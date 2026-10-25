//! What a Claude session still runs in the background, even once it's back
//! at its prompt: the commands it started that haven't ended (Claude Code
//! runs each in a shell of its own, under its process), and its background
//! agents still at work (their transcripts, beside the session's, still
//! being written).

use std::{
    collections::HashMap,
    path::Path,
    time::{Duration, SystemTime},
};

use crate::{system::Proc, transcript};

/// An agent whose transcript changed this recently is still at work.
const AGENT_FRESH: Duration = Duration::from_secs(120);
const SHOWN_MAX: usize = 6;
const COMMAND_MAX: usize = 80;

/// The command a Claude Code shell runs: Claude wraps each in
/// `bash -c 'source <snapshot> … && eval '<command>' \< /dev/null && pwd …'`.
pub fn wrapped_command(args: &[String]) -> Option<String> {
    let line = args.join(" ");
    if !line.contains("shell-snapshots/snapshot-") {
        return None;
    }
    let start = line.find("eval '")? + "eval '".len();
    let rest = &line[start..];
    let end = rest
        .find("' \\< /dev/null")
        .or_else(|| rest.find("' < /dev/null"))
        .or_else(|| rest.rfind('\''))?;
    let command = rest[..end].replace("'\\''", "'");
    let command = command.split_whitespace().collect::<Vec<_>>().join(" ");
    Some(if command.chars().count() > COMMAND_MAX {
        format!("{}…", command.chars().take(COMMAND_MAX).collect::<String>())
    } else {
        command
    })
}

pub fn commands(pid: i32, processes: &[Proc]) -> Vec<String> {
    let mut children: HashMap<i32, Vec<&Proc>> = HashMap::new();
    for process in processes {
        children.entry(process.ppid).or_default().push(process);
    }
    let mut found = Vec::new();
    let mut waiting = vec![pid];
    while let Some(parent) = waiting.pop() {
        for child in children.get(&parent).into_iter().flatten() {
            match wrapped_command(&child.args) {
                // A shell Claude ran a command in: the command, and not
                // what it started in turn.
                Some(command) => found.push(command),
                None => waiting.push(child.pid),
            }
        }
    }
    found.sort();
    found.dedup();
    found
}

pub fn agents(id: &str, claude: &Path, now: SystemTime) -> Vec<String> {
    let Some(transcript) = transcript::transcript_of(id, claude) else {
        return Vec::new();
    };
    let Ok(entries) = std::fs::read_dir(transcript.with_extension("").join("subagents")) else {
        return Vec::new();
    };
    let mut found = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path
            .extension()
            .is_none_or(|extension| extension != "jsonl")
        {
            continue;
        }
        let fresh = entry
            .metadata()
            .and_then(|meta| meta.modified())
            .is_ok_and(|modified| now.duration_since(modified).unwrap_or_default() < AGENT_FRESH);
        if !fresh {
            continue;
        }
        let description = std::fs::read_to_string(path.with_extension("meta.json"))
            .ok()
            .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
            .and_then(|meta| meta["description"].as_str().map(str::to_owned))
            .unwrap_or_else(|| "an agent".to_owned());
        found.push(format!("agent: {description}"));
    }
    found.sort();
    found
}

pub fn of(
    id: &str,
    pid: Option<i32>,
    processes: &[Proc],
    claude: &Path,
    now: SystemTime,
) -> Vec<String> {
    let mut all = agents(id, claude, now);
    if let Some(pid) = pid {
        all.extend(commands(pid, processes));
    }
    all.truncate(SHOWN_MAX);
    all
}

#[cfg(test)]
mod tests {
    use super::*;

    fn process(pid: i32, ppid: i32, args: &[&str]) -> Proc {
        Proc {
            pid,
            ppid,
            comm: args[0]
                .rsplit('/')
                .next()
                .unwrap_or_default()
                .chars()
                .take(15)
                .collect(),
            args: args.iter().map(|arg| (*arg).to_owned()).collect(),
            started: 0,
            cpu_ticks: 0,
            rss_bytes: 0,
            tty: 0,
            state: 'S',
            nice: 0,
            threads: 1,
            uid: 1000,
        }
    }

    const WRAPPED: &str = "source /home/me/.claude/shell-snapshots/snapshot-bash-1-x.sh 2>/dev/null || true && shopt -u extglob 2>/dev/null || true && eval 'cd ui && npx playwright test e2e/game.spec.ts' \\< /dev/null && pwd -P >| /tmp/claude-ab12-cwd";

    #[test]
    fn a_claude_shell_is_named_by_the_command_it_runs() {
        let args = ["/bin/bash".to_owned(), "-c".to_owned(), WRAPPED.to_owned()];
        assert_eq!(
            wrapped_command(&args).as_deref(),
            Some("cd ui && npx playwright test e2e/game.spec.ts")
        );
        assert_eq!(
            wrapped_command(&["/bin/bash".to_owned(), "-i".to_owned()]),
            None
        );
    }

    #[test]
    fn only_what_claude_started_counts_once_each() {
        let processes = [
            process(10, 1, &["claude"]),
            process(11, 10, &["/bin/bash", "-c", WRAPPED]),
            // What the command started in turn isn't listed again.
            process(12, 11, &["node", "playwright", "test"]),
            // Something of Claude's own, like an MCP server: looked into,
            // not listed.
            process(13, 10, &["node", "mcp-server.js"]),
            process(20, 1, &["/bin/bash", "-c", WRAPPED]),
        ];
        assert_eq!(
            commands(10, &processes),
            ["cd ui && npx playwright test e2e/game.spec.ts"]
        );
        assert!(commands(99, &processes).is_empty());
    }
}
