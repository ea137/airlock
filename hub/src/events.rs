//! Live notices inside the hub. A revoked device's open connections listen
//! here and close at once; the laptop app follows them on the admin socket's
//! `/events` stream.

use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Event {
    PairingRequested {
        id: String,
        code: String,
        name: String,
    },
    PairingDecided {
        id: String,
        approved: bool,
    },
    DeviceRevoked {
        id: String,
    },
    /// A device's retired token was used again, so someone copied it. The
    /// device was revoked; the laptop app tells you.
    TokenReused {
        id: String,
        name: String,
    },
    ChangeProposed {
        id: String,
        path: String,
        device: String,
    },
    /// An edit was written, declined or withdrawn.
    ChangeDecided {
        id: String,
    },
    SettingsChanged,
    /// The phone shared a Claude session that was in a laptop terminal it
    /// couldn't reach: it carries on in Airlock terminal `terminal`, which
    /// the laptop app opens in a window, so it is on both again.
    SessionShared {
        terminal: u32,
    },
    /// A Claude session changed how it stands (it waits on you, works,
    /// finished, ended), so screens showing sessions refresh; it says which
    /// to no one.
    SessionsChanged,
    /// The hub is stopping: open connections close so it can.
    HubStopping,
}

#[derive(Clone)]
pub struct Events {
    tx: broadcast::Sender<Event>,
}

impl Events {
    pub fn new() -> Self {
        Self {
            tx: broadcast::channel(256).0,
        }
    }

    pub fn send(&self, event: Event) {
        // No listeners is fine: nothing is connected.
        let _ = self.tx.send(event);
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Event> {
        self.tx.subscribe()
    }
}

impl Default for Events {
    fn default() -> Self {
        Self::new()
    }
}
