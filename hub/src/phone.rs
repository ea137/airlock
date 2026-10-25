//! The phone-facing server: what Tailscale Serve proxies to.
//!
//! Every request must carry a `Tailscale-User-Login` header naming an allowed
//! login (Serve adds it). Requests that change anything, and websocket
//! upgrades, must come from this origin, so other websites can't drive it.
//! Everything past pairing needs a device token, which only the laptop can
//! grant. Tokens rotate (see [`store::Store::authenticate`]): when one is
//! replaced, the new one rides back on the response as a cookie.

use axum::{
    Extension, Json, Router,
    body::Bytes,
    extract::{
        Request, State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    http::{HeaderMap, HeaderValue, Method, StatusCode, Uri, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::json;
use tokio::sync::broadcast::error::RecvError;
use tower_http::{
    CompressionLevel,
    compression::{
        CompressionLayer,
        predicate::{DefaultPredicate, NotForContentType, Predicate},
    },
};

use crate::{
    ask, attention, center,
    events::Event,
    faceid, files, laptop_tabs, procs, push,
    state::{AppState, internal_error},
    store::{self, Auth, Device, PairStatus, PairingRefused},
    system, terminal_api, units,
};

pub const DEVICE_COOKIE: &str = "airlock_device";
pub const PAIR_COOKIE: &str = "airlock_pair";
const DEVICE_COOKIE_SECS: i64 = 365 * 24 * 3600;

/// The phone UI, built by `ui/` into `ui/dist` and carried inside the binary.
#[derive(rust_embed::Embed)]
#[folder = "../ui/dist"]
#[allow_missing = true]
struct Ui;

/// The Tailscale login Serve vouched for.
#[derive(Clone, Debug)]
pub struct Login(pub String);

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/session", get(session))
        .route("/api/pair", post(pair))
        .route("/api/pair/status", get(pair_status))
        .route("/api/events", get(events))
        .merge(attention::routes())
        .merge(ask::routes())
        .merge(push::routes())
        .merge(terminal_api::routes())
        .merge(laptop_tabs::routes())
        .merge(center::routes())
        .merge(faceid::routes())
        .merge(files::routes())
        .merge(system::routes())
        .merge(procs::routes())
        .merge(units::routes())
        .fallback(ui)
        .layer(compression())
        .layer(middleware::from_fn_with_state(
            state.clone(),
            device_session,
        ))
        .layer(middleware::from_fn(same_origin))
        .layer(middleware::from_fn_with_state(state.clone(), identity))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            security_headers,
        ))
        .with_state(state)
}

/// Responses compressed for the phone (brotli, else gzip), at a level quick
/// enough for every poll; never a streamed answer, whose lines would wait
/// in the encoder, nor an image, already compressed.
fn compression() -> CompressionLayer<impl Predicate> {
    CompressionLayer::new()
        .quality(CompressionLevel::Precise(4))
        .compress_when(
            DefaultPredicate::new().and(NotForContentType::const_new("application/x-ndjson")),
        )
}

pub(crate) async fn identity(
    State(state): State<AppState>,
    mut req: Request,
    next: Next,
) -> Response {
    let login = req
        .headers()
        .get("tailscale-user-login")
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    match login {
        Some(login) if state.config.allowed_logins.contains(&login) => {
            req.extensions_mut().insert(Login(login));
            next.run(req).await
        }
        _ => (StatusCode::FORBIDDEN, "Not allowed.").into_response(),
    }
}

async fn same_origin(req: Request, next: Next) -> Response {
    let reads_only = matches!(*req.method(), Method::GET | Method::HEAD)
        && !req.headers().contains_key(header::UPGRADE);
    if reads_only || origin_is_host(req.headers()) {
        next.run(req).await
    } else {
        (StatusCode::FORBIDDEN, "Cross-site request refused.").into_response()
    }
}

fn origin_is_host(headers: &HeaderMap) -> bool {
    let text = |name| {
        headers
            .get(name)
            .and_then(|value: &HeaderValue| value.to_str().ok())
    };
    match (text(header::ORIGIN), text(header::HOST)) {
        (Some(origin), Some(host)) => {
            origin == format!("https://{host}")
                || (is_loopback(host) && origin == format!("http://{host}"))
        }
        _ => false,
    }
}

/// A page served from this laptop's loopback address is same-origin over
/// plain HTTP too (the browser tests use it). Phones always arrive over HTTPS
/// through Tailscale Serve.
fn is_loopback(host: &str) -> bool {
    let name = host.rsplit_once(':').map_or(host, |(name, _)| name);
    matches!(name, "127.0.0.1" | "localhost" | "[::1]")
}

fn hostname() -> String {
    std::fs::read_to_string("/proc/sys/kernel/hostname")
        .map(|name| name.trim().to_owned())
        .unwrap_or_default()
}

