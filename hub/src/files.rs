//! The phone's files: browse and read under your home folder, and propose
//! edits, which the laptop approves (see [`crate::edits`]). Nothing here
//! writes a file.
//!
//! Paths are resolved (symlinks followed) and must stay inside your home.
//! Airlock's own folders (its config, state and runtime) are never shown.
//! Files that look like secrets (`.env`, keys, credentials) are readable only
//! while the laptop's `sensitive_files` setting allows it.

use std::{
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    sync::OnceLock,
    time::UNIX_EPOCH,
};

use axum::{
    Extension, Json, Router,
    body::Bytes,
    extract::{Path as UrlPath, Query, State},
    http::{HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
};
use pulldown_cmark::{CowStr, Event as Md, Options, Parser, Tag};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};

use crate::{
    config::Paths,
    events::Event,
    phone::{Paired, unpaired},
    state::{AppState, internal_error},
    store::{self, Change, Device},
    token,
};

pub const TEXT_MAX: u64 = 2 * 1024 * 1024;
const RAW_MAX: u64 = 25 * 1024 * 1024;
const LIST_MAX: usize = 2000;
/// The most search results, and how many entries a search looks at.
const FOUND_MAX: usize = 100;
const SEARCH_VISITS: usize = 50_000;
const PENDING_MAX: usize = 20;

#[derive(Debug, PartialEq)]
pub enum Refusal {
    Missing,
    Outside,
    Private,
    Sensitive,
    TooBig(u64),
    NotAFile,
    NotAFolder,
    Other(&'static str),
}

impl IntoResponse for Refusal {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            Self::Missing => (StatusCode::NOT_FOUND, "That isn't there.".to_owned()),
            Self::Outside => (
                StatusCode::FORBIDDEN,
                "Only files in your home folder are shown.".to_owned(),
            ),
            Self::Private => (
                StatusCode::FORBIDDEN,
                "Airlock's own files are never shown on the phone.".to_owned(),
            ),
            Self::Sensitive => (
                StatusCode::FORBIDDEN,
                "This looks like a secret, and reading those from the phone is turned off on the laptop."
                    .to_owned(),
            ),
            Self::TooBig(size) => (
                StatusCode::PAYLOAD_TOO_LARGE,
                format!("It's too big to show here ({}).", human_size(size)),
            ),
            Self::NotAFile => (StatusCode::BAD_REQUEST, "That's a folder.".to_owned()),
            Self::NotAFolder => (StatusCode::BAD_REQUEST, "That's a file.".to_owned()),
            Self::Other(message) => (StatusCode::BAD_REQUEST, message.to_owned()),
        };
        (status, Json(json!({"error": message}))).into_response()
    }
}

pub fn human_size(bytes: u64) -> String {
    match bytes {
        0..1024 => format!("{bytes} B"),
        1024..1_048_576 => format!("{:.1} KB", bytes as f64 / 1024.0),
        _ => format!("{:.1} MB", bytes as f64 / 1_048_576.0),
    }
}

fn own_dirs() -> &'static [PathBuf] {
    static DIRS: OnceLock<Vec<PathBuf>> = OnceLock::new();
    DIRS.get_or_init(|| {
        Paths::from_env()
            .map(|paths| {
                [paths.config, paths.state, paths.runtime]
                    .into_iter()
                    .map(|dir| dir.canonicalize().unwrap_or(dir))
                    .collect()
            })
            .unwrap_or_default()
    })
}

/// `~`, `~/x` or an absolute path, followed through symlinks, as long as it
/// is inside `home` and not one of Airlock's own folders.
pub fn resolve(text: &str, home: &Path, private: &[PathBuf]) -> Result<PathBuf, Refusal> {
    let text = text.trim();
    let path = match text {
        "" | "~" => home.to_path_buf(),
        _ => match text.strip_prefix("~/") {
            Some(rest) => home.join(rest),
            None if text.starts_with('/') => PathBuf::from(text),
            None => return Err(Refusal::Outside),
        },
    };
    let path = path.canonicalize().map_err(|_| Refusal::Missing)?;
    if !path.starts_with(home) {
        return Err(Refusal::Outside);
    }
    if private.iter().any(|dir| path.starts_with(dir)) {
        return Err(Refusal::Private);
    }
    Ok(path)
}

