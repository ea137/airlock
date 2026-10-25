//! `airlock tab`: a terminal tab's shell, shared with the phone. It runs
//! your shell in a PTY of its own and passes everything through to the
//! terminal it runs in, unchanged, so the tab looks and works as before:
//! its scrollback, selection and title are the terminal app's. It mirrors
//! the tab to the hub over the admin socket ([`crate::laptop_tabs`]), and
//! types what the phone types. Whoever typed last sets the shell's size.
//!
//! The hub never holds the tab up: without the hub the tab works alone and
//! connects when it can, and a hub that falls behind is let go of rather
//! than waited for. If anything goes wrong before the shell starts, it
//! becomes the shell itself, so a tab always opens.
//!
//! The terminal app still knows when something runs in the tab. GNOME
//! Terminal asks before closing a tab whose foreground process group isn't
//! the process it started, which is this one. So while a program runs in
//! the shell, a helper in a group of its own holds the keyboard ([`keyboard`])
//! and passes the keys on, and the terminal asks as before; back at the
//! prompt, the keyboard comes back here. One of the two reads at a time,
//! and each hand-over is acknowledged, so no key is lost or reordered; if
//! the helper fails, the tab goes on without it.
//!
//! `airlock tabs install` starts it from `~/.bashrc` for GNOME Terminal's
//! tabs, in a marked block that `airlock tabs remove` takes out.

use std::{
    ffi::OsString,
    os::{
        fd::{AsRawFd, RawFd},
        unix::process::CommandExt,
    },
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

use axum::body::Bytes;
use futures_util::{SinkExt, StreamExt};
use pty_process::Size;
use serde::Deserialize;
use serde_json::json;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt, Interest, unix::AsyncFd},
    net::UnixStream,
    process::{ChildStderr, ChildStdout},
    signal::unix::{SignalKind, signal},
    sync::mpsc,
};
use tokio_tungstenite::tungstenite::Message;

const CONNECT_LIMIT: Duration = Duration::from_millis(800);
/// How often the tab looks at whether a program runs in the shell.
const CHECK_EVERY: Duration = Duration::from_millis(250);
const HANDOVER_LIMIT: Duration = Duration::from_secs(1);
/// How often a tab without the hub tries again.
const RETRY_EVERY: Duration = Duration::from_secs(10);
/// How many chunks of output may wait for the hub before it is let go.
const BACKLOG: usize = 512;
/// Set in the shell's environment, so it doesn't start another.
pub const MARK: &str = "AIRLOCK_TAB";

/// `(cols, rows)`.
fn window_size(fd: i32) -> Option<(u16, u16)> {
    // SAFETY: TIOCGWINSZ fills the zeroed winsize for a terminal fd, and
    // fails harmlessly on anything else.
    let mut size: libc::winsize = unsafe { std::mem::zeroed() };
    let ok = unsafe { libc::ioctl(fd, libc::TIOCGWINSZ, &mut size) } == 0;
    (ok && size.ws_col > 0 && size.ws_row > 0).then_some((size.ws_col, size.ws_row))
}

/// The terminal in raw mode until dropped: every key goes through as it
/// is, Ctrl+C included, for the shell's own terminal to make sense of.
struct Raw {
    fd: i32,
    saved: libc::termios,
}

impl Raw {
    fn enter(fd: i32) -> Option<Self> {
        // SAFETY: tcgetattr fills the zeroed termios for a terminal fd;
        // cfmakeraw and tcsetattr take a valid one.
        unsafe {
            let mut saved: libc::termios = std::mem::zeroed();
            if libc::tcgetattr(fd, &mut saved) != 0 {
                return None;
            }
            let mut raw = saved;
            libc::cfmakeraw(&mut raw);
            if libc::tcsetattr(fd, libc::TCSANOW, &raw) != 0 {
                return None;
            }
            Some(Self { fd, saved })
        }
    }
}

impl Drop for Raw {
    fn drop(&mut self) {
        // SAFETY: puts back the settings read in `enter`.
        unsafe {
            libc::tcsetattr(self.fd, libc::TCSANOW, &self.saved);
        }
    }
}

