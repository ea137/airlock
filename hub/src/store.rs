//! The database: paired devices, pairing requests and the audit log.
//!
//! Device tokens and pairing secrets are stored only as hashes
//! ([`token::hash`]), so reading the database file never lets anyone in.
//!
//! Device tokens rotate. Every [`ROTATE_EVERY_SECS`] of use the hub hands the
//! device a fresh token; once the device uses it, the old token is retired.
//! A retired token coming back means someone copied it, so the device is
//! revoked on the spot ([`Auth::Stolen`]).
//!
//! A device can also keep passkeys (Face ID). A passkey holds only a public
//! key; the private key never leaves the phone.

use std::{
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

use anyhow::{Context, Result};
use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};

use crate::token;

pub const PAIRING_TTL_SECS: i64 = 300;
/// At most this many requests wait at once, so nobody can flood the laptop.
pub const MAX_PENDING: i64 = 3;
/// A device's token is replaced after this much use, in seconds.
pub const ROTATE_EVERY_SECS: i64 = 600;
/// A replacement token handed out this recently is not replaced again, so
/// requests already in flight don't race each other.
pub const REPLACEMENT_GRACE_SECS: i64 = 60;
/// How long a token just replaced still lets its own device in: requests
/// sent before the phone had the new one may arrive after it was used.
pub const RETIRED_GRACE_SECS: i64 = 60;
/// A device unseen this long has to pair again, in seconds.
pub const IDLE_EXPIRY_SECS: i64 = 30 * 24 * 3600;

/// Where a phone's push service takes notifications for it, and the keys
/// they're encrypted to (base64url, as the browser gives them).
#[derive(Clone, Debug, PartialEq, serde::Deserialize, serde::Serialize)]
pub struct PushSubscription {
    pub endpoint: String,
    pub p256dh: String,
    pub auth: String,
}