pub fn display(path: &Path, home: &Path) -> String {
    match path.strip_prefix(home) {
        Ok(rest) if rest.as_os_str().is_empty() => "~".to_owned(),
        Ok(rest) => format!("~/{}", rest.display()),
        Err(_) => path.display().to_string(),
    }
}

pub fn is_sensitive(path: &Path) -> bool {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let in_folder = |folder: &str| path.components().any(|part| part.as_os_str() == folder);
    if name.ends_with(".pub") {
        return false;
    }
    let secret_names = [
        ".netrc",
        ".pgpass",
        ".npmrc",
        ".pypirc",
        ".git-credentials",
        "credentials",
        "credentials.json",
        "id_rsa",
        "id_dsa",
        "id_ecdsa",
        "id_ed25519",
    ];
    let secret_endings = [
        ".pem",
        ".key",
        ".p12",
        ".pfx",
        ".kdbx",
        ".keystore",
        ".jks",
        ".gpg",
    ];
    name == ".env"
        || name.starts_with(".env.")
        || secret_names.contains(&name.as_str())
        || secret_endings.iter().any(|ending| name.ends_with(ending))
        || name.starts_with("secret")
        || [".ssh", ".gnupg", ".aws", ".password-store", ".kube"]
            .iter()
            .any(|folder| in_folder(folder))
        || (in_folder(".docker") && name == "config.json")
}

fn modified(meta: &std::fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |since| since.as_secs() as i64)
}

fn sha256(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

#[derive(Debug, Serialize)]
pub struct Entry {
    pub name: String,
    pub path: String,
    /// `dir` or `file`.
    pub kind: &'static str,
    pub size: u64,
    pub modified: i64,
    /// How many entries a folder holds (capped at 999).
    pub items: Option<u32>,
    pub sensitive: bool,
}

/// Returns the entries and how many dotfiles were left out.
pub fn list(dir: &Path, home: &Path, hidden: bool) -> std::io::Result<(Vec<Entry>, usize)> {
    let mut entries = Vec::new();
    let mut left_out = 0;
    for entry in std::fs::read_dir(dir)?.flatten().take(LIST_MAX * 2) {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') && !hidden {
            left_out += 1;
            continue;
        }
        let path = entry.path();
        // Follow symlinks for what they point to; skip broken ones.
        let Ok(meta) = std::fs::metadata(&path) else {
            continue;
        };
        let is_dir = meta.is_dir();
        entries.push(Entry {
            path: display(&path, home),
            kind: if is_dir { "dir" } else { "file" },
            size: if is_dir { 0 } else { meta.len() },
            modified: modified(&meta),
            items: None,
            sensitive: !is_dir && is_sensitive(&path),
            name,
        });
        if entries.len() >= LIST_MAX {
            break;
        }
    }
    entries.sort_by(|a, b| {
        (a.kind != "dir", a.name.to_lowercase()).cmp(&(b.kind != "dir", b.name.to_lowercase()))
    });
    // Counting what's in each folder is cheap enough for a normal folder.
    let folders = entries.iter().filter(|e| e.kind == "dir").count();
    if folders <= 300 {
        for entry in entries.iter_mut().filter(|e| e.kind == "dir") {
            let path = dir.join(&entry.name);
            entry.items = std::fs::read_dir(path)
                .ok()
                .map(|items| items.take(999).count() as u32);
        }
    }
    Ok((entries, left_out))
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Text,
    Markdown,
    Html,
    Image,
    Binary,
}