/// One of this process's own descriptors (the terminal, 0 or 1), lent to an
/// `AsyncFd` without being closed with it.
struct Lent(RawFd);

impl AsRawFd for Lent {
    fn as_raw_fd(&self) -> RawFd {
        self.0
    }
}

/// Puts `fd`'s file in non-blocking mode, or back. The terminal is read
/// through readiness, never a blocking read, so it can stop reading at any
/// moment when the keyboard is handed over.
fn nonblocking(fd: RawFd, on: bool) -> bool {
    // SAFETY: F_GETFL and F_SETFL on a descriptor this process holds.
    unsafe {
        let flags = libc::fcntl(fd, libc::F_GETFL);
        if flags < 0 {
            return false;
        }
        let flags = if on {
            flags | libc::O_NONBLOCK
        } else {
            flags & !libc::O_NONBLOCK
        };
        libc::fcntl(fd, libc::F_SETFL, flags) == 0
    }
}

async fn read_some(fd: &AsyncFd<Lent>, buffer: &mut [u8]) -> std::io::Result<usize> {
    loop {
        let mut ready = fd.readable().await?;
        // SAFETY: reads into a buffer of the given length.
        let read = ready.try_io(|lent| {
            let n =
                unsafe { libc::read(lent.get_ref().0, buffer.as_mut_ptr().cast(), buffer.len()) };
            if n < 0 {
                Err(std::io::Error::last_os_error())
            } else {
                Ok(n as usize)
            }
        });
        if let Ok(result) = read {
            return result;
        }
    }
}

async fn write_all(fd: &AsyncFd<Lent>, mut bytes: &[u8]) -> std::io::Result<()> {
    while !bytes.is_empty() {
        let mut ready = fd.writable().await?;
        // SAFETY: writes from a buffer of the given length.
        let written = ready.try_io(|lent| {
            let n = unsafe { libc::write(lent.get_ref().0, bytes.as_ptr().cast(), bytes.len()) };
            if n < 0 {
                Err(std::io::Error::last_os_error())
            } else {
                Ok(n as usize)
            }
        });
        match written {
            Ok(Ok(0)) => return Err(std::io::ErrorKind::WriteZero.into()),
            Ok(Ok(n)) => bytes = &bytes[n..],
            Ok(Err(error)) => return Err(error),
            Err(_would_block) => {}
        }
    }
    Ok(())
}

