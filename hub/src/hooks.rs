//! Adds Airlock's hooks to Claude Code's settings (`~/.claude/settings.json`),
//! or takes them out again. Each hook runs `airlock hook` in the background
//! (`"async": true`), so it never slows Claude down, and prints nothing, so
//! it never changes what Claude sees. Everything else in the settings is
//! left exactly as it was.

use std::path::Path;

use anyhow::{Context, Result, bail};
use serde_json::{Map, Value, json};

pub const EVENTS: [&str; 11] = [
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PermissionRequest",
    "PermissionDenied",
    "PostToolUse",
    "PostToolUseFailure",
    "Notification",
    "Stop",
    "StopFailure",
    "SessionEnd",
];

fn is_ours(handler: &Value) -> bool {
    handler
        .get("command")
        .and_then(Value::as_str)
        .is_some_and(|command| command.trim_end().ends_with("airlock hook"))
}

fn is_our_status_line(settings: &Value) -> bool {
    settings["statusLine"]["command"]
        .as_str()
        .is_some_and(|command| command.trim_end().ends_with("airlock statusline"))
}

pub fn command_for(binary: &Path) -> String {
    format!("{} hook", binary.display())
}

/// An Airlock hook already there is replaced, so installing again updates
/// the path.
pub fn install(settings: &Value, command: &str) -> Result<Value> {
    let mut settings = remove(settings)?;
    let root = settings
        .as_object_mut()
        .context("the settings file isn't a JSON object")?;
    let hooks = root
        .entry("hooks")
        .or_insert_with(|| Value::Object(Map::new()))
        .as_object_mut()
        .context("\"hooks\" in the settings isn't an object")?;
    for event in EVENTS {
        let groups = hooks
            .entry(event)
            .or_insert_with(|| Value::Array(Vec::new()))
            .as_array_mut()
            .with_context(|| format!("\"hooks.{event}\" in the settings isn't a list"))?;
        groups.push(json!({
            "hooks": [{"type": "command", "command": command, "async": true}]
        }));
    }
    // The status line passes on each session's context and the plan's
    // usage; one of your own is left as it is.
    if !root.contains_key("statusLine")
        && let Some(binary) = command.trim_end().strip_suffix(" hook")
    {
        root.insert(
            "statusLine".to_owned(),
            json!({"type": "command", "command": format!("{binary} statusline")}),
        );
    }
    Ok(settings)
}

pub fn remove(settings: &Value) -> Result<Value> {
    let ours = is_our_status_line(settings);
    let mut settings = settings.clone();
    let Some(root) = settings.as_object_mut() else {
        bail!("the settings file isn't a JSON object");
    };
    if ours {
        root.remove("statusLine");
    }
    let Some(hooks) = root.get_mut("hooks") else {
        return Ok(settings);
    };
    let Some(events) = hooks.as_object_mut() else {
        bail!("\"hooks\" in the settings isn't an object");
    };
    for groups in events.values_mut() {
        let Some(groups) = groups.as_array_mut() else {
            continue;
        };
        for group in groups.iter_mut() {
            if let Some(handlers) = group.get_mut("hooks").and_then(Value::as_array_mut) {
                handlers.retain(|handler| !is_ours(handler));
            }
        }
        groups.retain(|group| {
            group
                .get("hooks")
                .and_then(Value::as_array)
                .is_none_or(|handlers| !handlers.is_empty())
        });
    }
    events.retain(|_, groups| groups.as_array().is_none_or(|groups| !groups.is_empty()));
    if events.is_empty() {
        root.remove("hooks");
    }
    Ok(settings)
}

pub fn installed(settings: &Value) -> bool {
    EVENTS.iter().all(|event| {
        settings["hooks"][event].as_array().is_some_and(|groups| {
            groups.iter().any(|group| {
                group["hooks"]
                    .as_array()
                    .is_some_and(|handlers| handlers.iter().any(is_ours))
            })
        })
    })
}