fn extension(path: &Path) -> String {
    path.extension()
        .map(|ext| ext.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

pub fn kind_by_name(path: &Path) -> Option<Kind> {
    match extension(path).as_str() {
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp" | "ico" | "avif" => {
            Some(Kind::Image)
        }
        "html" | "htm" => Some(Kind::Html),
        "md" | "markdown" | "mdx" => Some(Kind::Markdown),
        _ => None,
    }
}

pub fn looks_like_text(bytes: &[u8]) -> bool {
    let head = &bytes[..bytes.len().min(8000)];
    !head.contains(&0) && std::str::from_utf8(bytes).is_ok()
}

pub fn language(path: &Path) -> Option<&'static str> {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if name == "dockerfile" {
        return Some("dockerfile");
    }
    if name == "makefile" {
        return Some("makefile");
    }
    Some(match extension(path).as_str() {
        "rs" => "rust",
        "ts" | "tsx" | "mts" | "cts" => "typescript",
        "js" | "jsx" | "mjs" | "cjs" => "javascript",
        "svelte" | "vue" | "html" | "htm" | "xml" | "svg" => "xml",
        "json" | "jsonc" | "hujson" => "json",
        "toml" => "ini",
        "ini" | "cfg" | "conf" | "service" | "timer" | "desktop" => "ini",
        "yml" | "yaml" => "yaml",
        "sh" | "bash" | "zsh" => "bash",
        "py" => "python",
        "go" => "go",
        "css" | "scss" => "css",
        "md" | "markdown" => "markdown",
        "sql" => "sql",
        "diff" | "patch" => "diff",
        "java" => "java",
        "c" | "h" => "c",
        "cpp" | "cc" | "hpp" => "cpp",
        "rb" => "ruby",
        _ => return None,
    })
}

/// Markdown as HTML, safely: raw HTML in it is shown as text, links go only
/// to the web, mail, anchors or other files, and images only to files here.
pub fn render_markdown(text: &str, file: &Path, home: &Path) -> String {
    let folder = file.parent().unwrap_or(home);
    let options = Options::ENABLE_TABLES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_FOOTNOTES;
    let local = |dest: &str| -> Option<PathBuf> {
        let path = dest.split(['#', '?']).next().unwrap_or_default();
        if path.is_empty() {
            return None;
        }
        let joined = if path.starts_with('/') {
            PathBuf::from(path)
        } else {
            folder.join(path)
        };
        Some(joined)
    };
    let events = Parser::new_ext(text, options).map(|event| match event {
        Md::Html(html) | Md::InlineHtml(html) => Md::Text(html),
        Md::Start(Tag::Link {
            link_type,
            dest_url,
            title,
            id,
        }) => {
            let dest = dest_url.to_string();
            let safe = if dest.starts_with("http://")
                || dest.starts_with("https://")
                || dest.starts_with("mailto:")
                || dest.starts_with('#')
            {
                dest
            } else if dest.contains(':') {
                "#".to_owned()
            } else {
                match local(&dest) {
                    Some(path) => format!("#/files/view/{}", urlencode(&display(&path, home))),
                    None => "#".to_owned(),
                }
            };
            Md::Start(Tag::Link {
                link_type,
                dest_url: CowStr::from(safe),
                title,
                id,
            })
        }
        Md::Start(Tag::Image {
            link_type,
            dest_url,
            title,
            id,
        }) => {
            let dest = dest_url.to_string();
            let safe = if dest.contains(':') {
                // Only this laptop's files: no tracking pixels.
                String::new()
            } else {
                match local(&dest) {
                    Some(path) => {
                        format!("api/files/raw?path={}", urlencode(&path.to_string_lossy()))
                    }
                    None => String::new(),
                }
            };
            Md::Start(Tag::Image {
                link_type,
                dest_url: CowStr::from(safe),
                title,
                id,
            })
        }
        other => other,
    });
    let mut html = String::new();
    pulldown_cmark::html::push_html(&mut html, events);
    html
}

fn urlencode(text: &str) -> String {
    text.bytes()
        .map(|byte| {
            if byte.is_ascii_alphanumeric() || b"-_.~/".contains(&byte) {
                char::from(byte).to_string()
            } else {
                format!("%{byte:02X}")
            }
        })
        .collect()
}

