//! What the laptop app shows of the terminals and Claude sessions, and their
//! history: every half minute, and as the hub stops, the hub saves each
//! terminal's tabs (their scrollback, colours kept) and each session's
//! steps, so they can still be read after the terminal closes or the
//! session ends. The sessions going on are also kept whole and taken back
//! when the hub starts, as long as their Claude is still the same process. Closed terminals and
//! sessions are kept [`KEEP_SECS`] after they were last active, then
//! forgotten; any of them can be deleted sooner from the app.

use std::time::Duration;

use axum::{
    Json, Router,
    extract::{Path as UrlPath, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};
use serde_json::json;

use crate::{
    center,
    state::{AppState, internal_error},
    store::{self, SessionRecord, TerminalRecord},
};

pub const KEEP_SECS: i64 = 14 * 24 * 3600;
/// How often the hub saves what's open.
const EVERY: Duration = Duration::from_secs(30);
const SCROLLBACK_LINES: u32 = 2000;

pub async fn save(state: &AppState) {
    let now = store::now();
    let terminals = state.tmux.list(false).await.unwrap_or_default();
    let mut open = Vec::with_capacity(terminals.len());
    for terminal in &terminals {
        let mut tabs = Vec::with_capacity(terminal.tabs.len());
        for tab in &terminal.tabs {
            let text = state
                .tmux
                .scrollback(tab.id, SCROLLBACK_LINES)
                .await
                .unwrap_or_default();
            tabs.push(json!({
                "name": if tab.name.is_empty() { tab.folder.clone() } else { tab.name.clone() },
                "cwd": tab.cwd,
                "command": tab.command,
                "text": text,
            }));
        }
        let record = TerminalRecord {
            key: format!("{}-{}", terminal.id, terminal.created_at),
            terminal: terminal.id,
            name: terminal.name.clone(),
            created_at: terminal.created_at,
            updated_at: now,
            closed_at: None,
            tabs: tabs.into(),
        };
        open.push(record.key.clone());
        if let Err(error) = state.store().save_terminal(&record) {
            tracing::warn!("saving terminal {}: {error:#}", terminal.id);
        }
    }
    for session in state.claude.list(now) {
        let record = SessionRecord {
            ended_at: (session.state == crate::claude::State::Ended).then_some(session.updated_at),
            id: session.id,
            title: session.title,
            cwd: session.cwd,
            started_at: session.started_at,
            updated_at: session.updated_at,
            doing: session.doing,
            timeline: serde_json::to_value(&session.timeline).unwrap_or_default(),
        };
        if let Err(error) = state.store().save_session(&record) {
            tracing::warn!("saving session {}: {error:#}", record.id);
        }
    }
    // The sessions going on, whole, so a restart of the hub picks them up.
    let live = state.claude.kept();
    if let Err(error) = state.store().keep_live_sessions(&live) {
        tracing::warn!("keeping the live sessions: {error:#}");
    }
    let store = state.store();
    if let Err(error) = store.close_terminals_except(&open, now) {
        tracing::warn!("marking closed terminals: {error:#}");
    }
    if let Err(error) = store.purge_history(now - KEEP_SECS) {
        tracing::warn!("forgetting old history: {error:#}");
    }
}

/// Takes back the sessions going on when the hub last stopped, so one that
/// waits on you still shows after a restart (an update restarts the hub).
pub fn restore(state: &AppState) {
    match state.store().live_sessions() {
        Ok(kept) => state.claude.restore(kept),
        Err(error) => tracing::warn!("reading the kept sessions: {error:#}"),
    }
}

pub async fn keep(state: AppState) {
    let mut every = tokio::time::interval(EVERY);
    loop {
        every.tick().await;
        save(&state).await;
    }
}

fn refusal(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({"error": message}))).into_response()
}

async fn terminals(State(state): State<AppState>) -> Response {
    match state.tmux.list(true).await {
        Ok(terminals) => {
            Json(json!({"socket": state.tmux.socket(), "terminals": terminals})).into_response()
        }
        Err(error) => internal_error(error),
    }
}

async fn sessions(State(state): State<AppState>) -> Response {
    Json(center::sessions_json(&state).await).into_response()
}

async fn session(State(state): State<AppState>, UrlPath(id): UrlPath<String>) -> Response {
    match center::session_json(&state, &id).await {
        Some(found) => Json(found).into_response(),
        None => refusal(StatusCode::NOT_FOUND, "That session is gone."),
    }
}

async fn history(State(state): State<AppState>) -> Response {
    // What's open now is in it too, saved this moment.
    save(&state).await;
    let store = state.store();
    match (store.terminal_history(false), store.session_history()) {
        (Ok(terminals), Ok(sessions)) => {
            Json(json!({"terminals": terminals, "sessions": sessions, "keep_secs": KEEP_SECS}))
                .into_response()
        }
        (Err(error), _) | (_, Err(error)) => internal_error(error),
    }
}

async fn terminal_record(State(state): State<AppState>, UrlPath(key): UrlPath<String>) -> Response {
    match state.store().terminal_record(&key) {
        Ok(Some(record)) => Json(record).into_response(),
        Ok(None) => refusal(StatusCode::NOT_FOUND, "That terminal isn't kept any more."),
        Err(error) => internal_error(error),
    }
}

