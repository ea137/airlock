//! Push notifications to the phone (Web Push), so a prompt or a finished
//! turn reaches it with Airlock closed and the phone locked.
//!
//! The phone, opened from its Home Screen, subscribes through its browser's
//! push service (Apple's, on an iPhone) and gives the hub where to send and
//! the keys to encrypt to. The hub signs each push with its own key (VAPID,
//! RFC 8292), kept in `~/.config/airlock/push.pem` and made the first time
//! it's needed, and encrypts what it says (RFC 8291), so the push service
//! carries it without reading it. What a notification says is kept short:
//! that Claude waits or finished, and in which terminal or project, never
//! the command or the question, since it shows on the lock screen.

use std::{
    path::Path,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use anyhow::{Context, Result, bail};
use axum::{
    Extension, Json, Router,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD as B64};
use openssl::{
    bn::BigNumContext,
    derive::Deriver,
    ec::{EcGroup, EcKey, EcPoint, PointConversionForm},
    ecdsa::EcdsaSig,
    hash::{MessageDigest, hash},
    nid::Nid,
    pkey::{PKey, Private},
    sign::Signer,
    symm::{Cipher, encrypt_aead},
};
use serde::Deserialize;
use serde_json::json;

use crate::{
    phone::{Paired, unpaired},
    state::{AppState, internal_error},
    store::PushSubscription,
};

/// Who the hub says it is to push services (RFC 8292's `sub`).
const CONTACT: &str = "https://github.com/ea137/airlock";
/// How long a push service keeps a notification for a phone that's off.
const TTL_SECS: u64 = 4 * 3600;
const SEND_LIMIT: Duration = Duration::from_secs(15);

pub struct Push {
    key: EcKey<Private>,
    /// The public key, uncompressed, base64url: what phones subscribe with.
    public: String,
    /// Made with the first push: it reads the system's certificates.
    client: std::sync::OnceLock<reqwest::Client>,
}

fn group() -> EcGroup {
    EcGroup::from_curve_name(Nid::X9_62_PRIME256V1).expect("P-256 is built in")
}

fn public_bytes(key: &EcKey<impl openssl::pkey::HasPublic>) -> Result<Vec<u8>> {
    let mut ctx = BigNumContext::new()?;
    Ok(key
        .public_key()
        .to_bytes(&group(), PointConversionForm::UNCOMPRESSED, &mut ctx)?)
}

impl Push {
    fn with_key(key: EcKey<Private>) -> Result<Self> {
        Ok(Self {
            public: B64.encode(public_bytes(&key)?),
            key,
            client: std::sync::OnceLock::new(),
        })
    }

    fn client(&self) -> Result<&reqwest::Client> {
        if let Some(client) = self.client.get() {
            return Ok(client);
        }
        let client = reqwest::Client::builder()
            .timeout(SEND_LIMIT)
            .build()
            .context("starting the HTTPS client")?;
        Ok(self.client.get_or_init(|| client))
    }

    /// A key for this run only (tests).
    pub fn ephemeral() -> Self {
        let key = EcKey::generate(&group()).expect("making a P-256 key");
        Self::with_key(key).expect("making the push key")
    }

    pub fn load_or_create(dir: &Path) -> Result<Self> {
        let path = dir.join("push.pem");
        let key = match std::fs::read(&path) {
            Ok(pem) => EcKey::private_key_from_pem(&pem)
                .with_context(|| format!("reading the push key in {}", path.display()))?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let key = EcKey::generate(&group())?;
                let pem = key.private_key_to_pem()?;
                let partial = path.with_extension("pem.partial");
                {
                    use std::{io::Write, os::unix::fs::OpenOptionsExt};
                    let mut file = std::fs::OpenOptions::new()
                        .write(true)
                        .create_new(true)
                        .mode(0o600)
                        .open(&partial)
                        .with_context(|| format!("creating {}", partial.display()))?;
                    file.write_all(&pem)?;
                }
                std::fs::rename(&partial, &path)?;
                key
            }
            Err(error) => {
                return Err(error).with_context(|| format!("reading {}", path.display()));
            }
        };
        Self::with_key(key)
    }

    pub fn public_key(&self) -> &str {
        &self.public
    }

    /// The `Authorization` header for a push to `endpoint`: a token signed
    /// with the hub's key, for that push service, for the next 12 hours.
    fn vapid(&self, endpoint: &str) -> Result<String> {
        let url = reqwest::Url::parse(endpoint).context("the push address isn't a URL")?;
        let audience = url.origin().ascii_serialization();
        let expires = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs() + 12 * 3600;
        let header = B64.encode(br#"{"typ":"JWT","alg":"ES256"}"#);
        let claims =
            B64.encode(json!({"aud": audience, "exp": expires, "sub": CONTACT}).to_string());
        let signed = format!("{header}.{claims}");
        let digest = hash(MessageDigest::sha256(), signed.as_bytes())?;
        let signature = EcdsaSig::sign(&digest, &self.key)?;
        let mut raw = signature.r().to_vec_padded(32)?;
        raw.extend(signature.s().to_vec_padded(32)?);
        Ok(format!(
            "vapid t={signed}.{}, k={}",
            B64.encode(raw),
            self.public
        ))
    }

    /// Sends `message` to one subscription. `Ok(false)`: the push service
    /// says the subscription is gone, and it should be forgotten.
    pub async fn send(&self, to: &PushSubscription, message: &Message) -> Result<bool> {
        if !to.endpoint.starts_with("https://") && !cfg!(test) {
            bail!("a push address must be https");
        }
        let body = encrypt(
            &B64.decode(&to.p256dh)
                .context("the subscription's key isn't base64url")?,
            &B64.decode(&to.auth)
                .context("the subscription's secret isn't base64url")?,
            serde_json::to_vec(message)?.as_slice(),
            None,
        )?;
        let response = self
            .client()?
            .post(&to.endpoint)
            .header("Authorization", self.vapid(&to.endpoint)?)
            .header("TTL", TTL_SECS.to_string())
            .header("Urgency", if message.urgent { "high" } else { "normal" })
            .header("Content-Encoding", "aes128gcm")
            .header("Content-Type", "application/octet-stream")
            .body(body)
            .send()
            .await
            .context("reaching the push service")?;
        match response.status().as_u16() {
            200..=299 => Ok(true),
            404 | 410 => Ok(false),
            status => {
                let why = response.text().await.unwrap_or_default();
                bail!(
                    "the push service answered {status}: {}",
                    why.chars().take(200).collect::<String>()
                )
            }
        }
    }
}

#[derive(Clone, Debug, serde::Serialize, PartialEq)]
pub struct Message {
    pub title: String,
    pub body: String,
    /// Where tapping it opens, inside Airlock (`#/…`).
    pub url: String,
    /// Notifications with the same tag replace each other: one per session.
    pub tag: String,
    #[serde(skip)]
    pub urgent: bool,
}

/// HKDF-SHA-256 (RFC 5869), extract then expand, for up to 32 bytes.
fn hkdf(salt: &[u8], ikm: &[u8], info: &[u8], len: usize) -> Result<Vec<u8>> {
    let hmac = |key: &[u8], data: &[&[u8]]| -> Result<Vec<u8>> {
        let key = PKey::hmac(key)?;
        let mut signer = Signer::new(MessageDigest::sha256(), &key)?;
        for part in data {
            signer.update(part)?;
        }
        Ok(signer.sign_to_vec()?)
    };
    let prk = hmac(salt, &[ikm])?;
    let mut okm = hmac(&prk, &[info, &[1]])?;
    okm.truncate(len);
    Ok(okm)
}

/// `plaintext` encrypted for a subscription (RFC 8291, `aes128gcm`): the
/// body of a push. `fixed` gives the salt and the hub's one-time key, for
/// tests; otherwise both are new each time.
fn encrypt(
    ua_public: &[u8],
    auth_secret: &[u8],
    plaintext: &[u8],
    fixed: Option<(&[u8], EcKey<Private>)>,
) -> Result<Vec<u8>> {
    if ua_public.len() != 65 || auth_secret.len() != 16 {
        bail!("the subscription's keys are the wrong size");
    }
    let group = group();
    let mut ctx = BigNumContext::new()?;
    let point = EcPoint::from_bytes(&group, ua_public, &mut ctx)?;
    let peer = EcKey::from_public_key(&group, &point)?;
    let (salt, as_key) = match fixed {
        Some((salt, key)) => (salt.to_vec(), key),
        None => {
            let mut salt = vec![0u8; 16];
            openssl::rand::rand_bytes(&mut salt)?;
            (salt, EcKey::generate(&group)?)
        }
    };
    let as_public = public_bytes(&as_key)?;
    let as_pkey = PKey::from_ec_key(as_key)?;
    let peer_pkey = PKey::from_ec_key(peer)?;
    let mut deriver = Deriver::new(&as_pkey)?;
    deriver.set_peer(&peer_pkey)?;
    let shared = deriver.derive_to_vec()?;

    let mut key_info = b"WebPush: info\0".to_vec();
    key_info.extend(ua_public);
    key_info.extend(&as_public);
    let ikm = hkdf(auth_secret, &shared, &key_info, 32)?;
    let cek = hkdf(&salt, &ikm, b"Content-Encoding: aes128gcm\0", 16)?;
    let nonce = hkdf(&salt, &ikm, b"Content-Encoding: nonce\0", 12)?;

    // One record: the message, then the last-record delimiter.
    let mut record = plaintext.to_vec();
    record.push(2);
    let mut tag = [0u8; 16];
    let sealed = encrypt_aead(
        Cipher::aes_128_gcm(),
        &cek,
        Some(&nonce),
        &[],
        &record,
        &mut tag,
    )?;

    let mut body = salt;
    body.extend(4096u32.to_be_bytes());
    body.push(as_public.len() as u8);
    body.extend(&as_public);
    body.extend(sealed);
    body.extend(tag);
    Ok(body)
}

pub fn notify(state: &AppState, message: Message) {
    let subscriptions = match state.store().push_subscriptions(None) {
        Ok(subscriptions) => subscriptions,
        Err(error) => {
            tracing::warn!("reading push subscriptions: {error:#}");
            return;
        }
    };
    if subscriptions.is_empty() {
        return;
    }
    let state = state.clone();
    tokio::spawn(async move {
        for subscription in subscriptions {
            deliver(&state, &subscription, &message).await;
        }
    });
}

async fn deliver(state: &AppState, subscription: &PushSubscription, message: &Message) -> bool {
    match state.push.send(subscription, message).await {
        Ok(true) => true,
        Ok(false) => {
            let _ = state
                .store()
                .remove_push_subscription(&subscription.endpoint);
            false
        }
        Err(error) => {
            tracing::warn!("sending a push notification: {error:#}");
            false
        }
    }
}

#[derive(Deserialize)]
struct Keys {
    p256dh: String,
    auth: String,
}

#[derive(Deserialize)]
struct Subscribe {
    endpoint: String,
    keys: Keys,
}

#[derive(Deserialize)]
struct Unsubscribe {
    endpoint: String,
}

async fn key(
    State(state): State<AppState>,
    Extension(Paired(device)): Extension<Paired>,
) -> Response {
    if device.is_none() {
        return unpaired();
    }
    Json(json!({"key": state.push.public_key()})).into_response()
}

async fn subscribe(
    State(state): State<AppState>,
    Extension(Paired(device)): Extension<Paired>,
    Json(request): Json<Subscribe>,
) -> Response {
    let Some(device) = device else {
        return unpaired();
    };
    let valid = request.endpoint.starts_with("https://")
        && request.endpoint.len() <= 2048
        && B64
            .decode(&request.keys.p256dh)
            .is_ok_and(|key| key.len() == 65)
        && B64
            .decode(&request.keys.auth)
            .is_ok_and(|secret| secret.len() == 16);
    if !valid {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "That isn't a push subscription Airlock can use."})),
        )
            .into_response();
    }
    let subscription = PushSubscription {
        endpoint: request.endpoint,
        p256dh: request.keys.p256dh,
        auth: request.keys.auth,
    };
    match state
        .store()
        .add_push_subscription(&device.id, &subscription)
    {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => internal_error(error),
    }
}

