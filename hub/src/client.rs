//! Talks to the hub's admin socket: what the `airlock` command and the laptop
//! app use.

use std::{
    fmt, io,
    path::{Path, PathBuf},
    time::Duration,
};

use http_body_util::{BodyExt, Full};
use hyper::{
    Method, Request, Response, StatusCode,
    body::{Bytes, Incoming},
    header,
};
use hyper_util::rt::TokioIo;
use serde::de::DeserializeOwned;
use serde_json::Value;
use tokio::net::UnixStream;

use crate::{
    claude::HookReport,
    events::Event,
    store::{AuditEntry, Device, Pairing, Settings},
};

/// A hub that hasn't answered in this long is treated as broken. The events
/// stream is held to it only for its start.
pub const ANSWER_WITHIN: Duration = Duration::from_secs(10);

#[derive(Debug)]
pub enum AdminError {
    HubDown(io::Error),
    Refused { status: StatusCode, message: String },
    Broken(anyhow::Error),
}

pub type AdminResult<T> = Result<T, AdminError>;

impl fmt::Display for AdminError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::HubDown(_) => write!(f, "the hub isn't running; start it with `airlock serve`"),
            Self::Refused { message, .. } => write!(f, "{message}"),
            Self::Broken(error) => write!(f, "talking to the hub failed: {error:#}"),
        }
    }
}

impl std::error::Error for AdminError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::HubDown(error) => Some(error),
            Self::Refused { .. } => None,
            Self::Broken(error) => Some(error.as_ref()),
        }
    }
}

impl From<hyper::Error> for AdminError {
    fn from(error: hyper::Error) -> Self {
        Self::Broken(error.into())
    }
}

#[derive(Clone, Debug)]
pub struct Admin {
    socket: PathBuf,
}

impl Admin {
    pub fn new(socket: impl Into<PathBuf>) -> Self {
        Self {
            socket: socket.into(),
        }
    }

    pub fn socket(&self) -> &Path {
        &self.socket
    }

    pub async fn pairings(&self) -> AdminResult<Vec<Pairing>> {
        self.call(Method::GET, "/pairings").await
    }

    /// By the code the device shows, or the request's id.
    pub async fn approve(&self, request: &str) -> AdminResult<Pairing> {
        let path = format!("/pairings/{}/approve", segment(request));
        self.call(Method::POST, &path).await
    }

    pub async fn deny(&self, request: &str) -> AdminResult<Pairing> {
        let path = format!("/pairings/{}/deny", segment(request));
        self.call(Method::POST, &path).await
    }

    pub async fn devices(&self) -> AdminResult<Vec<Device>> {
        self.call(Method::GET, "/devices").await
    }

    /// By the device's name or id.
    pub async fn revoke(&self, device: &str) -> AdminResult<Device> {
        let path = format!("/devices/{}/revoke", segment(device));
        self.call(Method::POST, &path).await
    }

    pub async fn audit(&self) -> AdminResult<Vec<AuditEntry>> {
        self.call(Method::GET, "/audit").await
    }

    pub async fn changes(&self) -> AdminResult<Value> {
        self.call(Method::GET, "/changes").await
    }

    pub async fn change(&self, id: &str) -> AdminResult<Value> {
        self.call(Method::GET, &format!("/changes/{}", segment(id)))
            .await
    }

    /// Writes an edit: `with` is `phone` (its version) or `merge` (both
    /// changes). `overwrite` writes the phone's version over a file that
    /// changed on the laptop.
    pub async fn apply_change(&self, id: &str, with: &str, overwrite: bool) -> AdminResult<Value> {
        let path = format!("/changes/{}/apply", segment(id));
        let body = serde_json::json!({"use": with, "overwrite": overwrite});
        self.call_with(Method::POST, &path, Some(body)).await
    }

    pub async fn decline_change(&self, id: &str) -> AdminResult<()> {
        let path = format!("/changes/{}/decline", segment(id));
        self.call::<Value>(Method::POST, &path).await.map(|_| ())
    }

    pub async fn settings(&self) -> AdminResult<Settings> {
        self.call(Method::GET, "/settings").await
    }

    pub async fn save_settings(&self, settings: &Settings) -> AdminResult<Settings> {
        let body =
            serde_json::to_value(settings).map_err(|error| AdminError::Broken(error.into()))?;
        self.call_with(Method::PUT, "/settings", Some(body)).await
    }

    pub async fn terminals(&self) -> AdminResult<Value> {
        self.call(Method::GET, "/terminals").await
    }

    pub async fn sessions(&self) -> AdminResult<Value> {
        self.call(Method::GET, "/sessions").await
    }

    pub async fn session(&self, id: &str) -> AdminResult<Value> {
        self.call(Method::GET, &format!("/sessions/{}", segment(id)))
            .await
    }