const SCHEMA: &str = "
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS devices (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        login         TEXT NOT NULL,
        token_hash    TEXT NOT NULL UNIQUE,
        next_hash     TEXT UNIQUE,
        next_at       INTEGER,
        rotated_at    INTEGER NOT NULL,
        created_at    INTEGER NOT NULL,
        last_seen     INTEGER NOT NULL,
        revoked_at    INTEGER
    );
    CREATE TABLE IF NOT EXISTS retired_tokens (
        token_hash  TEXT PRIMARY KEY,
        device_id   TEXT NOT NULL,
        retired_at  INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pairings (
        id          TEXT PRIMARY KEY,
        code        TEXT NOT NULL,
        name        TEXT NOT NULL,
        login       TEXT NOT NULL,
        secret_hash TEXT NOT NULL UNIQUE,
        created_at  INTEGER NOT NULL,
        expires_at  INTEGER NOT NULL,
        state       TEXT NOT NULL,
        device_id   TEXT
    );
    CREATE TABLE IF NOT EXISTS audit (
        at      INTEGER NOT NULL,
        actor   TEXT NOT NULL,
        action  TEXT NOT NULL,
        detail  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS passkeys (
        device_id   TEXT NOT NULL,
        rp_id       TEXT NOT NULL,
        passkey     TEXT NOT NULL,
        created_at  INTEGER NOT NULL,
        used_at     INTEGER
    );
    CREATE TABLE IF NOT EXISTS settings (
        key    TEXT PRIMARY KEY,
        value  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS push_subscriptions (
        endpoint    TEXT PRIMARY KEY,
        device_id   TEXT NOT NULL,
        p256dh      TEXT NOT NULL,
        auth        TEXT NOT NULL,
        created_at  INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS changes (
        id           TEXT PRIMARY KEY,
        path         TEXT NOT NULL,
        device_id    TEXT NOT NULL,
        device_name  TEXT NOT NULL,
        base_hash    TEXT NOT NULL,
        base_text    TEXT NOT NULL,
        new_text     TEXT NOT NULL,
        created_at   INTEGER NOT NULL,
        state        TEXT NOT NULL,
        decided_at   INTEGER,
        outcome      TEXT
    );
    CREATE TABLE IF NOT EXISTS terminal_history (
        key          TEXT PRIMARY KEY,
        terminal     INTEGER NOT NULL,
        name         TEXT NOT NULL,
        created_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL,
        closed_at    INTEGER,
        tabs         TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS session_history (
        id           TEXT PRIMARY KEY,
        title        TEXT,
        cwd          TEXT NOT NULL,
        started_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL,
        ended_at     INTEGER,
        doing        TEXT NOT NULL,
        timeline     TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS live_sessions (
        id           TEXT PRIMARY KEY,
        body         TEXT NOT NULL
    );
";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TerminalRecord {
    /// The terminal's tmux id and when it started: tmux reuses ids.
    pub key: String,
    pub terminal: u32,
    pub name: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub closed_at: Option<i64>,
    /// Each tab: `{name, cwd, command, text}`, the text with its colours.
    pub tabs: serde_json::Value,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SessionRecord {
    pub id: String,
    pub title: Option<String>,
    pub cwd: String,
    pub started_at: i64,
    pub updated_at: i64,
    pub ended_at: Option<i64>,
    pub doing: String,
    /// Newest first.
    pub timeline: serde_json::Value,
}

/// Only the laptop changes these.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Settings {
    /// Whether the phone may read files that look like secrets (`.env`,
    /// keys, credentials). Airlock's own files are never readable.
    pub sensitive_files: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            sensitive_files: true,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Change {
    pub id: String,
    pub path: String,
    pub device_id: String,
    pub device_name: String,
    /// SHA-256 of the file as the phone read it.
    pub base_hash: String,
    #[serde(skip)]
    pub base_text: String,
    #[serde(skip)]
    pub new_text: String,
    pub created_at: i64,
    /// `pending`, `written`, `declined` or `withdrawn`.
    pub state: String,
    pub decided_at: Option<i64>,
    pub outcome: Option<String>,
}

const CHANGE_COLUMNS: &str = "id, path, device_id, device_name, base_hash, base_text, new_text, created_at, state, decided_at, outcome";

fn change_from_row(row: &Row) -> rusqlite::Result<Change> {
    Ok(Change {
        id: row.get(0)?,
        path: row.get(1)?,
        device_id: row.get(2)?,
        device_name: row.get(3)?,
        base_hash: row.get(4)?,
        base_text: row.get(5)?,
        new_text: row.get(6)?,
        created_at: row.get(7)?,
        state: row.get(8)?,
        decided_at: row.get(9)?,
        outcome: row.get(10)?,
    })
}

/// Seconds since the Unix epoch.
pub fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Device {
    pub id: String,
    pub name: String,
    pub login: String,
    pub created_at: i64,
    pub last_seen: i64,
    /// Whether it unlocks with Face ID (a passkey). Filled in by
    /// [`Store::devices`] only.
    #[serde(default)]
    pub face_id: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Pairing {
    pub id: String,
    pub code: String,
    pub name: String,
    pub login: String,
    pub created_at: i64,
    pub expires_at: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AuditEntry {
    pub at: i64,
    pub actor: String,
    pub action: String,
    pub detail: String,
}

#[derive(Debug, PartialEq)]
pub enum PairingRefused {
    TooMany,
}

#[derive(Debug, PartialEq)]
pub enum Match<T> {
    One(T),
    None,
    Many,
}

#[derive(Debug, PartialEq)]
pub enum PairStatus {
    Pending {
        code: String,
    },
    /// Approved just now: the phone gets its device token, once.
    Approved {
        device: Device,
        token: String,
    },
    Denied,
    Expired,
    /// Approved earlier, and the token was already handed out.
    Done,
    Unknown,
}

impl PairStatus {
    pub fn label(&self) -> &'static str {
        match self {
            Self::Pending { .. } => "pending",
            Self::Approved { .. } => "approved",
            Self::Denied => "denied",
            Self::Expired => "expired",
            Self::Done => "done",
            Self::Unknown => "none",
        }
    }
}

#[derive(Debug, PartialEq)]
pub enum Auth {
    /// A paired device. When `new_token` is set, its token was replaced: send
    /// the new one back to the device.
    Device {
        device: Device,
        new_token: Option<String>,
    },
    /// A retired token came back, so someone copied it. The device has been
    /// revoked.
    Stolen { device: Device },
    Unknown,
}

pub struct Store {
    conn: Connection,
}

const PAIRING_COLUMNS: &str = "id, code, name, login, created_at, expires_at";
const DEVICE_COLUMNS: &str = "id, name, login, created_at, last_seen";

fn pairing_from_row(row: &Row) -> rusqlite::Result<Pairing> {
    Ok(Pairing {
        id: row.get(0)?,
        code: row.get(1)?,
        name: row.get(2)?,
        login: row.get(3)?,
        created_at: row.get(4)?,
        expires_at: row.get(5)?,
    })
}

fn device_from_row(row: &Row) -> rusqlite::Result<Device> {
    Ok(Device {
        id: row.get(0)?,
        name: row.get(1)?,
        login: row.get(2)?,
        created_at: row.get(3)?,
        last_seen: row.get(4)?,
        face_id: false,
    })
}

impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path).with_context(|| format!("opening {}", path.display()))?;
        Self::init(conn)
    }

    pub fn open_in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> Result<Self> {
        conn.execute_batch(SCHEMA).context("creating the schema")?;
        Ok(Self { conn })
    }

    pub fn audit(&self, actor: &str, action: &str, detail: &str) -> Result<()> {
        self.conn.execute(
            "INSERT INTO audit (at, actor, action, detail) VALUES (?1, ?2, ?3, ?4)",
            params![now(), actor, action, detail],
        )?;
        Ok(())
    }

    pub fn audit_log(&self, limit: i64) -> Result<Vec<AuditEntry>> {
        let mut stmt = self
            .conn
            .prepare("SELECT at, actor, action, detail FROM audit ORDER BY rowid DESC LIMIT ?1")?;
        let rows = stmt.query_map(params![limit], |row| {
            Ok(AuditEntry {
                at: row.get(0)?,
                actor: row.get(1)?,
                action: row.get(2)?,
                detail: row.get(3)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    fn expire_pairings(&self) -> Result<()> {
        self.conn.execute(
            "UPDATE pairings SET state = 'expired' WHERE state = 'pending' AND expires_at <= ?1",
            params![now()],
        )?;
        Ok(())
    }

    /// A new pairing request from a phone. Returns it with the secret the
    /// phone keeps to collect its device token once the laptop approves.
    pub fn request_pairing(
        &self,
        name: &str,
        login: &str,
    ) -> Result<Result<(Pairing, String), PairingRefused>> {
        self.expire_pairings()?;
        let pending: i64 = self.conn.query_row(
            "SELECT count(*) FROM pairings WHERE state = 'pending'",
            [],
            |row| row.get(0),
        )?;
        if pending >= MAX_PENDING {
            self.audit(
                "phone",
                "pairing refused",
                &format!("{name} ({login}): too many waiting"),
            )?;
            return Ok(Err(PairingRefused::TooMany));
        }
        let code = loop {
            let code = token::pairing_code();
            let taken: bool = self.conn.query_row(
                "SELECT EXISTS (SELECT 1 FROM pairings WHERE state = 'pending' AND code = ?1)",
                params![code],
                |row| row.get(0),
            )?;
            if !taken {
                break code;
            }
        };
        let secret = token::secret();
        let created_at = now();
        let pairing = Pairing {
            id: token::id(),
            code,
            name: name.to_owned(),
            login: login.to_owned(),
            created_at,
            expires_at: created_at + PAIRING_TTL_SECS,
        };
        self.conn.execute(
            "INSERT INTO pairings (id, code, name, login, secret_hash, created_at, expires_at, state)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending')",
            params![
                pairing.id,
                pairing.code,
                pairing.name,
                pairing.login,
                token::hash(&secret),
                pairing.created_at,
                pairing.expires_at
            ],
        )?;
        self.audit(
            "phone",
            "pairing requested",
            &format!(
                "{} ({}), code {}",
                pairing.name, pairing.login, pairing.code
            ),
        )?;
        Ok(Ok((pairing, secret)))
    }

    pub fn pending_pairings(&self) -> Result<Vec<Pairing>> {
        self.expire_pairings()?;
        let mut stmt = self.conn.prepare(&format!(
            "SELECT {PAIRING_COLUMNS} FROM pairings WHERE state = 'pending' ORDER BY created_at"
        ))?;
        let rows = stmt.query_map([], pairing_from_row)?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn decide_pairing(
        &self,
        id_or_code: &str,
        approve: bool,
        actor: &str,
    ) -> Result<Match<Pairing>> {
        self.expire_pairings()?;
        let mut stmt = self.conn.prepare(&format!(
            "SELECT {PAIRING_COLUMNS} FROM pairings WHERE state = 'pending' AND (id = ?1 OR code = ?1)"
        ))?;
        let mut found = stmt
            .query_map(params![id_or_code], pairing_from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let pairing = match found.len() {
            0 => return Ok(Match::None),
            1 => found.remove(0),
            _ => return Ok(Match::Many),
        };
        let (state, action) = if approve {
            ("approved", "pairing approved")
        } else {
            ("denied", "pairing denied")
        };
        self.conn.execute(
            "UPDATE pairings SET state = ?1 WHERE id = ?2",
            params![state, pairing.id],
        )?;
        self.audit(
            actor,
            action,
            &format!(
                "{} ({}), code {}",
                pairing.name, pairing.login, pairing.code
            ),
        )?;
        Ok(Match::One(pairing))
    }

    /// What the phone holding `secret` sees. The first look after approval
    /// creates the device and returns its token; later looks return `Done`.
    pub fn pairing_status(&self, secret: &str) -> Result<PairStatus> {
        self.expire_pairings()?;
        let row = self
            .conn
            .query_row(
                "SELECT id, code, name, login, state FROM pairings WHERE secret_hash = ?1",
                params![token::hash(secret)],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                    ))
                },
            )
            .optional()?;
        let Some((id, code, name, login, state)) = row else {
            return Ok(PairStatus::Unknown);
        };
        Ok(match state.as_str() {
            "pending" => PairStatus::Pending { code },
            "denied" => PairStatus::Denied,
            "expired" => PairStatus::Expired,
            "approved" => {
                let token = token::secret();
                let now = now();
                let device = Device {
                    id: token::id(),
                    name,
                    login,
                    created_at: now,
                    last_seen: now,
                    face_id: false,
                };
                let tx = self.conn.unchecked_transaction()?;
                tx.execute(
                    "INSERT INTO devices (id, name, login, token_hash, rotated_at, created_at, last_seen)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?5)",
                    params![device.id, device.name, device.login, token::hash(&token), now],
                )?;
                tx.execute(
                    "UPDATE pairings SET state = 'paired', device_id = ?1 WHERE id = ?2",
                    params![device.id, id],
                )?;
                tx.commit()?;
                self.audit(
                    "hub",
                    "device paired",
                    &format!("{} ({}) as {}", device.name, device.login, device.id),
                )?;
                PairStatus::Approved { device, token }
            }
            _ => PairStatus::Done,
        })
    }

    /// Who `token` belongs to, replacing it when it has been in use for
    /// [`ROTATE_EVERY_SECS`] and `rotate` allows (a websocket handshake can't
    /// carry a new cookie, so it doesn't).
    pub fn authenticate(&self, token: &str, rotate: bool) -> Result<Auth> {
        let hash = token::hash(token);
        let now = now();

        let current = self
            .conn
            .query_row(
                &format!(
                    "SELECT {DEVICE_COLUMNS}, next_at, rotated_at FROM devices
                     WHERE token_hash = ?1 AND revoked_at IS NULL"
                ),
                params![hash],
                |row| {
                    Ok((
                        device_from_row(row)?,
                        row.get::<_, Option<i64>>(5)?,
                        row.get::<_, i64>(6)?,
                    ))
                },
            )
            .optional()?;
        if let Some((mut device, next_at, rotated_at)) = current {
            if now - device.last_seen > IDLE_EXPIRY_SECS {
                self.retire_device(&device, "hub", "device expired from disuse")?;
                return Ok(Auth::Unknown);
            }
            device.last_seen = now;
            self.conn.execute(
                "UPDATE devices SET last_seen = ?1 WHERE id = ?2",
                params![now, device.id],
            )?;
            let due = now - rotated_at >= ROTATE_EVERY_SECS;
            let replacement_in_flight = next_at.is_some_and(|at| now - at < REPLACEMENT_GRACE_SECS);
            if rotate && due && !replacement_in_flight {
                // Any earlier replacement never came back, so the device never
                // got it: it is overwritten, not retired.
                let new_token = token::secret();
                self.conn.execute(
                    "UPDATE devices SET next_hash = ?1, next_at = ?2 WHERE id = ?3",
                    params![token::hash(&new_token), now, device.id],
                )?;
                return Ok(Auth::Device {
                    device,
                    new_token: Some(new_token),
                });
            }
            return Ok(Auth::Device {
                device,
                new_token: None,
            });
        }

        let next = self
            .conn
            .query_row(
                &format!(
                    "SELECT {DEVICE_COLUMNS}, token_hash FROM devices
                     WHERE next_hash = ?1 AND revoked_at IS NULL"
                ),
                params![hash],
                |row| Ok((device_from_row(row)?, row.get::<_, String>(5)?)),
            )
            .optional()?;
        if let Some((mut device, old_hash)) = next {
            // The device has its new token: the old one is retired for good.
            let tx = self.conn.unchecked_transaction()?;
            tx.execute(
                "INSERT INTO retired_tokens (token_hash, device_id, retired_at) VALUES (?1, ?2, ?3)",
                params![old_hash, device.id, now],
            )?;
            tx.execute(
                "UPDATE devices SET token_hash = ?1, next_hash = NULL, next_at = NULL,
                     rotated_at = ?2, last_seen = ?2 WHERE id = ?3",
                params![hash, now, device.id],
            )?;
            tx.commit()?;
            device.last_seen = now;
            return Ok(Auth::Device {
                device,
                new_token: None,
            });
        }

        let reused = self
            .conn
            .query_row(
                &format!(
                    "SELECT {DEVICE_COLUMNS}, retired_tokens.retired_at FROM devices
                     JOIN retired_tokens ON retired_tokens.device_id = devices.id
                     WHERE retired_tokens.token_hash = ?1"
                ),
                params![hash],
                |row| Ok((device_from_row(row)?, row.get::<_, i64>(5)?)),
            )
            .optional()?;
        if let Some((device, retired_at)) = reused {
            // Just retired: a request the phone sent before it had its new
            // token, arriving late (a slow network, a page coming back). It
            // gets in, and nothing rotates; only an old token coming back
            // after that says it was copied.
            if now - retired_at < RETIRED_GRACE_SECS && self.is_active(&device.id)? {
                return Ok(Auth::Device {
                    device,
                    new_token: None,
                });
            }
            if self.is_active(&device.id)? {
                self.retire_device(&device, "hub", "device revoked: a retired token was reused")?;
            }
            return Ok(Auth::Stolen { device });
        }

        Ok(Auth::Unknown)
    }

    pub fn add_push_subscription(
        &self,
        device_id: &str,
        subscription: &PushSubscription,
    ) -> Result<()> {
        self.conn.execute(
            "INSERT INTO push_subscriptions (endpoint, device_id, p256dh, auth, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(endpoint) DO UPDATE SET device_id = ?2, p256dh = ?3, auth = ?4, created_at = ?5",
            params![subscription.endpoint, device_id, subscription.p256dh, subscription.auth, now()],
        )?;
        Ok(())
    }

    pub fn remove_push_subscription(&self, endpoint: &str) -> Result<()> {
        self.conn.execute(
            "DELETE FROM push_subscriptions WHERE endpoint = ?1",
            params![endpoint],
        )?;
        Ok(())
    }

    pub fn push_subscriptions(&self, device_id: Option<&str>) -> Result<Vec<PushSubscription>> {
        let mut statement = self.conn.prepare(
            "SELECT endpoint, p256dh, auth FROM push_subscriptions
             WHERE device_id IN (SELECT id FROM devices WHERE revoked_at IS NULL)
               AND (?1 IS NULL OR device_id = ?1)",
        )?;
        let rows = statement.query_map(params![device_id], |row| {
            Ok(PushSubscription {
                endpoint: row.get(0)?,
                p256dh: row.get(1)?,
                auth: row.get(2)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    fn retire_device(&self, device: &Device, actor: &str, action: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE devices SET revoked_at = ?1 WHERE id = ?2",
            params![now(), device.id],
        )?;
        self.audit(actor, action, &format!("{} ({})", device.name, device.id))
    }

    pub fn is_active(&self, device_id: &str) -> Result<bool> {
        Ok(self.conn.query_row(
            "SELECT EXISTS (SELECT 1 FROM devices WHERE id = ?1 AND revoked_at IS NULL)",
            params![device_id],
            |row| row.get(0),
        )?)
    }

    pub fn devices(&self) -> Result<Vec<Device>> {
        let mut stmt = self.conn.prepare(&format!(
            "SELECT {DEVICE_COLUMNS} FROM devices WHERE revoked_at IS NULL ORDER BY created_at"
        ))?;
        let rows = stmt.query_map([], device_from_row)?;
        let mut devices: Vec<Device> = rows.collect::<rusqlite::Result<_>>()?;
        for device in &mut devices {
            device.face_id = self.has_passkey(&device.id)?;
        }
        Ok(devices)
    }

    /// `rp_id` is the hub's host name.
    pub fn add_passkey(&self, device_id: &str, rp_id: &str, passkey: &str) -> Result<()> {
        self.conn.execute(
            "INSERT INTO passkeys (device_id, rp_id, passkey, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![device_id, rp_id, passkey, now()],
        )?;
        Ok(())
    }

    /// A device's passkeys: each one's row, host name and serialized key.
    pub fn passkeys(&self, device_id: &str) -> Result<Vec<(i64, String, String)>> {
        let mut stmt = self
            .conn
            .prepare("SELECT rowid, rp_id, passkey FROM passkeys WHERE device_id = ?1")?;
        let rows = stmt.query_map(params![device_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn update_passkey(&self, row: i64, passkey: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE passkeys SET passkey = ?1, used_at = ?2 WHERE rowid = ?3",
            params![passkey, now(), row],
        )?;
        Ok(())
    }

    pub fn has_passkey(&self, device_id: &str) -> Result<bool> {
        Ok(self.conn.query_row(
            "SELECT EXISTS (SELECT 1 FROM passkeys WHERE device_id = ?1)",
            params![device_id],
            |row| row.get(0),
        )?)
    }

    pub fn settings(&self) -> Result<Settings> {
        let text: Option<String> = self
            .conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'settings'",
                [],
                |row| row.get(0),
            )
            .optional()?;
        Ok(match text {
            Some(text) => serde_json::from_str(&text).unwrap_or_default(),
            None => Settings::default(),
        })
    }

    pub fn save_settings(&self, settings: &Settings, actor: &str) -> Result<()> {
        let before = self.settings()?;
        self.conn.execute(
            "INSERT INTO settings (key, value) VALUES ('settings', ?1)
             ON CONFLICT (key) DO UPDATE SET value = excluded.value",
            params![serde_json::to_string(settings)?],
        )?;
        if before.sensitive_files != settings.sensitive_files {
            let detail = if settings.sensitive_files {
                "the phone may read sensitive files"
            } else {
                "the phone may not read sensitive files"
            };
            self.audit(actor, "setting changed", detail)?;
        }
        Ok(())
    }

    pub fn propose_change(&self, change: &Change) -> Result<()> {
        self.conn.execute(
            &format!("INSERT INTO changes ({CHANGE_COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)"),
            params![
                change.id,
                change.path,
                change.device_id,
                change.device_name,
                change.base_hash,
                change.base_text,
                change.new_text,
                change.created_at,
                change.state,
                change.decided_at,
                change.outcome
            ],
        )?;
        self.audit(
            "phone",
            "edit proposed",
            &format!("{} by {}", change.path, change.device_name),
        )
    }

    pub fn change(&self, id: &str) -> Result<Option<Change>> {
        Ok(self
            .conn
            .query_row(
                &format!("SELECT {CHANGE_COLUMNS} FROM changes WHERE id = ?1"),
                params![id],
                change_from_row,
            )
            .optional()?)
    }

    /// Edits waiting first (oldest first), then the latest decided ones;
    /// only `device_id`'s when given.
    pub fn changes(&self, device_id: Option<&str>, decided: i64) -> Result<Vec<Change>> {
        let mut stmt = self.conn.prepare(&format!(
            "SELECT {CHANGE_COLUMNS} FROM (
                 SELECT * FROM changes WHERE state = 'pending' AND (?1 IS NULL OR device_id = ?1)
                 UNION ALL
                 SELECT * FROM (SELECT * FROM changes
                     WHERE state != 'pending' AND (?1 IS NULL OR device_id = ?1)
                     ORDER BY decided_at DESC LIMIT ?2)
             ) ORDER BY state != 'pending', CASE WHEN state = 'pending' THEN created_at ELSE -decided_at END"
        ))?;
        let rows = stmt.query_map(params![device_id, decided], change_from_row)?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// Settles a waiting edit. Returns false when it was no longer waiting.
    pub fn settle_change(&self, id: &str, state: &str, outcome: &str, actor: &str) -> Result<bool> {
        let settled = self.conn.execute(
            "UPDATE changes SET state = ?1, outcome = ?2, decided_at = ?3 WHERE id = ?4 AND state = 'pending'",
            params![state, outcome, now(), id],
        )?;
        if settled == 1
            && let Some(change) = self.change(id)?
        {
            self.audit(
                actor,
                &format!("edit {state}"),
                &format!("{}: {outcome}", change.path),
            )?;
        }
        Ok(settled == 1)
    }

    pub fn revoke(&self, id_or_name: &str, actor: &str) -> Result<Match<Device>> {
        let mut stmt = self.conn.prepare(&format!(
            "SELECT {DEVICE_COLUMNS} FROM devices WHERE revoked_at IS NULL AND (id = ?1 OR name = ?1)"
        ))?;
        let mut found = stmt
            .query_map(params![id_or_name], device_from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let device = match found.len() {
            0 => return Ok(Match::None),
            1 => found.remove(0),
            _ => return Ok(Match::Many),
        };
        self.retire_device(&device, actor, "device revoked")?;
        Ok(Match::One(device))
    }

    /// Saves a terminal's latest state; it stays open until
    /// [`Store::close_terminals_except`] says otherwise.
    pub fn save_terminal(&self, record: &TerminalRecord) -> Result<()> {
        self.conn.execute(
            "INSERT INTO terminal_history (key, terminal, name, created_at, updated_at, closed_at, tabs)
             VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6)
             ON CONFLICT(key) DO UPDATE SET name = ?3, updated_at = ?5, closed_at = NULL, tabs = ?6",
            params![
                record.key,
                record.terminal,
                record.name,
                record.created_at,
                record.updated_at,
                record.tabs.to_string()
            ],
        )?;
        Ok(())
    }

    pub fn close_terminals_except(&self, open: &[String], now: i64) -> Result<()> {
        let open = serde_json::to_string(open)?;
        self.conn.execute(
            "UPDATE terminal_history SET closed_at = ?2
             WHERE closed_at IS NULL AND key NOT IN (SELECT value FROM json_each(?1))",
            params![open, now],
        )?;
        Ok(())
    }

    fn terminal_from_row(row: &Row) -> rusqlite::Result<TerminalRecord> {
        let tabs: String = row.get(6)?;
        Ok(TerminalRecord {
            key: row.get(0)?,
            terminal: row.get(1)?,
            name: row.get(2)?,
            created_at: row.get(3)?,
            updated_at: row.get(4)?,
            closed_at: row.get(5)?,
            tabs: serde_json::from_str(&tabs).unwrap_or_default(),
        })
    }

    /// Without `text`, each tab's text is left out.
    pub fn terminal_history(&self, text: bool) -> Result<Vec<TerminalRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT key, terminal, name, created_at, updated_at, closed_at, tabs
             FROM terminal_history ORDER BY updated_at DESC",
        )?;
        let mut records = stmt
            .query_map([], Self::terminal_from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        if !text {
            for record in &mut records {
                if let Some(tabs) = record.tabs.as_array_mut() {
                    for tab in tabs.iter_mut().filter_map(|tab| tab.as_object_mut()) {
                        let lines = tab
                            .get("text")
                            .and_then(serde_json::Value::as_str)
                            .map_or(0, |text| text.lines().count());
                        tab.remove("text");
                        tab.insert("lines".to_owned(), lines.into());
                    }
                }
            }
        }
        Ok(records)
    }

    pub fn terminal_record(&self, key: &str) -> Result<Option<TerminalRecord>> {
        Ok(self
            .conn
            .query_row(
                "SELECT key, terminal, name, created_at, updated_at, closed_at, tabs
                 FROM terminal_history WHERE key = ?1",
                params![key],
                Self::terminal_from_row,
            )
            .optional()?)
    }

    pub fn delete_terminal_record(&self, key: &str) -> Result<bool> {
        Ok(self
            .conn
            .execute("DELETE FROM terminal_history WHERE key = ?1", params![key])?
            > 0)
    }

    pub fn save_session(&self, record: &SessionRecord) -> Result<()> {
        self.conn.execute(
            "INSERT INTO session_history (id, title, cwd, started_at, updated_at, ended_at, doing, timeline)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(id) DO UPDATE SET title = ?2, cwd = ?3, updated_at = ?5, ended_at = ?6,
                 doing = ?7, timeline = ?8",
            params![
                record.id,
                record.title,
                record.cwd,
                record.started_at,
                record.updated_at,
                record.ended_at,
                record.doing,
                record.timeline.to_string()
            ],
        )?;
        Ok(())
    }

    pub fn keep_live_sessions(&mut self, sessions: &[crate::claude::Kept]) -> Result<()> {
        let tx = self.conn.transaction()?;
        tx.execute("DELETE FROM live_sessions", [])?;
        for session in sessions {
            tx.execute(
                "INSERT INTO live_sessions (id, body) VALUES (?1, ?2)",
                params![session.id(), serde_json::to_string(session)?],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn live_sessions(&self) -> Result<Vec<crate::claude::Kept>> {
        let mut stmt = self.conn.prepare("SELECT body FROM live_sessions")?;
        let bodies = stmt
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<String>>>()?;
        Ok(bodies
            .iter()
            .filter_map(|body| serde_json::from_str(body).ok())
            .collect())
    }

    fn session_from_row(row: &Row) -> rusqlite::Result<SessionRecord> {
        let timeline: String = row.get(7)?;
        Ok(SessionRecord {
            id: row.get(0)?,
            title: row.get(1)?,
            cwd: row.get(2)?,
            started_at: row.get(3)?,
            updated_at: row.get(4)?,
            ended_at: row.get(5)?,
            doing: row.get(6)?,
            timeline: serde_json::from_str(&timeline).unwrap_or_default(),
        })
    }

    pub fn session_history(&self) -> Result<Vec<SessionRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, title, cwd, started_at, updated_at, ended_at, doing, timeline
             FROM session_history ORDER BY updated_at DESC",
        )?;
        Ok(stmt
            .query_map([], Self::session_from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn session_record(&self, id: &str) -> Result<Option<SessionRecord>> {
        Ok(self
            .conn
            .query_row(
                "SELECT id, title, cwd, started_at, updated_at, ended_at, doing, timeline
                 FROM session_history WHERE id = ?1",
                params![id],
                Self::session_from_row,
            )
            .optional()?)
    }

    pub fn delete_session_record(&self, id: &str) -> Result<bool> {
        Ok(self
            .conn
            .execute("DELETE FROM session_history WHERE id = ?1", params![id])?
            > 0)
    }

    /// Forgets the closed terminals and sessions last active before `before`.
    /// Open ones stay, however old.
    pub fn purge_history(&self, before: i64) -> Result<usize> {
        let terminals = self.conn.execute(
            "DELETE FROM terminal_history WHERE closed_at IS NOT NULL AND updated_at < ?1",
            params![before],
        )?;
        let sessions = self.conn.execute(
            "DELETE FROM session_history WHERE updated_at < ?1",
            params![before],
        )?;
        Ok(terminals + sessions)
    }
}

#[cfg(test)]
impl Store {
    pub(crate) fn backdate_tokens(&self, secs: i64) {
        self.conn
            .execute(
                "UPDATE devices SET rotated_at = rotated_at - ?1",
                params![secs],
            )
            .unwrap();
    }

    pub(crate) fn backdate_retired(&self, secs: i64) {
        self.conn
            .execute(
                "UPDATE retired_tokens SET retired_at = retired_at - ?1",
                params![secs],
            )
            .unwrap();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paired(store: &Store) -> (Device, String) {
        let (pairing, secret) = store
            .request_pairing("iPhone", "you@example.com")
            .unwrap()
            .unwrap();
        assert!(matches!(
            store.decide_pairing(&pairing.code, true, "test").unwrap(),
            Match::One(_)
        ));
        match store.pairing_status(&secret).unwrap() {
            PairStatus::Approved { device, token } => (device, token),
            other => panic!("expected approval, got {other:?}"),
        }
    }

    fn count(store: &Store, sql: &str, value: &str) -> i64 {
        store
            .conn
            .query_row(sql, params![value], |row| row.get(0))
            .unwrap()
    }

    fn age_token(store: &Store, device: &Device, secs: i64) {
        store
            .conn
            .execute(
                "UPDATE devices SET rotated_at = ?1 WHERE id = ?2",
                params![now() - secs, device.id],
            )
            .unwrap();
    }

    fn new_token(auth: Auth) -> Option<String> {
        match auth {
            Auth::Device { new_token, .. } => new_token,
            other => panic!("expected a device, got {other:?}"),
        }
    }

    #[test]
    fn secrets_are_stored_only_as_hashes() {
        let store = Store::open_in_memory().unwrap();
        let (pairing, secret) = store
            .request_pairing("iPhone", "you@example.com")
            .unwrap()
            .unwrap();
        store.decide_pairing(&pairing.id, true, "test").unwrap();
        let PairStatus::Approved { token, .. } = store.pairing_status(&secret).unwrap() else {
            panic!("not approved");
        };
        let by_secret = "SELECT count(*) FROM pairings WHERE secret_hash = ?1";
        let by_token = "SELECT count(*) FROM devices WHERE token_hash = ?1";
        assert_eq!(count(&store, by_secret, &secret), 0);
        assert_eq!(count(&store, by_secret, &token::hash(&secret)), 1);
        assert_eq!(count(&store, by_token, &token), 0);
        assert_eq!(count(&store, by_token, &token::hash(&token)), 1);
    }

    #[test]
    fn the_token_is_handed_out_once() {
        let store = Store::open_in_memory().unwrap();
        let (pairing, secret) = store
            .request_pairing("iPhone", "you@example.com")
            .unwrap()
            .unwrap();
        store.decide_pairing(&pairing.code, true, "test").unwrap();
        assert!(matches!(
            store.pairing_status(&secret).unwrap(),
            PairStatus::Approved { .. }
        ));
        assert_eq!(store.pairing_status(&secret).unwrap(), PairStatus::Done);
    }

    #[test]
    fn expired_requests_cannot_be_approved() {
        let store = Store::open_in_memory().unwrap();
        let (pairing, secret) = store
            .request_pairing("iPhone", "you@example.com")
            .unwrap()
            .unwrap();
        store
            .conn
            .execute("UPDATE pairings SET expires_at = ?1", params![now() - 1])
            .unwrap();
        assert_eq!(
            store.decide_pairing(&pairing.code, true, "test").unwrap(),
            Match::None
        );
        assert_eq!(store.pairing_status(&secret).unwrap(), PairStatus::Expired);
    }

    #[test]
    fn denied_requests_give_no_token() {
        let store = Store::open_in_memory().unwrap();
        let (pairing, secret) = store
            .request_pairing("iPhone", "you@example.com")
            .unwrap()
            .unwrap();
        store.decide_pairing(&pairing.id, false, "test").unwrap();
        assert_eq!(store.pairing_status(&secret).unwrap(), PairStatus::Denied);
        assert!(store.devices().unwrap().is_empty());
    }

    #[test]
    fn only_a_few_requests_wait_at_once() {
        let store = Store::open_in_memory().unwrap();
        for _ in 0..MAX_PENDING {
            store
                .request_pairing("iPhone", "you@example.com")
                .unwrap()
                .unwrap();
        }
        assert_eq!(
            store
                .request_pairing("iPhone", "you@example.com")
                .unwrap()
                .unwrap_err(),
            PairingRefused::TooMany
        );
    }

    #[test]
    fn a_fresh_token_is_not_replaced() {
        let store = Store::open_in_memory().unwrap();
        let (_, token) = paired(&store);
        assert_eq!(new_token(store.authenticate(&token, true).unwrap()), None);
    }

    #[test]
    fn tokens_rotate_and_the_old_one_dies_once_the_new_one_is_used() {
        let store = Store::open_in_memory().unwrap();
        let (device, old) = paired(&store);
        age_token(&store, &device, ROTATE_EVERY_SECS);

        let new = new_token(store.authenticate(&old, true).unwrap()).expect("rotation due");
        // Until the device uses the new token, the old one keeps working.
        assert_eq!(new_token(store.authenticate(&old, true).unwrap()), None);
        // The device uses the new one: the old one is retired.
        assert_eq!(new_token(store.authenticate(&new, true).unwrap()), None);
        // A request it sent before that, arriving late, still gets in, and
        // nothing rotates.
        assert!(matches!(
            store.authenticate(&old, true).unwrap(),
            Auth::Device { device: late, new_token: None } if late.id == device.id
        ));
        assert!(store.is_active(&device.id).unwrap());
        // The old one coming back after that means it was copied: the
        // device is cut off.
        store
            .conn
            .execute(
                "UPDATE retired_tokens SET retired_at = retired_at - ?1",
                params![RETIRED_GRACE_SECS],
            )
            .unwrap();
        assert!(matches!(
            store.authenticate(&old, true).unwrap(),
            Auth::Stolen { device: stolen } if stolen.id == device.id
        ));
        assert!(!store.is_active(&device.id).unwrap());
        assert_eq!(store.authenticate(&new, true).unwrap(), Auth::Unknown);
        assert!(
            store.audit_log(1).unwrap()[0]
                .action
                .contains("retired token was reused"),
            "the theft is in the audit log"
        );
    }

    #[test]
    fn a_lost_replacement_is_replaced_not_treated_as_theft() {
        let store = Store::open_in_memory().unwrap();
        let (device, old) = paired(&store);
        age_token(&store, &device, ROTATE_EVERY_SECS);
        let lost = new_token(store.authenticate(&old, true).unwrap()).unwrap();
        // The device never received `lost`; after the grace period it is replaced.
        store
            .conn
            .execute(
                "UPDATE devices SET next_at = ?1 WHERE id = ?2",
                params![now() - REPLACEMENT_GRACE_SECS, device.id],
            )
            .unwrap();
        let second = new_token(store.authenticate(&old, true).unwrap()).unwrap();
        assert_ne!(lost, second);
        assert_eq!(store.authenticate(&lost, true).unwrap(), Auth::Unknown);
        assert!(store.is_active(&device.id).unwrap());
        assert_eq!(new_token(store.authenticate(&second, true).unwrap()), None);
    }

    #[test]
    fn requests_in_flight_do_not_get_a_second_replacement() {
        let store = Store::open_in_memory().unwrap();
        let (device, old) = paired(&store);
        age_token(&store, &device, ROTATE_EVERY_SECS);
        assert!(new_token(store.authenticate(&old, true).unwrap()).is_some());
        assert_eq!(new_token(store.authenticate(&old, true).unwrap()), None);
    }

    #[test]
    fn websocket_handshakes_do_not_rotate() {
        let store = Store::open_in_memory().unwrap();
        let (device, token) = paired(&store);
        age_token(&store, &device, ROTATE_EVERY_SECS);
        assert_eq!(new_token(store.authenticate(&token, false).unwrap()), None);
    }

    #[test]
    fn idle_devices_expire() {
        let store = Store::open_in_memory().unwrap();
        let (device, token) = paired(&store);
        store
            .conn
            .execute(
                "UPDATE devices SET last_seen = ?1 WHERE id = ?2",
                params![now() - IDLE_EXPIRY_SECS - 1, device.id],
            )
            .unwrap();
        assert_eq!(store.authenticate(&token, true).unwrap(), Auth::Unknown);
        assert!(!store.is_active(&device.id).unwrap());
    }

    #[test]
    fn revoked_devices_are_shut_out() {
        let store = Store::open_in_memory().unwrap();
        let (device, token) = paired(&store);
        assert!(matches!(
            store.authenticate(&token, true).unwrap(),
            Auth::Device { .. }
        ));
        assert!(matches!(
            store.revoke(&device.id, "test").unwrap(),
            Match::One(_)
        ));
        assert_eq!(store.authenticate(&token, true).unwrap(), Auth::Unknown);
        assert!(store.devices().unwrap().is_empty());
    }

    #[test]
    fn every_decision_is_audited() {
        let store = Store::open_in_memory().unwrap();
        let (device, _) = paired(&store);
        store.revoke(&device.name, "test").unwrap();
        let actions: Vec<String> = store
            .audit_log(10)
            .unwrap()
            .into_iter()
            .map(|e| e.action)
            .collect();
        assert_eq!(
            actions,
            [
                "device revoked",
                "device paired",
                "pairing approved",
                "pairing requested"
            ]
        );
    }
}
