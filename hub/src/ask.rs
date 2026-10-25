//! Ask Claude, from the phone: a question about what's on screen (a port, a
//! failed service, a process, the laptop as a whole), answered by Claude Code
//! running on the laptop with your own login.
//!
//! It can look but not change: restricted mode (no command-running tools
//! but Bash, no WebFetch, your Claude settings and hooks left out, so the
//! question doesn't show up in Work), the tools that read files and search,
//! and Bash for a list of read-only commands only; anything else is refused
//! without asking (`dontAsk`). Airlock's own secrets, SSH and GPG keys and
//! Claude's login are kept from it. Nothing is kept (`--no-session-
//! persistence`): a follow-up carries the conversation so far.

use std::{
    path::{Path, PathBuf},
    sync::OnceLock,
    time::{Duration, Instant},
};

use axum::{
    Extension, Json, Router,
    body::{Body, Bytes},
    extract::State,
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use futures_util::stream;
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::{Child, ChildStdout},
    sync::Semaphore,
};

use crate::{
    phone::{Paired, unpaired},
    state::AppState,
};

/// The first is the default.
pub const MODELS: [(&str, &str); 3] = [
    ("claude-sonnet-5-5", "Sonnet 5.5"),
    ("claude-opus-5-5", "Opus 5.5"),
    ("claude-haiku-5-5", "Haiku 5.5"),
];
const ANSWER_LIMIT: Duration = Duration::from_secs(180);
/// Questions answered at once, by every phone together.
const AT_ONCE: usize = 2;
/// The longest question, context and conversation so far, in bytes.
const QUESTION_MAX: usize = 4_000;
const ABOUT_MAX: usize = 20_000;
const EARLIER_MAX: usize = 40_000;

const ROLE: &str = "You are answering a question from the owner of this Linux laptop, asked from their phone through Airlock, a remote for the laptop. \
When it helps, look things up on this laptop with the read-only tools you have; you can't change anything, and must not try. \
Answer for a phone screen: short and in plain words, the answer first. When the question is whether something is a problem, say whether it is safe to ignore, worth a look or worth fixing, and why. \
When there's something to do, give the exact commands the owner can run in a terminal on the laptop. Use Markdown sparingly: short lists and `code`.";

/// The commands Claude may run: ones that only read. Anything else is
/// refused. A rule matches what starts with it, flags included, so a
/// command with a flag that writes (`git diff --output`) or serves
/// (`tailscale status --web`) is left out or listed whole.
const READ_ONLY: &[&str] = &[
    "Bash(systemctl status:*)",
    "Bash(systemctl show:*)",
    "Bash(systemctl cat:*)",
    "Bash(systemctl list-units:*)",
    "Bash(systemctl list-timers:*)",
    "Bash(systemctl is-active:*)",
    "Bash(systemctl is-enabled:*)",
    "Bash(systemctl is-failed:*)",
    "Bash(systemctl --user status:*)",
    "Bash(systemctl --user show:*)",
    "Bash(systemctl --user cat:*)",
    "Bash(systemctl --user list-units:*)",
    "Bash(systemctl --user list-timers:*)",
    "Bash(ps:*)",
    "Bash(ss:*)",
    "Bash(df:*)",
    "Bash(du:*)",
    "Bash(free:*)",
    "Bash(uptime)",
    "Bash(uname:*)",
    "Bash(nproc)",
    "Bash(lscpu)",
    "Bash(lsblk:*)",
    "Bash(findmnt:*)",
    "Bash(ip -br addr)",
    "Bash(ip -br link)",
    "Bash(ip addr show:*)",
    "Bash(dpkg -l:*)",
    "Bash(dpkg -S:*)",
    "Bash(dpkg-query:*)",
    "Bash(apt list:*)",
    "Bash(apt-cache policy:*)",
    "Bash(apt-cache show:*)",
    "Bash(which:*)",
    "Bash(id)",
    "Bash(hostnamectl status)",
    // Not `docker inspect`: a container's environment holds its passwords.
    "Bash(docker ps:*)",
    "Bash(docker images:*)",
    "Bash(tailscale status)",
    "Bash(tailscale status --json)",
    "Bash(upower -e)",
    "Bash(upower -i:*)",
    // Without the index lock (`GIT_OPTIONAL_LOCKS=0` below), it only reads.
    "Bash(git status:*)",
];