/// The Content-Security-Policy: everything from this origin only,
/// websockets only back to this host, and frames only from here and the
/// preview origin (this host on `preview_port`). The page may also reach
/// the preview origin, to check that the tailnet lets it through.
fn content_security_policy(host: Option<&str>, preview_port: Option<u16>) -> HeaderValue {
    let preview = match (host, preview_port) {
        (Some(host), Some(port)) => {
            let name = host.rsplit_once(':').map_or(host, |(name, _)| name);
            let plain = if is_loopback(host) {
                format!(" http://{name}:{port}")
            } else {
                String::new()
            };
            format!(" https://{name}:{port}{plain}")
        }
        _ => String::new(),
    };
    let connect = match host {
        Some(host) => format!("connect-src 'self' wss://{host}{preview}"),
        None => "connect-src 'self'".to_owned(),
    };
    let frames = format!("frame-src 'self'{preview}");
    HeaderValue::from_str(&format!(
        "default-src 'self'; {connect}; {frames}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; \
         font-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    ))
    .expect("the host was checked to be header-safe")
}

async fn security_headers(State(state): State<AppState>, req: Request, next: Next) -> Response {
    let preview_port = state
        .config
        .preview_listen
        .map(|_| state.config.preview_port);
    let host = req
        .headers()
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .filter(|host| {
            host.chars()
                .all(|c| c.is_ascii_alphanumeric() || ".-:".contains(c))
        })
        .map(str::to_owned);
    let mut res = next.run(req).await;
    let headers = res.headers_mut();
    // A handler may set a stricter policy of its own (a sandboxed file
    // preview does); otherwise the page's policy applies.
    if !headers.contains_key(header::CONTENT_SECURITY_POLICY) {
        headers.insert(
            header::CONTENT_SECURITY_POLICY,
            content_security_policy(host.as_deref(), preview_port),
        );
        headers.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    }
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    // Nothing is kept, unless a handler says what may be (the UI's files, a
    // file's thumbnail).
    if !headers.contains_key(header::CACHE_CONTROL) {
        headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    }
    res
}

pub(crate) fn read_cookie<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(';'))
        .filter_map(|pair| pair.trim().split_once('='))
        .find(|(key, _)| *key == name)
        .map(|(_, value)| value)
}

pub(crate) fn cookie(name: &str, value: &str, max_age: i64) -> HeaderValue {
    HeaderValue::from_str(&format!(
        "{name}={value}; Path=/; Max-Age={max_age}; HttpOnly; Secure; SameSite=Strict"
    ))
    .expect("cookie values are hex")
}

#[derive(Clone, Debug)]
pub struct Paired(pub Option<Device>);

/// Finds the paired device from its token cookie, rotates the token when it
/// is due, and cuts the device off if a retired token shows up.
pub(crate) async fn device_session(
    State(state): State<AppState>,
    mut req: Request,
    next: Next,
) -> Response {
    let token = read_cookie(req.headers(), DEVICE_COOKIE).map(str::to_owned);
    // A websocket handshake can't hand back a new cookie, so it never rotates.
    let rotate = !req.headers().contains_key(header::UPGRADE);
    let auth = match token {
        Some(token) => state.store().authenticate(&token, rotate),
        None => Ok(Auth::Unknown),
    };
    let (device, new_token) = match auth {
        Ok(Auth::Device { device, new_token }) => (Some(device), new_token),
        Ok(Auth::Stolen { device }) => {
            tracing::warn!(device = %device.id, "a retired device token came back; device revoked");
            state.events.send(Event::DeviceRevoked {
                id: device.id.clone(),
            });
            state.events.send(Event::TokenReused {
                id: device.id,
                name: device.name,
            });
            (None, None)
        }
        Ok(Auth::Unknown) => (None, None),
        Err(error) => return internal_error(error),
    };
    // A Face ID device needs this browser's live unlock too.
    let mut held = false;
    if let Some(device) = &device {
        let path = req.uri().path();
        if path.starts_with("/api/") && !faceid::OPEN_WHEN_LOCKED.contains(&path) {
            let now = store::now();
            let unlock = read_cookie(req.headers(), faceid::UNLOCK_COOKIE);
            let locked = state
                .faceid
                .is_locked(&state.store(), &device.id, unlock, now);
            match locked {
                Ok(true) => held = true,
                Ok(false) => state.faceid.touch(unlock, now),
                Err(error) => return internal_error(error),
            }
        }
    }
    let mut res = if held {
        (
            StatusCode::LOCKED,
            Json(json!({"error": "Airlock is locked. Unlock it with Face ID."})),
        )
            .into_response()
    } else {
        req.extensions_mut().insert(Paired(device));
        next.run(req).await
    };
    if let Some(token) = new_token {
        res.headers_mut().append(
            header::SET_COOKIE,
            cookie(DEVICE_COOKIE, &token, DEVICE_COOKIE_SECS),
        );
    }
    res
}

pub(crate) fn unpaired() -> Response {
    (StatusCode::UNAUTHORIZED, "This device is not paired.").into_response()
}

/// A file in `assets/` is
/// named by a hash of what's in it, so it never changes: the phone keeps it,
/// and asks again only for the page, which names the files of its version.
fn kept(path: &str) -> &'static str {
    if path.starts_with("assets/") {
        "private, max-age=31536000, immutable"
    } else {
        "no-store"
    }
}

async fn ui(uri: Uri) -> Response {
    let path = match uri.path().trim_start_matches('/') {
        "" => "index.html",
        path => path,
    };
    match Ui::get(path) {
        Some(file) => (
            [
                (header::CONTENT_TYPE, file.metadata.mimetype().to_owned()),
                (header::CACHE_CONTROL, kept(path).to_owned()),
            ],
            file.data.into_owned(),
        )
            .into_response(),
        None if path == "index.html" => (
            StatusCode::SERVICE_UNAVAILABLE,
            "The phone UI isn't built. Run ./build.sh on the laptop.",
        )
            .into_response(),
        None => (StatusCode::NOT_FOUND, "Not found.").into_response(),
    }
}

async fn session(
    State(state): State<AppState>,
    Extension(Paired(device)): Extension<Paired>,
    headers: HeaderMap,
) -> Response {
    let Some(device) = device else {
        return Json(json!({"paired": false})).into_response();
    };
    let unlock = read_cookie(&headers, faceid::UNLOCK_COOKIE);
    let lock = state
        .faceid
        .lock_state(&state.store(), &device.id, unlock, store::now());
    match lock {
        Ok(lock) => Json(json!({
            "paired": true,
            "device": {"id": device.id, "name": device.name},
            "host": hostname(),
            "home": std::env::var("HOME").unwrap_or_default(),
            "lock": lock,
            "preview_port": state.config.preview_listen.map(|_| state.config.preview_port),
        }))
        .into_response(),
        Err(error) => internal_error(error),
    }
}

#[derive(Default, Deserialize)]
struct PairBody {
    name: Option<String>,
}

