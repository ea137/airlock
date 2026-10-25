//! Face ID: a passkey on the phone that unlocks Airlock, verified by the hub.
//!
//! Once a device has a passkey, every API call but the few in
//! [`OPEN_WHEN_LOCKED`] is refused with 423 unless it also carries a live
//! unlock cookie. Unlocking with the passkey hands the browser a fresh,
//! random unlock secret ([`UNLOCK_COOKIE`]); it stays live while that
//! browser keeps making requests, and dies after [`LOCK_AFTER_SECS`]
//! without one (the phone's screens poll while they are visible, so this is
//! "five minutes in the background"). Unlock state belongs to the browser
//! that unlocked, not to the device: a copied device cookie gets nothing,
//! even while the real phone is unlocked. The passkey's private key never
//! leaves the phone. Unlock secrets live in memory, only as hashes: after
//! the hub restarts, every Face ID device starts locked.

use std::{collections::HashMap, sync::Mutex};

use anyhow::{Context, Result, anyhow};
use axum::{
    Extension, Json, Router,
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::post,
};
use serde_json::json;
use webauthn_rs::prelude::{
    CredentialID, Passkey, PasskeyAuthentication, PasskeyRegistration, PublicKeyCredential,
    RegisterPublicKeyCredential, Url, Uuid, Webauthn, WebauthnBuilder,
};

use crate::{
    phone::{Paired, cookie, read_cookie, unpaired},
    state::{AppState, internal_error},
    store::{self, Store},
    token,
};

/// A Face ID device locks after this long without a request, in seconds,
/// unless `face_id_lock_secs` in the config says otherwise.
pub const LOCK_AFTER_SECS: i64 = 300;
/// A started setup or unlock must finish within this long, in seconds.
const CEREMONY_SECS: i64 = 120;

/// What a locked device may still reach: whether it is locked, the way to
/// unlock, and locking (which a locked browser asking again is harmless).
/// (The UI's own files aren't under `/api/` and stay open.)
pub const OPEN_WHEN_LOCKED: [&str; 5] = [
    "/api/session",
    "/api/events",
    "/api/faceid/lock",
    "/api/faceid/unlock/start",
    "/api/faceid/unlock/finish",
];

pub const UNLOCK_COOKIE: &str = "airlock_unlock";

struct Unlock {
    device: String,
    active_at: i64,
}

pub struct FaceId {
    /// Seconds without a request before an unlock dies.
    lock_after: i64,
    /// Hash of an unlock secret → the unlock.
    unlocks: Mutex<HashMap<String, Unlock>>,
    registering: Mutex<HashMap<String, (i64, String, PasskeyRegistration)>>,
    unlocking: Mutex<HashMap<String, (i64, String, PasskeyAuthentication)>>,
    /// Woken when a browser locks, so its terminal streams end at once.
    forgotten: tokio::sync::Notify,
}

fn locked<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl FaceId {
    pub fn new(lock_after: i64) -> Self {
        Self {
            lock_after,
            unlocks: Mutex::default(),
            registering: Mutex::default(),
            unlocking: Mutex::default(),
            forgotten: tokio::sync::Notify::new(),
        }
    }

    /// Waits until some browser locks on purpose.
    pub async fn some_lock(&self) {
        self.forgotten.notified().await;
    }

    fn live(&self, device: &str, secret: Option<&str>, now: i64) -> bool {
        let Some(secret) = secret else {
            return false;
        };
        locked(&self.unlocks)
            .get(&token::hash(secret))
            .is_some_and(|unlock| {
                unlock.device == device && now - unlock.active_at <= self.lock_after
            })
    }

    pub fn is_locked(
        &self,
        store: &Store,
        device: &str,
        secret: Option<&str>,
        now: i64,
    ) -> Result<bool> {
        Ok(store.has_passkey(device)? && !self.live(device, secret, now))
    }

    pub fn lock_state(
        &self,
        store: &Store,
        device: &str,
        secret: Option<&str>,
        now: i64,
    ) -> Result<&'static str> {
        Ok(if !store.has_passkey(device)? {
            "none"
        } else if self.live(device, secret, now) {
            "unlocked"
        } else {
            "locked"
        })
    }

    pub fn touch(&self, secret: Option<&str>, now: i64) {
        if let Some(secret) = secret
            && let Some(unlock) = locked(&self.unlocks).get_mut(&token::hash(secret))
        {
            unlock.active_at = now;
        }
    }

    fn unlock(&self, device: &str, now: i64) -> String {
        let secret = token::secret();
        let mut unlocks = locked(&self.unlocks);
        unlocks.retain(|_, unlock| now - unlock.active_at <= self.lock_after);
        unlocks.insert(
            token::hash(&secret),
            Unlock {
                device: device.to_owned(),
                active_at: now,
            },
        );
        secret
    }

    fn forget(&self, secret: &str) {
        locked(&self.unlocks).remove(&token::hash(secret));
        self.forgotten.notify_waiters();
    }

    #[cfg(test)]
    pub(crate) fn backdate(&self, device: &str, secs: i64) {
        for unlock in locked(&self.unlocks).values_mut() {
            if unlock.device == device {
                unlock.active_at -= secs;
            }
        }
    }
}

