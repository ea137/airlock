//! The window's own terminals: a tmux client in a PTY the app owns, attached
//! to one of Airlock's terminals. What it prints goes to the window as it
//! comes; the window's keys and size come back. Closing one only detaches:
//! the terminal keeps running in tmux, as when the phone leaves it.

use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
};

use airlock_hub::terminals::Tmux;
use pty_process::Size;
use tauri::ipc::{Channel, InvokeResponseBody};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    sync::mpsc,
};

enum Input {
    Keys(Vec<u8>),
    Resize { cols: u16, rows: u16 },
    Close,
}

#[derive(Default)]
pub struct Screens {
    next: AtomicU64,
    open: Arc<Mutex<HashMap<u64, mpsc::UnboundedSender<Input>>>>,
}

fn size(cols: u16, rows: u16) -> Size {
    Size::new(rows.clamp(5, 300), cols.clamp(10, 500))
}

impl Screens {
    pub fn open(
        &self,
        tmux: &Tmux,
        terminal: u32,
        cols: u16,
        rows: u16,
        output: Channel<InvokeResponseBody>,
    ) -> Result<u64, String> {
        self.attach(tmux, terminal, cols, rows, move |bytes| {
            output.send(InvokeResponseBody::Raw(bytes)).is_ok()
        })
    }

    /// Attaches to `terminal` on `tmux`; its output goes to `output` (which
    /// says whether anyone still listens), and an empty message says it
    /// ended. Returns the screen's number.
    pub fn attach(
        &self,
        tmux: &Tmux,
        terminal: u32,
        cols: u16,
        rows: u16,
        output: impl Fn(Vec<u8>) -> bool + Send + 'static,
    ) -> Result<u64, String> {
        let (pty, pts) =
            pty_process::open().map_err(|error| format!("opening a terminal: {error}"))?;
        pty.resize(size(cols, rows))
            .map_err(|error| format!("sizing the terminal: {error}"))?;
        let mut child = tmux
            .attach_command(terminal)
            .spawn(pts)
            .map_err(|error| format!("attaching to the terminal: {error}"))?;
        let (mut reader, mut writer) = pty.into_split();
        let (input, mut inputs) = mpsc::unbounded_channel();
        let id = self.next.fetch_add(1, Ordering::Relaxed) + 1;
        self.lock().insert(id, input);
        let open = self.open.clone();
        tauri::async_runtime::spawn(async move {
            let mut buffer = vec![0u8; 16 * 1024];
            loop {
                tokio::select! {
                    read = reader.read(&mut buffer) => match read {
                        // The tmux client ended: the terminal closed.
                        Ok(0) | Err(_) => break,
                        Ok(n) => {
                            if !output(buffer[..n].to_vec()) {
                                break;
                            }
                        }
                    },
                    input = inputs.recv() => match input {
                        Some(Input::Keys(keys)) => {
                            if writer.write_all(&keys).await.is_err() {
                                break;
                            }
                        }
                        Some(Input::Resize { cols, rows }) => {
                            let _ = writer.resize(size(cols, rows));
                        }
                        Some(Input::Close) | None => break,
                    },
                }
            }
            // Detach this window only; the terminal keeps running in tmux.
            let _ = child.kill().await;
            open.lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .remove(&id);
            output(Vec::new());
        });
        Ok(id)
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<u64, mpsc::UnboundedSender<Input>>> {
        self.open
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn send(&self, screen: u64, input: Input) -> Result<(), String> {
        self.lock()
            .get(&screen)
            .ok_or_else(|| "That terminal isn't open in this window any more.".to_owned())?
            .send(input)
            .map_err(|_| "That terminal has closed.".to_owned())
    }

    pub fn keys(&self, screen: u64, keys: Vec<u8>) -> Result<(), String> {
        self.send(screen, Input::Keys(keys))
    }

    pub fn resize(&self, screen: u64, cols: u16, rows: u16) -> Result<(), String> {
        self.send(screen, Input::Resize { cols, rows })
    }

    /// Detaches; a screen already gone is fine.
    pub fn close(&self, screen: u64) {
        let _ = self.send(screen, Input::Close);
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;

    /// A tmux server of the test's own, with one terminal, gone afterwards.
    struct Scratch {
        socket: String,
    }

    impl Scratch {
        fn new() -> Self {
            let socket = format!("airlock-app-test-{}", std::process::id());
            let made = std::process::Command::new("tmux")
                .args([
                    "-L",
                    &socket,
                    "-f",
                    "/dev/null",
                    "new-session",
                    "-d",
                    "-x",
                    "80",
                    "-y",
                    "24",
                ])
                .env_remove("TMUX")
                .status()
                .unwrap();
            assert!(made.success());
            Self { socket }
        }

        fn first_terminal(&self) -> u32 {
            let out = std::process::Command::new("tmux")
                .args(["-L", &self.socket, "display-message", "-p", "#{session_id}"])
                .env_remove("TMUX")
                .output()
                .unwrap();
            String::from_utf8_lossy(&out.stdout)
                .trim()
                .trim_start_matches('$')
                .parse()
                .unwrap()
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::process::Command::new("tmux")
                .args(["-L", &self.socket, "kill-server"])
                .status();
        }
    }

    #[tokio::test]
    async fn a_terminal_opens_in_the_window_and_takes_its_keys() {
        let scratch = Scratch::new();
        let tmux = Tmux::new(scratch.socket.clone(), "/dev/null");
        let screens = Screens::default();
        let seen = Arc::new(Mutex::new(Vec::<u8>::new()));
        let sink = seen.clone();
        let screen = screens
            .attach(&tmux, scratch.first_terminal(), 80, 24, move |bytes| {
                sink.lock().unwrap().extend(bytes);
                true
            })
            .unwrap();
        screens
            .keys(screen, b"echo window-$((6*7))\r".to_vec())
            .unwrap();
        let mut shown = String::new();
        for _ in 0..80 {
            tokio::time::sleep(Duration::from_millis(100)).await;
            shown = String::from_utf8_lossy(&seen.lock().unwrap()).into_owned();
            if shown.contains("window-42") {
                break;
            }
        }
        assert!(shown.contains("window-42"), "{shown}");
        screens.resize(screen, 100, 30).unwrap();

        // Closing detaches the window; the terminal itself keeps running.
        screens.close(screen);
        for _ in 0..50 {
            if screens.keys(screen, b"x".to_vec()).is_err() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        assert!(
            screens.keys(screen, b"x".to_vec()).is_err(),
            "the screen is gone"
        );
        let alive = std::process::Command::new("tmux")
            .args(["-L", &scratch.socket, "has-session"])
            .status()
            .unwrap();
        assert!(alive.success(), "the terminal is still there");
    }
}