pub fn search(dir: &Path, home: &Path, query: &str) -> Vec<Entry> {
    let needle = query.trim().to_lowercase();
    let mut found = Vec::new();
    if needle.is_empty() {
        return found;
    }
    let skip = [
        "node_modules",
        "target",
        "dist",
        "build",
        "__pycache__",
        ".git",
    ];
    let mut stack = vec![(dir.to_path_buf(), 0usize)];
    let mut visited = 0;
    while let Some((folder, depth)) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&folder) else {
            continue;
        };
        for entry in entries.flatten() {
            visited += 1;
            if visited > SEARCH_VISITS || found.len() >= FOUND_MAX {
                return found;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') || skip.contains(&name.as_str()) {
                continue;
            }
            let path = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if name.to_lowercase().contains(&needle)
                && let Ok(meta) = std::fs::metadata(&path)
            {
                found.push(Entry {
                    path: display(&path, home),
                    kind: if meta.is_dir() { "dir" } else { "file" },
                    size: if meta.is_dir() { 0 } else { meta.len() },
                    modified: modified(&meta),
                    items: None,
                    sensitive: !meta.is_dir() && is_sensitive(&path),
                    name,
                });
            }
            if file_type.is_dir() && depth < 10 {
                stack.push((path, depth + 1));
            }
        }
    }
    found
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/files", get(folder))
        .route("/api/files/read", get(read))
        .route("/api/files/raw", get(raw))
        .route("/api/files/search", get(find))
        .route("/api/files/open", post(open_on_laptop))
        .route("/api/files/changes", get(my_changes).post(propose))
        .route("/api/files/changes/{id}", delete(withdraw))
}

#[derive(Deserialize)]
struct PathQuery {
    #[serde(default)]
    path: String,
    #[serde(default)]
    hidden: Option<String>,
    #[serde(default)]
    q: String,
    /// For `raw`: the modified time the phone saw. When it still matches,
    /// the browser may keep the file (a folder's thumbnails load once).
    #[serde(default)]
    v: Option<i64>,
}

// A refusal is the whole response; these run once per request, so its
// size doesn't matter.
#[allow(clippy::result_large_err)]
fn paired(device: Option<Device>) -> Result<Device, Response> {
    device.ok_or_else(unpaired)
}

#[allow(clippy::result_large_err)]
fn readable(state: &AppState, path: &Path) -> Result<(), Response> {
    if !is_sensitive(path) {
        return Ok(());
    }
    match state.store().settings() {
        Ok(settings) if settings.sensitive_files => Ok(()),
        Ok(_) => Err(Refusal::Sensitive.into_response()),
        Err(error) => Err(internal_error(error)),
    }
}

async fn folder(
    State(state): State<AppState>,
    Extension(Paired(device)): Extension<Paired>,
    Query(query): Query<PathQuery>,
) -> Response {
    if let Err(refused) = paired(device) {
        return refused;
    }
    let home = state.config.files_root();
    let dir = match resolve(&query.path, &home, own_dirs()) {
        Ok(dir) => dir,
        Err(refused) => return refused.into_response(),
    };
    if !dir.is_dir() {
        return Refusal::NotAFolder.into_response();
    }
    let hidden = query.hidden.is_some_and(|value| value == "1");
    let result = {
        let (home, dir) = (home.clone(), dir.clone());
        tokio::task::spawn_blocking(move || list(&dir, &home, hidden)).await
    };
    match result {
        Ok(Ok((entries, left_out))) => {
            let parent = (dir != home)
                .then(|| dir.parent().map(|parent| display(parent, &home)))
                .flatten();
            Json(json!({
                "path": display(&dir, &home),
                "name": if dir == home { "~".to_owned() } else { dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default() },
                "parent": parent,
                "entries": entries,
                "hidden": left_out,
            }))
            .into_response()
        }
        Ok(Err(_)) => Refusal::Other("That folder can't be read.").into_response(),
        Err(error) => internal_error(error.into()),
    }
}