/// Files Claude may not read, whatever folder they're in. `//` starts a
/// path from the root, as Claude Code's rules write it.
const SECRETS: &[&str] = &[
    "Read(~/.config/airlock/**)",
    "Read(~/.ssh/**)",
    "Read(~/.gnupg/**)",
    "Read(~/.claude/.credentials.json)",
    "Read(~/.local/share/keyrings/**)",
    "Read(//proc/*/environ)",
];

const READABLE: &[&str] = &[
    "/etc",
    "/var/log",
    "/usr/lib/systemd",
    "/usr/share/doc",
    "/opt",
    "/proc",
];

#[derive(Deserialize)]
struct Turn {
    question: String,
    answer: String,
}

#[derive(Deserialize)]
struct Question {
    question: String,
    /// What the phone was showing, in words.
    #[serde(default)]
    about: Option<String>,
    #[serde(default)]
    earlier: Vec<Turn>,
    #[serde(default)]
    model: Option<String>,
}

fn refusal(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({"error": message}))).into_response()
}

fn home() -> PathBuf {
    std::env::var_os("HOME").map_or_else(|| PathBuf::from("/"), PathBuf::from)
}

fn prompt(question: &Question) -> String {
    let mut prompt = String::new();
    if let Some(about) = question
        .about
        .as_deref()
        .filter(|about| !about.trim().is_empty())
    {
        prompt.push_str("What I'm looking at in Airlock:\n");
        prompt.push_str(about.trim());
        prompt.push_str("\n\n");
    }
    if !question.earlier.is_empty() {
        prompt.push_str("Earlier in this conversation:\n");
        for turn in &question.earlier {
            prompt.push_str(&format!(
                "Q: {}\nA: {}\n",
                turn.question.trim(),
                turn.answer.trim()
            ));
        }
        prompt.push('\n');
    }
    prompt.push_str("My question: ");
    prompt.push_str(question.question.trim());
    prompt
}

fn looking(tool: &str, input: &Value) -> String {
    let field = |key: &str| input.get(key).and_then(Value::as_str).unwrap_or_default();
    let what = match tool {
        "Bash" => field("command"),
        "Read" => field("file_path"),
        "Grep" | "Glob" => field("pattern"),
        "WebSearch" => field("query"),
        _ => "",
    };
    let what: String = what
        .lines()
        .next()
        .unwrap_or_default()
        .chars()
        .take(160)
        .collect();
    if what.is_empty() {
        tool.to_owned()
    } else {
        what
    }
}

pub fn events_in(line: &str) -> Vec<Value> {
    let Ok(message) = serde_json::from_str::<Value>(line) else {
        return Vec::new();
    };
    match message.get("type").and_then(Value::as_str) {
        Some("stream_event") => {
            let delta = &message["event"]["delta"];
            match (message["event"]["type"].as_str(), delta["type"].as_str(), delta["text"].as_str()) {
                (Some("content_block_delta"), Some("text_delta"), Some(text)) => vec![json!({"text": text})],
                _ => Vec::new(),
            }
        }
        Some("assistant") => message["message"]["content"]
            .as_array()
            .map(|blocks| {
                blocks
                    .iter()
                    .filter(|block| block["type"] == "tool_use")
                    .map(|block| {
                        json!({"looking": looking(block["name"].as_str().unwrap_or_default(), &block["input"])})
                    })
                    .collect()
            })
            .unwrap_or_default(),
        Some("result") => {
            if message["subtype"] == "success" && message["is_error"] != true {
                vec![json!({"done": true})]
            } else {
                let why = message["result"]
                    .as_str()
                    .filter(|text| !text.is_empty())
                    .or_else(|| message["subtype"].as_str())
                    .unwrap_or("it stopped");
                vec![json!({"error": format!("Claude couldn't answer: {why}")})]
            }
        }
        _ => Vec::new(),
    }
}

