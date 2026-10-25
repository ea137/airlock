//! Dev-server previews, on their own origin.
//!
//! A dev server's pages run whatever its code says, so they never share
//! Airlock's origin: previews are served by a second listener
//! (`preview_listen`), which Tailscale Serve publishes on its own port
//! (`preview_port`). Pages there can't call Airlock's API (it checks the
//! origin of anything that changes state, and sends no CORS headers), and
//! Airlock's cookies are stripped before a request reaches the dev server.
//!
//! The same device and Face ID checks as the phone's apply. `/__airlock/ping`
//! answers anyone the tailnet lets through, so the phone can tell a blocked
//! port from a broken page. Opening
//! `/__airlock/open?port=5173` picks which dev server this browser sees;
//! everything else is passed to it as it is, websockets included (for hot
//! reload), with Host and Origin set to what the dev server expects.

use std::{
    sync::Mutex,
    time::{Duration, Instant},
};

use axum::{
    Extension, Router,
    body::Body,
    extract::{Query, Request, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    middleware,
    response::{IntoResponse, Redirect, Response},
    routing::get,
};
use hyper_util::rt::TokioIo;
use serde::Deserialize;

use crate::{
    faceid,
    phone::{self, Paired, read_cookie},
    state::AppState,
    store, system,
};

pub const PREVIEW_COOKIE: &str = "airlock_preview";
/// Airlock's cookies, never passed to a dev server nor set by one.
const OURS: [&str; 4] = [
    phone::DEVICE_COOKIE,
    phone::PAIR_COOKIE,
    faceid::UNLOCK_COOKIE,
    PREVIEW_COOKIE,
];
/// Reused for a moment because a page loads many files.
const PORTS_FRESH: Duration = Duration::from_secs(3);

#[derive(Default)]
pub struct Ports {
    seen: Mutex<Option<(Instant, Vec<u16>)>>,
}

impl Ports {
    async fn current(&self, state: &AppState) -> Vec<u16> {
        if let Some((at, ports)) = self
            .seen
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .as_ref()
            && at.elapsed() < PORTS_FRESH
        {
            return ports.clone();
        }
        let ports = system::dev_ports(state).await;
        *self
            .seen
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) =
            Some((Instant::now(), ports.clone()));
        ports
    }
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/__airlock/open", get(open))
        .route("/__airlock/ping", get(ping))
        .fallback(proxy)
        .layer(middleware::from_fn_with_state(
            state.clone(),
            phone::device_session,
        ))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            phone::identity,
        ))
        .with_state(state)
}

async fn ping() -> StatusCode {
    StatusCode::NO_CONTENT
}

fn page(status: StatusCode, message: &str) -> Response {
    let body = format!(
        "<!doctype html><meta charset=utf-8><meta name=viewport content=\"width=device-width\"><title>Airlock preview</title>\
         <body style=\"font:16px system-ui;margin:2em;color:#333\"><p>{message}</p>"
    );
    let mut res = (status, body).into_response();
    res.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/html; charset=utf-8"),
    );
    res.headers_mut().insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static("default-src 'none'; style-src 'unsafe-inline'"),
    );
    res
}

// A refusal is the whole page; this runs once per request, so its size
// doesn't matter.
#[allow(clippy::result_large_err)]
fn allowed(
    state: &AppState,
    device: Option<&store::Device>,
    headers: &HeaderMap,
) -> Result<(), Response> {
    let Some(device) = device else {
        return Err(page(
            StatusCode::UNAUTHORIZED,
            "This device isn't paired with the laptop.",
        ));
    };
    let unlock = read_cookie(headers, faceid::UNLOCK_COOKIE);
    match state
        .faceid
        .is_locked(&state.store(), &device.id, unlock, store::now())
    {
        Ok(false) => {
            state.faceid.touch(unlock, store::now());
            Ok(())
        }
        Ok(true) => Err(page(
            StatusCode::LOCKED,
            "Airlock is locked. Unlock it with Face ID, then open the preview again.",
        )),
        Err(_) => Err(page(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Something went wrong on the laptop.",
        )),
    }
}

#[derive(Deserialize)]
struct Open {
    port: u16,
}

async fn open(
    State(state): State<AppState>,
    Extension(Paired(device)): Extension<Paired>,
    headers: HeaderMap,
    Query(Open { port }): Query<Open>,
) -> Response {
    if let Err(refused) = allowed(&state, device.as_ref(), &headers) {
        return refused;
    }
    if !state.preview_ports.current(&state).await.contains(&port) {
        return page(StatusCode::NOT_FOUND, "That dev server isn't running.");
    }
    let mut res = Redirect::to("/").into_response();
    res.headers_mut().append(
        header::SET_COOKIE,
        phone::cookie(PREVIEW_COOKIE, &port.to_string(), 24 * 3600),
    );
    res
}

