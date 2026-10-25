//! Streams one terminal to one screen: a tmux client in a PTY the hub owns,
//! or a tab of the laptop's own terminal app ([`crate::laptop_tabs`]),
//! bridged to a websocket. Binary frames carry terminal bytes both ways; text
//! frames carry small JSON control messages:
//!
//! - `{"type":"resize","cols":80,"rows":24}` from the screen;
//! - `{"type":"ping"}` from the screen, answered with `{"type":"pong"}`, so a
//!   phone can tell a live link from one iOS left dead.
//!
//! Closing the socket only detaches the screen; the terminal keeps running.
//! When the terminal or tab itself closes, the stream ends with [`ENDED`],
//! which the phone doesn't retry.
//!
//! A new stream from a device to a terminal replaces the one it already had
//! there (closed with [`REPLACED`], which the phone doesn't retry), and a
//! device has at most [`PER_DEVICE`] streams open.

use std::{
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};

use anyhow::Context;
use axum::{
    body::Bytes,
    extract::ws::{CloseFrame, Message, WebSocket},
};
use futures_util::{SinkExt, StreamExt};
use pty_process::Size;
use serde::Deserialize;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    sync::{broadcast, broadcast::error::RecvError, mpsc, oneshot},
};

use crate::{
    events::Event,
    laptop_tabs::{LaptopTabs, ToTab},
    state::AppState,
    store,
};

const PING_EVERY: Duration = Duration::from_secs(20);
pub const SILENT_MAX: Duration = Duration::from_secs(60);
pub const PER_DEVICE: usize = 6;
pub const REPLACED: u16 = 4001;
pub const LOCKED: u16 = 4003;
/// The close code for a stream whose terminal or tab closed: there is
/// nothing to reconnect to.
pub const ENDED: u16 = 4004;
const LOCK_CHECK: Duration = Duration::from_secs(5);

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Target {
    Terminal(u32),
    LaptopTab(u32),
}

struct Open {
    id: u64,
    device: String,
    target: Target,
    end: oneshot::Sender<()>,
}

#[derive(Default)]
pub struct Streams {
    next: AtomicU64,
    open: Mutex<Vec<Open>>,
}

impl Streams {
    fn lock(&self) -> std::sync::MutexGuard<'_, Vec<Open>> {
        self.open
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Returns the stream's id, and what ends it.
    fn add(&self, device: &str, target: Target) -> (u64, oneshot::Receiver<()>) {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let (end, ended) = oneshot::channel();
        let mut open = self.lock();
        let mut replaced = Vec::new();
        let mut index = 0;
        while index < open.len() {
            if open[index].device == device && open[index].target == target {
                replaced.push(open.remove(index));
            } else {
                index += 1;
            }
        }
        while open.iter().filter(|stream| stream.device == device).count() >= PER_DEVICE {
            let oldest = open
                .iter()
                .position(|stream| stream.device == device)
                .expect("counted above");
            replaced.push(open.remove(oldest));
        }
        open.push(Open {
            id,
            device: device.to_owned(),
            target,
            end,
        });
        drop(open);
        for stream in replaced {
            let _ = stream.end.send(());
        }
        (id, ended)
    }

    fn remove(&self, id: u64) {
        self.lock().retain(|stream| stream.id != id);
    }

    #[cfg(test)]
    pub(crate) fn count(&self) -> usize {
        self.lock().len()
    }
}

fn clamp(cols: u16, rows: u16) -> (u16, u16) {
    (cols.clamp(10, 500), rows.clamp(5, 300))
}

enum Output {
    Tmux {
        reader: pty_process::OwnedReadPty,
        buffer: Vec<u8>,
    },
    Tab {
        id: u32,
        tabs: Arc<LaptopTabs>,
        snapshot: Option<Bytes>,
        printed: broadcast::Receiver<Bytes>,
    },
}

impl Output {
    async fn next(&mut self) -> Option<Bytes> {
        match self {
            Self::Tmux { reader, buffer } => match reader.read(buffer).await {
                Ok(0) | Err(_) => None,
                Ok(n) => Some(Bytes::copy_from_slice(&buffer[..n])),
            },
            Self::Tab {
                id,
                tabs,
                snapshot,
                printed,
            } => {
                if let Some(screen) = snapshot.take() {
                    return Some(screen);
                }
                match printed.recv().await {
                    Ok(bytes) => Some(bytes),
                    Err(RecvError::Lagged(_)) => tabs.snapshot(*id),
                    Err(RecvError::Closed) => None,
                }
            }
        }
    }
}

enum Input {
    Tmux {
        writer: pty_process::OwnedWritePty,
        child: tokio::process::Child,
    },
    Tab {
        id: u32,
        viewer: u64,
        tabs: Arc<LaptopTabs>,
        to_tab: mpsc::Sender<ToTab>,
        /// The phone's size, which the tab takes again when the phone types
        /// after the laptop took it back.
        size: (u16, u16),
    },
}