    pub async fn history(&self) -> AdminResult<Value> {
        self.call(Method::GET, "/history").await
    }

    pub async fn terminal_record(&self, key: &str) -> AdminResult<Value> {
        self.call(Method::GET, &format!("/history/terminals/{}", segment(key)))
            .await
    }

    pub async fn delete_terminal_record(&self, key: &str) -> AdminResult<()> {
        let path = format!("/history/terminals/{}", segment(key));
        self.call::<Value>(Method::DELETE, &path).await.map(|_| ())
    }

    pub async fn session_record(&self, id: &str) -> AdminResult<Value> {
        self.call(Method::GET, &format!("/history/sessions/{}", segment(id)))
            .await
    }

    pub async fn delete_session_record(&self, id: &str) -> AdminResult<()> {
        let path = format!("/history/sessions/{}", segment(id));
        self.call::<Value>(Method::DELETE, &path).await.map(|_| ())
    }

    pub async fn report_hook(&self, report: &HookReport) -> AdminResult<()> {
        let body = serde_json::to_vec(report).map_err(|error| AdminError::Broken(error.into()))?;
        within("/claude/hook", async {
            let response = self.send(Method::POST, "/claude/hook", Some(body)).await?;
            response.into_body().collect().await?;
            Ok(())
        })
        .await
    }

    pub async fn report_status(&self, report: &crate::claude::StatusReport) -> AdminResult<()> {
        let body = serde_json::to_vec(report).map_err(|error| AdminError::Broken(error.into()))?;
        within("/claude/status", async {
            let response = self
                .send(Method::POST, "/claude/status", Some(body))
                .await?;
            response.into_body().collect().await?;
            Ok(())
        })
        .await
    }

    pub async fn events(&self) -> AdminResult<Events> {
        let response = within("/events", self.send(Method::GET, "/events", None)).await?;
        Ok(Events {
            body: response.into_body(),
            buffer: Vec::new(),
        })
    }

    async fn call<T: DeserializeOwned>(&self, method: Method, path: &str) -> AdminResult<T> {
        self.call_with(method, path, None).await
    }

    /// An empty answer reads as `null`.
    async fn call_with<T: DeserializeOwned>(
        &self,
        method: Method,
        path: &str,
        json: Option<Value>,
    ) -> AdminResult<T> {
        let json = json.map(|value| value.to_string().into_bytes());
        let body = within(path, async {
            let response = self.send(method, path, json).await?;
            Ok(response.into_body().collect().await?.to_bytes())
        })
        .await?;
        let body: &[u8] = if body.is_empty() { b"null" } else { &body };
        serde_json::from_slice(body).map_err(|error| {
            AdminError::Broken(
                anyhow::Error::new(error).context(format!("reading the hub's answer to {path}")),
            )
        })
    }

    async fn send(
        &self,
        method: Method,
        path: &str,
        json: Option<Vec<u8>>,
    ) -> AdminResult<Response<Incoming>> {
        let stream = match UnixStream::connect(&self.socket).await {
            Ok(stream) => stream,
            // No socket, or a stale one left by a hub that crashed.
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::NotFound | io::ErrorKind::ConnectionRefused
                ) =>
            {
                return Err(AdminError::HubDown(error));
            }
            Err(error) => {
                return Err(AdminError::Broken(
                    anyhow::Error::new(error)
                        .context(format!("connecting to {}", self.socket.display())),
                ));
            }
        };
        let (mut sender, connection) =
            hyper::client::conn::http1::handshake(TokioIo::new(stream)).await?;
        tokio::spawn(async move {
            let _ = connection.await;
        });
        let mut request = Request::builder()
            .method(method)
            .uri(path)
            .header(header::HOST, "airlock");
        if json.is_some() {
            request = request.header(header::CONTENT_TYPE, "application/json");
        }
        let request = request
            .body(Full::new(Bytes::from(json.unwrap_or_default())))
            .map_err(|error| AdminError::Broken(error.into()))?;
        let response = sender.send_request(request).await?;
        let status = response.status();
        if status.is_success() {
            return Ok(response);
        }
        let body = response.into_body().collect().await?.to_bytes();
        let message = serde_json::from_slice::<Value>(&body)
            .ok()
            .and_then(|body| body["error"].as_str().map(str::to_owned))
            .unwrap_or_else(|| format!("the hub answered {status}"));
        Err(AdminError::Refused { status, message })
    }
}

async fn within<T>(path: &str, work: impl Future<Output = AdminResult<T>>) -> AdminResult<T> {
    match tokio::time::timeout(ANSWER_WITHIN, work).await {
        Ok(result) => result,
        Err(_) => Err(AdminError::Broken(anyhow::anyhow!(
            "the hub didn't answer {path} within {} seconds",
            ANSWER_WITHIN.as_secs()
        ))),
    }
}