fn foreign_cookies(headers: &HeaderMap) -> Option<HeaderValue> {
    let kept: Vec<String> = headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(';'))
        .map(str::trim)
        .filter(|pair| {
            let name = pair.split('=').next().unwrap_or_default();
            !pair.is_empty() && !OURS.contains(&name)
        })
        .map(str::to_owned)
        .collect();
    (!kept.is_empty())
        .then(|| HeaderValue::from_str(&kept.join("; ")).ok())
        .flatten()
}

/// Headers that belong to one hop, not passed on.
const HOP: [&str; 6] = [
    "connection",
    "keep-alive",
    "proxy-connection",
    "te",
    "trailer",
    "transfer-encoding",
];

async fn proxy(
    State(state): State<AppState>,
    Extension(Paired(device)): Extension<Paired>,
    mut req: Request,
) -> Response {
    if let Err(refused) = allowed(&state, device.as_ref(), req.headers()) {
        return refused;
    }
    let Some(port) =
        read_cookie(req.headers(), PREVIEW_COOKIE).and_then(|text| text.parse::<u16>().ok())
    else {
        return page(
            StatusCode::NOT_FOUND,
            "Open a preview from Airlock's System screen.",
        );
    };
    if !state.preview_ports.current(&state).await.contains(&port) {
        return page(
            StatusCode::NOT_FOUND,
            "That dev server isn't running any more.",
        );
    }
    let upgrade = req.headers().contains_key(header::UPGRADE);
    let client_side = upgrade
        .then(|| req.extensions_mut().remove::<hyper::upgrade::OnUpgrade>())
        .flatten();

    let (mut parts, body) = req.into_parts();
    let cookies = foreign_cookies(&parts.headers);
    let headers = &mut parts.headers;
    headers.remove(header::COOKIE);
    if let Some(cookies) = cookies {
        headers.insert(header::COOKIE, cookies);
    }
    for name in HOP {
        if !(upgrade && name == "connection") {
            headers.remove(name);
        }
    }
    headers.remove("tailscale-user-login");
    let local = format!("localhost:{port}");
    headers.insert(
        header::HOST,
        HeaderValue::from_str(&local).expect("a port is header-safe"),
    );
    if headers.contains_key(header::ORIGIN) {
        let origin = HeaderValue::from_str(&format!("http://{local}")).expect("header-safe");
        headers.insert(header::ORIGIN, origin);
    }
    headers.remove(header::REFERER);
    let path = parts
        .uri
        .path_and_query()
        .map_or("/", |path| path.as_str())
        .to_owned();
    parts.uri = path.parse().unwrap_or_default();
    let upstream_request = Request::from_parts(parts, body);

    let Ok(stream) = tokio::net::TcpStream::connect(("127.0.0.1", port)).await else {
        return page(StatusCode::BAD_GATEWAY, "The dev server didn't answer.");
    };
    let Ok((mut sender, connection)) =
        hyper::client::conn::http1::handshake::<_, Body>(TokioIo::new(stream)).await
    else {
        return page(StatusCode::BAD_GATEWAY, "The dev server didn't answer.");
    };
    tokio::spawn(async move {
        let _ = connection.with_upgrades().await;
    });
    let Ok(mut response) = sender.send_request(upstream_request).await else {
        return page(StatusCode::BAD_GATEWAY, "The dev server broke off.");
    };

    // Websockets (hot reload): join the two upgraded connections.
    if response.status() == StatusCode::SWITCHING_PROTOCOLS
        && let Some(client_side) = client_side
    {
        let server_side = hyper::upgrade::on(&mut response);
        tokio::spawn(async move {
            if let (Ok(client), Ok(server)) = (client_side.await, server_side.await) {
                let mut client = TokioIo::new(client);
                let mut server = TokioIo::new(server);
                let _ = tokio::io::copy_bidirectional(&mut client, &mut server).await;
            }
        });
    }

    let (mut parts, body) = response.into_parts();
    // A dev server can't set or clear Airlock's cookies.
    let set_cookies: Vec<HeaderValue> = parts
        .headers
        .get_all(header::SET_COOKIE)
        .iter()
        .filter(|value| {
            let name = value
                .to_str()
                .ok()
                .and_then(|text| text.split('=').next())
                .unwrap_or_default()
                .trim();
            !OURS.contains(&name)
        })
        .cloned()
        .collect();
    parts.headers.remove(header::SET_COOKIE);
    for value in set_cookies {
        parts.headers.append(header::SET_COOKIE, value);
    }
    if parts.status != StatusCode::SWITCHING_PROTOCOLS {
        for name in HOP {
            parts.headers.remove(name);
        }
    }
    Response::from_parts(parts, Body::new(body))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn airlocks_cookies_stay_with_airlock() {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::COOKIE,
            HeaderValue::from_static(
                "airlock_device=abc; theme=dark; airlock_unlock=def; airlock_preview=5173; sid=1",
            ),
        );
        assert_eq!(foreign_cookies(&headers).unwrap(), "theme=dark; sid=1");
        headers.insert(
            header::COOKIE,
            HeaderValue::from_static("airlock_device=abc"),
        );
        assert_eq!(foreign_cookies(&headers), None);
    }
}