/// The cookie lives for a day at most; the hub ends the unlock sooner when
/// the phone goes quiet.
fn unlocked(secret: &str) -> Response {
    let mut res = StatusCode::NO_CONTENT.into_response();
    res.headers_mut()
        .append(header::SET_COOKIE, cookie(UNLOCK_COOKIE, secret, 24 * 3600));
    res
}

/// `http://` only on this laptop's loopback, for tests.
fn relying_party(headers: &HeaderMap) -> Result<(String, Webauthn)> {
    let host = headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .context("the request has no host")?;
    let name = match host.rsplit_once(':') {
        Some((name, port)) if port.chars().all(|c| c.is_ascii_digit()) => name,
        _ => host,
    };
    let scheme = if name == "localhost" { "http" } else { "https" };
    let origin = Url::parse(&format!("{scheme}://{host}")).context("reading the host")?;
    let webauthn = WebauthnBuilder::new(name, &origin)
        .and_then(|builder| builder.rp_name("Airlock").build())
        .map_err(|error| anyhow!("setting up passkeys for {host}: {error:?}"))?;
    Ok((name.to_owned(), webauthn))
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/faceid/setup/start", post(setup_start))
        .route("/api/faceid/setup/finish", post(setup_finish))
        .route("/api/faceid/unlock/start", post(unlock_start))
        .route("/api/faceid/unlock/finish", post(unlock_finish))
        .route("/api/faceid/lock", post(lock))
}

/// The phone asks as soon as Airlock leaves its screen, so coming back
/// always takes Face ID.
async fn lock(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Some(secret) = read_cookie(&headers, UNLOCK_COOKIE) {
        state.faceid.forget(secret);
    }
    let mut res = StatusCode::NO_CONTENT.into_response();
    res.headers_mut()
        .append(header::SET_COOKIE, cookie(UNLOCK_COOKIE, "", 0));
    res
}

fn refusal(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({"error": message}))).into_response()
}

fn passkeys_for(store: &Store, device: &str, rp_id: &str) -> Result<Vec<(i64, Passkey)>> {
    store
        .passkeys(device)?
        .into_iter()
        .filter(|(_, rp, _)| rp == rp_id)
        .map(|(row, _, text)| {
            let passkey: Passkey =
                serde_json::from_str(&text).context("reading a stored passkey")?;
            Ok((row, passkey))
        })
        .collect()
}

async fn setup_start(
    State(state): State<AppState>,
    Extension(Paired(device)): Extension<Paired>,
    headers: HeaderMap,
) -> Response {
    let Some(device) = device else {
        return unpaired();
    };
    let (rp_id, webauthn) = match relying_party(&headers) {
        Ok(found) => found,
        Err(error) => return refusal(StatusCode::BAD_REQUEST, &format!("{error:#}")),
    };
    let existing = match passkeys_for(&state.store(), &device.id, &rp_id) {
        Ok(existing) => existing,
        Err(error) => return internal_error(error),
    };
    let exclude: Vec<CredentialID> = existing
        .iter()
        .map(|(_, passkey)| passkey.cred_id().clone())
        .collect();
    // A fresh, meaningless handle: nothing about you is in the passkey.
    let started = webauthn.start_passkey_registration(
        Uuid::new_v4(),
        &device.name,
        &device.name,
        Some(exclude),
    );
    match started {
        Ok((options, registration)) => {
            locked(&state.faceid.registering)
                .insert(device.id.clone(), (store::now(), rp_id, registration));
            Json(options).into_response()
        }
        Err(error) => internal_error(anyhow!("starting a passkey setup: {error:?}")),
    }
}