pub struct Events {
    body: Incoming,
    buffer: Vec<u8>,
}

impl Events {
    /// The next event, or `None` once the hub stops. Events this version
    /// doesn't know are skipped.
    pub async fn next(&mut self) -> Option<AdminResult<Event>> {
        loop {
            if let Some(end) = self.buffer.iter().position(|&byte| byte == b'\n') {
                let line: Vec<u8> = self.buffer.drain(..=end).collect();
                if let Ok(event) = serde_json::from_slice::<Event>(&line) {
                    return Some(Ok(event));
                }
                continue;
            }
            match self.body.frame().await? {
                Ok(frame) => {
                    if let Ok(data) = frame.into_data() {
                        self.buffer.extend_from_slice(&data);
                    }
                }
                Err(error) => return Some(Err(error.into())),
            }
        }
    }
}

/// Escapes one URL path segment: device names can hold spaces.
pub fn segment(text: &str) -> String {
    text.bytes()
        .map(|byte| {
            if byte.is_ascii_alphanumeric() || b"-_.~".contains(&byte) {
                char::from(byte).to_string()
            } else {
                format!("%{byte:02X}")
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        admin,
        state::testing::{LOGIN, state},
    };

    #[test]
    fn segments_are_escaped() {
        assert_eq!(segment("Linux computer"), "Linux%20computer");
        assert_eq!(segment("123456"), "123456");
        assert_eq!(segment("a/b"), "a%2Fb");
    }

    #[tokio::test]
    async fn the_laptop_answers_pairings_and_follows_events() {
        let dir = tempfile::tempdir().unwrap();
        let socket = dir.path().join("admin.sock");
        let state = state();
        let listener = admin::bind(&socket).await.unwrap();
        let router = admin::router(state.clone());
        tokio::spawn(async move { axum::serve(listener, router).await });
        let admin = Admin::new(&socket);

        let mut events = admin.events().await.unwrap();
        let (pairing, _secret) = state
            .store()
            .request_pairing("Test phone", LOGIN)
            .unwrap()
            .unwrap();
        state.events.send(Event::PairingRequested {
            id: pairing.id.clone(),
            code: pairing.code.clone(),
            name: pairing.name.clone(),
        });
        assert_eq!(admin.pairings().await.unwrap(), vec![pairing.clone()]);
        assert!(matches!(
            events.next().await,
            Some(Ok(Event::PairingRequested { ref code, .. })) if *code == pairing.code
        ));

        let approved = admin.approve(&pairing.code).await.unwrap();
        assert_eq!(approved.id, pairing.id);
        assert_eq!(
            events.next().await.unwrap().unwrap(),
            Event::PairingDecided {
                id: pairing.id.clone(),
                approved: true
            }
        );
        assert!(admin.pairings().await.unwrap().is_empty());
        assert!(
            admin
                .audit()
                .await
                .unwrap()
                .iter()
                .any(|entry| entry.detail.contains("Test phone"))
        );

        match admin.approve(&pairing.code).await {
            Err(AdminError::Refused { status, message }) => {
                assert_eq!(status, StatusCode::NOT_FOUND);
                assert_eq!(message, "No waiting request has that code or id.");
            }
            other => panic!("approving twice: want a refusal, got {other:?}"),
        }

        state.events.send(Event::HubStopping);
        assert!(events.next().await.is_none());
    }

    #[tokio::test(start_paused = true)]
    async fn a_hub_that_never_answers_is_given_up_on() {
        let dir = tempfile::tempdir().unwrap();
        let socket = dir.path().join("admin.sock");
        let listener = tokio::net::UnixListener::bind(&socket).unwrap();
        // Takes the connection and says nothing, like a hub stuck shutting down.
        tokio::spawn(async move {
            let (_stream, _) = listener.accept().await.unwrap();
            std::future::pending::<()>().await;
        });
        let error = Admin::new(&socket).devices().await.unwrap_err();
        assert!(matches!(error, AdminError::Broken(_)), "got {error:?}");
        assert!(
            error
                .to_string()
                .contains("didn't answer /devices within 10 seconds"),
            "got {error}"
        );
    }

    #[tokio::test]
    async fn no_hub_is_told_apart_from_a_refusal() {
        let dir = tempfile::tempdir().unwrap();
        let admin = Admin::new(dir.path().join("admin.sock"));
        let error = admin.devices().await.unwrap_err();
        assert!(matches!(error, AdminError::HubDown(_)), "got {error:?}");
        assert_eq!(
            error.to_string(),
            "the hub isn't running; start it with `airlock serve`"
        );
    }
}