pub fn read(path: &Path) -> Result<Value> {
    match std::fs::read_to_string(path) {
        Ok(text) => serde_json::from_str(&text)
            .with_context(|| format!("{} isn't valid JSON; fix it first", path.display())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(json!({})),
        Err(error) => Err(error).with_context(|| format!("reading {}", path.display())),
    }
}

pub fn write(path: &Path, before: &Value, settings: &Value) -> Result<bool> {
    if before == settings {
        return Ok(false);
    }
    if path.exists() {
        let backup = path.with_extension("json.airlock-backup");
        std::fs::copy(path, &backup)
            .with_context(|| format!("backing up {} to {}", path.display(), backup.display()))?;
    } else if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).with_context(|| format!("creating {}", dir.display()))?;
    }
    let mut text = serde_json::to_string_pretty(settings)?;
    text.push('\n');
    // Written whole, then moved into place, so Claude never reads half a file.
    let partial = path.with_extension("json.airlock-partial");
    std::fs::write(&partial, text).with_context(|| format!("writing {}", partial.display()))?;
    std::fs::rename(&partial, path).with_context(|| format!("replacing {}", path.display()))?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    const COMMAND: &str = "/home/me/.local/bin/airlock hook";

    fn theirs() -> Value {
        json!({
            "model": "opus",
            "hooks": {
                "PreToolUse": [
                    {"matcher": "Bash", "hooks": [{"type": "command", "command": "~/.claude/guard.sh"}]}
                ]
            }
        })
    }

    #[test]
    fn installing_adds_ours_and_keeps_theirs() {
        let settings = install(&theirs(), COMMAND).unwrap();
        assert!(installed(&settings));
        assert_eq!(settings["model"], "opus");
        let pre = settings["hooks"]["PreToolUse"].as_array().unwrap();
        assert_eq!(pre.len(), 2, "their guard and ours");
        assert_eq!(pre[0]["hooks"][0]["command"], "~/.claude/guard.sh");
        assert_eq!(pre[1]["hooks"][0]["command"], COMMAND);
        assert_eq!(pre[1]["hooks"][0]["async"], true);
        assert!(pre[1].get("matcher").is_none(), "ours follows every tool");
        assert_eq!(
            settings["statusLine"]["command"],
            "/home/me/.local/bin/airlock statusline"
        );
        // A status line of your own stays yours.
        let mine = json!({"statusLine": {"type": "command", "command": "~/my-line.sh"}});
        assert_eq!(
            install(&mine, COMMAND).unwrap()["statusLine"]["command"],
            "~/my-line.sh"
        );
        assert_eq!(remove(&install(&mine, COMMAND).unwrap()).unwrap(), mine);
    }

    #[test]
    fn installing_twice_changes_nothing_more() {
        let once = install(&theirs(), COMMAND).unwrap();
        let twice = install(&once, COMMAND).unwrap();
        assert_eq!(once, twice);
        let moved = install(&once, "/opt/airlock hook").unwrap();
        assert_eq!(
            moved["hooks"]["Stop"][0]["hooks"][0]["command"],
            "/opt/airlock hook"
        );
        assert_eq!(moved["hooks"]["Stop"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn removing_leaves_theirs_as_it_was() {
        let installed_settings = install(&theirs(), COMMAND).unwrap();
        assert_eq!(remove(&installed_settings).unwrap(), theirs());
        assert_eq!(
            remove(&install(&json!({}), COMMAND).unwrap()).unwrap(),
            json!({})
        );
    }

    #[test]
    fn settings_of_the_wrong_shape_are_refused() {
        assert!(install(&json!([]), COMMAND).is_err());
        assert!(install(&json!({"hooks": []}), COMMAND).is_err());
    }

    #[test]
    fn writing_keeps_a_backup_and_skips_no_ops() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, theirs().to_string()).unwrap();
        let before = read(&path).unwrap();
        assert!(
            !write(&path, &before, &before).unwrap(),
            "nothing changed, nothing written"
        );
        let after = install(&before, COMMAND).unwrap();
        assert!(write(&path, &before, &after).unwrap());
        assert_eq!(read(&path).unwrap(), after);
        let backup = dir.path().join("settings.json.airlock-backup");
        assert_eq!(read(&backup).unwrap(), theirs());
        assert_eq!(read(&dir.path().join("missing.json")).unwrap(), json!({}));
    }
}