async fn read(
    State(state): State<AppState>,
    Extension(Paired(device)): Extension<Paired>,
    Query(query): Query<PathQuery>,
) -> Response {
    if let Err(refused) = paired(device) {
        return refused;
    }
    let home = state.config.files_root();
    let path = match resolve(&query.path, &home, own_dirs()) {
        Ok(path) => path,
        Err(refused) => return refused.into_response(),
    };
    let Ok(meta) = std::fs::metadata(&path) else {
        return Refusal::Missing.into_response();
    };
    if meta.is_dir() {
        return Refusal::NotAFile.into_response();
    }
    if let Err(refused) = readable(&state, &path) {
        return refused;
    }
    let by_name = kind_by_name(&path);
    let summary = json!({
        "path": display(&path, &home),
        "name": path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        "folder": path.parent().map(|parent| display(parent, &home)),
        "size": meta.len(),
        "modified": modified(&meta),
        "sensitive": is_sensitive(&path),
    });
    let with = |mut fields: serde_json::Value| {
        if let (Some(fields), Some(base)) = (fields.as_object_mut(), summary.as_object()) {
            for (key, value) in base {
                fields.insert(key.clone(), value.clone());
            }
        }
        Json(fields).into_response()
    };
    if by_name == Some(Kind::Image) {
        return with(json!({"kind": Kind::Image}));
    }
    if meta.len() > TEXT_MAX {
        return with(json!({"kind": Kind::Binary, "too_big": true}));
    }
    let bytes = match tokio::fs::read(&path).await {
        Ok(bytes) => bytes,
        Err(_) => return Refusal::Other("That file can't be read.").into_response(),
    };
    if !looks_like_text(&bytes) {
        return with(json!({"kind": Kind::Binary, "too_big": false}));
    }
    let text = String::from_utf8_lossy(&bytes).into_owned();
    let lines = text.lines().count();
    let hash = sha256(&bytes);
    match by_name {
        Some(Kind::Markdown) => {
            let html = render_markdown(&text, &path, &home);
            with(
                json!({"kind": Kind::Markdown, "text": text, "html": html, "hash": hash, "lines": lines, "language": "markdown"}),
            )
        }
        Some(Kind::Html) => with(
            json!({"kind": Kind::Html, "text": text, "hash": hash, "lines": lines, "language": "xml"}),
        ),
        _ => with(
            json!({"kind": Kind::Text, "text": text, "hash": hash, "lines": lines, "language": language(&path)}),
        ),
    }
}

/// HTML is sandboxed: no scripts, no access to Airlock's cookies or API,
/// and nothing loaded from the web.
async fn raw(
    State(state): State<AppState>,
    Extension(Paired(device)): Extension<Paired>,
    Query(query): Query<PathQuery>,
) -> Response {
    if let Err(refused) = paired(device) {
        return refused;
    }
    let home = state.config.files_root();
    let path = match resolve(&query.path, &home, own_dirs()) {
        Ok(path) => path,
        Err(refused) => return refused.into_response(),
    };
    if !matches!(kind_by_name(&path), Some(Kind::Image | Kind::Html)) {
        return Refusal::Other("Only images and web pages are shown this way.").into_response();
    }
    if let Err(refused) = readable(&state, &path) {
        return refused;
    }
    let Ok(meta) = std::fs::metadata(&path) else {
        return Refusal::Missing.into_response();
    };
    if meta.len() > RAW_MAX {
        return Refusal::TooBig(meta.len()).into_response();
    }
    let Ok(bytes) = tokio::fs::read(&path).await else {
        return Refusal::Other("That file can't be read.").into_response();
    };
    let mime = mime_guess::from_path(&path).first_or_octet_stream();
    let mut res = bytes.into_response();
    let headers = res.headers_mut();
    if let Ok(value) = HeaderValue::from_str(mime.as_ref()) {
        headers.insert(header::CONTENT_TYPE, value);
    }
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static(
            "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; frame-ancestors 'self'",
        ),
    );
    headers.insert(
        header::X_FRAME_OPTIONS,
        HeaderValue::from_static("SAMEORIGIN"),
    );
    // A URL naming the file's modified time names this version of it.
    let cache = if query.v == Some(modified(&meta)) {
        "private, max-age=604800, immutable"
    } else {
        "no-cache"
    };
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static(cache));
    res
}