/// Ignores the signals that stop a process using its terminal from the
/// background: handing the keyboard back means changing the terminal's
/// foreground from there.
fn ignore_background_stops() {
    // SAFETY: setting two signals to be ignored.
    unsafe {
        libc::signal(libc::SIGTTOU, libc::SIG_IGN);
        libc::signal(libc::SIGTTIN, libc::SIG_IGN);
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Holder {
    Us,
    /// Handed over, or being handed back, since then.
    Moving(Instant),
    Helper,
}

/// The keyboard helper ([`keyboard`]), in a process group of its own.
struct Helper {
    /// Killed when dropped.
    _child: tokio::process::Child,
    pid: i32,
    /// It said it is ready for signals.
    ready: bool,
}

impl Helper {
    /// Starts it: itself, the keys it reads, and its acknowledgements (`r`
    /// ready, `s` started reading, `k` stopped).
    fn start() -> Option<(Self, ChildStdout, ChildStderr)> {
        let mut child = tokio::process::Command::new(std::env::current_exe().ok()?)
            .arg("tab-keyboard")
            .arg0("airlock-tab-busy")
            .process_group(0)
            .stdin(std::process::Stdio::inherit())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .ok()?;
        let pid = child.id()? as i32;
        let keys = child.stdout.take()?;
        let acks = child.stderr.take()?;
        Some((
            Self {
                _child: child,
                pid,
                ready: false,
            },
            keys,
            acks,
        ))
    }
}

fn signal_helper(pid: i32, signal: i32) {
    // SAFETY: kill with a signal number, to a child not yet reaped.
    unsafe {
        libc::kill(pid, signal);
    }
}

fn watch(fd: RawFd, interest: Interest) -> Option<AsyncFd<Lent>> {
    // SAFETY: 0 and 1 stay open for as long as this process runs, so the
    // descriptor outlives the AsyncFd watching it.
    unsafe { AsyncFd::register_with_interest(Lent(fd), interest) }.ok()
}

fn foreground(group: i32) -> bool {
    // SAFETY: tcsetpgrp on this process's controlling terminal.
    unsafe { libc::tcsetpgrp(0, group) == 0 }
}

/// Whether a program runs in the foreground of the shell's terminal, the
/// PTY whose master is `master`, rather than the shell `shell` itself.
fn program_runs(master: RawFd, shell: i32) -> bool {
    // SAFETY: tcgetpgrp on a PTY master this process holds.
    let group = unsafe { libc::tcgetpgrp(master) };
    group > 0 && group != shell
}

/// The keyboard helper, run as `airlock tab-keyboard` by [`run`]: once
/// ready it says `r`; on SIGUSR1 it reads the terminal and passes the keys
/// on, saying `s`; on SIGUSR2 it stops, saying `k`. It passes window
/// resizes, which go to the terminal's foreground, back to the tab.
pub async fn keyboard() -> i32 {
    ignore_background_stops();
    let (Ok(mut start), Ok(mut stop), Ok(mut resized)) = (
        signal(SignalKind::user_defined1()),
        signal(SignalKind::user_defined2()),
        signal(SignalKind::window_change()),
    ) else {
        return 1;
    };
    if !nonblocking(0, true) {
        return 1;
    }
    let Some(terminal) = watch(0, Interest::READABLE) else {
        return 1;
    };
    let mut keys = tokio::io::stdout();
    let mut acks = tokio::io::stderr();
    let ack = async |acks: &mut tokio::io::Stderr, what: u8| {
        acks.write_all(&[what]).await.is_ok() && acks.flush().await.is_ok()
    };
    if !ack(&mut acks, b'r').await {
        return 0;
    }
    let mut reading = false;
    let mut buffer = [0u8; 4096];
    loop {
        tokio::select! {
            Some(()) = start.recv() => {
                reading = true;
                if !ack(&mut acks, b's').await {
                    return 0;
                }
            },
            Some(()) = stop.recv() => {
                reading = false;
                if !ack(&mut acks, b'k').await {
                    return 0;
                }
            },
            Some(()) = resized.recv() => {
                // SAFETY: signals the tab that started this helper.
                unsafe {
                    libc::kill(libc::getppid(), libc::SIGWINCH);
                }
            },
            read = read_some(&terminal, &mut buffer), if reading => match read {
                Ok(0) => return 0,
                Ok(n) => {
                    if keys.write_all(&buffer[..n]).await.is_err() || keys.flush().await.is_err() {
                        return 0;
                    }
                }
                // Not the terminal's foreground: wait to be told again.
                Err(error) if error.raw_os_error() == Some(libc::EIO) => reading = false,
                Err(_) => return 1,
            },
        }
    }
}

#[derive(Debug, PartialEq)]
enum FromHub {
    Input(Bytes),
    Resize { cols: u16, rows: u16 },
    Release,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum Control {
    Resize { cols: u16, rows: u16 },
    Release,
}

struct Link {
    to_hub: mpsc::Sender<Message>,
    from_hub: mpsc::Receiver<FromHub>,
}

impl Link {
    async fn connect(admin: &Path, pid: u32, (cols, rows): (u16, u16)) -> Option<Self> {
        let open = async {
            let stream = UnixStream::connect(admin).await.ok()?;
            let (socket, _) =
                tokio_tungstenite::client_async("ws://airlock/laptop-tabs/connect", stream)
                    .await
                    .ok()?;
            Some(socket)
        };
        let socket = tokio::time::timeout(CONNECT_LIMIT, open).await.ok()??;
        let (mut sink, mut stream) = socket.split();
        let hello = json!({"type": "hello", "pid": pid, "cols": cols, "rows": rows});
        sink.send(Message::Text(hello.to_string().into()))
            .await
            .ok()?;
        let (to_hub, mut outgoing) = mpsc::channel::<Message>(BACKLOG);
        tokio::spawn(async move {
            while let Some(message) = outgoing.recv().await {
                if sink.send(message).await.is_err() {
                    return;
                }
            }
            let _ = sink.close().await;
        });
        let (incoming, from_hub) = mpsc::channel(64);
        tokio::spawn(async move {
            while let Some(Ok(message)) = stream.next().await {
                let heard = match message {
                    Message::Binary(bytes) => FromHub::Input(bytes),
                    Message::Text(text) => match serde_json::from_str::<Control>(&text) {
                        Ok(Control::Resize { cols, rows }) => FromHub::Resize { cols, rows },
                        Ok(Control::Release) => FromHub::Release,
                        Err(_) => continue,
                    },
                    Message::Close(_) => return,
                    _ => continue,
                };
                if incoming.send(heard).await.is_err() {
                    return;
                }
            }
        });
        Some(Self { to_hub, from_hub })
    }

    /// False once the hub is gone or has fallen too far behind to keep.
    fn printed(&self, bytes: &[u8]) -> bool {
        self.to_hub
            .try_send(Message::Binary(Bytes::copy_from_slice(bytes)))
            .is_ok()
    }

    fn says(&self, message: serde_json::Value) -> bool {
        self.to_hub
            .try_send(Message::Text(message.to_string().into()))
            .is_ok()
    }
}

fn shell() -> OsString {
    std::env::var_os("SHELL")
        .filter(|shell| !shell.is_empty())
        .unwrap_or_else(|| "/bin/bash".into())
}

/// Becomes the shell itself, unshared: what a tab gets when the
/// pass-through can't start.
fn just_the_shell() -> i32 {
    let error = std::process::Command::new(shell()).env(MARK, "off").exec();
    eprintln!("airlock tab: couldn't start your shell: {error}");
    1
}

/// Runs the tab, sharing it through the hub's admin socket at `admin`.
/// Returns the shell's exit code, for the process to exit with.
pub async fn run(admin: PathBuf) -> i32 {
    let laptop = window_size(0).unwrap_or((80, 24));
    let Ok((pty, pts)) = pty_process::open() else {
        return just_the_shell();
    };
    if pty.resize(Size::new(laptop.1, laptop.0)).is_err() {
        return just_the_shell();
    }
    let Ok(mut child) = pty_process::Command::new(shell()).env(MARK, "1").spawn(pts) else {
        return just_the_shell();
    };
    let Some(pid) = child.id() else {
        return just_the_shell();
    };
    let master = pty.as_raw_fd();
    let shell_pid = pid as i32;
    let raw = Raw::enter(0);
    ignore_background_stops();
    let terminal = nonblocking(0, true)
        .then(|| Some((watch(0, Interest::READABLE)?, watch(1, Interest::WRITABLE)?)))
        .flatten();
    let Some((terminal_in, terminal_out)) = terminal else {
        nonblocking(0, false);
        drop(raw);
        let _ = child.kill().await;
        return just_the_shell();
    };
    // SAFETY: getpgrp and tcgetpgrp only read.
    let us = unsafe { libc::getpgrp() };
    let started = (unsafe { libc::tcgetpgrp(0) } == us)
        .then(Helper::start)
        .flatten();
    let (mut helper, mut helper_keys, mut helper_acks) = match started {
        Some((helper, keys, acks)) => (Some(helper), Some(keys), Some(acks)),
        None => (None, None, None),
    };
    let mut holder = Holder::Us;
    let (mut from_shell, mut to_shell) = pty.into_split();
    let mut resized = signal(SignalKind::window_change()).ok();
    let mut link = Link::connect(&admin, pid, laptop).await;
    let mut retry =
        tokio::time::interval_at(tokio::time::Instant::now() + RETRY_EVERY, RETRY_EVERY);
    let mut checks = tokio::time::interval(CHECK_EVERY);
    let mut laptop = laptop;
    // The phone's size, while a phone has the shell.
    let mut phone: Option<(u16, u16)> = None;
    let mut printed = vec![0u8; 16 * 1024];
    let mut typed = vec![0u8; 4 * 1024];
    let mut keyed = vec![0u8; 4 * 1024];

    // Sets the shell's size and tells the hub, which keeps its screen at it.
    let size =
        |to_shell: &pty_process::OwnedWritePty, link: &Option<Link>, (cols, rows): (u16, u16)| {
            let _ = to_shell.resize(Size::new(rows, cols));
            if let Some(link) = link {
                link.says(json!({"type": "size", "cols": cols, "rows": rows}));
            }
        };
    // Without the helper, the keyboard is ours again, for good.
    macro_rules! give_up {
        () => {{
            foreground(us);
            holder = Holder::Us;
            helper = None;
            helper_keys = None;
            helper_acks = None;
        }};
    }

    loop {
        // Typing on the laptop takes the size back from a phone.
        macro_rules! laptop_typed {
            ($bytes:expr) => {{
                if phone.take().is_some() {
                    size(&to_shell, &link, laptop);
                    if let Some(link) = &link {
                        link.says(json!({"type": "laptop"}));
                    }
                }
                to_shell.write_all($bytes).await.is_ok()
            }};
        }
        tokio::select! {
            read = from_shell.read(&mut printed) => match read {
                // The shell is gone.
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if write_all(&terminal_out, &printed[..n]).await.is_err() {
                        break;
                    }
                    if link.as_ref().is_some_and(|link| !link.printed(&printed[..n])) {
                        link = None;
                    }
                }
            },
            read = read_some(&terminal_in, &mut typed), if holder == Holder::Us => match read {
                // The terminal is gone.
                Ok(0) => break,
                Ok(n) => {
                    if !laptop_typed!(&typed[..n]) {
                        break;
                    }
                }
                Err(error) if error.raw_os_error() == Some(libc::EIO) => break,
                Err(_) => break,
            },
            // Keys the helper read while a program runs.
            read = async {
                match helper_keys.as_mut() {
                    Some(keys) => keys.read(&mut keyed).await,
                    None => std::future::pending().await,
                }
            } => match read {
                Ok(n) if n > 0 => {
                    if !laptop_typed!(&keyed[..n]) {
                        break;
                    }
                }
                _ => give_up!(),
            },
            ack = async {
                match helper_acks.as_mut() {
                    Some(acks) => acks.read_u8().await,
                    None => std::future::pending().await,
                }
            } => match ack {
                Ok(b'r') => {
                    if let Some(helper) = helper.as_mut() {
                        helper.ready = true;
                    }
                }
                Ok(b's') => holder = Holder::Helper,
                Ok(b'k') => {
                    foreground(us);
                    holder = Holder::Us;
                }
                _ => give_up!(),
            },
            _ = checks.tick() => {
                let ready = helper.as_ref().filter(|helper| helper.ready).map(|helper| helper.pid);
                match (holder, ready) {
                    (Holder::Moving(since), _) if since.elapsed() > HANDOVER_LIMIT => give_up!(),
                    // A program started: the helper holds the keyboard, so
                    // the terminal sees it running.
                    (Holder::Us, Some(pid)) if program_runs(master, shell_pid) => {
                        if foreground(pid) {
                            signal_helper(pid, libc::SIGUSR1);
                            holder = Holder::Moving(Instant::now());
                        }
                    }
                    // Back at the prompt: the keyboard comes back.
                    (Holder::Helper, Some(pid)) if !program_runs(master, shell_pid) => {
                        signal_helper(pid, libc::SIGUSR2);
                        holder = Holder::Moving(Instant::now());
                    }
                    _ => {}
                }
            },
            Some(()) = async {
                match resized.as_mut() {
                    Some(resized) => resized.recv().await,
                    None => std::future::pending().await,
                }
            } => {
                if let Some(now) = window_size(0) {
                    laptop = now;
                    if phone.is_none() {
                        size(&to_shell, &link, laptop);
                    }
                }
            },
            heard = async {
                match link.as_mut() {
                    Some(link) => link.from_hub.recv().await,
                    None => std::future::pending().await,
                }
            } => match heard {
                Some(FromHub::Input(bytes)) => {
                    if to_shell.write_all(&bytes).await.is_err() {
                        break;
                    }
                }
                Some(FromHub::Resize { cols, rows }) => {
                    phone = Some((cols, rows));
                    size(&to_shell, &link, (cols, rows));
                }
                Some(FromHub::Release) => {
                    if phone.take().is_some() {
                        size(&to_shell, &link, laptop);
                    }
                }
                // The hub went away: the tab is the laptop's alone.
                None => {
                    link = None;
                    if phone.take().is_some() {
                        size(&to_shell, &link, laptop);
                    }
                }
            },
            // Without a hub, no phone has the size: the laptop's goes.
            _ = retry.tick(), if link.is_none() => {
                link = Link::connect(&admin, pid, laptop).await;
            },
        }
    }

    drop(helper);
    foreground(us);
    nonblocking(0, false);
    drop(raw);
    match tokio::time::timeout(Duration::from_secs(1), child.wait()).await {
        Ok(Ok(status)) => status.code().unwrap_or_else(|| {
            128 + std::os::unix::process::ExitStatusExt::signal(&status).unwrap_or(1)
        }),
        _ => 0,
    }
}

/// The marked block in `~/.bashrc` that starts [`run`] for GNOME Terminal's
/// tabs, with `airlock` at `binary`. It comes first in the file, so the
/// tab's first shell does as little as it can before it hands over.
pub fn bashrc_block(binary: &Path) -> String {
    let binary = binary.display().to_string().replace('\'', r"'\''");
    format!(
        "{START}
# Shows each new GNOME Terminal tab on your phone, as it is. `airlock tabs remove` takes this out.
if [[ $- == *i* && -n \"$GNOME_TERMINAL_SCREEN\" && -z \"${MARK}\" && -x '{binary}' ]]; then
  exec '{binary}' tab
fi
{END}
"
    )
}

const START: &str = "# >>> airlock >>>";
const END: &str = "# <<< airlock <<<";

pub fn has_block(bashrc: &str) -> bool {
    bashrc.contains(START)
}

pub fn without_block(bashrc: &str) -> String {
    let Some(start) = bashrc.find(START) else {
        return bashrc.to_owned();
    };
    let Some(end) = bashrc[start..].find(END).map(|end| start + end + END.len()) else {
        return bashrc.to_owned();
    };
    let rest = bashrc[end..].strip_prefix('\n').unwrap_or(&bashrc[end..]);
    format!("{}{rest}", &bashrc[..start])
}

pub fn with_block(bashrc: &str, binary: &Path) -> String {
    format!("{}{}", bashrc_block(binary), without_block(bashrc))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_block_goes_first_once_and_comes_out_clean() {
        let binary = Path::new("/home/you/.local/bin/airlock");
        let mine = "# my settings\nalias ll='ls -l'\n";
        let added = with_block(mine, binary);
        assert!(added.starts_with(START), "{added}");
        assert!(added.ends_with(mine), "the rest is kept as it was: {added}");
        assert!(added.contains("exec '/home/you/.local/bin/airlock' tab"));
        assert!(added.contains("GNOME_TERMINAL_SCREEN"));
        assert!(has_block(&added));
        // Added again (a new binary path): still one block.
        let again = with_block(&added, Path::new("/opt/airlock"));
        assert_eq!(again.matches(START).count(), 1, "{again}");
        assert!(again.contains("exec '/opt/airlock' tab"));
        assert_eq!(without_block(&again), mine);
        assert!(!has_block(mine));
        assert_eq!(without_block(mine), mine);
    }

    #[test]
    fn a_quote_in_the_path_stays_one_word() {
        let block = bashrc_block(Path::new("/home/o'neil/bin/airlock"));
        assert!(
            block.contains(r"exec '/home/o'\''neil/bin/airlock' tab"),
            "{block}"
        );
    }
}