async fn pair(
    State(state): State<AppState>,
    Extension(Login(login)): Extension<Login>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let body: PairBody = if body.is_empty() {
        PairBody::default()
    } else {
        match serde_json::from_slice(&body) {
            Ok(body) => body,
            Err(_) => return (StatusCode::BAD_REQUEST, "Expected JSON.").into_response(),
        }
    };
    let user_agent = headers
        .get(header::USER_AGENT)
        .and_then(|value| value.to_str().ok());
    let name = device_name(body.name.as_deref(), user_agent);
    let result = state.store().request_pairing(&name, &login);
    match result {
        Ok(Ok((pairing, secret))) => {
            state.events.send(Event::PairingRequested {
                id: pairing.id.clone(),
                code: pairing.code.clone(),
                name: pairing.name.clone(),
            });
            let mut res =
                Json(json!({"code": pairing.code, "expires_in": store::PAIRING_TTL_SECS}))
                    .into_response();
            res.headers_mut().append(
                header::SET_COOKIE,
                cookie(PAIR_COOKIE, &secret, store::PAIRING_TTL_SECS),
            );
            res
        }
        Ok(Err(PairingRefused::TooMany)) => (
            StatusCode::TOO_MANY_REQUESTS,
            "Too many pairing requests are waiting on the laptop.",
        )
            .into_response(),
        Err(error) => internal_error(error),
    }
}

async fn pair_status(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let Some(secret) = read_cookie(&headers, PAIR_COOKIE) else {
        return Json(json!({"state": "none"})).into_response();
    };
    let status = state.store().pairing_status(secret);
    let status = match status {
        Ok(status) => status,
        Err(error) => return internal_error(error),
    };
    let body = match &status {
        PairStatus::Pending { code } => json!({"state": "pending", "code": code}),
        PairStatus::Approved { device, .. } => {
            json!({"state": "approved", "device": {"id": device.id, "name": device.name}})
        }
        other => json!({"state": other.label()}),
    };
    let mut res = Json(body).into_response();
    if let PairStatus::Approved { token, .. } = &status {
        res.headers_mut().append(
            header::SET_COOKIE,
            cookie(DEVICE_COOKIE, token, DEVICE_COOKIE_SECS),
        );
    }
    if !matches!(status, PairStatus::Pending { .. }) {
        res.headers_mut()
            .append(header::SET_COOKIE, cookie(PAIR_COOKIE, "", 0));
    }
    res
}

/// Closes the moment the device is revoked.
async fn events(
    State(state): State<AppState>,
    Extension(Paired(device)): Extension<Paired>,
    ws: WebSocketUpgrade,
) -> Response {
    let Some(device) = device else {
        return (StatusCode::UNAUTHORIZED, "This device is not paired.").into_response();
    };
    ws.on_upgrade(move |socket| event_stream(socket, state, device.id))
}

fn still_active(state: &AppState, device_id: &str) -> bool {
    state.store().is_active(device_id).unwrap_or(false)
}

async fn event_stream(mut socket: WebSocket, state: AppState, device_id: String) {
    let mut events = state.events.subscribe();
    if !still_active(&state, &device_id) {
        return;
    }
    let hello = json!({"type": "hello", "device": device_id}).to_string();
    if socket.send(Message::Text(hello.into())).await.is_err() {
        return;
    }
    // The only news a phone gets: that a session changed how it stands,
    // never which one or how; it asks for what it shows. Missed news might
    // have been that.
    let sessions_changed = || Message::Text(r#"{"type":"sessions_changed"}"#.into());
    loop {
        tokio::select! {
            event = events.recv() => match event {
                Ok(Event::DeviceRevoked { id }) if id == device_id => break,
                Ok(Event::HubStopping) | Err(RecvError::Closed) => break,
                Ok(Event::SessionsChanged) => {
                    if socket.send(sessions_changed()).await.is_err() {
                        return;
                    }
                }
                Ok(_) => {}
                Err(RecvError::Lagged(_)) => {
                    if !still_active(&state, &device_id)
                        || socket.send(sessions_changed()).await.is_err()
                    {
                        break;
                    }
                }
            },
            incoming = socket.recv() => match incoming {
                Some(Ok(_)) => {}
                _ => return,
            },
        }
    }
    let _ = socket.send(Message::Close(None)).await;
}

fn device_name(given: Option<&str>, user_agent: Option<&str>) -> String {
    let given: String = given
        .unwrap_or_default()
        .chars()
        .filter(|c| !c.is_control())
        .take(40)
        .collect();
    let given = given.trim();
    if !given.is_empty() {
        return given.to_owned();
    }
    let user_agent = user_agent.unwrap_or_default();
    let guess = [
        ("iPhone", "iPhone"),
        ("iPad", "iPad"),
        ("Android", "Android phone"),
        ("Macintosh", "Mac"),
        ("Windows", "Windows PC"),
        ("Linux", "Linux computer"),
    ]
    .into_iter()
    .find(|(needle, _)| user_agent.contains(needle))
    .map_or("Device", |(_, name)| name);
    guess.to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_come_from_the_phone_or_its_browser() {
        assert_eq!(device_name(Some("  Work phone "), None), "Work phone");
        assert_eq!(
            device_name(
                None,
                Some("Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X)")
            ),
            "iPhone"
        );
        assert_eq!(device_name(Some("\u{7}"), None), "Device");
        assert_eq!(device_name(Some(&"x".repeat(100)), None).len(), 40);
    }

    #[test]
    fn origin_must_match_the_host() {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::HOST,
            HeaderValue::from_static("laptop.example.ts.net"),
        );
        assert!(!origin_is_host(&headers));
        headers.insert(
            header::ORIGIN,
            HeaderValue::from_static("https://evil.example"),
        );
        assert!(!origin_is_host(&headers));
        headers.insert(
            header::ORIGIN,
            HeaderValue::from_static("https://laptop.example.ts.net"),
        );
        assert!(origin_is_host(&headers));
        headers.insert(
            header::ORIGIN,
            HeaderValue::from_static("http://laptop.example.ts.net"),
        );
        assert!(!origin_is_host(&headers), "plain HTTP only on loopback");
    }

    #[test]
    fn loopback_pages_are_same_origin_over_http() {
        let headers = |origin, host| {
            let mut headers = HeaderMap::new();
            headers.insert(header::ORIGIN, HeaderValue::from_static(origin));
            headers.insert(header::HOST, HeaderValue::from_static(host));
            headers
        };
        assert!(origin_is_host(&headers(
            "http://127.0.0.1:7690",
            "127.0.0.1:7690"
        )));
        assert!(origin_is_host(&headers(
            "http://localhost:7690",
            "localhost:7690"
        )));
        assert!(!origin_is_host(&headers(
            "http://127.0.0.1:9999",
            "127.0.0.1:7690"
        )));
        assert!(!origin_is_host(&headers(
            "http://evil.example",
            "127.0.0.1:7690"
        )));
    }
}

