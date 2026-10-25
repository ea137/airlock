//! A Claude Code session's transcript, read when the phone opens one of its
//! steps: the tool's full input and what it gave back. Claude Code keeps
//! each session in `~/.claude/projects/<folder>/<session id>.jsonl`; the hub
//! reads only that file, found by the session's id, when asked, and keeps
//! nothing it reads. (The phone has a terminal on this laptop, so it could
//! read the file anyway; this just shows it well.)

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;
use similar::{ChangeTag, TextDiff};

const TEXT_MAX: usize = 60_000;

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ToolCall {
    pub tool: String,
    pub input: Value,
    pub output: Option<String>,
    pub failed: bool,
    /// For an edit: its lines, `-` removed, `+` added, ` ` kept.
    pub diff: Vec<DiffLine>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct DiffLine {
    pub tag: char,
    pub text: String,
}

pub fn claude_dir() -> PathBuf {
    match std::env::var_os("CLAUDE_CONFIG_DIR") {
        Some(dir) if !dir.is_empty() => PathBuf::from(dir),
        _ => PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(".claude"),
    }
}

/// The id is checked to be a plain name first, so it can't point anywhere
/// else.
pub fn transcript_of(id: &str, claude: &Path) -> Option<PathBuf> {
    let plain = !id.is_empty()
        && id.len() <= 100
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if !plain {
        return None;
    }
    let projects = claude.join("projects");
    std::fs::read_dir(projects)
        .ok()?
        .flatten()
        .map(|folder| folder.path().join(format!("{id}.jsonl")))
        .find(|path| path.is_file())
}

fn cut(text: &str) -> String {
    if text.len() <= TEXT_MAX {
        return text.to_owned();
    }
    let mut end = TEXT_MAX;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    format!(
        "{}\n… (cut: {} more characters)",
        &text[..end],
        text.len() - end
    )
}

fn cut_all(value: &Value) -> Value {
    match value {
        Value::String(text) => Value::String(cut(text)),
        Value::Array(items) => Value::Array(items.iter().map(cut_all).collect()),
        Value::Object(fields) => Value::Object(
            fields
                .iter()
                .map(|(key, value)| (key.clone(), cut_all(value)))
                .collect(),
        ),
        other => other.clone(),
    }
}

fn result_text(content: &Value) -> String {
    match content {
        Value::String(text) => text.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter_map(|part| part.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

/// Whether a full input is the one the hook's trimmed copy came from: each
/// field the hook kept matches (the hook cut long values with `…`).
fn same_input(full: &Value, kept: &Value) -> bool {
    let Some(kept) = kept.as_object() else {
        return true;
    };
    kept.iter()
        .all(|(key, value)| match (full.get(key), value) {
            (Some(Value::String(full)), Value::String(kept)) => match kept.strip_suffix('…') {
                Some(start) => full.starts_with(start),
                None => full == kept,
            },
            (Some(full), kept) => full == kept,
            (None, _) => false,
        })
}

fn diff_lines(old: &str, new: &str) -> Vec<DiffLine> {
    TextDiff::from_lines(old, new)
        .iter_all_changes()
        .map(|change| DiffLine {
            tag: match change.tag() {
                ChangeTag::Delete => '-',
                ChangeTag::Insert => '+',
                ChangeTag::Equal => ' ',
            },
            text: change.value().trim_end_matches('\n').to_owned(),
        })
        .collect()
}

fn edit_diff(tool: &str, input: &Value) -> Vec<DiffLine> {
    let field = |value: &Value, key: &str| {
        value
            .get(key)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned()
    };
    match tool {
        "Edit" => diff_lines(&field(input, "old_string"), &field(input, "new_string")),
        "MultiEdit" => input
            .get("edits")
            .and_then(Value::as_array)
            .map(|edits| {
                edits
                    .iter()
                    .enumerate()
                    .flat_map(|(index, edit)| {
                        let mut lines = if index > 0 {
                            vec![DiffLine {
                                tag: '@',
                                text: String::new(),
                            }]
                        } else {
                            Vec::new()
                        };
                        lines.extend(diff_lines(
                            &field(edit, "old_string"),
                            &field(edit, "new_string"),
                        ));
                        lines
                    })
                    .collect()
            })
            .unwrap_or_default(),
        _ => Vec::new(),
    }
}

/// The tool use a step stands for: by its id when the hook knew it, else
/// the last use of `tool` whose input matches what the hook kept.
pub fn find_call(
    transcript: &str,
    tool_use_id: Option<&str>,
    tool: &str,
    kept: &Value,
) -> Option<ToolCall> {
    let mut found: Option<(String, Value)> = None;
    let mut results: Vec<(String, String, bool)> = Vec::new();
    for line in transcript.lines() {
        let Ok(entry) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let Some(parts) = entry.pointer("/message/content").and_then(Value::as_array) else {
            continue;
        };
        for part in parts {
            match part.get("type").and_then(Value::as_str) {
                Some("tool_use") => {
                    let id = part.get("id").and_then(Value::as_str).unwrap_or_default();
                    let name = part.get("name").and_then(Value::as_str).unwrap_or_default();
                    let input = part.get("input").cloned().unwrap_or(Value::Null);
                    let matches = match tool_use_id {
                        Some(wanted) => id == wanted,
                        None => name == tool && same_input(&input, kept),
                    };
                    if matches {
                        found = Some((id.to_owned(), input));
                    }
                }
                Some("tool_result") => {
                    let id = part
                        .get("tool_use_id")
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    let failed = part
                        .get("is_error")
                        .and_then(Value::as_bool)
                        .unwrap_or(false);
                    results.push((
                        id.to_owned(),
                        result_text(part.get("content").unwrap_or(&Value::Null)),
                        failed,
                    ));
                }
                _ => {}
            }
        }
    }
    let (id, input) = found?;
    let result = results
        .into_iter()
        .rev()
        .find(|(result_id, _, _)| *result_id == id);
    Some(ToolCall {
        diff: edit_diff(tool, &input),
        tool: tool.to_owned(),
        input: cut_all(&input),
        output: result.as_ref().map(|(_, text, _)| cut(text)),
        failed: result.is_some_and(|(_, _, failed)| failed),
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn transcript() -> String {
        [
            json!({"type": "user", "message": {"role": "user", "content": "fix the readme"}}),
            json!({"type": "assistant", "message": {"content": [
                {"type": "text", "text": "Looking."},
                {"type": "tool_use", "id": "toolu_1", "name": "Bash", "input": {"command": "ls", "description": "List files"}},
            ]}}),
            json!({"type": "user", "message": {"content": [
                {"type": "tool_result", "tool_use_id": "toolu_1", "content": "README.md\nsrc"},
            ]}}),
            json!({"type": "assistant", "message": {"content": [
                {"type": "tool_use", "id": "toolu_2", "name": "Edit", "input": {
                    "file_path": "/home/me/app/README.md",
                    "old_string": "# app\nold line\n",
                    "new_string": "# app\nnew line\n",
                }},
            ]}}),
            json!({"type": "user", "message": {"content": [
                {"type": "tool_result", "tool_use_id": "toolu_2", "content": [{"type": "text", "text": "Updated."}]},
            ]}}),
            json!({"type": "assistant", "message": {"content": [
                {"type": "tool_use", "id": "toolu_3", "name": "Bash", "input": {"command": "false"}},
            ]}}),
            json!({"type": "user", "message": {"content": [
                {"type": "tool_result", "tool_use_id": "toolu_3", "content": "Exit code 1", "is_error": true},
            ]}}),
        ]
        .iter()
        .map(Value::to_string)
        .collect::<Vec<_>>()
        .join("\n")
    }

    #[test]
    fn a_step_is_found_by_its_id_with_what_it_gave_back() {
        let call = find_call(&transcript(), Some("toolu_1"), "Bash", &json!({})).unwrap();
        assert_eq!(call.input["command"], "ls");
        assert_eq!(call.output.as_deref(), Some("README.md\nsrc"));
        assert!(!call.failed);
    }

    #[test]
    fn without_an_id_the_input_the_hook_kept_finds_it() {
        let call = find_call(&transcript(), None, "Bash", &json!({"command": "false"})).unwrap();
        assert!(call.failed);
        assert_eq!(call.output.as_deref(), Some("Exit code 1"));
        assert_eq!(
            find_call(&transcript(), None, "Bash", &json!({"command": "rm"})),
            None
        );
    }

    #[test]
    fn an_edit_comes_with_its_diff() {
        let call = find_call(
            &transcript(),
            None,
            "Edit",
            &json!({"file_path": "/home/me/app/README.md"}),
        )
        .unwrap();
        let lines: Vec<String> = call
            .diff
            .iter()
            .map(|line| format!("{}{}", line.tag, line.text))
            .collect();
        assert_eq!(lines, [" # app", "-old line", "+new line"]);
        assert_eq!(call.output.as_deref(), Some("Updated."));
    }

    #[test]
    fn only_a_plain_session_id_names_a_transcript() {
        let claude = tempfile::tempdir().unwrap();
        let folder = claude.path().join("projects/-home-me-app");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join("5acfb07e-0d5c-405c.jsonl"), transcript()).unwrap();
        assert!(transcript_of("5acfb07e-0d5c-405c", claude.path()).is_some());
        assert_eq!(transcript_of("../../etc/passwd", claude.path()), None);
        assert_eq!(transcript_of("missing", claude.path()), None);
    }

    #[test]
    fn long_text_is_cut() {
        let long = "x".repeat(TEXT_MAX + 10);
        assert!(cut(&long).ends_with("(cut: 10 more characters)"));
    }
}