async fn unsubscribe(
    State(state): State<AppState>,
    Extension(Paired(device)): Extension<Paired>,
    Json(request): Json<Unsubscribe>,
) -> Response {
    if device.is_none() {
        return unpaired();
    }
    match state.store().remove_push_subscription(&request.endpoint) {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => internal_error(error),
    }
}

async fn test(
    State(state): State<AppState>,
    Extension(Paired(device)): Extension<Paired>,
) -> Response {
    let Some(device) = device else {
        return unpaired();
    };
    let subscriptions = match state.store().push_subscriptions(Some(&device.id)) {
        Ok(subscriptions) => subscriptions,
        Err(error) => return internal_error(error),
    };
    let message = Message {
        title: "Airlock".to_owned(),
        body: "Notifications work. You'll hear when Claude waits on you or finishes.".to_owned(),
        url: "#/".to_owned(),
        tag: "airlock-test".to_owned(),
        urgent: true,
    };
    let mut sent = 0;
    for subscription in &subscriptions {
        if deliver(&state, subscription, &message).await {
            sent += 1;
        }
    }
    if sent == 0 {
        return (
            StatusCode::BAD_GATEWAY,
            Json(json!({"error": "The notification didn't go through; turn notifications off and on again."})),
        )
            .into_response();
    }
    StatusCode::NO_CONTENT.into_response()
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/push/key", get(key))
        .route("/api/push/subscribe", post(subscribe))
        .route("/api/push/unsubscribe", post(unsubscribe))
        .route("/api/push/test", post(test))
}

