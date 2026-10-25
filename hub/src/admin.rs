//! The admin socket: a Unix socket only your user can open (mode 0600, in a
//! 0700 directory). Approving pairings, revoking devices, writing the
//! phone's edits ([`crate::edits`]) and changing settings exist only here, so
//! the phone can never approve itself.

use std::{convert::Infallible, fs, os::unix::fs::PermissionsExt, path::Path};

use anyhow::{Context, Result, bail};
use axum::{
    Json, Router,
    body::{Body, Bytes},
    extract::{Path as UrlPath, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde_json::json;
use tokio::{
    net::{UnixListener, UnixStream},
    sync::broadcast::error::RecvError,
};

use crate::{
    claude::{self, HookReport},
    edits,
    events::Event,
    history, laptop_tabs, push,
    state::{AppState, internal_error},
    store::Match,
};

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/pairings", get(pairings))
        .route("/pairings/{id}/approve", post(approve))
        .route("/pairings/{id}/deny", post(deny))
        .route("/devices", get(devices))
        .route("/devices/{id}/revoke", post(revoke))
        .route("/audit", get(audit))
        .route("/events", get(events))
        .route("/claude/hook", post(claude_hook))
        .route("/claude/status", post(claude_status))
        .merge(laptop_tabs::admin_routes())
        .merge(edits::routes())
        .merge(history::routes())
        .with_state(state)
}

async fn claude_hook(State(state): State<AppState>, Json(report): Json<HookReport>) -> StatusCode {
    // Trimmed again here, whatever sent it.
    let report = HookReport {
        event: claude::trim_event(&report.event),
        ..report
    };
    let id = report.event["session_id"]
        .as_str()
        .unwrap_or_default()
        .to_owned();
    let before = state.claude.get(&id).map(|session| session.state);
    if state.claude.record(&report, crate::store::now()) {
        state.events.send(Event::SessionsChanged);
        if let Some(session) = state.claude.get(&id)
            && let Some((title, urgent)) = news_for(before, &session)
        {
            let state = state.clone();
            tokio::spawn(async move {
                let place = place_of(&state, &session).await;
                push::notify(
                    &state,
                    push::Message {
                        title: title.to_owned(),
                        body: place,
                        url: format!("#/center/s/{}", session.id),
                        tag: session.id.clone(),
                        urgent,
                    },
                );
            });
        }
    }
    StatusCode::NO_CONTENT
}

fn news_for(
    before: Option<claude::State>,
    session: &claude::Session,
) -> Option<(&'static str, bool)> {
    use claude::State;
    match (before, session.state) {
        (Some(State::NeedsYou), State::NeedsYou) => None,
        (_, State::NeedsYou) => Some(("Claude is waiting on you", true)),
        (Some(State::Working), State::Idle) if session.doing.contains("error") => {
            Some(("Claude stopped on an error", false))
        }
        (Some(State::Working), State::Idle) => Some(("Claude finished", false)),
        _ => None,
    }
}

/// Never what the session does or asks, since a notification shows on the
/// lock screen.
async fn place_of(state: &AppState, session: &claude::Session) -> String {
    let folder = session
        .cwd
        .rsplit('/')
        .find(|part| !part.is_empty())
        .unwrap_or("a session")
        .to_owned();
    if let Some(pane) = &session.pane
        && state.tmux.socket_path().await.as_deref() == Some(pane.socket.as_str())
        && let Some((terminal, _)) = state.tmux.locate(&pane.pane).await
        && let Ok(terminals) = state.tmux.list(false).await
        && let Some(found) = terminals.iter().find(|found| found.id == terminal)
    {
        return format!("In {} · {folder}", found.name);
    }
    if session.pane.is_none()
        && let Some(tab) = session.pid.and_then(|pid| state.laptop_tabs.holding(pid))
        && let Some(title) = state
            .laptop_tabs
            .list()
            .into_iter()
            .find(|view| view.id == tab)
            .and_then(|view| view.title)
    {
        return format!("In {title}");
    }
    format!("In {folder}")
}

async fn claude_status(
    State(state): State<AppState>,
    Json(report): Json<claude::StatusReport>,
) -> StatusCode {
    state.claude.status(&report, crate::store::now());
    StatusCode::NO_CONTENT
}

pub async fn bind(path: &Path) -> Result<UnixListener> {
    let dir = path
        .parent()
        .context("the admin socket needs a directory")?;
    fs::create_dir_all(dir).with_context(|| format!("creating {}", dir.display()))?;
    fs::set_permissions(dir, fs::Permissions::from_mode(0o700))?;
    if UnixStream::connect(path).await.is_ok() {
        bail!(
            "another hub is already running ({} answers)",
            path.display()
        );
    }
    match fs::remove_file(path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(error).with_context(|| format!("removing the stale {}", path.display()));
        }
    }
    let listener =
        UnixListener::bind(path).with_context(|| format!("binding {}", path.display()))?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    Ok(listener)
}