fn models() -> Value {
    json!({"models": MODELS.iter().map(|(id, name)| json!({"id": id, "name": name})).collect::<Vec<_>>()})
}

async fn models_route(Extension(Paired(device)): Extension<Paired>) -> Response {
    if device.is_none() {
        return unpaired();
    }
    Json(models()).into_response()
}

struct Answering {
    lines: tokio::io::Lines<BufReader<ChildStdout>>,
    /// Killed when the answer is dropped, a phone that left included.
    _child: Child,
    _turn: tokio::sync::OwnedSemaphorePermit,
    deadline: Instant,
    ended: bool,
}

fn command(claude: &str, question: &Question, model: &str, home: &Path) -> tokio::process::Command {
    let mut command = tokio::process::Command::new(claude);
    command
        .arg("-p")
        .arg(prompt(question))
        .args(["--model", model])
        .args([
            "--restricted",
            "--strict-mcp-config",
            "--no-session-persistence",
        ])
        .args(["--permission-mode", "dontAsk"])
        .args([
            "--output-format",
            "stream-json",
            "--verbose",
            "--include-partial-messages",
        ])
        .args(["--append-system-prompt", ROLE])
        .args(["--tools", "Read", "Grep", "Glob", "Bash", "WebSearch"])
        .arg("--allowedTools")
        .args(READ_ONLY)
        .args(["Read", "Grep", "Glob", "WebSearch"])
        .arg("--disallowedTools")
        .args(SECRETS)
        .arg("--add-dir")
        .args(READABLE)
        .current_dir(home)
        // Its hooks are left out already; this says so to `airlock hook`.
        .env("AIRLOCK_ASK", "1")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    command
}

fn line_of(event: &Value) -> Bytes {
    Bytes::from(format!("{event}\n"))
}