#[cfg(test)]
mod tests {
    use openssl::bn::BigNum;

    use super::*;

    fn key_from(private: &str) -> EcKey<Private> {
        let group = group();
        let d = BigNum::from_slice(&B64.decode(private).unwrap()).unwrap();
        let mut ctx = BigNumContext::new().unwrap();
        let mut point = EcPoint::new(&group).unwrap();
        point.mul_generator2(&group, &d, &mut ctx).unwrap();
        EcKey::from_private_components(&group, &d, &point).unwrap()
    }

    /// RFC 8291, Appendix A: the same keys, salt and message give the same
    /// body, byte for byte.
    #[test]
    fn encryption_matches_the_rfc_example() {
        let as_private = key_from("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw");
        let ua_public = B64
            .decode("BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4")
            .unwrap();
        let auth = B64.decode("BTBZMqHH6r4Tts7J_aSIgg").unwrap();
        let salt = B64.decode("DGv6ra1nlYgDCS1FRnbzlw").unwrap();
        let body = encrypt(
            &ua_public,
            &auth,
            b"When I grow up, I want to be a watermelon",
            Some((&salt, as_private)),
        )
        .unwrap();
        assert_eq!(
            B64.encode(body),
            "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN"
        );
    }

    #[test]
    fn the_vapid_token_is_signed_for_the_push_service() {
        let push = Push::ephemeral();
        let header = push
            .vapid("https://web.push.apple.com/QGuQyavXutnMH")
            .unwrap();
        let token = header
            .strip_prefix("vapid t=")
            .unwrap()
            .split(", k=")
            .next()
            .unwrap();
        let parts: Vec<&str> = token.split('.').collect();
        assert_eq!(parts.len(), 3);
        let claims: serde_json::Value =
            serde_json::from_slice(&B64.decode(parts[1]).unwrap()).unwrap();
        assert_eq!(claims["aud"], "https://web.push.apple.com");
        // The signature checks out against the public key it names.
        let raw = B64.decode(parts[2]).unwrap();
        let signature = EcdsaSig::from_private_components(
            BigNum::from_slice(&raw[..32]).unwrap(),
            BigNum::from_slice(&raw[32..]).unwrap(),
        )
        .unwrap();
        let digest = hash(
            MessageDigest::sha256(),
            format!("{}.{}", parts[0], parts[1]).as_bytes(),
        )
        .unwrap();
        assert!(signature.verify(&digest, &push.key).unwrap());
        assert!(header.ends_with(&format!(", k={}", push.public_key())));
    }