async fn find(
    State(state): State<AppState>,
    Extension(Paired(device)): Extension<Paired>,
    Query(query): Query<PathQuery>,
) -> Response {
    if let Err(refused) = paired(device) {
        return refused;
    }
    let home = state.config.files_root();
    let dir = match resolve(&query.path, &home, own_dirs()) {
        Ok(dir) if dir.is_dir() => dir,
        Ok(_) => return Refusal::NotAFolder.into_response(),
        Err(refused) => return refused.into_response(),
    };
    let found = tokio::task::spawn_blocking(move || {
        let private: Vec<String> = own_dirs().iter().map(|own| display(own, &home)).collect();
        search(&dir, &home, &query.q)
            .into_iter()
            .filter(|entry| {
                !private
                    .iter()
                    .any(|own| entry.path.starts_with(own.as_str()))
            })
            .collect::<Vec<_>>()
    })
    .await;
    match found {
        Ok(found) => Json(json!({"entries": found})).into_response(),
        Err(error) => internal_error(error.into()),
    }
}

#[derive(Deserialize)]
struct PathBody {
    path: String,
}

/// Programs are never run.
async fn open_on_laptop(
    State(state): State<AppState>,
    Extension(Paired(device)): Extension<Paired>,
    bytes: Bytes,
) -> Response {
    if let Err(refused) = paired(device) {
        return refused;
    }
    let Ok(PathBody { path }) = serde_json::from_slice(&bytes) else {
        return Refusal::Other("Expected {\"path\": …}.").into_response();
    };
    let home = state.config.files_root();
    let path = match resolve(&path, &home, own_dirs()) {
        Ok(path) => path,
        Err(refused) => return refused.into_response(),
    };
    if let Ok(meta) = std::fs::metadata(&path)
        && meta.is_file()
    {
        let runnable = meta.permissions().mode() & 0o111 != 0
            || ["desktop", "sh", "appimage", "run", "bin", "exe", "jar"]
                .contains(&extension(&path).as_str());
        if runnable {
            return Refusal::Other("Airlock doesn't start programs on the laptop.").into_response();
        }
    }
    let opened = tokio::process::Command::new("gio")
        .arg("open")
        .arg(&path)
        .kill_on_drop(true)
        .output()
        .await;
    match opened {
        Ok(output) if output.status.success() => StatusCode::NO_CONTENT.into_response(),
        Ok(output) => (
            StatusCode::BAD_GATEWAY,
            Json(json!({"error": format!("The laptop couldn't open it: {}", String::from_utf8_lossy(&output.stderr).trim())})),
        )
            .into_response(),
        Err(_) => (
            StatusCode::BAD_GATEWAY,
            Json(json!({"error": "The laptop has no way to open files (gio is missing)."})),
        )
            .into_response(),
    }
}

fn change_view(change: &Change, home: &Path) -> serde_json::Value {
    json!({
        "id": change.id,
        "path": display(Path::new(&change.path), home),
        "created_at": change.created_at,
        "state": change.state,
        "decided_at": change.decided_at,
        "outcome": change.outcome,
    })
}

async fn my_changes(
    State(state): State<AppState>,
    Extension(Paired(device)): Extension<Paired>,
) -> Response {
    let device = match paired(device) {
        Ok(device) => device,
        Err(refused) => return refused,
    };
    let home = state.config.files_root();
    let changes = state.store().changes(Some(&device.id), 20);
    match changes {
        Ok(changes) => {
            let views: Vec<_> = changes.iter().map(|c| change_view(c, &home)).collect();
            Json(json!({"changes": views})).into_response()
        }
        Err(error) => internal_error(error),
    }
}

