//! The laptop's side of the phone's edits, on the admin socket: what each
//! one changes, and writing it once you approve. An edit is written only if
//! the file is still as the phone read it; if it changed on the laptop since,
//! you see both changes and choose: merge them (when they don't overlap),
//! write the phone's version over the laptop's, or keep the laptop's.

use std::{os::unix::fs::PermissionsExt, path::Path};

use anyhow::{Context, Result, bail};
use axum::{
    Json, Router,
    body::Bytes,
    extract::{Path as UrlPath, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};

use crate::{
    events::Event,
    repos::{self, Diff},
    state::{AppState, internal_error},
    store::{Change, Settings},
    token,
};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/changes", get(list))
        .route("/changes/{id}", get(detail))
        .route("/changes/{id}/apply", post(apply))
        .route("/changes/{id}/decline", post(decline))
        .route("/settings", get(settings).put(save_settings))
}

fn refusal(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({"error": message}))).into_response()
}

fn sha256(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

pub fn diff(path: &str, before: &str, after: &str) -> Diff {
    let text = similar::TextDiff::from_lines(before, after)
        .unified_diff()
        .context_radius(3)
        .header(&format!("a/{path}"), &format!("b/{path}"))
        .to_string();
    repos::parse_diff(&format!("diff --git a/{path} b/{path}\n{text}"))
}

/// The three-way merge of the laptop's and the phone's changes to `base`,
/// by `git merge-file`. `Ok(Some(text))` when they don't overlap.
pub async fn merge(base: &str, laptop: &str, phone: &str) -> Result<Option<String>> {
    let dir = tempfile_dir()?;
    let write = |name: &str, text: &str| -> Result<std::path::PathBuf> {
        let path = dir.join(name);
        std::fs::write(&path, text)?;
        Ok(path)
    };
    let (laptop_file, base_file, phone_file) = (
        write("laptop", laptop)?,
        write("base", base)?,
        write("phone", phone)?,
    );
    let output = tokio::process::Command::new("git")
        .args([
            "merge-file",
            "-p",
            "-L",
            "laptop",
            "-L",
            "as the phone read it",
            "-L",
            "phone",
        ])
        .arg(&laptop_file)
        .arg(&base_file)
        .arg(&phone_file)
        .output()
        .await
        .context("running git merge-file");
    let _ = std::fs::remove_dir_all(&dir);
    let output = output?;
    // The exit code is the number of conflicts; below zero is an error.
    match output.status.code() {
        Some(0) => Ok(Some(String::from_utf8_lossy(&output.stdout).into_owned())),
        Some(code) if code > 0 => Ok(None),
        _ => bail!(
            "git merge-file: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ),
    }
}

fn tempfile_dir() -> Result<std::path::PathBuf> {
    let base = std::env::var_os("XDG_RUNTIME_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    let dir = base.join(format!("airlock-merge-{}", token::id()));
    std::fs::create_dir(&dir).with_context(|| format!("creating {}", dir.display()))?;
    std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700))?;
    Ok(dir)
}

pub fn write_file(path: &Path, text: &str) -> Result<()> {
    let mode = std::fs::metadata(path)
        .with_context(|| format!("reading {}", path.display()))?
        .permissions()
        .mode();
    let name = path
        .file_name()
        .context("the path has no file name")?
        .to_string_lossy();
    let partial = path.with_file_name(format!(".{name}.airlock-{}", token::id()));
    let written = (|| -> Result<()> {
        std::fs::write(&partial, text)?;
        std::fs::set_permissions(&partial, std::fs::Permissions::from_mode(mode))?;
        std::fs::File::open(&partial)?.sync_all()?;
        std::fs::rename(&partial, path)?;
        Ok(())
    })();
    if written.is_err() {
        let _ = std::fs::remove_file(&partial);
    }
    written.with_context(|| format!("writing {}", path.display()))
}

/// Its text and hash, or `None` if it's gone or unreadable.
fn current(path: &str) -> Option<(String, String)> {
    let bytes = std::fs::read(path).ok()?;
    let hash = sha256(&bytes);
    Some((String::from_utf8_lossy(&bytes).into_owned(), hash))
}

#[derive(Serialize)]
struct ChangeView<'a> {
    #[serde(flatten)]
    change: &'a Change,
    /// The file is no longer as the phone read it.
    conflict: bool,
    missing: bool,
}

async fn list(State(state): State<AppState>) -> Response {
    let changes = state.store().changes(None, 30);
    match changes {
        Ok(changes) => {
            let views: Vec<ChangeView> = changes
                .iter()
                .map(|change| {
                    let now = (change.state == "pending")
                        .then(|| current(&change.path))
                        .flatten();
                    ChangeView {
                        change,
                        conflict: now
                            .as_ref()
                            .is_some_and(|(_, hash)| *hash != change.base_hash),
                        missing: change.state == "pending" && now.is_none(),
                    }
                })
                .collect();
            Json(views).into_response()
        }
        Err(error) => internal_error(error),
    }
}