async fn delete_terminal_record(
    State(state): State<AppState>,
    UrlPath(key): UrlPath<String>,
) -> Response {
    match state.store().delete_terminal_record(&key) {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => refusal(StatusCode::NOT_FOUND, "That terminal isn't kept any more."),
        Err(error) => internal_error(error),
    }
}

async fn session_record(State(state): State<AppState>, UrlPath(id): UrlPath<String>) -> Response {
    match state.store().session_record(&id) {
        Ok(Some(record)) => Json(record).into_response(),
        Ok(None) => refusal(StatusCode::NOT_FOUND, "That session isn't kept any more."),
        Err(error) => internal_error(error),
    }
}

async fn delete_session_record(
    State(state): State<AppState>,
    UrlPath(id): UrlPath<String>,
) -> Response {
    match state.store().delete_session_record(&id) {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => refusal(StatusCode::NOT_FOUND, "That session isn't kept any more."),
        Err(error) => internal_error(error),
    }
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/terminals", get(terminals))
        .route("/sessions", get(sessions))
        .route("/sessions/{id}", get(session))
        .route("/history", get(history))
        .route(
            "/history/terminals/{key}",
            get(terminal_record).delete(delete_terminal_record),
        )
        .route(
            "/history/sessions/{id}",
            get(session_record).delete(delete_session_record),
        )
}

#[cfg(test)]
mod tests {
    use axum::{body::Body, http::Request};
    use http_body_util::BodyExt;
    use serde_json::Value;
    use tower::ServiceExt;

    use super::*;
    use crate::{state::testing::state_with, terminals::testing::ScratchTmux};

    async fn call(router: &Router, method: &str, uri: &str) -> (StatusCode, Value) {
        let request = Request::builder()
            .method(method)
            .uri(uri)
            .body(Body::empty())
            .unwrap();
        let response = router.clone().oneshot(request).await.unwrap();
        let status = response.status();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        )
    }

    #[tokio::test]
    async fn a_terminal_is_kept_after_it_closes_and_can_be_deleted() {
        let scratch = ScratchTmux::new();
        let state = state_with(scratch.tmux.clone());
        let router = routes().with_state(state.clone());
        let dir = tempfile::tempdir().unwrap();
        let terminal = scratch.tmux.create("notes", dir.path()).await.unwrap();
        scratch
            .tmux
            .type_line(terminal, "echo kept-$((40+2))")
            .await
            .unwrap();
        for _ in 0..50 {
            let preview = scratch.tmux.preview(terminal, 5).await.unwrap_or_default();
            if preview.iter().any(|line| line.trim() == "kept-42") {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }

        let (status, live) = call(&router, "GET", "/terminals").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(live["terminals"][0]["name"], "notes");
        assert_eq!(live["socket"], scratch.tmux.socket());

        // Asking for the history saves what's open first.
        let (_, history) = call(&router, "GET", "/history").await;
        let kept = &history["terminals"][0];
        assert_eq!(kept["name"], "notes");
        assert_eq!(kept["closed_at"], Value::Null);
        assert!(
            kept["tabs"][0].get("text").is_none(),
            "the list leaves the text out"
        );
        let key = kept["key"].as_str().unwrap().to_owned();

        scratch.tmux.close(terminal).await.unwrap();
        let (_, history) = call(&router, "GET", "/history").await;
        assert!(history["terminals"][0]["closed_at"].is_i64(), "{history}");
        let (_, record) = call(&router, "GET", &format!("/history/terminals/{key}")).await;
        let text = record["tabs"][0]["text"].as_str().unwrap();
        assert!(text.lines().any(|line| line.trim() == "kept-42"), "{text}");

        let (status, _) = call(&router, "DELETE", &format!("/history/terminals/{key}")).await;
        assert_eq!(status, StatusCode::NO_CONTENT);
        let (status, _) = call(&router, "GET", &format!("/history/terminals/{key}")).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
    }

    #[test]
    fn closed_history_goes_after_two_weeks_and_open_terminals_stay() {
        let store = crate::store::Store::open_in_memory().unwrap();
        let record = |key: &str, updated_at: i64| TerminalRecord {
            key: key.to_owned(),
            terminal: 1,
            name: key.to_owned(),
            created_at: 0,
            updated_at,
            closed_at: None,
            tabs: json!([]),
        };
        let now = 100 * 24 * 3600;
        store
            .save_terminal(&record("old-closed", now - KEEP_SECS - 10))
            .unwrap();
        store
            .save_terminal(&record("old-open", now - KEEP_SECS - 10))
            .unwrap();
        store
            .save_terminal(&record("recent-closed", now - 60))
            .unwrap();
        store
            .close_terminals_except(&["old-open".to_owned()], now - KEEP_SECS - 5)
            .unwrap();
        store.purge_history(now - KEEP_SECS).unwrap();
        let kept: Vec<String> = store
            .terminal_history(false)
            .unwrap()
            .into_iter()
            .map(|record| record.key)
            .collect();
        assert_eq!(kept, ["recent-closed", "old-open"]);
    }
}