async fn setup_finish(
    State(state): State<AppState>,
    Extension(Paired(device)): Extension<Paired>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let Some(device) = device else {
        return unpaired();
    };
    let Ok(credential) = serde_json::from_slice::<RegisterPublicKeyCredential>(&body) else {
        return refusal(StatusCode::BAD_REQUEST, "Expected the new passkey.");
    };
    let now = store::now();
    let Some((started, rp_id, registration)) = locked(&state.faceid.registering).remove(&device.id)
    else {
        return refusal(
            StatusCode::CONFLICT,
            "No Face ID setup is under way. Start again.",
        );
    };
    if now - started > CEREMONY_SECS {
        return refusal(
            StatusCode::CONFLICT,
            "The Face ID setup took too long. Start again.",
        );
    }
    let webauthn = match relying_party(&headers) {
        Ok((rp, webauthn)) if rp == rp_id => webauthn,
        _ => {
            return refusal(
                StatusCode::BAD_REQUEST,
                "The setup started at another address.",
            );
        }
    };
    let passkey = match webauthn.finish_passkey_registration(&credential, &registration) {
        Ok(passkey) => passkey,
        Err(error) => {
            tracing::warn!(device = %device.id, "a passkey setup failed: {error:?}");
            return refusal(
                StatusCode::BAD_REQUEST,
                "The passkey didn't check out. Try again.",
            );
        }
    };
    let saved = serde_json::to_string(&passkey)
        .context("storing the passkey")
        .and_then(|text| {
            let store = state.store();
            store.add_passkey(&device.id, &rp_id, &text)?;
            store.audit(
                "phone",
                "face id set up",
                &format!("{} ({})", device.name, device.id),
            )
        });
    if let Err(error) = saved {
        return internal_error(error);
    }
    // Setting up Face ID is proof enough: this browser starts unlocked.
    unlocked(&state.faceid.unlock(&device.id, now))
}

async fn unlock_start(
    State(state): State<AppState>,
    Extension(Paired(device)): Extension<Paired>,
    headers: HeaderMap,
) -> Response {
    let Some(device) = device else {
        return unpaired();
    };
    let (rp_id, webauthn) = match relying_party(&headers) {
        Ok(found) => found,
        Err(error) => return refusal(StatusCode::BAD_REQUEST, &format!("{error:#}")),
    };
    let passkeys = match passkeys_for(&state.store(), &device.id, &rp_id) {
        Ok(passkeys) => passkeys,
        Err(error) => return internal_error(error),
    };
    if passkeys.is_empty() {
        return refusal(
            StatusCode::CONFLICT,
            "This device has no Face ID set up here.",
        );
    }
    let keys: Vec<Passkey> = passkeys.into_iter().map(|(_, passkey)| passkey).collect();
    match webauthn.start_passkey_authentication(&keys) {
        Ok((options, authentication)) => {
            locked(&state.faceid.unlocking)
                .insert(device.id.clone(), (store::now(), rp_id, authentication));
            Json(options).into_response()
        }
        Err(error) => internal_error(anyhow!("starting a Face ID unlock: {error:?}")),
    }
}

async fn unlock_finish(
    State(state): State<AppState>,
    Extension(Paired(device)): Extension<Paired>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let Some(device) = device else {
        return unpaired();
    };
    let Ok(assertion) = serde_json::from_slice::<PublicKeyCredential>(&body) else {
        return refusal(StatusCode::BAD_REQUEST, "Expected the passkey's answer.");
    };
    let now = store::now();
    let Some((started, rp_id, authentication)) = locked(&state.faceid.unlocking).remove(&device.id)
    else {
        return refusal(StatusCode::CONFLICT, "No unlock is under way. Start again.");
    };
    if now - started > CEREMONY_SECS {
        return refusal(
            StatusCode::CONFLICT,
            "The unlock took too long. Start again.",
        );
    }
    let webauthn = match relying_party(&headers) {
        Ok((rp, webauthn)) if rp == rp_id => webauthn,
        _ => {
            return refusal(
                StatusCode::BAD_REQUEST,
                "The unlock started at another address.",
            );
        }
    };
    let result = match webauthn.finish_passkey_authentication(&assertion, &authentication) {
        Ok(result) => result,
        Err(error) => {
            tracing::warn!(device = %device.id, "a Face ID unlock failed: {error:?}");
            let _ = state.store().audit(
                "phone",
                "face id unlock failed",
                &format!("{} ({})", device.name, device.id),
            );
            // 403, not 401: the device is still paired, just not unlocked.
            return refusal(
                StatusCode::FORBIDDEN,
                "Face ID didn't check out. Try again.",
            );
        }
    };
    // The used passkey's counter moves on, so a cloned key shows itself.
    // One lock on the store for the whole read-and-save.
    let saved = {
        let store = state.store();
        passkeys_for(&store, &device.id, &rp_id).and_then(|passkeys| {
            for (row, mut passkey) in passkeys {
                if passkey.cred_id() == result.cred_id() {
                    passkey.update_credential(&result);
                    store.update_passkey(row, &serde_json::to_string(&passkey)?)?;
                }
            }
            Ok(())
        })
    };
    if let Err(error) = saved {
        return internal_error(error);
    }
    unlocked(&state.faceid.unlock(&device.id, now))
}