// A refusal is the whole response; this runs once per request, so its size
// doesn't matter.
#[allow(clippy::result_large_err)]
fn find(state: &AppState, id: &str) -> Result<Change, Response> {
    match state.store().change(id) {
        Ok(Some(change)) => Ok(change),
        Ok(None) => Err(refusal(StatusCode::NOT_FOUND, "No edit has that id.")),
        Err(error) => Err(internal_error(error)),
    }
}

async fn detail(State(state): State<AppState>, UrlPath(id): UrlPath<String>) -> Response {
    let change = match find(&state, &id) {
        Ok(change) => change,
        Err(refused) => return refused,
    };
    let phone_diff = diff(&change.path, &change.base_text, &change.new_text);
    let now = current(&change.path);
    let conflict = now
        .as_ref()
        .is_some_and(|(_, hash)| *hash != change.base_hash);
    let (laptop_diff, merged) = match (&now, conflict) {
        (Some((text, _)), true) => {
            let merged = match merge(&change.base_text, text, &change.new_text).await {
                Ok(merged) => merged,
                Err(error) => return internal_error(error),
            };
            (Some(diff(&change.path, &change.base_text, text)), merged)
        }
        _ => (None, None),
    };
    Json(json!({
        "change": ChangeView { change: &change, conflict, missing: now.is_none() },
        "phone_diff": phone_diff,
        "laptop_diff": laptop_diff,
        "can_merge": merged.is_some(),
    }))
    .into_response()
}

#[derive(Deserialize)]
struct Apply {
    /// `phone`: the phone's version; `merge`: both changes merged.
    #[serde(rename = "use")]
    with: String,
    /// Write the phone's version even though the file changed on the laptop.
    #[serde(default)]
    overwrite: bool,
}

async fn apply(
    State(state): State<AppState>,
    UrlPath(id): UrlPath<String>,
    bytes: Bytes,
) -> Response {
    let Ok(Apply { with, overwrite }) = serde_json::from_slice(&bytes) else {
        return refusal(
            StatusCode::BAD_REQUEST,
            "Expected {\"use\": \"phone\" | \"merge\"}.",
        );
    };
    let change = match find(&state, &id) {
        Ok(change) => change,
        Err(refused) => return refused,
    };
    if change.state != "pending" {
        return refusal(StatusCode::CONFLICT, "That edit was already answered.");
    }
    let Some((now, hash)) = current(&change.path) else {
        return refusal(StatusCode::CONFLICT, "The file is gone from the laptop.");
    };
    let unchanged = hash == change.base_hash;
    let (text, outcome) = match (with.as_str(), unchanged, overwrite) {
        ("phone", true, _) => (change.new_text.clone(), "written"),
        ("phone", false, true) => (change.new_text.clone(), "written over the laptop's changes"),
        ("phone", false, false) => {
            return refusal(
                StatusCode::CONFLICT,
                "The file changed on the laptop since the phone read it.",
            );
        }
        ("merge", _, _) => match merge(&change.base_text, &now, &change.new_text).await {
            Ok(Some(merged)) => (merged, "merged with the laptop's changes"),
            Ok(None) => {
                return refusal(
                    StatusCode::CONFLICT,
                    "The changes overlap, so they can't be merged by themselves.",
                );
            }
            Err(error) => return internal_error(error),
        },
        _ => return refusal(StatusCode::BAD_REQUEST, "Use \"phone\" or \"merge\"."),
    };
    if let Err(error) = write_file(Path::new(&change.path), &text) {
        return internal_error(error);
    }
    match state
        .store()
        .settle_change(&id, "written", outcome, "laptop")
    {
        Ok(_) => {
            state.events.send(Event::ChangeDecided { id });
            Json(json!({"outcome": outcome})).into_response()
        }
        Err(error) => internal_error(error),
    }
}

async fn decline(State(state): State<AppState>, UrlPath(id): UrlPath<String>) -> Response {
    let settled =
        state
            .store()
            .settle_change(&id, "declined", "kept the laptop's version", "laptop");
    match settled {
        Ok(true) => {
            state.events.send(Event::ChangeDecided { id });
            StatusCode::NO_CONTENT.into_response()
        }
        Ok(false) => refusal(StatusCode::CONFLICT, "That edit isn't waiting."),
        Err(error) => internal_error(error),
    }
}

async fn settings(State(state): State<AppState>) -> Response {
    let settings = state.store().settings();
    match settings {
        Ok(settings) => Json(settings).into_response(),
        Err(error) => internal_error(error),
    }
}