    /// What the phone does with a push: takes the hub's one-time key from
    /// the body, derives the same secret, and opens the message.
    fn open(body: &[u8], ua: &EcKey<Private>, auth: &[u8]) -> Vec<u8> {
        let group = group();
        let mut ctx = BigNumContext::new().unwrap();
        let (salt, rest) = body.split_at(16);
        let id_len = rest[4] as usize;
        let as_public = &rest[5..5 + id_len];
        let sealed = &rest[5 + id_len..];
        let point = EcPoint::from_bytes(&group, as_public, &mut ctx).unwrap();
        let peer = PKey::from_ec_key(EcKey::from_public_key(&group, &point).unwrap()).unwrap();
        let mine = PKey::from_ec_key(ua.clone()).unwrap();
        let mut deriver = Deriver::new(&mine).unwrap();
        deriver.set_peer(&peer).unwrap();
        let shared = deriver.derive_to_vec().unwrap();
        let mut key_info = b"WebPush: info\0".to_vec();
        key_info.extend(public_bytes(ua).unwrap());
        key_info.extend(as_public);
        let ikm = hkdf(auth, &shared, &key_info, 32).unwrap();
        let cek = hkdf(salt, &ikm, b"Content-Encoding: aes128gcm\0", 16).unwrap();
        let nonce = hkdf(salt, &ikm, b"Content-Encoding: nonce\0", 12).unwrap();
        let (data, tag) = sealed.split_at(sealed.len() - 16);
        let mut plain =
            openssl::symm::decrypt_aead(Cipher::aes_128_gcm(), &cek, Some(&nonce), &[], data, tag)
                .unwrap();
        assert_eq!(plain.pop(), Some(2), "the last-record delimiter");
        plain
    }