#[derive(Deserialize)]
struct Proposal {
    path: String,
    /// The file as the phone read it.
    base_text: String,
    text: String,
}

async fn propose(
    State(state): State<AppState>,
    Extension(Paired(device)): Extension<Paired>,
    bytes: Bytes,
) -> Response {
    let device = match paired(device) {
        Ok(device) => device,
        Err(refused) => return refused,
    };
    let Ok(proposal) = serde_json::from_slice::<Proposal>(&bytes) else {
        return Refusal::Other("Expected {\"path\", \"base_text\", \"text\"}.").into_response();
    };
    if proposal.text.len() as u64 > TEXT_MAX || proposal.base_text.len() as u64 > TEXT_MAX {
        return Refusal::TooBig(proposal.text.len() as u64).into_response();
    }
    if proposal.text == proposal.base_text {
        return Refusal::Other("Nothing changed.").into_response();
    }
    let home = state.config.files_root();
    let path = match resolve(&proposal.path, &home, own_dirs()) {
        Ok(path) if path.is_file() => path,
        Ok(_) => return Refusal::NotAFile.into_response(),
        Err(refused) => return refused.into_response(),
    };
    if let Err(refused) = readable(&state, &path) {
        return refused;
    }
    let waiting = state
        .store()
        .changes(Some(&device.id), 0)
        .map(|changes| changes.len());
    match waiting {
        Ok(count) if count >= PENDING_MAX => {
            return Refusal::Other("Too many edits are waiting on the laptop.").into_response();
        }
        Ok(_) => {}
        Err(error) => return internal_error(error),
    }
    let change = Change {
        id: token::id(),
        path: path.to_string_lossy().into_owned(),
        device_id: device.id.clone(),
        device_name: device.name.clone(),
        base_hash: sha256(proposal.base_text.as_bytes()),
        base_text: proposal.base_text,
        new_text: proposal.text,
        created_at: store::now(),
        state: "pending".to_owned(),
        decided_at: None,
        outcome: None,
    };
    if let Err(error) = state.store().propose_change(&change) {
        return internal_error(error);
    }
    state.events.send(Event::ChangeProposed {
        id: change.id.clone(),
        path: display(&path, &home),
        device: device.name,
    });
    (StatusCode::CREATED, Json(change_view(&change, &home))).into_response()
}

