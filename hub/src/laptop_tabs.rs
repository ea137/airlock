//! Tabs of the laptop's own terminal app (GNOME Terminal), on the phone as
//! they are. A tab's shell runs inside `airlock tab` ([`crate::tab`]): a
//! pass-through that hands everything to the terminal unchanged and mirrors
//! it to the hub over the admin socket. The hub keeps each tab's screen (a
//! [`vt100`] parser), so a phone opening one sees what is there, and the
//! phone's typing goes back into the tab. Whoever typed last sets the tab's
//! size, as tmux does: the phone's while you use it there, the laptop's
//! again once you type on the laptop.

use std::{
    collections::HashMap,
    io::Write as _,
    sync::{
        Mutex, MutexGuard,
        atomic::{AtomicU32, AtomicU64, Ordering},
    },
};

use axum::{
    Extension, Json, Router,
    body::Bytes,
    extract::{
        Path as UrlPath, Query, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::sync::{broadcast, mpsc};

use crate::{
    attach::{self, Target},
    claude,
    events::Event,
    faceid,
    phone::{Paired, read_cookie, unpaired},
    state::AppState,
    store,
};

/// How many chunks of output a slow phone may fall behind before it is
/// sent the whole screen again.
const OUTPUT_BACKLOG: usize = 256;
const TYPED_BACKLOG: usize = 64;

#[derive(Debug, PartialEq)]
pub enum ToTab {
    Input(Bytes),
    Resize { cols: u16, rows: u16 },
    /// No phone has the tab's size any more: back to the laptop's.
    Release,
}

#[derive(Default)]
struct Title(Option<String>);

impl vt100::Callbacks for Title {
    fn set_window_title(&mut self, _: &mut vt100::Screen, title: &[u8]) {
        let title: String = String::from_utf8_lossy(title)
            .chars()
            .filter(|c| !c.is_control())
            .take(120)
            .collect();
        self.0 = Some(title).filter(|title| !title.trim().is_empty());
    }
}

struct Tab {
    /// Its shell's pid.
    pid: i32,
    opened_at: i64,
    active_at: i64,
    screen: vt100::Parser<Title>,
    output: broadcast::Sender<Bytes>,
    to_tab: mpsc::Sender<ToTab>,
    /// The phone stream whose size the tab has now, if a phone's.
    sized_by: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct TabView {
    pub id: u32,
    pub title: Option<String>,
    pub folder: String,
    pub command: String,
    pub opened_at: i64,
    pub active_at: i64,
    /// A phone has its size now.
    pub on_phone: bool,
}

pub struct Watch {
    pub viewer: u64,
    pub snapshot: Bytes,
    pub output: broadcast::Receiver<Bytes>,
    pub to_tab: mpsc::Sender<ToTab>,
}

#[derive(Default)]
pub struct LaptopTabs {
    next: AtomicU32,
    next_viewer: AtomicU64,
    tabs: Mutex<HashMap<u32, Tab>>,
}

impl LaptopTabs {
    fn lock(&self) -> MutexGuard<'_, HashMap<u32, Tab>> {
        self.tabs
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Returns the tab's id, and what the hub sends its pass-through.
    pub fn open(&self, pid: i32, cols: u16, rows: u16) -> (u32, mpsc::Receiver<ToTab>) {
        let id = self.next.fetch_add(1, Ordering::Relaxed) + 1;
        let (to_tab, typed) = mpsc::channel(TYPED_BACKLOG);
        let now = store::now();
        let (rows, cols) = (rows.clamp(2, 500), cols.clamp(2, 1000));
        self.lock().insert(
            id,
            Tab {
                pid,
                opened_at: now,
                active_at: now,
                screen: vt100::Parser::new_with_callbacks(rows, cols, 0, Title::default()),
                output: broadcast::channel(OUTPUT_BACKLOG).0,
                to_tab,
                sized_by: None,
            },
        );
        (id, typed)
    }

    pub fn printed(&self, id: u32, bytes: Bytes) {
        if let Some(tab) = self.lock().get_mut(&id) {
            tab.screen.process(&bytes);
            tab.active_at = store::now();
            // Nobody watching is fine.
            let _ = tab.output.send(bytes);
        }
    }

    /// While a phone has the tab, the screen the hub keeps stays as wide as
    /// it was: narrowing it would cut every line
    /// past the phone's width, and a phone opening the tab again would get
    /// them cut. Wider is harmless, since programs draw within the width
    /// they were given; the rows have to match, as they move by them.
    pub fn sized(&self, id: u32, cols: u16, rows: u16) {
        if let Some(tab) = self.lock().get_mut(&id) {
            let (_, kept) = tab.screen.screen().size();
            let cols = if tab.sized_by.is_some() {
                cols.max(kept)
            } else {
                cols
            };
            tab.screen
                .screen_mut()
                .set_size(rows.clamp(2, 500), cols.clamp(2, 1000));
        }
    }

    pub fn laptop_took(&self, id: u32) {
        if let Some(tab) = self.lock().get_mut(&id) {
            tab.sized_by = None;
        }
    }

    pub fn close(&self, id: u32) {
        self.lock().remove(&id);
    }

    pub fn exists(&self, id: u32) -> bool {
        self.lock().contains_key(&id)
    }

    pub fn list(&self) -> Vec<TabView> {
        let mut views: Vec<TabView> = self
            .lock()
            .iter()
            .map(|(&id, tab)| TabView {
                id,
                title: tab.screen.callbacks().0.clone(),
                folder: std::fs::read_link(format!("/proc/{}/cwd", tab.pid))
                    .map(|path| path.to_string_lossy().into_owned())
                    .unwrap_or_default(),
                command: foreground(tab.pid),
                opened_at: tab.opened_at,
                active_at: tab.active_at,
                on_phone: tab.sized_by.is_some(),
            })
            .collect();
        views.sort_by_key(|tab| (tab.opened_at, tab.id));
        views
    }

    /// The tab whose shell `pid` is, or runs under.
    pub fn holding(&self, pid: i32) -> Option<u32> {
        let shells: HashMap<i32, u32> =
            self.lock().iter().map(|(&id, tab)| (tab.pid, id)).collect();
        let mut pid = pid;
        for _ in 0..32 {
            if let Some(&id) = shells.get(&pid) {
                return Some(id);
            }
            pid = parent(pid)?;
        }
        None
    }

    pub fn text(&self, id: u32) -> Option<String> {
        self.lock()
            .get(&id)
            .map(|tab| tab.screen.screen().contents())
    }

    /// The screen with its colours, and its width and height.
    pub fn in_colour(&self, id: u32) -> Option<(String, u32, u32)> {
        let tabs = self.lock();
        let screen = tabs.get(&id)?.screen.screen();
        let (rows, cols) = screen.size();
        Some((in_colour(screen), u32::from(cols), u32::from(rows)))
    }

    /// It doesn't take the tab's size: Work types a key or an answer, it
    /// doesn't show the tab at the phone's size.
    pub async fn type_bytes(&self, id: u32, bytes: Bytes) -> anyhow::Result<()> {
        let to_tab = self
            .lock()
            .get(&id)
            .map(|tab| tab.to_tab.clone())
            .ok_or_else(|| anyhow::anyhow!("Its tab has closed."))?;
        to_tab
            .send(ToTab::Input(bytes))
            .await
            .map_err(|_| anyhow::anyhow!("Its tab has closed."))
    }

    pub async fn press(&self, id: u32, keys: &[&str]) -> anyhow::Result<()> {
        let application = self
            .lock()
            .get(&id)
            .is_some_and(|tab| tab.screen.screen().application_cursor());
        let mut bytes = Vec::new();
        for key in keys {
            let pressed = key_bytes(key, application)
                .ok_or_else(|| anyhow::anyhow!("There's no {key} key."))?;
            bytes.extend_from_slice(pressed);
        }
        self.type_bytes(id, Bytes::from(bytes)).await
    }

    pub fn watch(&self, id: u32) -> Option<Watch> {
        let tabs = self.lock();
        let tab = tabs.get(&id)?;
        Some(Watch {
            viewer: self.next_viewer.fetch_add(1, Ordering::Relaxed) + 1,
            snapshot: Bytes::from(snapshot(tab.screen.screen())),
            output: tab.output.subscribe(),
            to_tab: tab.to_tab.clone(),
        })
    }

    pub fn snapshot(&self, id: u32) -> Option<Bytes> {
        self.lock()
            .get(&id)
            .map(|tab| Bytes::from(snapshot(tab.screen.screen())))
    }

    /// Returns whether `viewer` didn't have the size yet, so it has to go to
    /// the tab.
    pub fn claim(&self, id: u32, viewer: u64) -> bool {
        match self.lock().get_mut(&id) {
            Some(tab) => tab.sized_by.replace(viewer) != Some(viewer),
            None => false,
        }
    }

    /// Returns whether `viewer` had the tab's size, which then goes back to
    /// the laptop's.
    pub fn release(&self, id: u32, viewer: u64) -> bool {
        match self.lock().get_mut(&id) {
            Some(tab) if tab.sized_by == Some(viewer) => {
                tab.sized_by = None;
                true
            }
            _ => false,
        }
    }
}

fn parent(pid: i32) -> Option<i32> {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    stat.rsplit_once(')')?
        .1
        .split_whitespace()
        .nth(1)?
        .parse()
        .ok()
        .filter(|parent| *parent > 1)
}

/// `claude` for Claude Code, whatever its binary is called.
fn foreground(shell: i32) -> String {
    let in_front = std::fs::read_to_string(format!("/proc/{shell}/stat"))
        .ok()
        .and_then(|stat| {
            // After the name: state, ppid, pgrp, session, tty, tpgid.
            stat.rsplit_once(')')?
                .1
                .split_whitespace()
                .nth(5)?
                .parse::<i32>()
                .ok()
        })
        .filter(|pgrp| *pgrp > 0)
        .unwrap_or(shell);
    if claude::is_claude(in_front) {
        return "claude".to_owned();
    }
    std::fs::read_to_string(format!("/proc/{in_front}/comm"))
        .map(|name| name.trim().to_owned())
        .unwrap_or_default()
}

fn color(out: &mut Vec<u8>, color: vt100::Color, fg: bool) {
    let (base, bright, extended) = if fg { (30, 90, 38) } else { (40, 100, 48) };
    let _ = match color {
        vt100::Color::Default => write!(out, ";{}", extended + 1),
        vt100::Color::Idx(n) if n < 8 => write!(out, ";{}", base + n),
        vt100::Color::Idx(n) if n < 16 => write!(out, ";{}", bright + n - 8),
        vt100::Color::Idx(n) => write!(out, ";{extended};5;{n}"),
        vt100::Color::Rgb(r, g, b) => write!(out, ";{extended};2;{r};{g};{b}"),
    };
}

#[derive(Clone, Copy, PartialEq)]
struct Pen {
    fg: vt100::Color,
    bg: vt100::Color,
    /// Bold, dim, italic, underline and inverse.
    modes: [bool; 5],
}

impl Pen {
    fn of(cell: &vt100::Cell) -> Self {
        Self {
            fg: cell.fgcolor(),
            bg: cell.bgcolor(),
            modes: [
                cell.bold(),
                cell.dim(),
                cell.italic(),
                cell.underline(),
                cell.inverse(),
            ],
        }
    }

    fn write(&self, out: &mut Vec<u8>) {
        out.extend_from_slice(b"\x1b[0");
        for (on, code) in self.modes.iter().zip([1, 2, 3, 4, 7]) {
            if *on {
                let _ = write!(out, ";{code}");
            }
        }
        color(out, self.fg, true);
        color(out, self.bg, false);
        out.push(b'm');
    }
}

/// Where `row` ends: after its last cell with something in it, or a colour.
fn end_of(screen: &vt100::Screen, row: u16) -> u16 {
    let (_, cols) = screen.size();
    (0..cols)
        .rev()
        .find(|col| {
            screen
                .cell(row, *col)
                .is_some_and(|cell| cell.has_contents() || cell.bgcolor() != vt100::Color::Default)
        })
        .map_or(0, |col| col + 1)
}

fn write_cells(
    out: &mut Vec<u8>,
    screen: &vt100::Screen,
    row: u16,
    end: u16,
    pen: &mut Option<Pen>,
) {
    for col in 0..end {
        let Some(cell) = screen.cell(row, col) else {
            continue;
        };
        if cell.is_wide_continuation() {
            continue;
        }
        let this = Pen::of(cell);
        if *pen != Some(this) {
            this.write(out);
            *pen = Some(this);
        }
        if cell.has_contents() {
            out.extend_from_slice(cell.contents().as_bytes());
        } else {
            out.push(b' ');
        }
    }
}

/// The screen as a phone can take it whatever its width: each line of
/// text with its colours, wrapped where the phone wraps it rather than with
/// the laptop's cursor moves, then the modes its programs set (keypad,
/// mouse, bracketed paste).
pub fn snapshot(screen: &vt100::Screen) -> Vec<u8> {
    let (rows, cols) = screen.size();
    let (cursor_row, _) = screen.cursor_position();
    let last = (0..rows)
        .rev()
        .find(|row| end_of(screen, *row) > 0)
        .map_or(cursor_row, |row| row.max(cursor_row));
    let mut out = b"\x1b[0m\x1b[H\x1b[2J".to_vec();
    let mut pen: Option<Pen> = None;
    for row in 0..=last {
        // A row that runs on into the next keeps its spaces at the end.
        let wraps = row < last && screen.row_wrapped(row);
        let end = if wraps { cols } else { end_of(screen, row) };
        write_cells(&mut out, screen, row, end, &mut pen);
        if row < last && !wraps {
            out.extend_from_slice(b"\x1b[0m\r\n");
            pen = None;
        }
    }
    out.extend_from_slice(b"\x1b[0m");
    out.extend_from_slice(&screen.input_mode_formatted());
    out
}

/// The screen row by row with its colours, as `tmux capture-pane -e`
/// gives a pane's, for Work's view of a session.
pub fn in_colour(screen: &vt100::Screen) -> String {
    let (rows, _) = screen.size();
    let mut out = Vec::new();
    for row in 0..rows {
        let mut pen = None;
        write_cells(&mut out, screen, row, end_of(screen, row), &mut pen);
        if pen.is_some() {
            out.extend_from_slice(b"\x1b[0m");
        }
        out.push(b'\n');
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Arrows follow the cursor-key mode the tab's program set.
pub fn key_bytes(name: &str, application_cursor: bool) -> Option<&'static [u8]> {
    let arrow = |normal: &'static [u8], in_application_mode: &'static [u8]| {
        if application_cursor {
            in_application_mode
        } else {
            normal
        }
    };
    Some(match name {
        "Enter" => b"\r",
        "Escape" => b"\x1b",
        "Tab" => b"\t",
        "BTab" => b"\x1b[Z",
        "Up" => arrow(b"\x1b[A", b"\x1bOA"),
        "Down" => arrow(b"\x1b[B", b"\x1bOB"),
        "Right" => arrow(b"\x1b[C", b"\x1bOC"),
        "Left" => arrow(b"\x1b[D", b"\x1bOD"),
        "BSpace" => b"\x7f",
        "C-c" => b"\x03",
        "C-d" => b"\x04",
        "Space" => b" ",
        _ => return None,
    })
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum FromTab {
    Hello { pid: i32, cols: u16, rows: u16 },
    Size { cols: u16, rows: u16 },
    Laptop,
}

async fn connect(State(state): State<AppState>, ws: WebSocketUpgrade) -> Response {
    ws.max_message_size(1 << 20)
        .on_upgrade(move |socket| serve(socket, state))
}

async fn serve(socket: WebSocket, state: AppState) {
    let (mut to_tab, mut from_tab) = socket.split();
    let hello = match from_tab.next().await {
        Some(Ok(Message::Text(text))) => serde_json::from_str::<FromTab>(&text).ok(),
        _ => None,
    };
    let Some(FromTab::Hello { pid, cols, rows }) = hello else {
        return;
    };
    let tabs = &state.laptop_tabs;
    let (id, mut typed) = tabs.open(pid, cols, rows);
    let mut events = state.events.subscribe();
    loop {
        tokio::select! {
            incoming = from_tab.next() => match incoming {
                Some(Ok(Message::Binary(bytes))) => tabs.printed(id, bytes),
                Some(Ok(Message::Text(text))) => match serde_json::from_str::<FromTab>(&text) {
                    Ok(FromTab::Size { cols, rows }) => tabs.sized(id, cols, rows),
                    Ok(FromTab::Laptop) => tabs.laptop_took(id),
                    _ => {}
                },
                Some(Ok(Message::Close(_)) | Err(_)) | None => break,
                Some(Ok(_)) => {}
            },
            outgoing = typed.recv() => {
                let message = match outgoing {
                    Some(ToTab::Input(bytes)) => Message::Binary(bytes),
                    Some(ToTab::Resize { cols, rows }) => {
                        Message::Text(json!({"type": "resize", "cols": cols, "rows": rows}).to_string().into())
                    }
                    Some(ToTab::Release) => Message::Text(r#"{"type":"release"}"#.into()),
                    None => break,
                };
                if to_tab.send(message).await.is_err() {
                    break;
                }
            },
            event = events.recv() => {
                if matches!(event, Ok(Event::HubStopping) | Err(broadcast::error::RecvError::Closed)) {
                    break;
                }
            },
        }
    }
    tabs.close(id);
}

pub fn admin_routes() -> Router<AppState> {
    Router::new().route("/laptop-tabs/connect", get(connect))
}

async fn list(
    State(state): State<AppState>,
    Extension(Paired(device)): Extension<Paired>,
) -> Response {
    if device.is_none() {
        return unpaired();
    }
    // Whether new tabs are shared at all, so the phone can say how.
    let shared = std::env::var_os("HOME")
        .and_then(|home| std::fs::read_to_string(std::path::Path::new(&home).join(".bashrc")).ok())
        .is_some_and(|bashrc| crate::tab::has_block(&bashrc));
    Json(json!({"tabs": state.laptop_tabs.list(), "shared": shared})).into_response()
}

#[derive(Deserialize)]
struct Size {
    cols: Option<u16>,
    rows: Option<u16>,
}

async fn attach_ws(
    State(state): State<AppState>,
    Extension(Paired(device)): Extension<Paired>,
    UrlPath(id): UrlPath<u32>,
    Query(size): Query<Size>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    let Some(device) = device else {
        return unpaired();
    };
    if !state.laptop_tabs.exists(id) {
        return (StatusCode::NOT_FOUND, "That tab has closed.").into_response();
    }
    let (cols, rows) = (size.cols.unwrap_or(80), size.rows.unwrap_or(24));
    // The stream ends when this browser's Face ID unlock does.
    let viewer = attach::Viewer {
        device: device.id,
        unlock: read_cookie(&headers, faceid::UNLOCK_COOKIE).map(str::to_owned),
    };
    ws.max_message_size(1 << 20).on_upgrade(move |socket| {
        attach::bridge(socket, state, Target::LaptopTab(id), viewer, cols, rows)
    })
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/laptop-tabs", get(list))
        .route("/api/laptop-tabs/{id}/attach", get(attach_ws))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn screen(rows: u16, cols: u16, printed: &[u8]) -> vt100::Parser {
        let mut parser = vt100::Parser::new(rows, cols, 0);
        parser.process(printed);
        parser
    }

    fn shown_at(cols: u16, bytes: &[u8]) -> Vec<String> {
        let parser = screen(24, cols, bytes);
        let mut rows: Vec<String> = parser
            .screen()
            .rows(0, cols)
            .map(|row| row.trim_end().to_owned())
            .collect();
        while rows.last().is_some_and(String::is_empty) {
            rows.pop();
        }
        rows
    }

    #[test]
    fn the_snapshot_wraps_where_the_phone_does_and_keeps_colours() {
        // A laptop tab 40 wide: a red word, a line that wraps, a prompt.
        let laptop = screen(
            6,
            40,
            b"\x1b[31merror\x1b[0m: no such file\r\n\
              0123456789012345678901234567890123456789wrapped on\r\n\
              $ ",
        );
        let snapshot = snapshot(laptop.screen());
        assert!(
            snapshot.windows(5).any(|w| w == b"\x1b[0;3"),
            "colours kept"
        );
        // On a phone 20 wide, the long line wraps there instead, unbroken.
        assert_eq!(
            shown_at(20, &snapshot),
            [
                "error: no such file",
                "01234567890123456789",
                "01234567890123456789",
                "wrapped on",
                "$",
            ]
        );
        // And on one as wide as the laptop, it reads as the laptop did.
        assert_eq!(
            shown_at(40, &snapshot),
            [
                "error: no such file",
                "0123456789012345678901234567890123456789",
                "wrapped on",
                "$",
            ]
        );
    }

    #[test]
    fn a_wrapped_line_keeps_its_spaces_where_it_wraps() {
        let laptop = screen(4, 10, b"one two   three four");
        assert_eq!(
            shown_at(30, &snapshot(laptop.screen())),
            ["one two   three four"]
        );
    }

    #[test]
    fn the_last_to_type_has_the_size() {
        let tabs = LaptopTabs::default();
        let (id, _typed) = tabs.open(1, 120, 40);
        let phone = tabs.watch(id).unwrap();
        let other = tabs.watch(id).unwrap();
        assert!(
            tabs.claim(id, phone.viewer),
            "the phone's size goes to the tab"
        );
        assert!(!tabs.claim(id, phone.viewer), "once");
        assert!(tabs.list()[0].on_phone);
        // Typing on the laptop took it back: the phone's next key claims it again.
        tabs.laptop_took(id);
        assert!(tabs.claim(id, phone.viewer));
        // Another phone takes it; the first leaving changes nothing.
        assert!(tabs.claim(id, other.viewer));
        assert!(!tabs.release(id, phone.viewer));
        assert!(tabs.release(id, other.viewer), "the laptop's size again");
        assert!(!tabs.list()[0].on_phone);
    }

    #[test]
    fn a_phone_taking_the_size_never_cuts_the_lines_the_hub_keeps() {
        let tabs = LaptopTabs::default();
        let (id, _typed) = tabs.open(1, 60, 10);
        let line = "drwxr-xr-x 366 root root 16384 Oct 10 23:15 applications";
        tabs.printed(id, Bytes::from(format!("{line}\r\n")));
        let phone = tabs.watch(id).unwrap();
        tabs.claim(id, phone.viewer);
        tabs.sized(id, 20, 12);
        // Opened again while the phone has it: the whole line is still there.
        assert!(tabs.text(id).unwrap().starts_with(line));
        assert!(
            tabs.snapshot(id)
                .unwrap()
                .windows(line.len())
                .any(|w| w == line.as_bytes())
        );
        // Back to the laptop, at its own size.
        tabs.release(id, phone.viewer);
        tabs.sized(id, 50, 10);
        let snapshot = tabs.snapshot(id).unwrap();
        assert_eq!(shown_at(50, &snapshot)[0], line[..50].trim_end());
    }

    #[tokio::test]
    async fn a_tab_shows_what_it_prints_and_gets_what_the_phone_types() {
        let tabs = LaptopTabs::default();
        let (id, mut typed) = tabs.open(std::process::id() as i32, 80, 24);
        tabs.printed(
            id,
            Bytes::from_static(b"\x1b]2;you@laptop: ~/app\x07hello\r\n"),
        );
        let view = &tabs.list()[0];
        assert_eq!(view.title.as_deref(), Some("you@laptop: ~/app"));
        assert!(!view.folder.is_empty(), "its shell's folder");
        assert!(tabs.text(id).unwrap().starts_with("hello"));

        let mut watch = tabs.watch(id).unwrap();
        tabs.printed(id, Bytes::from_static(b"again"));
        assert_eq!(
            watch.output.recv().await.unwrap(),
            Bytes::from_static(b"again")
        );
        watch
            .to_tab
            .send(ToTab::Input(Bytes::from_static(b"ls\r")))
            .await
            .unwrap();
        assert_eq!(
            typed.recv().await,
            Some(ToTab::Input(Bytes::from_static(b"ls\r")))
        );

        // This test runs under its own process: a child of the shell is
        // found in its tab.
        assert_eq!(tabs.holding(std::process::id() as i32), Some(id));
        tabs.close(id);
        assert!(tabs.watch(id).is_none());
        assert!(tabs.list().is_empty());
    }
}