    #[tokio::test]
    async fn a_push_reaches_the_push_service_signed_and_sealed() {
        use axum::{body::Bytes, http::HeaderMap};
        let (seen_tx, mut seen) = tokio::sync::mpsc::unbounded_channel::<(HeaderMap, Bytes)>();
        let service = Router::new()
            .route(
                "/push/live",
                post(move |headers: HeaderMap, body: Bytes| {
                    let seen_tx = seen_tx.clone();
                    async move {
                        seen_tx.send((headers, body)).unwrap();
                        StatusCode::CREATED
                    }
                }),
            )
            .route("/push/gone", post(|| async { StatusCode::GONE }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, service).await.unwrap() });

        let ua = EcKey::generate(&group()).unwrap();
        let mut auth = [0u8; 16];
        openssl::rand::rand_bytes(&mut auth).unwrap();
        let subscription = |path: &str| PushSubscription {
            endpoint: format!("http://{address}{path}"),
            p256dh: B64.encode(public_bytes(&ua).unwrap()),
            auth: B64.encode(auth),
        };
        let message = Message {
            title: "Claude is waiting on you".to_owned(),
            body: "In Backend · demo".to_owned(),
            url: "#/center/s/s1".to_owned(),
            tag: "s1".to_owned(),
            urgent: true,
        };
        let push = Push::ephemeral();
        assert!(
            push.send(&subscription("/push/live"), &message)
                .await
                .unwrap()
        );
        let (headers, body) = seen.recv().await.unwrap();
        assert_eq!(headers["content-encoding"], "aes128gcm");
        assert_eq!(headers["urgency"], "high");
        assert!(
            headers["authorization"]
                .to_str()
                .unwrap()
                .starts_with("vapid t=")
        );
        let said: serde_json::Value = serde_json::from_slice(&open(&body, &ua, &auth)).unwrap();
        assert_eq!(said["title"], "Claude is waiting on you");
        assert_eq!(said["body"], "In Backend · demo");
        assert_eq!(said["url"], "#/center/s/s1");

        // A push service that says the subscription is gone: it's forgotten.
        assert!(
            !push
                .send(&subscription("/push/gone"), &message)
                .await
                .unwrap()
        );
    }

    #[test]
    fn the_key_is_made_once_and_kept_private() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let first = Push::load_or_create(dir.path()).unwrap();
        let again = Push::load_or_create(dir.path()).unwrap();
        assert_eq!(first.public_key(), again.public_key());
        let mode = std::fs::metadata(dir.path().join("push.pem"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }
}