async fn withdraw(
    State(state): State<AppState>,
    Extension(Paired(device)): Extension<Paired>,
    UrlPath(id): UrlPath<String>,
) -> Response {
    let device = match paired(device) {
        Ok(device) => device,
        Err(refused) => return refused,
    };
    let mine = state
        .store()
        .change(&id)
        .map(|change| change.filter(|change| change.device_id == device.id));
    match mine {
        Ok(Some(_)) => {}
        Ok(None) => return Refusal::Missing.into_response(),
        Err(error) => return internal_error(error),
    }
    let settled = state
        .store()
        .settle_change(&id, "withdrawn", "withdrawn on the phone", "phone");
    match settled {
        Ok(true) => {
            state.events.send(Event::ChangeDecided { id });
            StatusCode::NO_CONTENT.into_response()
        }
        Ok(false) => Refusal::Other("The laptop has already answered it.").into_response(),
        Err(error) => internal_error(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_stay_home_and_out_of_airlocks_folders() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().canonicalize().unwrap();
        let private = home.join(".config/airlock");
        std::fs::create_dir_all(&private).unwrap();
        std::fs::create_dir_all(home.join("Projects/app")).unwrap();
        std::fs::write(private.join("secret"), "x").unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), home.join("escape")).unwrap();

        let private = [private];
        assert_eq!(resolve("~", &home, &private).unwrap(), home);
        assert_eq!(
            resolve("~/Projects/app", &home, &private).unwrap(),
            home.join("Projects/app")
        );
        assert!(matches!(
            resolve("~/Projects/../../etc", &home, &private),
            Err(Refusal::Missing | Refusal::Outside)
        ));
        assert_eq!(resolve("/etc", &home, &private), Err(Refusal::Outside));
        assert_eq!(
            resolve("~/escape", &home, &private),
            Err(Refusal::Outside),
            "symlinks are followed"
        );
        assert_eq!(
            resolve("~/.config/airlock/secret", &home, &private),
            Err(Refusal::Private)
        );
        assert_eq!(resolve("~/nope", &home, &private), Err(Refusal::Missing));
        assert_eq!(resolve("relative", &home, &private), Err(Refusal::Outside));
        assert_eq!(display(&home.join("Projects/app"), &home), "~/Projects/app");
    }

    #[test]
    fn secrets_are_recognised() {
        for path in [
            "/h/app/.env",
            "/h/app/.env.local",
            "/h/.ssh/config",
            "/h/.ssh/id_ed25519",
            "/h/certs/server.pem",
            "/h/.aws/credentials",
            "/h/.docker/config.json",
            "/h/app/secrets.yaml",
            "/h/.netrc",
        ] {
            assert!(is_sensitive(Path::new(path)), "{path}");
        }
        for path in [
            "/h/.ssh/id_ed25519.pub",
            "/h/app/README.md",
            "/h/app/.envrc.example",
            "/h/app/config.json",
        ] {
            assert!(!is_sensitive(Path::new(path)), "{path}");
        }
    }

    #[test]
    fn markdown_is_rendered_without_its_html_or_scripts() {
        let home = Path::new("/home/me");
        let file = home.join("Projects/app/README.md");
        let html = render_markdown(
            "# Title\n\n<script>alert(1)</script>\n\n[web](https://example.com) [bad](javascript:alert(1)) [doc](docs/a.md)\n\n![logo](img/logo.png) ![pixel](https://tracker.example/p.gif)\n",
            &file,
            home,
        );
        assert!(html.contains("<h1>Title</h1>"), "{html}");
        assert!(!html.contains("<script>"), "{html}");
        assert!(html.contains("&lt;script&gt;"), "{html}");
        assert!(html.contains(r#"href="https://example.com""#), "{html}");
        assert!(!html.contains("javascript:"), "{html}");
        assert!(
            html.contains(r##"href="#/files/view/~/Projects/app/docs/a.md""##),
            "{html}"
        );
        assert!(
            html.contains("api/files/raw?path=/home/me/Projects/app/img/logo.png"),
            "{html}"
        );
        assert!(!html.contains("tracker.example"), "{html}");
    }

    #[test]
    fn folders_list_folders_first_and_hide_dotfiles() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().canonicalize().unwrap();
        std::fs::create_dir(home.join("src")).unwrap();
        std::fs::write(home.join("src/main.rs"), "fn main() {}").unwrap();
        std::fs::write(home.join("README.md"), "# hi").unwrap();
        std::fs::write(home.join(".env"), "KEY=1").unwrap();
        let (entries, hidden) = list(&home, &home, false).unwrap();
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, ["src", "README.md"]);
        assert_eq!(hidden, 1);
        assert_eq!(entries[0].items, Some(1));
        let (entries, _) = list(&home, &home, true).unwrap();
        let env = entries.iter().find(|e| e.name == ".env").unwrap();
        assert!(env.sensitive);
        let found = search(&home, &home, "MAIN");
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].path, "~/src/main.rs");
    }

    #[test]
    fn text_and_sizes() {
        assert!(looks_like_text(b"plain text\n"));
        assert!(!looks_like_text(b"\x00\x01binary"));
        assert!(!looks_like_text(&[0xff, 0xfe, 0x41]));
        assert_eq!(human_size(801), "801 B");
        assert_eq!(human_size(2867), "2.8 KB");
        assert_eq!(language(Path::new("install.sh")), Some("bash"));
        assert_eq!(language(Path::new("Dockerfile")), Some("dockerfile"));
        assert_eq!(kind_by_name(Path::new("a.PNG")), Some(Kind::Image));
    }
}
