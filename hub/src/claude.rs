//! Claude Code sessions, as their hooks report them. `airlock hook` runs from
//! each session's hooks (asynchronously, so it never slows Claude down) and
//! forwards the event to the admin socket.

use std::{
    collections::{HashMap, VecDeque},
    sync::{Arc, Mutex},
};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

const TIMELINE_MAX: usize = 60;
const ENDED_KEEP_SECS: i64 = 10 * 60;
const SILENT_DROP_SECS: i64 = 12 * 3600;
const TEXT_MAX: usize = 160;

/// The tool input fields the hub keeps; file contents and edits never leave
/// the hook.
pub const KEPT_INPUT_FIELDS: [&str; 9] = [
    "file_path",
    "notebook_path",
    "path",
    "command",
    "description",
    "pattern",
    "url",
    "query",
    "subagent_type",
];

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct HookReport {
    pub event: Value,
    /// `$TMUX`: the tmux server's socket path, its pid and session index.
    #[serde(default)]
    pub tmux: Option<String>,
    /// `$TMUX_PANE`, like `%12`.
    #[serde(default)]
    pub pane: Option<String>,
    /// When the hook ran, in milliseconds since the epoch. Hooks run in the
    /// background and can arrive out of order; older news doesn't overwrite
    /// newer.
    #[serde(default)]
    pub at_ms: i64,
    /// The Claude Code process the hook ran for, so the hub can tell where
    /// it runs when it isn't in tmux.
    #[serde(default)]
    pub claude_pid: Option<i32>,
}

/// File contents, edits and tool results are dropped.
pub fn trim_event(event: &Value) -> Value {
    let mut kept = Map::new();
    for field in [
        "hook_event_name",
        "session_id",
        "cwd",
        "tool_name",
        "notification_type",
        "message",
        "title",
        "prompt",
        "source",
        "reason",
        "session_title",
        "model",
        "tool_use_id",
    ] {
        if let Some(value) = event.get(field) {
            let value = match value {
                Value::String(text) => Value::String(clip(text, 2 * TEXT_MAX)),
                other => other.clone(),
            };
            kept.insert(field.to_owned(), value);
        }
    }
    if let Some(Value::Object(input)) = event.get("tool_input") {
        let input: Map<String, Value> = input
            .iter()
            .filter(|(key, _)| KEPT_INPUT_FIELDS.contains(&key.as_str()))
            .map(|(key, value)| match value {
                Value::String(text) => (key.clone(), Value::String(clip(text, 2 * TEXT_MAX))),
                other => (key.clone(), other.clone()),
            })
            .collect();
        kept.insert("tool_input".to_owned(), Value::Object(input));
    }
    Value::Object(kept)
}

fn clip(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_owned();
    }
    let mut kept: String = text.chars().take(max - 1).collect();
    kept.push('…');
    kept
}