impl Input {
    /// False once the terminal has gone.
    async fn typed(&mut self, bytes: Bytes) -> bool {
        match self {
            Self::Tmux { writer, .. } => writer.write_all(&bytes).await.is_ok(),
            Self::Tab {
                id,
                viewer,
                tabs,
                to_tab,
                size,
            } => {
                let (cols, rows) = *size;
                if tabs.claim(*id, *viewer)
                    && to_tab.send(ToTab::Resize { cols, rows }).await.is_err()
                {
                    return false;
                }
                to_tab.send(ToTab::Input(bytes)).await.is_ok()
            }
        }
    }

    async fn resize(&mut self, cols: u16, rows: u16) -> anyhow::Result<()> {
        let (cols, rows) = clamp(cols, rows);
        match self {
            Self::Tmux { writer, .. } => writer.resize(Size::new(rows, cols))?,
            Self::Tab {
                id,
                viewer,
                tabs,
                to_tab,
                size,
            } => {
                // The same size again is the phone's page settling (its
                // keyboard, its toolbar), not the phone taking the tab back
                // from the laptop.
                if *size == (cols, rows) {
                    return Ok(());
                }
                *size = (cols, rows);
                tabs.claim(*id, *viewer);
                to_tab
                    .send(ToTab::Resize { cols, rows })
                    .await
                    .ok()
                    .context("the tab has closed")?;
            }
        }
        Ok(())
    }

    /// Detaches this screen only: the terminal or tab keeps running, and a
    /// tab gets its laptop size back if this phone had it.
    async fn finish(self) {
        match self {
            Self::Tmux { mut child, .. } => {
                let _ = child.kill().await;
            }
            Self::Tab {
                id,
                viewer,
                tabs,
                to_tab,
                ..
            } => {
                if tabs.release(id, viewer) {
                    let _ = to_tab.send(ToTab::Release).await;
                }
            }
        }
    }
}