fn refusal(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({"error": message}))).into_response()
}

async fn pairings(State(state): State<AppState>) -> Response {
    let pending = state.store().pending_pairings();
    match pending {
        Ok(pending) => Json(pending).into_response(),
        Err(error) => internal_error(error),
    }
}

async fn approve(State(state): State<AppState>, UrlPath(id): UrlPath<String>) -> Response {
    decide(&state, &id, true)
}

async fn deny(State(state): State<AppState>, UrlPath(id): UrlPath<String>) -> Response {
    decide(&state, &id, false)
}

fn decide(state: &AppState, id_or_code: &str, approve: bool) -> Response {
    let decided = state.store().decide_pairing(id_or_code, approve, "laptop");
    match decided {
        Ok(Match::One(pairing)) => {
            state.events.send(Event::PairingDecided {
                id: pairing.id.clone(),
                approved: approve,
            });
            Json(pairing).into_response()
        }
        Ok(Match::None) => refusal(
            StatusCode::NOT_FOUND,
            "No waiting request has that code or id.",
        ),
        Ok(Match::Many) => refusal(
            StatusCode::CONFLICT,
            "Several waiting requests match; use the id.",
        ),
        Err(error) => internal_error(error),
    }
}

async fn devices(State(state): State<AppState>) -> Response {
    let devices = state.store().devices();
    match devices {
        Ok(devices) => Json(devices).into_response(),
        Err(error) => internal_error(error),
    }
}

async fn revoke(State(state): State<AppState>, UrlPath(id): UrlPath<String>) -> Response {
    let revoked = state.store().revoke(&id, "laptop");
    match revoked {
        Ok(Match::One(device)) => {
            state.events.send(Event::DeviceRevoked {
                id: device.id.clone(),
            });
            Json(device).into_response()
        }
        Ok(Match::None) => refusal(
            StatusCode::NOT_FOUND,
            "No paired device has that name or id.",
        ),
        Ok(Match::Many) => refusal(
            StatusCode::CONFLICT,
            "Several devices have that name; use the id.",
        ),
        Err(error) => internal_error(error),
    }
}

async fn audit(State(state): State<AppState>) -> Response {
    let entries = state.store().audit_log(100);
    match entries {
        Ok(entries) => Json(entries).into_response(),
        Err(error) => internal_error(error),
    }
}

/// Ends when the hub stops, so it never holds a shutdown up.
async fn events(State(state): State<AppState>) -> Response {
    let lines = futures_util::stream::unfold(state.events.subscribe(), |mut events| async move {
        loop {
            match events.recv().await {
                Ok(Event::HubStopping) | Err(RecvError::Closed) => return None,
                Err(RecvError::Lagged(_)) => continue,
                Ok(event) => {
                    let mut line = serde_json::to_vec(&event).expect("events serialize");
                    line.push(b'\n');
                    return Some((Ok::<_, Infallible>(Bytes::from(line)), events));
                }
            }
        }
    });
    (
        [(header::CONTENT_TYPE, "application/x-ndjson")],
        Body::from_stream(lines),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_prompt_or_a_turn_ending_is_news_and_nothing_else() {
        use claude::State;
        let sessions = claude::Sessions::new();
        let mut at = 0;
        let mut hook = |name: &str| {
            at += 1000;
            sessions.record(
                &HookReport {
                    event: serde_json::json!({"session_id": "s1", "cwd": "/home/me/demo", "hook_event_name": name, "tool_name": "Bash", "tool_input": {"command": "ls"}}),
                    at_ms: at,
                    ..HookReport::default()
                },
                at / 1000,
            );
            sessions.get("s1").unwrap()
        };
        let news =
            |before, session: &claude::Session| news_for(before, session).map(|(title, _)| title);
        let working = hook("PreToolUse");
        assert_eq!(news(None, &working), None, "going to work isn't");
        let asking = hook("PermissionRequest");
        assert_eq!(
            news(Some(State::Working), &asking),
            Some("Claude is waiting on you")
        );
        assert_eq!(
            news(Some(State::NeedsYou), &asking),
            None,
            "once per prompt"
        );
        let back = hook("PostToolUse");
        let done = hook("Stop");
        assert_eq!(news(Some(back.state), &done), Some("Claude finished"));
        assert_eq!(news(Some(State::Idle), &done), None, "already done");
    }

    #[tokio::test]
    async fn the_socket_is_private_and_only_one_hub_runs() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("run/admin.sock");
        let _listener = bind(&path).await.unwrap();
        let mode = |p: &Path| fs::metadata(p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(&path), 0o600);
        assert_eq!(mode(path.parent().unwrap()), 0o700);
        assert!(bind(&path).await.is_err(), "a second hub refuses to start");
    }
}