async fn save_settings(State(state): State<AppState>, bytes: Bytes) -> Response {
    let Ok(settings) = serde_json::from_slice::<Settings>(&bytes) else {
        return refusal(StatusCode::BAD_REQUEST, "Expected the settings.");
    };
    let saved = state.store().save_settings(&settings, "laptop");
    match saved {
        Ok(()) => {
            state.events.send(Event::SettingsChanged);
            Json(settings).into_response()
        }
        Err(error) => internal_error(error),
    }
}

#[cfg(test)]
mod tests {
    use axum::{Extension, body::Body, http::Request};
    use http_body_util::BodyExt;
    use serde_json::Value;
    use tower::ServiceExt;

    use super::*;
    use crate::{
        admin, files, phone::Paired, state::testing::state_in, store::Device, terminals::Tmux,
    };

    async fn call(router: &Router, method: &str, uri: &str, body: Value) -> (StatusCode, Value) {
        let body = if body.is_null() {
            Body::empty()
        } else {
            Body::from(body.to_string())
        };
        let request = Request::builder()
            .method(method)
            .uri(uri)
            .header("content-type", "application/json")
            .body(body)
            .unwrap();
        let response = router.clone().oneshot(request).await.unwrap();
        let status = response.status();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        )
    }

    fn phone_and_laptop(root: &Path) -> (Router, Router) {
        let unused = Tmux::new(format!("airlock-unused-{}", token::id()), "/dev/null");
        let state = state_in(unused, root);
        let device = Device {
            id: "d1".to_owned(),
            name: "Test phone".to_owned(),
            login: "you@example.com".to_owned(),
            created_at: 0,
            last_seen: 0,
            face_id: false,
        };
        let phone = files::routes()
            .layer(Extension(Paired(Some(device))))
            .with_state(state.clone());
        (phone, admin::router(state))
    }

    #[tokio::test]
    async fn the_phones_edit_is_written_only_once_the_laptop_approves() {
        let root = tempfile::tempdir().unwrap();
        let file = root.path().join("notes.md");
        std::fs::write(&file, "one\ntwo\nthree\n").unwrap();
        let (phone, laptop) = phone_and_laptop(root.path());

        let (status, read) = call(
            &phone,
            "GET",
            "/api/files/read?path=~/notes.md",
            Value::Null,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(read["kind"], "markdown");
        let base = read["text"].as_str().unwrap().to_owned();
        let proposal =
            json!({"path": "~/notes.md", "base_text": base, "text": "one\nTWO\nthree\n"});
        let (status, proposed) = call(&phone, "POST", "/api/files/changes", proposal).await;
        assert_eq!(status, StatusCode::CREATED, "{proposed}");
        let id = proposed["id"].as_str().unwrap().to_owned();
        assert_eq!(
            std::fs::read_to_string(&file).unwrap(),
            "one\ntwo\nthree\n",
            "nothing written yet"
        );

        let (_, waiting) = call(&laptop, "GET", "/changes", Value::Null).await;
        assert_eq!(waiting[0]["state"], "pending");
        assert_eq!(waiting[0]["conflict"], false);
        let (_, detail) = call(&laptop, "GET", &format!("/changes/{id}"), Value::Null).await;
        assert_eq!(detail["phone_diff"]["files"][0]["added"], 1);
        assert_eq!(detail["laptop_diff"], Value::Null);

        let (status, applied) = call(
            &laptop,
            "POST",
            &format!("/changes/{id}/apply"),
            json!({"use": "phone"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{applied}");
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "one\nTWO\nthree\n");
        let (_, mine) = call(&phone, "GET", "/api/files/changes", Value::Null).await;
        assert_eq!(mine["changes"][0]["state"], "written");
        assert_eq!(mine["changes"][0]["path"], "~/notes.md");
    }

    #[tokio::test]
    async fn a_file_changed_on_the_laptop_is_never_overwritten_by_accident() {
        let root = tempfile::tempdir().unwrap();
        let file = root.path().join("plan.txt");
        std::fs::write(&file, "one\ntwo\nthree\nfour\nfive\n").unwrap();
        let (phone, laptop) = phone_and_laptop(root.path());

        let proposal = json!({
            "path": "~/plan.txt",
            "base_text": "one\ntwo\nthree\nfour\nfive\n",
            "text": "one\ntwo\nthree\nfour\nFIVE\n",
        });
        let (_, proposed) = call(&phone, "POST", "/api/files/changes", proposal).await;
        let id = proposed["id"].as_str().unwrap().to_owned();
        // Meanwhile, on the laptop:
        std::fs::write(&file, "ONE\ntwo\nthree\nfour\nfive\n").unwrap();

        let (_, detail) = call(&laptop, "GET", &format!("/changes/{id}"), Value::Null).await;
        assert_eq!(detail["change"]["conflict"], true);
        assert_eq!(detail["can_merge"], true);
        assert_eq!(detail["laptop_diff"]["files"][0]["removed"], 1);

        let apply = format!("/changes/{id}/apply");
        let (status, refused) = call(&laptop, "POST", &apply, json!({"use": "phone"})).await;
        assert_eq!(status, StatusCode::CONFLICT);
        assert_eq!(
            refused["error"],
            "The file changed on the laptop since the phone read it."
        );
        assert_eq!(
            std::fs::read_to_string(&file).unwrap(),
            "ONE\ntwo\nthree\nfour\nfive\n"
        );

        let (status, merged) = call(&laptop, "POST", &apply, json!({"use": "merge"})).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(merged["outcome"], "merged with the laptop's changes");
        assert_eq!(
            std::fs::read_to_string(&file).unwrap(),
            "ONE\ntwo\nthree\nfour\nFIVE\n"
        );
        let (status, _) = call(&laptop, "POST", &apply, json!({"use": "phone"})).await;
        assert_eq!(status, StatusCode::CONFLICT, "answered once only");
    }

    #[tokio::test]
    async fn secrets_follow_the_laptops_setting() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join(".env"), "TOKEN=abc\n").unwrap();
        let (phone, laptop) = phone_and_laptop(root.path());
        let read = "/api/files/read?path=~/.env";
        assert_eq!(
            call(&phone, "GET", read, Value::Null).await.0,
            StatusCode::OK,
            "on by default"
        );

        let (status, _) = call(
            &laptop,
            "PUT",
            "/settings",
            json!({"sensitive_files": false}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let (status, refused) = call(&phone, "GET", read, Value::Null).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        assert!(
            refused["error"]
                .as_str()
                .unwrap()
                .contains("turned off on the laptop")
        );
        let proposal = json!({"path": "~/.env", "base_text": "TOKEN=abc\n", "text": "TOKEN=x\n"});
        assert_eq!(
            call(&phone, "POST", "/api/files/changes", proposal).await.0,
            StatusCode::FORBIDDEN
        );
        let (_, listed) = call(&phone, "GET", "/api/files?path=~&hidden=1", Value::Null).await;
        assert_eq!(
            listed["entries"][0]["sensitive"], true,
            "still listed, marked"
        );
    }

    #[tokio::test]
    async fn the_phone_can_take_back_a_waiting_edit() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("a.txt"), "a\n").unwrap();
        let (phone, laptop) = phone_and_laptop(root.path());
        let proposal = json!({"path": "~/a.txt", "base_text": "a\n", "text": "b\n"});
        let (_, proposed) = call(&phone, "POST", "/api/files/changes", proposal).await;
        let id = proposed["id"].as_str().unwrap();
        let path = format!("/api/files/changes/{id}");
        assert_eq!(
            call(&phone, "DELETE", &path, Value::Null).await.0,
            StatusCode::NO_CONTENT
        );
        let apply = format!("/changes/{id}/apply");
        assert_eq!(
            call(&laptop, "POST", &apply, json!({"use": "phone"}))
                .await
                .0,
            StatusCode::CONFLICT
        );
        assert_eq!(
            std::fs::read_to_string(root.path().join("a.txt")).unwrap(),
            "a\n"
        );
    }

    #[tokio::test]
    async fn changes_that_dont_overlap_merge() {
        let base = "one\ntwo\nthree\nfour\nfive\nsix\n";
        let laptop = "ONE\ntwo\nthree\nfour\nfive\nsix\n";
        let phone = "one\ntwo\nthree\nfour\nfive\nSIX\n";
        assert_eq!(
            merge(base, laptop, phone).await.unwrap().as_deref(),
            Some("ONE\ntwo\nthree\nfour\nfive\nSIX\n")
        );
        let clash = "one\ntwo\nthree\nfour\nfive\nsix\n".replace("one", "uno");
        assert_eq!(merge(base, laptop, &clash).await.unwrap(), None);
    }

    #[test]
    fn writing_keeps_the_files_permissions() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("run.sh");
        std::fs::write(&path, "echo old\n").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o750)).unwrap();
        write_file(&path, "echo new\n").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "echo new\n");
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o750);
        let leftovers = std::fs::read_dir(dir.path()).unwrap().count();
        assert_eq!(leftovers, 1, "no partial file left behind");
    }

    #[test]
    fn diffs_read_line_by_line() {
        let diff = diff("README.md", "a\nb\nc\n", "a\nB\nc\n");
        assert_eq!(diff.files.len(), 1);
        assert_eq!((diff.files[0].added, diff.files[0].removed), (1, 1));
        assert_eq!(diff.files[0].path, "README.md");
    }
}