async fn open(
    state: &AppState,
    target: Target,
    cols: u16,
    rows: u16,
) -> anyhow::Result<(Output, Input)> {
    match target {
        Target::Terminal(terminal) => {
            let (cols, rows) = clamp(cols, rows);
            let (pty, pts) = pty_process::open()?;
            pty.resize(Size::new(rows, cols))?;
            let child = state.tmux.attach_command(terminal).spawn(pts)?;
            let (reader, writer) = pty.into_split();
            Ok((
                Output::Tmux {
                    reader,
                    buffer: vec![0u8; 16 * 1024],
                },
                Input::Tmux { writer, child },
            ))
        }
        Target::LaptopTab(id) => {
            let tabs = Arc::clone(&state.laptop_tabs);
            let watch = tabs.watch(id).context("the tab has closed")?;
            let mut input = Input::Tab {
                id,
                viewer: watch.viewer,
                tabs: Arc::clone(&tabs),
                to_tab: watch.to_tab,
                // None yet: no size is this one.
                size: (0, 0),
            };
            input.resize(cols, rows).await?;
            Ok((
                Output::Tab {
                    id,
                    tabs,
                    snapshot: Some(watch.snapshot),
                    printed: watch.output,
                },
                input,
            ))
        }
    }
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum Control {
    Resize { cols: u16, rows: u16 },
    Ping,
}

/// Who a stream is for: the device, and the unlock secret of the browser
/// that opened it (if it had one).
pub struct Viewer {
    pub device: String,
    pub unlock: Option<String>,
}

impl Viewer {
    fn is_locked(&self, state: &AppState) -> bool {
        state
            .faceid
            .is_locked(
                &state.store(),
                &self.device,
                self.unlock.as_deref(),
                store::now(),
            )
            .unwrap_or(true)
    }

    /// What the person does on the stream keeps their unlock alive.
    fn active(&self, state: &AppState) {
        state.faceid.touch(self.unlock.as_deref(), store::now());
    }
}

pub async fn bridge(
    socket: WebSocket,
    state: AppState,
    target: Target,
    viewer: Viewer,
    cols: u16,
    rows: u16,
) {
    let (id, replaced) = state.streams.add(&viewer.device, target);
    if let Err(error) = run(socket, &state, target, &viewer, cols, rows, replaced).await {
        tracing::warn!(?target, "terminal stream ended: {error:#}");
    }
    state.streams.remove(id);
}

async fn run(
    socket: WebSocket,
    state: &AppState,
    target: Target,
    viewer: &Viewer,
    cols: u16,
    rows: u16,
    mut replaced: oneshot::Receiver<()>,
) -> anyhow::Result<()> {
    let device_id = viewer.device.as_str();
    let (mut output, mut input) = open(state, target, cols, rows).await?;
    let (mut to_screen, mut from_screen) = socket.split();
    let mut events = state.events.subscribe();
    let mut pings = tokio::time::interval_at(tokio::time::Instant::now() + PING_EVERY, PING_EVERY);
    let mut heard = Instant::now();
    let mut lock_checks =
        tokio::time::interval_at(tokio::time::Instant::now() + LOCK_CHECK, LOCK_CHECK);
    let mut farewell: Option<CloseFrame> = None;

    loop {
        tokio::select! {
            shown = output.next() => match shown {
                None => {
                    farewell = Some(CloseFrame {
                        code: ENDED,
                        reason: "It closed.".into(),
                    });
                    break;
                }
                Some(bytes) => {
                    if to_screen.send(Message::Binary(bytes)).await.is_err() {
                        break;
                    }
                }
            },
            _ = pings.tick() => {
                if heard.elapsed() > SILENT_MAX {
                    break;
                }
                if to_screen.send(Message::Ping(axum::body::Bytes::new())).await.is_err() {
                    break;
                }
            },
            _ = &mut replaced => {
                farewell = Some(CloseFrame {
                    code: REPLACED,
                    reason: "Opened again from this device.".into(),
                });
                break;
            },
            // The check also runs at once when a browser locks on purpose.
            _ = async {
                tokio::select! {
                    _ = lock_checks.tick() => {},
                    () = state.faceid.some_lock() => {},
                }
            } => {
                if viewer.is_locked(state) {
                    farewell = Some(CloseFrame {
                        code: LOCKED,
                        reason: "Airlock locked.".into(),
                    });
                    break;
                }
            },
            incoming = from_screen.next() => {
                // Anything at all from the phone, its pongs included, says
                // it's still there.
                if matches!(incoming, Some(Ok(_))) {
                    heard = Instant::now();
                }
                match incoming {
                    Some(Ok(Message::Binary(bytes))) => {
                        viewer.active(state);
                        if !input.typed(bytes).await {
                            break;
                        }
                    }
                    Some(Ok(Message::Text(text))) => match serde_json::from_str::<Control>(&text) {
                        Ok(Control::Resize { cols, rows }) => {
                            viewer.active(state);
                            input.resize(cols, rows).await?;
                        }
                        Ok(Control::Ping) => {
                            let pong = Message::Text(r#"{"type":"pong"}"#.into());
                            if to_screen.send(pong).await.is_err() {
                                break;
                            }
                        }
                        Err(_) => {}
                    },
                    Some(Ok(Message::Close(_)) | Err(_)) | None => break,
                    Some(Ok(_)) => {}
                }
            },
            event = events.recv() => match event {
                Ok(Event::DeviceRevoked { id }) if id == device_id => break,
                Ok(Event::HubStopping) | Err(RecvError::Closed) => break,
                Err(RecvError::Lagged(_)) => {
                    if !state.store().is_active(device_id).unwrap_or(false) {
                        break;
                    }
                }
                Ok(_) => {}
            },
        }
    }

    input.finish().await;
    let _ = to_screen.send(Message::Close(farewell)).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::laptop_tabs::{LaptopTabs, ToTab};

    #[tokio::test]
    async fn the_same_size_again_leaves_a_tab_with_the_laptop() {
        let tabs = Arc::new(LaptopTabs::default());
        let (id, mut typed) = tabs.open(1, 120, 40);
        let watch = tabs.watch(id).unwrap();
        let mut input = Input::Tab {
            id,
            viewer: watch.viewer,
            tabs: Arc::clone(&tabs),
            to_tab: watch.to_tab,
            size: (0, 0),
        };
        input.resize(40, 20).await.unwrap();
        assert!(tabs.list()[0].on_phone, "the phone's size at once");
        assert_eq!(
            typed.recv().await,
            Some(ToTab::Resize { cols: 40, rows: 20 })
        );

        tabs.laptop_took(id);
        input.resize(40, 20).await.unwrap();
        assert!(!tabs.list()[0].on_phone);
        assert!(typed.try_recv().is_err());

        input.resize(60, 20).await.unwrap();
        assert!(tabs.list()[0].on_phone);
        assert_eq!(
            typed.recv().await,
            Some(ToTab::Resize { cols: 60, rows: 20 })
        );
    }

    #[test]
    fn a_new_stream_replaces_the_one_it_had_and_a_device_is_capped() {
        let streams = Streams::default();
        let (first, mut first_ended) = streams.add("phone", Target::Terminal(1));
        let (_, mut other_ended) = streams.add("phone", Target::Terminal(2));
        let (_, mut laptop_ended) = streams.add("other phone", Target::Terminal(1));
        let (_, mut tab_ended) = streams.add("phone", Target::LaptopTab(1));
        let (_, _again) = streams.add("phone", Target::Terminal(1));
        assert!(first_ended.try_recv().is_ok(), "replaced");
        assert!(other_ended.try_recv().is_err(), "another terminal stays");
        assert!(laptop_ended.try_recv().is_err(), "another device stays");
        assert!(tab_ended.try_recv().is_err(), "a laptop tab stays");
        streams.remove(first);
        assert_eq!(streams.count(), 4);

        let mut kept = Vec::new();
        for terminal in 10..10 + PER_DEVICE as u32 {
            kept.push(streams.add("phone", Target::Terminal(terminal)));
        }
        assert!(
            other_ended.try_recv().is_ok(),
            "the oldest of the device went"
        );
        let phones = streams.count() - 1;
        assert_eq!(phones, PER_DEVICE);
    }
}