fn first_line(text: &str) -> String {
    clip(text.lines().next().unwrap_or_default().trim(), TEXT_MAX)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum State {
    Working,
    NeedsYou,
    Idle,
    Ended,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Waiting {
    /// `permission` (a tool wants to run) or `question` (anything else).
    pub kind: &'static str,
    pub headline: String,
    pub detail: Option<String>,
    /// When it started waiting, in seconds since the epoch.
    pub since: i64,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct Step {
    /// Its number in the session, for opening it later.
    pub seq: u64,
    pub at: i64,
    pub text: String,
    /// Relative to the session's folder.
    pub file: Option<String>,
    pub tool: Option<String>,
    pub input: Option<Value>,
    #[serde(skip)]
    pub tool_use_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Pane {
    pub socket: String,
    /// The pane id, like `%12`.
    pub pane: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Session {
    pub id: String,
    pub cwd: String,
    pub title: Option<String>,
    pub state: State,
    pub doing: String,
    pub waiting: Option<Waiting>,
    pub started_at: i64,
    pub updated_at: i64,
    pub pane: Option<Pane>,
    pub pid: Option<i32>,
    /// Newest first.
    pub timeline: VecDeque<Step>,
    #[serde(skip)]
    latest_ms: i64,
    #[serde(skip)]
    next_seq: u64,
}

/// The Claude Code process above the hook: hooks run in a shell Claude
/// started, so it's a parent or two up. Found by its name or command
/// (`claude`, or a file in a `claude` folder like `…/claude/versions/2.1.293`).
pub fn claude_above() -> Option<i32> {
    let mut pid = std::os::unix::process::parent_id() as i32;
    for _ in 0..6 {
        if pid <= 1 {
            return None;
        }
        let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
        if is_claude(pid) {
            return Some(pid);
        }
        let parent = stat
            .rsplit_once(')')?
            .1
            .split_whitespace()
            .nth(1)?
            .parse()
            .ok()?;
        pid = parent;
    }
    None
}

pub fn is_claude(pid: i32) -> bool {
    let Ok(stat) = std::fs::read_to_string(format!("/proc/{pid}/stat")) else {
        return false;
    };
    let comm = stat
        .split_once('(')
        .and_then(|(_, rest)| rest.rsplit_once(')'))
        .map_or("", |(comm, _)| comm);
    let command = std::fs::read(format!("/proc/{pid}/cmdline")).unwrap_or_default();
    let first =
        String::from_utf8_lossy(command.split(|&byte| byte == 0).next().unwrap_or_default())
            .into_owned();
    comm == "claude"
        || first.split('/').any(|part| part == "claude")
        || first.contains("claude-code")
}

fn pane_of(report: &HookReport) -> Option<Pane> {
    let socket = report.tmux.as_deref()?.split(',').next()?.trim();
    let pane = report.pane.as_deref()?.trim();
    let valid = !socket.is_empty()
        && socket.starts_with('/')
        && pane.len() > 1
        && pane.starts_with('%')
        && pane[1..].chars().all(|c| c.is_ascii_digit());
    valid.then(|| Pane {
        socket: socket.to_owned(),
        pane: pane.to_owned(),
    })
}

fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value.get(key).and_then(Value::as_str).unwrap_or_default()
}

fn relative(path: &str, cwd: &str) -> String {
    let cwd = cwd.trim_end_matches('/');
    match path.strip_prefix(cwd) {
        Some(rest) if rest.starts_with('/') && !cwd.is_empty() => rest[1..].to_owned(),
        _ => path.to_owned(),
    }
}

/// A tool use in a few words, and the file it touches.
fn describe_tool(tool: &str, input: &Value, cwd: &str) -> (String, Option<String>) {
    let file = [text(input, "file_path"), text(input, "notebook_path")]
        .into_iter()
        .find(|path| !path.is_empty())
        .map(|path| relative(path, cwd));
    let command = first_line(text(input, "command"));
    match tool {
        "Edit" | "MultiEdit" | "Write" | "NotebookEdit" => (
            format!("Editing {}", file.clone().unwrap_or_default()),
            file,
        ),
        "Read" => (
            format!("Reading {}", file.clone().unwrap_or_default()),
            file,
        ),
        "Bash" => (format!("Running {command}"), None),
        "Grep" | "Glob" => ("Searching the code".to_owned(), None),
        "WebSearch" => ("Searching the web".to_owned(), None),
        "WebFetch" => (format!("Reading {}", first_line(text(input, "url"))), None),
        "Task" | "Agent" => ("Running a subagent".to_owned(), None),
        "TodoWrite" => ("Planning".to_owned(), None),
        other => (format!("Using {other}"), None),
    }
}

fn commit_message(command: &str) -> Option<String> {
    let rest = command.trim().strip_prefix("git commit")?;
    let after = rest.split_once("-m ")?.1.trim_start();
    let quote = after.chars().next().filter(|c| *c == '"' || *c == '\'')?;
    let message = after[1..].split(quote).next()?;
    Some(first_line(message))
}

fn step_for(tool: &str, input: &Value, cwd: &str, at: i64) -> Option<Step> {
    let (_, file) = describe_tool(tool, input, cwd);
    let text = match tool {
        "Edit" | "MultiEdit" | "NotebookEdit" => {
            format!("Edited {}", file.clone().unwrap_or_default())
        }
        "Write" => format!("Wrote {}", file.clone().unwrap_or_default()),
        "Read" => format!("Read {}", file.clone().unwrap_or_default()),
        "Bash" => {
            let command = text(input, "command");
            match commit_message(command) {
                Some(message) => format!("Committed \"{message}\""),
                None => format!("Ran {}", first_line(command)),
            }
        }
        "Grep" | "Glob" => format!("Searched for {}", first_line(text(input, "pattern"))),
        "WebFetch" => format!("Opened {}", first_line(text(input, "url"))),
        "WebSearch" => format!("Searched the web for {}", first_line(text(input, "query"))),
        "Task" | "Agent" => format!("Ran a subagent: {}", first_line(text(input, "description"))),
        _ => return None,
    };
    Some(Step {
        at,
        text,
        file,
        tool: Some(tool.to_owned()),
        input: Some(input.clone()),
        ..Step::default()
    })
}

fn permission_ask(tool: &str, input: &Value, cwd: &str) -> (String, Option<String>) {
    let (_, file) = describe_tool(tool, input, cwd);
    match tool {
        "Bash" => (
            "Claude wants to run".to_owned(),
            Some(clip(text(input, "command").trim(), 2 * TEXT_MAX)),
        ),
        "Edit" | "MultiEdit" | "Write" | "NotebookEdit" => {
            ("Claude wants to edit".to_owned(), file)
        }
        "WebFetch" => (
            "Claude wants to open".to_owned(),
            Some(first_line(text(input, "url"))),
        ),
        "" => ("Claude wants your permission".to_owned(), None),
        other => (format!("Claude wants to use {other}"), file),
    }
}

/// What an event changes about a session: its state, what it is doing, and
/// what it waits for.
type Change = (State, String, Option<Waiting>);

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Context {
    /// Percent of the window in use, 0 to 100.
    pub used: f64,
    /// The window's size, in tokens.
    pub size: u64,
}

/// `used` is a percent; `resets_at` is in seconds since the epoch.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Limit {
    pub used: f64,
    pub resets_at: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Usage {
    pub five_hour: Option<Limit>,
    pub seven_day: Option<Limit>,
    pub at: i64,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct StatusReport {
    pub session_id: String,
    #[serde(default)]
    pub context: Option<Context>,
    #[serde(default)]
    pub five_hour: Option<Limit>,
    #[serde(default)]
    pub seven_day: Option<Limit>,
}

impl StatusReport {
    /// The parts of Claude Code's status line input Airlock keeps; nothing
    /// of what the session says or does.
    pub fn from_status_line(input: &Value) -> Self {
        let number = |value: &Value| value.as_f64();
        let limit = |value: &Value| {
            number(&value["used_percentage"]).map(|used| Limit {
                used: used.clamp(0.0, 100.0),
                resets_at: value["resets_at"].as_i64(),
            })
        };
        let window = &input["context_window"];
        Self {
            session_id: input["session_id"].as_str().unwrap_or_default().to_owned(),
            context: number(&window["used_percentage"]).map(|used| Context {
                used: used.clamp(0.0, 100.0),
                size: window["context_window_size"].as_u64().unwrap_or(0),
            }),
            five_hour: limit(&input["rate_limits"]["five_hour"]),
            seven_day: limit(&input["rate_limits"]["seven_day"]),
        }
    }
}

#[derive(Clone, Default)]
pub struct Sessions {
    inner: Arc<Mutex<HashMap<String, Session>>>,
    contexts: Arc<Mutex<HashMap<String, Context>>>,
    usage: Arc<Mutex<Option<Usage>>>,
}

impl Sessions {
    pub fn status(&self, report: &StatusReport, now: i64) {
        if let Some(context) = report.context
            && !report.session_id.is_empty()
            && report.session_id.len() <= 100
        {
            let mut contexts = self.contexts.lock().unwrap_or_else(|p| p.into_inner());
            contexts.insert(report.session_id.clone(), context);
            // Only sessions still known keep theirs.
            let known = self.lock();
            contexts.retain(|id, _| known.contains_key(id) || *id == report.session_id);
        }
        if report.five_hour.is_some() || report.seven_day.is_some() {
            *self.usage.lock().unwrap_or_else(|p| p.into_inner()) = Some(Usage {
                five_hour: report.five_hour,
                seven_day: report.seven_day,
                at: now,
            });
        }
    }

    pub fn context(&self, id: &str) -> Option<Context> {
        self.contexts
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .get(id)
            .copied()
    }

    pub fn usage(&self) -> Option<Usage> {
        self.usage.lock().unwrap_or_else(|p| p.into_inner()).clone()
    }

    pub fn new() -> Self {
        Self::default()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Session>> {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Takes in one hook event. Returns whether the session now stands
    /// differently: it's new, in another state, or waiting on something
    /// else; a step taken or a new "doing" line isn't.
    pub fn record(&self, report: &HookReport, now: i64) -> bool {
        let event = &report.event;
        let id = text(event, "session_id");
        if id.is_empty() || id.len() > 100 {
            return false;
        }
        let name = text(event, "hook_event_name");
        let mut sessions = self.lock();
        let before = sessions
            .get(id)
            .map(|session| (session.state, session.waiting.clone()));
        let session = sessions.entry(id.to_owned()).or_insert_with(|| Session {
            id: id.to_owned(),
            cwd: String::new(),
            title: None,
            state: State::Idle,
            doing: "Started".to_owned(),
            waiting: None,
            started_at: now,
            updated_at: now,
            pane: None,
            pid: None,
            timeline: VecDeque::new(),
            latest_ms: 0,
            next_seq: 1,
        });
        let cwd = text(event, "cwd");
        if !cwd.is_empty() {
            session.cwd = cwd.to_owned();
        }
        if let Some(pane) = pane_of(report) {
            session.pane = Some(pane);
        }
        if let Some(pid) = report.claude_pid.filter(|pid| *pid > 1) {
            session.pid = Some(pid);
        }
        let title = text(event, "session_title");
        if !title.is_empty() {
            session.title = Some(first_line(title));
        }
        session.updated_at = now;
        let at = if report.at_ms > 0 {
            report.at_ms / 1000
        } else {
            now
        };
        // Steps are kept whatever the order; the state follows the newest.
        let newest = report.at_ms == 0 || report.at_ms >= session.latest_ms;
        if newest {
            session.latest_ms = report.at_ms;
        }
        let tool = text(event, "tool_name");
        let empty = Value::Object(Map::new());
        let input = event.get("tool_input").unwrap_or(&empty);
        let cwd = session.cwd.as_str();
        let thinking = || Some((State::Working, "Thinking".to_owned(), None));
        let needs_you = |kind, headline: String, detail| {
            Some((
                State::NeedsYou,
                headline.clone(),
                Some(Waiting {
                    kind,
                    headline,
                    detail,
                    since: at,
                }),
            ))
        };
        let (next, step): (Option<Change>, Option<Step>) = match name {
            "SessionStart" => (
                Some((
                    State::Idle,
                    "Waiting for your first message".to_owned(),
                    None,
                )),
                None,
            ),
            "UserPromptSubmit" => {
                let prompt = first_line(text(event, "prompt"));
                let step = (!prompt.is_empty()).then(|| Step {
                    at,
                    text: format!("You asked: {prompt}"),
                    ..Step::default()
                });
                (thinking(), step)
            }
            "PreToolUse" => {
                let (doing, _) = describe_tool(tool, input, cwd);
                (Some((State::Working, doing, None)), None)
            }
            "PermissionRequest" => {
                let (headline, detail) = permission_ask(tool, input, cwd);
                (needs_you("permission", headline, detail), None)
            }
            "PostToolUse" | "PostToolUseFailure" => {
                let step = step_for(tool, input, cwd, at).map(|step| Step {
                    text: if name == "PostToolUseFailure" {
                        format!("{} (failed)", step.text)
                    } else {
                        step.text
                    },
                    tool_use_id: Some(text(event, "tool_use_id").to_owned())
                        .filter(|id| !id.is_empty()),
                    ..step
                });
                (thinking(), step)
            }
            "PermissionDenied" => {
                let (doing, _) = describe_tool(tool, input, cwd);
                let step = Step {
                    at,
                    text: format!("Was denied: {doing}"),
                    ..Step::default()
                };
                (thinking(), Some(step))
            }
            "Notification" => {
                let message = first_line(text(event, "message"));
                let next = match text(event, "notification_type") {
                    // A PermissionRequest says more; its detail stays.
                    "permission_prompt"
                        if session
                            .waiting
                            .as_ref()
                            .is_some_and(|waiting| waiting.kind == "permission") =>
                    {
                        None
                    }
                    "permission_prompt" => needs_you("permission", message, None),
                    "idle_prompt" => Some((
                        State::Idle,
                        "Waiting for your next message".to_owned(),
                        None,
                    )),
                    "elicitation_dialog" | "elicitation_url_dialog" | "agent_needs_input" => {
                        needs_you("question", message, None)
                    }
                    _ => None,
                };
                (next, None)
            }
            "Stop" => (
                Some((State::Idle, "Finished; waiting for you".to_owned(), None)),
                None,
            ),
            "StopFailure" => (
                Some((State::Idle, "Stopped on an error".to_owned(), None)),
                None,
            ),
            "SessionEnd" => (Some((State::Ended, "Ended".to_owned(), None)), None),
            _ => (None, None),
        };
        if let Some((state, doing, waiting)) = next
            && newest
        {
            session.state = state;
            session.doing = doing;
            session.waiting = waiting;
        }
        if let Some(step) = step {
            push(session, step);
        }
        before != Some((session.state, session.waiting.clone()))
    }

    pub fn list(&self, now: i64) -> Vec<Session> {
        let mut sessions = self.lock();
        sessions.retain(|_, session| {
            let quiet = now - session.updated_at;
            match session.state {
                State::Ended => quiet < ENDED_KEEP_SECS,
                _ => quiet < SILENT_DROP_SECS,
            }
        });
        let mut list: Vec<Session> = sessions.values().cloned().collect();
        list.sort_by_key(|session| {
            (
                session.state != State::NeedsYou,
                session.state == State::Ended,
                std::cmp::Reverse(session.updated_at),
            )
        });
        list
    }

    pub fn get(&self, id: &str) -> Option<Session> {
        self.lock().get(id).cloned()
    }

    pub fn end(&self, id: &str, now: i64) {
        if let Some(session) = self.lock().get_mut(id)
            && session.state != State::Ended
        {
            session.state = State::Ended;
            session.doing = "Ended".to_owned();
            session.waiting = None;
            session.updated_at = now;
        }
    }

    pub fn answered(&self, id: &str, now: i64) {
        if let Some(session) = self.lock().get_mut(id) {
            session.state = State::Working;
            session.doing = "Thinking".to_owned();
            session.waiting = None;
            session.updated_at = now;
        }
    }

    /// The sessions still going, as the hub keeps them across a restart.
    pub fn kept(&self) -> Vec<Kept> {
        self.lock()
            .values()
            .filter(|session| session.state != State::Ended)
            .map(Kept::from)
            .collect()
    }

    /// Takes back the sessions kept before a restart, whose Claude is still
    /// the same process: a session waiting on you sends nothing until you
    /// answer, so the hub couldn't hear of it again otherwise.
    pub fn restore(&self, kept: Vec<Kept>) {
        let mut sessions = self.lock();
        for kept in kept {
            let same_process = match (kept.pid, kept.pid_started) {
                (Some(pid), Some(started)) => process_started(pid) == Some(started),
                // In a tmux pane, the hub checks the pane is still there.
                (None, _) => kept.pane.is_some(),
                (Some(_), None) => false,
            };
            if same_process && !sessions.contains_key(&kept.id) {
                let session = kept.into_session();
                sessions.insert(session.id.clone(), session);
            }
        }
    }
}

/// When process `pid` started, in clock ticks after boot: with its pid, it
/// names one process even after the pid is reused.
fn process_started(pid: i32) -> Option<u64> {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    stat.rsplit_once(')')?
        .1
        .split_whitespace()
        .nth(19)?
        .parse()
        .ok()
}

/// A session as the hub keeps it across a restart: everything it knew,
/// with its Claude process named by pid and start time.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Kept {
    id: String,
    cwd: String,
    title: Option<String>,
    state: State,
    doing: String,
    /// `(kind, headline, detail, since)`.
    waiting: Option<(String, String, Option<String>, i64)>,
    started_at: i64,
    updated_at: i64,
    /// `(socket, pane)`.
    pane: Option<(String, String)>,
    pid: Option<i32>,
    pid_started: Option<u64>,
    /// `(seq, at, text, file, tool, input, tool_use_id)`, newest first.
    #[allow(clippy::type_complexity)]
    timeline: Vec<(
        u64,
        i64,
        String,
        Option<String>,
        Option<String>,
        Option<Value>,
        Option<String>,
    )>,
    latest_ms: i64,
    next_seq: u64,
}

impl Kept {
    pub fn id(&self) -> &str {
        &self.id
    }

    fn into_session(self) -> Session {
        Session {
            id: self.id,
            cwd: self.cwd,
            title: self.title,
            state: self.state,
            doing: self.doing,
            waiting: self.waiting.map(|(kind, headline, detail, since)| Waiting {
                kind: if kind == "permission" {
                    "permission"
                } else {
                    "question"
                },
                headline,
                detail,
                since,
            }),
            started_at: self.started_at,
            updated_at: self.updated_at,
            pane: self.pane.map(|(socket, pane)| Pane { socket, pane }),
            pid: self.pid,
            timeline: self
                .timeline
                .into_iter()
                .map(|(seq, at, text, file, tool, input, tool_use_id)| Step {
                    seq,
                    at,
                    text,
                    file,
                    tool,
                    input,
                    tool_use_id,
                })
                .collect(),
            latest_ms: self.latest_ms,
            next_seq: self.next_seq,
        }
    }
}

impl From<&Session> for Kept {
    fn from(session: &Session) -> Self {
        Self {
            id: session.id.clone(),
            cwd: session.cwd.clone(),
            title: session.title.clone(),
            state: session.state,
            doing: session.doing.clone(),
            waiting: session.waiting.as_ref().map(|waiting| {
                (
                    waiting.kind.to_owned(),
                    waiting.headline.clone(),
                    waiting.detail.clone(),
                    waiting.since,
                )
            }),
            started_at: session.started_at,
            updated_at: session.updated_at,
            pane: session
                .pane
                .as_ref()
                .map(|pane| (pane.socket.clone(), pane.pane.clone())),
            pid: session.pid,
            pid_started: session.pid.and_then(process_started),
            timeline: session
                .timeline
                .iter()
                .map(|step| {
                    (
                        step.seq,
                        step.at,
                        step.text.clone(),
                        step.file.clone(),
                        step.tool.clone(),
                        step.input.clone(),
                        step.tool_use_id.clone(),
                    )
                })
                .collect(),
            latest_ms: session.latest_ms,
            next_seq: session.next_seq,
        }
    }
}

fn push(session: &mut Session, mut step: Step) {
    step.seq = session.next_seq;
    session.next_seq += 1;
    // Newest first; a late step slots in by time.
    let at = session
        .timeline
        .iter()
        .position(|known| known.at <= step.at)
        .unwrap_or(session.timeline.len());
    session.timeline.insert(at, step);
    session.timeline.truncate(TIMELINE_MAX);
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn a_status_line_gives_the_context_and_the_plans_usage_and_nothing_else() {
        let input = json!({
            "session_id": "s1",
            "transcript_path": "/home/me/.claude/projects/x/s1.jsonl",
            "model": {"id": "claude-opus-5-5", "display_name": "Opus 5.5"},
            "context_window": {"used_percentage": 42.4, "context_window_size": 1_000_000},
            "rate_limits": {
                "five_hour": {"used_percentage": 18.0, "resets_at": 1_792_250_000},
                "seven_day": {"used_percentage": 61.5, "resets_at": 1_792_600_000}
            }
        });
        let report = StatusReport::from_status_line(&input);
        assert_eq!(
            report.context,
            Some(Context {
                used: 42.4,
                size: 1_000_000
            })
        );
        assert_eq!(report.five_hour.unwrap().used, 18.0);
        let sessions = Sessions::new();
        sessions.status(&report, 100);
        assert_eq!(sessions.context("s1").unwrap().used, 42.4);
        let usage = sessions.usage().unwrap();
        assert_eq!(usage.seven_day.unwrap().resets_at, Some(1_792_600_000));
        assert_eq!(usage.at, 100);
        // Nothing to say: nothing kept, the last usage stays.
        sessions.status(&StatusReport::from_status_line(&json!({})), 200);
        assert_eq!(sessions.usage().unwrap().at, 100);
    }

    fn report(event: Value, at_ms: i64) -> HookReport {
        HookReport {
            event: trim_event(&event),
            tmux: Some("/tmp/tmux-1000/airlock,4242,0".to_owned()),
            pane: Some("%7".to_owned()),
            at_ms,
            claude_pid: None,
        }
    }

    fn hook(name: &str, extra: Value) -> Value {
        let mut event = json!({
            "hook_event_name": name,
            "session_id": "s1",
            "cwd": "/home/me/Projects/app",
            "transcript_path": "/home/me/.claude/projects/x/s1.jsonl",
        });
        if let (Value::Object(event), Value::Object(extra)) = (&mut event, extra) {
            event.extend(extra);
        }
        event
    }

    #[test]
    fn file_contents_never_reach_the_hub() {
        let event = hook(
            "PreToolUse",
            json!({
                "tool_name": "Write",
                "tool_input": {"file_path": "/home/me/Projects/app/.env", "content": "SECRET=1"},
                "tool_response": {"content": "SECRET=1"},
            }),
        );
        let kept = trim_event(&event).to_string();
        assert!(!kept.contains("SECRET"), "{kept}");
        assert!(!kept.contains("transcript_path"), "{kept}");
        assert!(kept.contains(".env"), "{kept}");
    }

    #[test]
    fn a_session_waiting_on_you_is_still_there_after_the_hub_restarts() {
        let before = Sessions::new();
        // Its Claude is this test's own process, so it is still running.
        let mut asking = report(
            hook(
                "PermissionRequest",
                json!({"tool_name": "Bash", "tool_input": {"command": "pnpm test"}}),
            ),
            2_000,
        );
        (asking.tmux, asking.pane) = (None, None);
        asking.claude_pid = Some(std::process::id() as i32);
        before.record(&asking, 2);
        let mut gone = report(hook("Stop", json!({"session_id": "s2"})), 3_000);
        (gone.tmux, gone.pane) = (None, None);
        gone.claude_pid = Some(i32::MAX - 1);
        before.record(&gone, 3);

        // Kept through the store, as across a restart.
        let mut store = crate::store::Store::open_in_memory().unwrap();
        store.keep_live_sessions(&before.kept()).unwrap();
        let after = Sessions::new();
        after.restore(store.live_sessions().unwrap());

        let session = after.get("s1").expect("still waiting on you");
        assert_eq!(session.state, State::NeedsYou);
        assert_eq!(
            session
                .waiting
                .as_ref()
                .map(|w| (w.kind, w.detail.as_deref())),
            Some(("permission", Some("pnpm test")))
        );
        assert_eq!(session, before.get("s1").unwrap(), "everything it knew");
        assert!(after.get("s2").is_none(), "its Claude is gone");

        // A pid now held by a different process isn't the same Claude.
        let mut renamed = before.kept();
        for kept in &mut renamed {
            kept.pid_started = kept.pid_started.map(|started| started + 1);
        }
        let other = Sessions::new();
        other.restore(renamed);
        assert!(other.get("s1").is_none());
    }

    #[test]
    fn a_session_works_asks_and_finishes() {
        let sessions = Sessions::new();
        sessions.record(
            &report(hook("SessionStart", json!({"source": "startup"})), 1_000),
            1,
        );
        let started = sessions.get("s1").unwrap();
        assert_eq!(started.state, State::Idle);
        assert_eq!(
            started.pane,
            Some(Pane {
                socket: "/tmp/tmux-1000/airlock".to_owned(),
                pane: "%7".to_owned()
            })
        );

        sessions.record(
            &report(
                hook(
                    "UserPromptSubmit",
                    json!({"prompt": "fix the tests\nplease"}),
                ),
                2_000,
            ),
            2,
        );
        sessions.record(
            &report(
                hook(
                    "PreToolUse",
                    json!({"tool_name": "Edit", "tool_input": {"file_path": "/home/me/Projects/app/src/lib.rs"}}),
                ),
                3_000,
            ),
            3,
        );
        let working = sessions.get("s1").unwrap();
        assert_eq!(working.state, State::Working);
        assert_eq!(working.doing, "Editing src/lib.rs");

        sessions.record(
            &report(
                hook(
                    "PostToolUse",
                    json!({"tool_name": "Edit", "tool_input": {"file_path": "/home/me/Projects/app/src/lib.rs"}}),
                ),
                4_000,
            ),
            4,
        );
        sessions.record(
            &report(
                hook(
                    "PermissionRequest",
                    json!({"tool_name": "Bash", "tool_input": {"command": "pnpm test"}}),
                ),
                5_000,
            ),
            5,
        );
        sessions.record(
            &report(
                hook(
                    "Notification",
                    json!({"notification_type": "permission_prompt", "message": "Claude needs your permission to use Bash"}),
                ),
                5_100,
            ),
            5,
        );
        let asking = sessions.get("s1").unwrap();
        assert_eq!(asking.state, State::NeedsYou);
        let waiting = asking.waiting.unwrap();
        assert_eq!(waiting.headline, "Claude wants to run");
        assert_eq!(
            waiting.detail.as_deref(),
            Some("pnpm test"),
            "the request's detail outlives the notification"
        );

        sessions.record(
            &report(
                hook(
                    "PostToolUse",
                    json!({"tool_name": "Bash", "tool_input": {"command": "git commit -m \"Tests pass again\" -q"}}),
                ),
                6_000,
            ),
            6,
        );
        sessions.record(&report(hook("Stop", json!({})), 7_000), 7);
        let done = sessions.get("s1").unwrap();
        assert_eq!(done.state, State::Idle);
        let steps: Vec<&str> = done
            .timeline
            .iter()
            .map(|step| step.text.as_str())
            .collect();
        assert_eq!(
            steps,
            [
                "Committed \"Tests pass again\"",
                "Edited src/lib.rs",
                "You asked: fix the tests"
            ]
        );
    }

    #[test]
    fn late_news_does_not_overwrite_newer() {
        let sessions = Sessions::new();
        sessions.record(&report(hook("Stop", json!({})), 9_000), 9);
        sessions.record(
            &report(
                hook("PreToolUse", json!({"tool_name": "Read", "tool_input": {}})),
                8_000,
            ),
            9,
        );
        assert_eq!(sessions.get("s1").unwrap().state, State::Idle);
    }

    #[test]
    fn needs_you_comes_first_and_ended_sessions_fade() {
        let sessions = Sessions::new();
        let other = |id: &str, name: &str, extra: Value| {
            let mut event = hook(name, extra);
            event["session_id"] = json!(id);
            report(event, 0)
        };
        sessions.record(&other("old", "Stop", json!({})), 100);
        sessions.record(
            &other(
                "asks",
                "PermissionRequest",
                json!({"tool_name": "Bash", "tool_input": {"command": "ls"}}),
            ),
            50,
        );
        sessions.record(
            &other("gone", "SessionEnd", json!({"reason": "other"})),
            100,
        );
        let order: Vec<String> = sessions.list(100).into_iter().map(|s| s.id).collect();
        assert_eq!(order, ["asks", "old", "gone"]);
        let later: Vec<String> = sessions
            .list(100 + ENDED_KEEP_SECS)
            .into_iter()
            .map(|s| s.id)
            .collect();
        assert_eq!(later, ["asks", "old"]);
    }

    #[test]
    fn panes_come_from_tmux_variables_only_when_well_formed() {
        let mut bad = report(hook("Stop", json!({})), 0);
        bad.pane = Some("%7; rm -rf /".to_owned());
        assert_eq!(pane_of(&bad), None);
        bad.pane = Some("%7".to_owned());
        bad.tmux = Some("relative/socket,1,0".to_owned());
        assert_eq!(pane_of(&bad), None);
        bad.tmux = None;
        assert_eq!(pane_of(&bad), None);
    }

    #[test]
    fn commit_messages_are_read_from_the_command() {
        assert_eq!(
            commit_message("git commit -m 'Fix it'").as_deref(),
            Some("Fix it")
        );
        assert_eq!(
            commit_message("git commit -q -m \"Two words\"").as_deref(),
            Some("Two words")
        );
        assert_eq!(commit_message("git commit -F - <<EOF"), None);
        assert_eq!(commit_message("git status"), None);
    }
}
