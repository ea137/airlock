//! The phone's API for terminals and tabs. Every route needs a paired device.

use std::path::{Path, PathBuf};

use axum::{
    Extension, Json, Router,
    body::Bytes,
    extract::{Path as UrlPath, Query, State, WebSocketUpgrade},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, patch, post},
};
use serde::{Deserialize, de::DeserializeOwned};
use serde_json::json;

use crate::{
    attach, faceid,
    phone::{Paired, read_cookie, unpaired},
    state::{AppState, internal_error},
    terminals::clean_name,
};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/terminals", get(list).post(create))
        .route("/api/terminals/{id}", patch(rename).delete(close))
        .route("/api/terminals/{id}/tabs", post(new_tab))
        .route("/api/terminals/{id}/attach", get(attach_ws))
        .route("/api/terminals/{id}/bottom", post(to_bottom))
        .route("/api/terminals/{id}/text", get(text))
        .route("/api/tabs/{id}", patch(rename_tab).delete(close_tab))
        .route("/api/tabs/{id}/select", post(select_tab))
        .route("/api/folders", get(folders))
}

#[derive(Debug)]
struct BadRequest(&'static str);

impl IntoResponse for BadRequest {
    fn into_response(self) -> Response {
        (StatusCode::BAD_REQUEST, Json(json!({"error": self.0}))).into_response()
    }
}

fn bad_request(message: &'static str) -> BadRequest {
    BadRequest(message)
}

fn tmux_failure(error: anyhow::Error) -> Response {
    let message = format!("{error:#}");
    if message.contains("can't find") || message.contains("no such") {
        (
            StatusCode::NOT_FOUND,
            Json(json!({"error": "That terminal or tab is gone."})),
        )
            .into_response()
    } else {
        internal_error(error)
    }
}

fn done(result: anyhow::Result<()>) -> Response {
    match result {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => tmux_failure(error),
    }
}

fn body<T: DeserializeOwned + Default>(bytes: &Bytes) -> Result<T, BadRequest> {
    if bytes.is_empty() {
        return Ok(T::default());
    }
    serde_json::from_slice(bytes).map_err(|_| bad_request("Expected JSON."))
}

fn home() -> PathBuf {
    std::env::var_os("HOME").map_or_else(|| PathBuf::from("/"), PathBuf::from)
}

fn start_folder(cwd: Option<&str>) -> Result<PathBuf, BadRequest> {
    let path = match cwd.map(str::trim) {
        None | Some("") | Some("~") => home(),
        Some(text) => match text.strip_prefix("~/") {
            Some(rest) => home().join(rest),
            None => PathBuf::from(text),
        },
    };
    match path.canonicalize() {
        Ok(path) if path.is_dir() => Ok(path),
        _ => Err(bad_request("That folder doesn't exist.")),
    }
}

fn folder_name(path: &Path) -> String {
    path.file_name().map_or_else(
        || "home".to_owned(),
        |name| name.to_string_lossy().into_owned(),
    )
}

async fn list(
    State(state): State<AppState>,
    Extension(Paired(device)): Extension<Paired>,
) -> Response {
    if device.is_none() {
        return unpaired();
    }
    match state.tmux.list(true).await {
        Ok(terminals) => Json(terminals).into_response(),
        Err(error) => internal_error(error),
    }
}

#[derive(Default, Deserialize)]
struct NewTerminal {
    name: Option<String>,
    cwd: Option<String>,
}

async fn create(
    State(state): State<AppState>,
    Extension(Paired(device)): Extension<Paired>,
    bytes: Bytes,
) -> Response {
    if device.is_none() {
        return unpaired();
    }
    let request: NewTerminal = match body(&bytes) {
        Ok(request) => request,
        Err(refused) => return refused.into_response(),
    };
    let cwd = match start_folder(request.cwd.as_deref()) {
        Ok(cwd) => cwd,
        Err(refused) => return refused.into_response(),
    };
    let name = match clean_name(request.name.as_deref().unwrap_or_default()) {
        name if name.is_empty() => folder_name(&cwd),
        name => name,
    };
    match state.tmux.create(&name, &cwd).await {
        Ok(id) => (StatusCode::CREATED, Json(json!({"id": id}))).into_response(),
        Err(error) => internal_error(error),
    }
}

#[derive(Default, Deserialize)]
struct Name {
    name: String,
}

async fn rename(
    State(state): State<AppState>,
    Extension(Paired(device)): Extension<Paired>,
    UrlPath(id): UrlPath<u32>,
    bytes: Bytes,
) -> Response {
    if device.is_none() {
        return unpaired();
    }
    let request: Name = match body(&bytes) {
        Ok(request) => request,
        Err(refused) => return refused.into_response(),
    };
    let name = clean_name(&request.name);
    if name.is_empty() {
        return bad_request("A terminal needs a name.").into_response();
    }
    done(state.tmux.rename(id, &name).await)
}

async fn close(
    State(state): State<AppState>,
    Extension(Paired(device)): Extension<Paired>,
    UrlPath(id): UrlPath<u32>,
) -> Response {
    if device.is_none() {
        return unpaired();
    }
    // Its last screen goes into the history before it goes.
    crate::history::save(&state).await;
    done(state.tmux.close(id).await)
}

#[derive(Default, Deserialize)]
struct NewTab {
    cwd: Option<String>,
}

async fn new_tab(
    State(state): State<AppState>,
    Extension(Paired(device)): Extension<Paired>,
    UrlPath(id): UrlPath<u32>,
    bytes: Bytes,
) -> Response {
    if device.is_none() {
        return unpaired();
    }
    let request: NewTab = match body(&bytes) {
        Ok(request) => request,
        Err(refused) => return refused.into_response(),
    };
    let cwd = match request.cwd.as_deref() {
        None => None,
        Some(cwd) => match start_folder(Some(cwd)) {
            Ok(cwd) => Some(cwd),
            Err(refused) => return refused.into_response(),
        },
    };
    match state.tmux.new_tab(id, cwd.as_deref()).await {
        Ok(tab) => (StatusCode::CREATED, Json(json!({"id": tab}))).into_response(),
        Err(error) => tmux_failure(error),
    }
}

const TEXT_LINES: u32 = 2000;

async fn to_bottom(
    State(state): State<AppState>,
    Extension(Paired(device)): Extension<Paired>,
    UrlPath(id): UrlPath<u32>,
) -> Response {
    if device.is_none() {
        return unpaired();
    }
    done(state.tmux.to_bottom(id).await)
}

async fn text(
    State(state): State<AppState>,
    Extension(Paired(device)): Extension<Paired>,
    UrlPath(id): UrlPath<u32>,
) -> Response {
    if device.is_none() {
        return unpaired();
    }
    match state.tmux.text(id, TEXT_LINES).await {
        Ok(text) => Json(serde_json::json!({ "text": text })).into_response(),
        Err(_) => (StatusCode::NOT_FOUND, "That terminal has closed.").into_response(),
    }
}

async fn select_tab(
    State(state): State<AppState>,
    Extension(Paired(device)): Extension<Paired>,
    UrlPath(id): UrlPath<u32>,
) -> Response {
    if device.is_none() {
        return unpaired();
    }
    done(state.tmux.select_tab(id).await)
}

async fn rename_tab(
    State(state): State<AppState>,
    Extension(Paired(device)): Extension<Paired>,
    UrlPath(id): UrlPath<u32>,
    bytes: Bytes,
) -> Response {
    if device.is_none() {
        return unpaired();
    }
    let request: Name = match body(&bytes) {
        Ok(request) => request,
        Err(refused) => return refused.into_response(),
    };
    done(state.tmux.rename_tab(id, &clean_name(&request.name)).await)
}

async fn close_tab(
    State(state): State<AppState>,
    Extension(Paired(device)): Extension<Paired>,
    UrlPath(id): UrlPath<u32>,
) -> Response {
    if device.is_none() {
        return unpaired();
    }
    done(state.tmux.close_tab(id).await)
}

#[derive(Deserialize)]
struct Size {
    cols: Option<u16>,
    rows: Option<u16>,
}

async fn attach_ws(
    State(state): State<AppState>,
    Extension(Paired(device)): Extension<Paired>,
    UrlPath(id): UrlPath<u32>,
    Query(size): Query<Size>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    let Some(device) = device else {
        return unpaired();
    };
    if !state.tmux.exists(id).await {
        return (StatusCode::NOT_FOUND, "That terminal is gone.").into_response();
    }
    let (cols, rows) = (size.cols.unwrap_or(80), size.rows.unwrap_or(24));
    // The stream ends when this browser's Face ID unlock does.
    let viewer = attach::Viewer {
        device: device.id,
        unlock: read_cookie(&headers, faceid::UNLOCK_COOKIE).map(str::to_owned),
    };
    ws.max_message_size(1 << 20).on_upgrade(move |socket| {
        attach::bridge(
            socket,
            state,
            attach::Target::Terminal(id),
            viewer,
            cols,
            rows,
        )
    })
}

async fn folders(
    State(state): State<AppState>,
    Extension(Paired(device)): Extension<Paired>,
) -> Response {
    if device.is_none() {
        return unpaired();
    }
    let home = home();
    let mut open: Vec<String> = Vec::new();
    for terminal in state.tmux.list(false).await.unwrap_or_default() {
        for tab in terminal.tabs {
            if !open.contains(&tab.cwd) {
                open.push(tab.cwd);
            }
        }
    }
    let roots = crate::projects::roots(&state.config).await;
    Json(json!({"home": home, "open": open, "roots": roots})).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn start_folders_must_exist() {
        assert_eq!(start_folder(None).unwrap(), home().canonicalize().unwrap());
        assert_eq!(
            start_folder(Some("~")).unwrap(),
            home().canonicalize().unwrap()
        );
        assert!(start_folder(Some("/no/such/folder/airlock")).is_err());
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            start_folder(Some(dir.path().to_str().unwrap())).unwrap(),
            dir.path().canonicalize().unwrap()
        );
    }
}