#[cfg(test)]
mod http_tests {
    use std::time::Duration;

    use axum::{
        body::Body,
        http::{Request as HttpRequest, request::Builder},
    };
    use futures_util::StreamExt;
    use http_body_util::BodyExt;
    use tokio_tungstenite::tungstenite::{Message as WsMessage, client::IntoClientRequest};
    use tower::ServiceExt;

    use super::*;
    use crate::{
        admin, attach, client,
        state::testing::{LOGIN, state as app, state_with as app_with},
        terminals::testing::ScratchTmux,
    };

    const HOST: &str = "laptop.example-tailnet.ts.net";

    struct Reply {
        status: StatusCode,
        headers: HeaderMap,
        body: serde_json::Value,
    }

    impl Reply {
        fn cookie(&self, name: &str) -> Option<String> {
            self.headers
                .get_all(header::SET_COOKIE)
                .iter()
                .filter_map(|value| value.to_str().ok()?.split(';').next())
                .filter_map(|pair| pair.split_once('='))
                .find(|(key, value)| *key == name && !value.is_empty())
                .map(|(key, value)| format!("{key}={value}"))
        }
    }

    async fn send(router: &Router, request: HttpRequest<Body>) -> Reply {
        let res = router.clone().oneshot(request).await.unwrap();
        let status = res.status();
        let headers = res.headers().clone();
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        let body = serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);
        Reply {
            status,
            headers,
            body,
        }
    }

    /// A request as Tailscale Serve would pass it on from your own phone.
    fn from_phone(method: Method, uri: &str, cookie: Option<&str>) -> Builder {
        let builder = HttpRequest::builder()
            .method(method)
            .uri(uri)
            .header(header::HOST, HOST)
            .header("tailscale-user-login", LOGIN)
            .header(header::ORIGIN, format!("https://{HOST}"));
        match cookie {
            Some(cookie) => builder.header(header::COOKIE, cookie),
            None => builder,
        }
    }

    async fn session(phone: &Router, cookie: &str) -> serde_json::Value {
        let request = from_phone(Method::GET, "/api/session", Some(cookie))
            .body(Body::empty())
            .unwrap();
        send(phone, request).await.body
    }

    async fn on_laptop(admin: &Router, path: &str) -> Reply {
        let request = HttpRequest::builder()
            .method(Method::POST)
            .uri(path)
            .body(Body::empty())
            .unwrap();
        send(admin, request).await
    }

    /// Returns the pairing cookie and the code.
    async fn ask(phone: &Router) -> (String, String) {
        let request = from_phone(Method::POST, "/api/pair", None)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(r#"{"name":"Test phone"}"#))
            .unwrap();
        let asked = send(phone, request).await;
        assert_eq!(asked.status, StatusCode::OK);
        let code = asked.body["code"].as_str().unwrap().to_owned();
        (asked.cookie(PAIR_COOKIE).unwrap(), code)
    }

    async fn collect(phone: &Router, pair_cookie: &str) -> Reply {
        let request = from_phone(Method::GET, "/api/pair/status", Some(pair_cookie))
            .body(Body::empty())
            .unwrap();
        send(phone, request).await
    }

    /// Returns the device cookie.
    async fn pair(phone: &Router, admin: &Router) -> String {
        let (pair_cookie, code) = ask(phone).await;
        assert_eq!(
            on_laptop(admin, &format!("/pairings/{code}/approve"))
                .await
                .status,
            StatusCode::OK
        );
        let collected = collect(phone, &pair_cookie).await;
        assert_eq!(collected.body["state"], "approved");
        collected.cookie(DEVICE_COOKIE).unwrap()
    }

    #[tokio::test]
    async fn strangers_are_refused() {
        let phone = router(app());
        let anonymous = HttpRequest::builder()
            .uri("/api/session")
            .header(header::HOST, HOST)
            .body(Body::empty())
            .unwrap();
        assert_eq!(send(&phone, anonymous).await.status, StatusCode::FORBIDDEN);
        let someone_else = HttpRequest::builder()
            .uri("/api/session")
            .header(header::HOST, HOST)
            .header("tailscale-user-login", "someone@example.org")
            .body(Body::empty())
            .unwrap();
        let refused = send(&phone, someone_else).await;
        assert_eq!(refused.status, StatusCode::FORBIDDEN);
        assert_eq!(refused.headers[header::X_FRAME_OPTIONS], "DENY");
        assert!(
            refused.headers[header::CONTENT_SECURITY_POLICY]
                .to_str()
                .unwrap()
                .contains("frame-ancestors 'none'")
        );
    }

    #[tokio::test]
    async fn answers_come_compressed_and_only_what_never_changes_is_kept() {
        let state = app();
        let (phone, admin) = (router(state.clone()), admin::router(state.clone()));
        let device = pair(&phone, &admin).await;
        let asked = |encodings: Option<&str>| {
            let request = from_phone(Method::GET, "/api/session", Some(&device));
            match encodings {
                Some(encodings) => request.header(header::ACCEPT_ENCODING, encodings),
                None => request,
            }
            .body(Body::empty())
            .unwrap()
        };
        let res = phone
            .clone()
            .oneshot(asked(Some("gzip, deflate, br")))
            .await
            .unwrap();
        assert_eq!(res.headers()[header::CONTENT_ENCODING], "br");
        assert_eq!(res.headers()[header::CACHE_CONTROL], "no-store");
        let res = phone.clone().oneshot(asked(Some("gzip"))).await.unwrap();
        assert_eq!(res.headers()[header::CONTENT_ENCODING], "gzip");
        let res = phone.clone().oneshot(asked(None)).await.unwrap();
        assert!(!res.headers().contains_key(header::CONTENT_ENCODING));

        // A handler's own word on keeping wins; otherwise nothing is kept.
        let kept_a_minute = Router::new()
            .route(
                "/kept",
                axum::routing::get(|| async {
                    ([(header::CACHE_CONTROL, "private, max-age=60")], "x")
                }),
            )
            .route("/plain", axum::routing::get(|| async { "x" }))
            .layer(middleware::from_fn_with_state(state, security_headers));
        let cache_of = |path: &str| {
            let request = HttpRequest::builder()
                .uri(path)
                .body(Body::empty())
                .unwrap();
            let router = kept_a_minute.clone();
            async move {
                router.oneshot(request).await.unwrap().headers()[header::CACHE_CONTROL].clone()
            }
        };
        assert_eq!(cache_of("/kept").await, "private, max-age=60");
        assert_eq!(cache_of("/plain").await, "no-store");

        // The UI's hashed files are kept; the page that names them isn't.
        assert_eq!(
            kept("assets/index-7lb3TL6B.js"),
            "private, max-age=31536000, immutable"
        );
        assert_eq!(kept("index.html"), "no-store");
    }

    #[tokio::test]
    async fn other_websites_cannot_start_pairing() {
        let phone = router(app());
        let request = HttpRequest::builder()
            .method(Method::POST)
            .uri("/api/pair")
            .header(header::HOST, HOST)
            .header("tailscale-user-login", LOGIN)
            .header(header::ORIGIN, "https://evil.example")
            .body(Body::empty())
            .unwrap();
        assert_eq!(send(&phone, request).await.status, StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn a_previewed_app_cannot_act_on_airlock() {
        // Same host, the preview port: another origin, so no changes.
        let phone = router(app());
        let request = HttpRequest::builder()
            .method(Method::POST)
            .uri("/api/terminals")
            .header(header::HOST, HOST)
            .header("tailscale-user-login", LOGIN)
            .header(header::ORIGIN, format!("https://{HOST}:8443"))
            .body(Body::empty())
            .unwrap();
        assert_eq!(send(&phone, request).await.status, StatusCode::FORBIDDEN);
        assert!(!origin_is_host(&HeaderMap::from_iter([
            (header::HOST, HeaderValue::from_static("127.0.0.1:4430")),
            (
                header::ORIGIN,
                HeaderValue::from_static("https://127.0.0.1:4431")
            ),
        ])));
    }

    #[tokio::test]
    async fn a_phone_gets_in_once_the_laptop_approves() {
        let state = app();
        let (phone, admin) = (router(state.clone()), admin::router(state));
        let (pair_cookie, _) = ask(&phone).await;
        assert_eq!(collect(&phone, &pair_cookie).await.body["state"], "pending");
        assert_eq!(session(&phone, &pair_cookie).await["paired"], false);

        let device = pair(&phone, &admin).await;
        let me = session(&phone, &device).await;
        assert_eq!(me["paired"], true);
        assert_eq!(me["device"]["name"], "Test phone");
        let cookie_line = |reply: &Reply| {
            reply
                .headers
                .get_all(header::SET_COOKIE)
                .iter()
                .map(|v| v.to_str().unwrap().to_owned())
                .collect::<Vec<_>>()
        };
        let (pair_cookie, code) = ask(&phone).await;
        on_laptop(&admin, &format!("/pairings/{code}/approve")).await;
        let collected = collect(&phone, &pair_cookie).await;
        assert!(cookie_line(&collected).iter().any(|line| {
            line.starts_with(DEVICE_COOKIE)
                && line.contains("HttpOnly")
                && line.contains("Secure")
                && line.contains("SameSite=Strict")
        }));
    }

    #[tokio::test]
    async fn a_denied_phone_stays_out() {
        let state = app();
        let (phone, admin) = (router(state.clone()), admin::router(state));
        let (pair_cookie, code) = ask(&phone).await;
        assert_eq!(
            on_laptop(&admin, &format!("/pairings/{code}/deny"))
                .await
                .status,
            StatusCode::OK
        );
        let collected = collect(&phone, &pair_cookie).await;
        assert_eq!(collected.body["state"], "denied");
        assert_eq!(collected.cookie(DEVICE_COOKIE), None);
    }

    #[tokio::test]
    async fn tokens_rotate_and_a_copied_token_gets_the_device_cut_off() {
        let state = app();
        let (phone, admin) = (router(state.clone()), admin::router(state.clone()));
        let mut alerts = state.events.subscribe();
        let old = pair(&phone, &admin).await;

        state.store().backdate_tokens(store::ROTATE_EVERY_SECS);
        let request = from_phone(Method::GET, "/api/session", Some(&old))
            .body(Body::empty())
            .unwrap();
        let new = send(&phone, request)
            .await
            .cookie(DEVICE_COOKIE)
            .expect("a fresh token rides back");
        assert_ne!(new, old);
        assert_eq!(session(&phone, &new).await["paired"], true);

        // A request the phone sent before it had the new token, arriving
        // late, still gets in.
        assert_eq!(session(&phone, &old).await["paired"], true);
        // Someone replays the copied, now retired, token later on.
        state.store().backdate_retired(store::RETIRED_GRACE_SECS);
        assert_eq!(session(&phone, &old).await["paired"], false);
        // The device is cut off, and the laptop hears about it.
        assert_eq!(session(&phone, &new).await["paired"], false);
        let mut seen = Vec::new();
        while let Ok(event) = alerts.try_recv() {
            seen.push(event);
        }
        assert!(
            seen.iter()
                .any(|event| matches!(event, Event::TokenReused { .. }))
        );
    }

    async fn post_json(phone: &Router, path: &str, cookie: &str, body: String) -> Reply {
        let request = from_phone(Method::POST, path, Some(cookie))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body))
            .unwrap();
        send(phone, request).await
    }

    async fn get(phone: &Router, path: &str, cookie: &str) -> Reply {
        let request = from_phone(Method::GET, path, Some(cookie))
            .body(Body::empty())
            .unwrap();
        send(phone, request).await
    }

    #[tokio::test]
    async fn face_id_locks_a_quiet_device_and_only_its_passkey_unlocks_it() {
        use webauthn_authenticator_rs::{WebauthnAuthenticator, softpasskey::SoftPasskey};
        use webauthn_rs::prelude::{CreationChallengeResponse, RequestChallengeResponse, Url};

        let state = app();
        let (phone, admin) = (router(state.clone()), admin::router(state.clone()));
        let device = pair(&phone, &admin).await;
        let me = session(&phone, &device).await;
        assert_eq!(me["lock"], "none", "no Face ID, no lock");
        let id = me["device"]["id"].as_str().unwrap().to_owned();
        let origin = Url::parse(&format!("https://{HOST}")).unwrap();
        // The phone's passkey: it claims Face ID passed, as the real one does.
        let mut iphone = WebauthnAuthenticator::new(SoftPasskey::new(true));

        let started = post_json(&phone, "/api/faceid/setup/start", &device, String::new()).await;
        assert_eq!(started.status, StatusCode::OK);
        let options: CreationChallengeResponse = serde_json::from_value(started.body).unwrap();
        let credential = iphone.do_registration(origin.clone(), options).unwrap();
        let body = serde_json::to_string(&credential).unwrap();
        let set_up = post_json(&phone, "/api/faceid/setup/finish", &device, body).await;
        assert_eq!(set_up.status, StatusCode::NO_CONTENT, "{:?}", set_up.body);
        let unlock = set_up
            .cookie(faceid::UNLOCK_COOKIE)
            .expect("an unlock cookie");
        let iphone_cookies = format!("{device}; {unlock}");
        assert_eq!(session(&phone, &iphone_cookies).await["lock"], "unlocked");
        assert_eq!(
            get(&phone, "/api/terminals", &iphone_cookies).await.status,
            StatusCode::OK
        );
        assert!(state.store().devices().unwrap()[0].face_id);

        // A copy of the device cookie gets nothing, even while the phone is
        // unlocked: the unlock belongs to the browser that unlocked.
        assert_eq!(session(&phone, &device).await["lock"], "locked");
        assert_eq!(
            get(&phone, "/api/terminals", &device).await.status,
            StatusCode::LOCKED
        );

        // Five quiet minutes later, the phone is locked too.
        state.faceid.backdate(&id, faceid::LOCK_AFTER_SECS + 1);
        assert_eq!(session(&phone, &iphone_cookies).await["lock"], "locked");
        let held = get(&phone, "/api/terminals", &iphone_cookies).await;
        assert_eq!(held.status, StatusCode::LOCKED);
        assert_eq!(
            held.body["error"],
            "Airlock is locked. Unlock it with Face ID."
        );

        // Its own passkey unlocks it, with a fresh unlock cookie.
        let started = post_json(&phone, "/api/faceid/unlock/start", &device, String::new()).await;
        let options: RequestChallengeResponse = serde_json::from_value(started.body).unwrap();
        let answer = iphone.do_authentication(origin.clone(), options).unwrap();
        let answer = serde_json::to_string(&answer).unwrap();
        let unlocked =
            post_json(&phone, "/api/faceid/unlock/finish", &device, answer.clone()).await;
        assert_eq!(
            unlocked.status,
            StatusCode::NO_CONTENT,
            "{:?}",
            unlocked.body
        );
        let fresh = unlocked.cookie(faceid::UNLOCK_COOKIE).unwrap();
        assert_ne!(fresh, unlock);
        let iphone_cookies = format!("{device}; {fresh}");
        assert_eq!(
            get(&phone, "/api/terminals", &iphone_cookies).await.status,
            StatusCode::OK
        );

        // Leaving the screen locks it at once, and asking again while locked
        // is harmless.
        let left = post_json(&phone, "/api/faceid/lock", &iphone_cookies, String::new()).await;
        assert_eq!(left.status, StatusCode::NO_CONTENT);
        assert_eq!(session(&phone, &iphone_cookies).await["lock"], "locked");
        assert_eq!(
            get(&phone, "/api/terminals", &iphone_cookies).await.status,
            StatusCode::LOCKED
        );
        let again = post_json(&phone, "/api/faceid/lock", &iphone_cookies, String::new()).await;
        assert_eq!(again.status, StatusCode::NO_CONTENT);

        // An old answer, replayed, doesn't: each unlock has its own challenge.
        state.faceid.backdate(&id, faceid::LOCK_AFTER_SECS + 1);
        post_json(&phone, "/api/faceid/unlock/start", &device, String::new()).await;
        let replayed = post_json(&phone, "/api/faceid/unlock/finish", &device, answer).await;
        assert_eq!(replayed.status, StatusCode::FORBIDDEN);
        assert_eq!(replayed.cookie(faceid::UNLOCK_COOKIE), None);
        assert_eq!(
            get(&phone, "/api/terminals", &iphone_cookies).await.status,
            StatusCode::LOCKED
        );

        // Another passkey, someone else's, can't answer for this device.
        let mut stranger = WebauthnAuthenticator::new(SoftPasskey::new(true));
        let started = post_json(&phone, "/api/faceid/unlock/start", &device, String::new()).await;
        let options: RequestChallengeResponse = serde_json::from_value(started.body).unwrap();
        assert!(
            stranger.do_authentication(origin, options).is_err(),
            "the challenge names only this device's passkey"
        );
        assert!(
            state
                .store()
                .audit_log(5)
                .unwrap()
                .iter()
                .any(|entry| entry.action == "face id unlock failed")
        );
    }

    #[tokio::test]
    async fn revoking_closes_the_live_connection_at_once() {
        let state = app();
        let (phone, admin) = (router(state.clone()), admin::router(state));
        let device = pair(&phone, &admin).await;

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, phone).await.unwrap() });

        let mut request = format!("ws://{address}/api/events")
            .into_client_request()
            .unwrap();
        let headers = request.headers_mut();
        headers.insert(header::HOST, HOST.parse().unwrap());
        headers.insert("tailscale-user-login", LOGIN.parse().unwrap());
        headers.insert(header::ORIGIN, format!("https://{HOST}").parse().unwrap());
        headers.insert(header::COOKIE, device.parse().unwrap());
        let (mut socket, _) = tokio_tungstenite::connect_async(request).await.unwrap();
        let hello = socket.next().await.unwrap().unwrap();
        assert!(hello.to_text().unwrap().contains("hello"));

        let path = format!("/devices/{}/revoke", client::segment("Test phone"));
        assert_eq!(on_laptop(&admin, &path).await.status, StatusCode::OK);
        let next = tokio::time::timeout(Duration::from_secs(2), socket.next())
            .await
            .expect("the connection closes within 2 seconds");
        assert!(matches!(
            next,
            None | Some(Ok(WsMessage::Close(_))) | Some(Err(_))
        ));
    }

    #[tokio::test]
    async fn a_phone_hears_only_that_a_session_changed_how_it_stands() {
        let state = app();
        let (phone, admin) = (router(state.clone()), admin::router(state.clone()));
        let device = pair(&phone, &admin).await;
        let mut socket = connect(phone, "/api/events", &device).await;
        let hello = socket.next().await.unwrap().unwrap();
        assert!(hello.to_text().unwrap().contains("hello"));
        let hook = |name: &str| {
            let event = json!({"session_id": "s1", "cwd": "/tmp", "hook_event_name": name, "tool_name": "Bash", "tool_input": {"command": "ls"}});
            HttpRequest::builder()
                .method(Method::POST)
                .uri("/claude/hook")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(json!({ "event": event }).to_string()))
                .unwrap()
        };
        async fn heard(socket: &mut Socket) -> Option<String> {
            tokio::time::timeout(Duration::from_millis(500), socket.next())
                .await
                .ok()
                .flatten()
                .map(|message| message.unwrap().into_text().unwrap().to_string())
        }

        // The laptop's own news never reaches the phone: not a pairing code.
        state.events.send(Event::PairingRequested {
            id: "p1".to_owned(),
            code: "123456".to_owned(),
            name: "Someone's phone".to_owned(),
        });
        // A session that goes to work is news; going on working isn't.
        send(&admin, hook("PreToolUse")).await;
        assert_eq!(
            heard(&mut socket).await.as_deref(),
            Some(r#"{"type":"sessions_changed"}"#)
        );
        send(&admin, hook("PreToolUse")).await;
        assert_eq!(heard(&mut socket).await, None);
        // Asking you something is news again.
        send(&admin, hook("PermissionRequest")).await;
        assert_eq!(
            heard(&mut socket).await.as_deref(),
            Some(r#"{"type":"sessions_changed"}"#)
        );
    }

    type Socket = tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >;

    async fn connect(phone: Router, path: &str, device: &str) -> Socket {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, phone).await.unwrap() });
        let mut request = format!("ws://{address}{path}")
            .into_client_request()
            .unwrap();
        let headers = request.headers_mut();
        headers.insert(header::HOST, HOST.parse().unwrap());
        headers.insert("tailscale-user-login", LOGIN.parse().unwrap());
        headers.insert(header::ORIGIN, format!("https://{HOST}").parse().unwrap());
        headers.insert(header::COOKIE, device.parse().unwrap());
        tokio_tungstenite::connect_async(request).await.unwrap().0
    }

    fn json_request(
        method: Method,
        uri: &str,
        device: &str,
        body: serde_json::Value,
    ) -> HttpRequest<Body> {
        from_phone(method, uri, Some(device))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body.to_string()))
            .unwrap()
    }

    #[tokio::test]
    async fn terminals_need_a_paired_device() {
        let phone = router(app());
        let request = from_phone(Method::GET, "/api/terminals", None)
            .body(Body::empty())
            .unwrap();
        assert_eq!(send(&phone, request).await.status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn the_phone_manages_terminals_and_tabs() {
        let scratch = ScratchTmux::new();
        let state = app_with(scratch.tmux.clone());
        let (phone, admin) = (router(state.clone()), admin::router(state));
        let device = pair(&phone, &admin).await;
        let cwd = scratch.dir().to_str().unwrap();

        let created = send(
            &phone,
            json_request(Method::POST, "/api/terminals", &device, json!({"cwd": cwd})),
        )
        .await;
        assert_eq!(created.status, StatusCode::CREATED);
        let id = created.body["id"].as_u64().unwrap();

        let tab = send(
            &phone,
            json_request(
                Method::POST,
                &format!("/api/terminals/{id}/tabs"),
                &device,
                json!({}),
            ),
        )
        .await;
        assert_eq!(tab.status, StatusCode::CREATED);
        let tab = tab.body["id"].as_u64().unwrap();
        let renamed = send(
            &phone,
            json_request(
                Method::PATCH,
                &format!("/api/tabs/{tab}"),
                &device,
                json!({"name": "claude"}),
            ),
        )
        .await;
        assert_eq!(renamed.status, StatusCode::NO_CONTENT);

        let listed = send(
            &phone,
            from_phone(Method::GET, "/api/terminals", Some(&device))
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        let terminal = &listed.body[0];
        assert_eq!(
            terminal["name"],
            scratch.dir().file_name().unwrap().to_str().unwrap()
        );
        assert_eq!(terminal["tabs"].as_array().unwrap().len(), 2);
        assert_eq!(terminal["tabs"][1]["name"], "claude");

        let closed = send(
            &phone,
            from_phone(Method::DELETE, &format!("/api/tabs/{tab}"), Some(&device))
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(closed.status, StatusCode::NO_CONTENT);
        let gone = send(
            &phone,
            from_phone(Method::DELETE, &format!("/api/tabs/{tab}"), Some(&device))
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(gone.status, StatusCode::NOT_FOUND);

        let nowhere = send(
            &phone,
            json_request(
                Method::POST,
                "/api/terminals",
                &device,
                json!({"cwd": "/no/such/airlock"}),
            ),
        )
        .await;
        assert_eq!(nowhere.status, StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn a_terminal_streams_to_the_phone_and_runs_what_it_types() {
        let scratch = ScratchTmux::new();
        let state = app_with(scratch.tmux.clone());
        let (phone, admin) = (router(state.clone()), admin::router(state.clone()));
        let device = pair(&phone, &admin).await;
        let id = scratch.tmux.create("stream", scratch.dir()).await.unwrap();

        let mut socket = connect(
            phone,
            &format!("/api/terminals/{id}/attach?cols=80&rows=24"),
            &device,
        )
        .await;
        use futures_util::SinkExt;
        socket
            .send(WsMessage::Text(r#"{"type":"ping"}"#.into()))
            .await
            .unwrap();
        // The shell computes 40+2, so seeing 42 means the keys ran, not just echoed.
        socket
            .send(WsMessage::Binary("echo airlock-$((40+2))\r".into()))
            .await
            .unwrap();

        let (mut screen, mut pong) = (String::new(), false);
        let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
        while !(pong && screen.contains("airlock-42")) {
            let next = tokio::time::timeout_at(deadline, socket.next())
                .await
                .expect("the output arrives within 10 seconds");
            match next {
                Some(Ok(WsMessage::Binary(bytes))) => {
                    screen.push_str(&String::from_utf8_lossy(&bytes))
                }
                Some(Ok(WsMessage::Text(text))) => pong |= text.contains("pong"),
                other => panic!("the stream ended early: {other:?}"),
            }
        }

        // Revoking the device ends the stream; the terminal itself keeps running.
        let path = format!("/devices/{}/revoke", client::segment("Test phone"));
        assert_eq!(on_laptop(&admin, &path).await.status, StatusCode::OK);
        while let Some(Ok(WsMessage::Binary(_))) =
            tokio::time::timeout(Duration::from_secs(2), socket.next())
                .await
                .expect("closes within 2 s")
        {
            // Output still in flight before the close.
        }
        assert!(scratch.tmux.exists(id).await);
    }

    #[tokio::test]
    async fn a_face_id_lock_ends_the_terminal_stream_at_once() {
        use webauthn_authenticator_rs::{WebauthnAuthenticator, softpasskey::SoftPasskey};
        use webauthn_rs::prelude::{CreationChallengeResponse, Url};

        let scratch = ScratchTmux::new();
        let state = app_with(scratch.tmux.clone());
        let (phone, admin) = (router(state.clone()), admin::router(state.clone()));
        let device = pair(&phone, &admin).await;
        let origin = Url::parse(&format!("https://{HOST}")).unwrap();
        let mut iphone = WebauthnAuthenticator::new(SoftPasskey::new(true));
        let started = post_json(&phone, "/api/faceid/setup/start", &device, String::new()).await;
        let options: CreationChallengeResponse = serde_json::from_value(started.body).unwrap();
        let credential = iphone.do_registration(origin, options).unwrap();
        let body = serde_json::to_string(&credential).unwrap();
        let set_up = post_json(&phone, "/api/faceid/setup/finish", &device, body).await;
        let unlock = set_up.cookie(faceid::UNLOCK_COOKIE).unwrap();
        let cookies = format!("{device}; {unlock}");
        let id = scratch.tmux.create("locked", scratch.dir()).await.unwrap();

        let mut socket = connect(
            phone.clone(),
            &format!("/api/terminals/{id}/attach?cols=80&rows=24"),
            &cookies,
        )
        .await;
        // The stream is live: its first screen arrives.
        let first = tokio::time::timeout(Duration::from_secs(5), socket.next())
            .await
            .expect("the screen arrives");
        assert!(matches!(first, Some(Ok(WsMessage::Binary(_)))));

        // Airlock leaves the phone's screen and locks: the stream ends well
        // before the next routine check.
        let locked = post_json(&phone, "/api/faceid/lock", &cookies, String::new()).await;
        assert_eq!(locked.status, StatusCode::NO_CONTENT);
        let close = loop {
            match tokio::time::timeout(Duration::from_secs(2), socket.next())
                .await
                .expect("closes within 2 s")
            {
                Some(Ok(WsMessage::Binary(_))) => {}
                Some(Ok(WsMessage::Close(frame))) => break frame,
                other => panic!("expected a close frame, got {other:?}"),
            }
        };
        let code: u16 = close.expect("a close code").code.into();
        assert_eq!(code, attach::LOCKED);
        assert!(scratch.tmux.exists(id).await, "the terminal keeps running");
    }
}