async fn ask(
    State(state): State<AppState>,
    Extension(Paired(device)): Extension<Paired>,
    Json(question): Json<Question>,
) -> Response {
    if device.is_none() {
        return unpaired();
    }
    let earlier: usize = question
        .earlier
        .iter()
        .map(|turn| turn.question.len() + turn.answer.len())
        .sum();
    if question.question.trim().is_empty()
        || question.question.len() > QUESTION_MAX
        || question
            .about
            .as_ref()
            .is_some_and(|about| about.len() > ABOUT_MAX)
        || earlier > EARLIER_MAX
    {
        return refusal(
            StatusCode::BAD_REQUEST,
            "Ask a question, and not too long a one.",
        );
    }
    let model = match question.model.as_deref() {
        None => MODELS[0].0,
        Some(wanted) => match MODELS.iter().find(|(id, _)| *id == wanted) {
            Some((id, _)) => id,
            None => return refusal(StatusCode::BAD_REQUEST, "Airlock doesn't offer that model."),
        },
    };
    static TURNS: OnceLock<std::sync::Arc<Semaphore>> = OnceLock::new();
    let turns = TURNS.get_or_init(|| std::sync::Arc::new(Semaphore::new(AT_ONCE)));
    let Ok(turn) = turns.clone().try_acquire_owned() else {
        return refusal(
            StatusCode::TOO_MANY_REQUESTS,
            "Claude is already answering two questions; ask again in a moment.",
        );
    };

    let mut child = match command(&state.config.claude_command, &question, model, &home()).spawn() {
        Ok(child) => child,
        Err(error) => {
            return refusal(
                StatusCode::SERVICE_UNAVAILABLE,
                &format!("Couldn't start Claude Code on the laptop: {error}"),
            );
        }
    };
    let Some(stdout) = child.stdout.take() else {
        return refusal(
            StatusCode::SERVICE_UNAVAILABLE,
            "Couldn't read Claude's answer.",
        );
    };
    let answering = Answering {
        lines: BufReader::new(stdout).lines(),
        _child: child,
        _turn: turn,
        deadline: Instant::now() + ANSWER_LIMIT,
        ended: false,
    };
    let body = stream::unfold(answering, |mut answering| async move {
        if answering.ended {
            return None;
        }
        let left = answering.deadline.saturating_duration_since(Instant::now());
        let chunk = match tokio::time::timeout(left, answering.lines.next_line()).await {
            Ok(Ok(Some(line))) => {
                let events = events_in(&line);
                answering.ended = events
                    .iter()
                    .any(|event| event.get("done").is_some() || event.get("error").is_some());
                events
                    .iter()
                    .map(line_of)
                    .fold(Vec::new(), |mut all, bytes| {
                        all.extend_from_slice(&bytes);
                        all
                    })
            }
            Ok(_) => {
                answering.ended = true;
                line_of(&json!({"error": "Claude stopped without an answer."})).to_vec()
            }
            Err(_) => {
                answering.ended = true;
                line_of(&json!({"error": "Claude took too long to answer."})).to_vec()
            }
        };
        Some((Ok::<_, std::io::Error>(Bytes::from(chunk)), answering))
    });
    (
        [
            (header::CONTENT_TYPE, "application/x-ndjson"),
            (header::CACHE_CONTROL, "no-store"),
        ],
        Body::from_stream(body),
    )
        .into_response()
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/ask", post(ask))
        .route("/api/ask/models", get(models_route))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_output_becomes_what_the_phone_shows() {
        let looked = r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"systemctl status vboxdrv\nmore","description":"x"}}]}}"#;
        assert_eq!(
            events_in(looked),
            [json!({"looking": "systemctl status vboxdrv"})]
        );
        let piece = r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"It's safe "}}}"#;
        assert_eq!(events_in(piece), [json!({"text": "It's safe "})]);
        let done = r#"{"type":"result","subtype":"success","is_error":false,"result":"It's safe to ignore."}"#;
        assert_eq!(events_in(done), [json!({"done": true})]);
        let failed = r#"{"type":"result","subtype":"error_max_turns","is_error":true}"#;
        assert_eq!(
            events_in(failed),
            [json!({"error": "Claude couldn't answer: error_max_turns"})]
        );
        assert!(events_in(r#"{"type":"system","subtype":"init"}"#).is_empty());
        assert!(events_in("not json").is_empty());
    }

    #[test]
    fn the_question_carries_the_screen_and_the_conversation() {
        let question = Question {
            question: "Should I worry?".to_owned(),
            about: Some("Port 6379: Redis, open to all networks".to_owned()),
            earlier: vec![Turn {
                question: "What is it?".to_owned(),
                answer: "A database.".to_owned(),
            }],
            model: None,
        };
        let asked = prompt(&question);
        assert!(asked.starts_with("What I'm looking at in Airlock:\nPort 6379"));
        assert!(asked.contains("Q: What is it?\nA: A database."));
        assert!(asked.ends_with("My question: Should I worry?"));
    }

    #[tokio::test]
    #[ignore = "asks the real Claude Code, with your login"]
    async fn the_real_claude_looks_and_changes_nothing() {
        let made = std::env::temp_dir().join(format!("airlock-ask-{}", std::process::id()));
        let question = Question {
            question: format!(
                "Run `df -h /`, then run `touch {}`. Say in one line what each did.",
                made.display()
            ),
            about: None,
            earlier: Vec::new(),
            model: None,
        };
        let mut child = command("claude", &question, "claude-haiku-5-5", &home())
            .spawn()
            .unwrap();
        let mut lines = BufReader::new(child.stdout.take().unwrap()).lines();
        let mut events = Vec::new();
        while let Some(line) = tokio::time::timeout(ANSWER_LIMIT, lines.next_line())
            .await
            .unwrap()
            .unwrap()
        {
            events.extend(events_in(&line));
        }
        child.wait().await.unwrap();
        println!("{events:#?}");
        assert!(
            events.iter().any(|event| event["looking"]
                .as_str()
                .is_some_and(|it| it.starts_with("df"))),
            "it didn't look with df"
        );
        assert!(
            events.iter().any(|event| event["done"] == true),
            "no answer"
        );
        assert!(!made.exists(), "Claude made {}", made.display());
    }
}
