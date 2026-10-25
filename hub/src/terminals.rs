//! Terminals and their tabs, kept by Airlock's own tmux server
//! (`tmux -L airlock`). A terminal is a tmux session; a tab is a tmux window.
//! Every call runs `tmux` with explicit arguments, never through a shell.

use std::{
    ffi::OsStr,
    path::{Path, PathBuf},
    process::Output,
};

use anyhow::{Context, Result, bail};
use serde::Serialize;
use tokio::process::Command;

pub const TMUX_CONF: &str = include_str!("../assets/tmux.conf");

pub const NAME_MAX: usize = 40;

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Terminal {
    /// tmux's session id without the `$`.
    pub id: u32,
    pub name: String,
    pub created_at: i64,
    pub activity_at: i64,
    pub tabs: Vec<Tab>,
    /// The last lines on the active tab's screen, when asked for.
    pub preview: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Tab {
    /// tmux's window id without the `@`.
    pub id: u32,
    pub index: u32,
    /// The name you gave the tab; empty when it follows its folder and
    /// command.
    pub name: String,
    pub active: bool,
    pub cwd: String,
    pub folder: String,
    pub command: String,
}

pub fn clean_name(text: &str) -> String {
    let kept: String = text
        .chars()
        .filter(|c| !c.is_control())
        .take(NAME_MAX)
        .collect();
    kept.trim().to_owned()
}

#[derive(Clone, Debug)]
pub struct Tmux {
    socket: String,
    conf: PathBuf,
}

/// Separates the fields tmux prints. tmux escapes most control characters in
/// its output but not tab, and names never hold one ([`clean_name`]).
const SEP: char = '\t';

impl Tmux {
    pub fn new(socket: impl Into<String>, conf: impl Into<PathBuf>) -> Self {
        Self {
            socket: socket.into(),
            conf: conf.into(),
        }
    }

    pub fn socket(&self) -> &str {
        &self.socket
    }

    fn command(&self) -> Command {
        let mut command = Command::new("tmux");
        command
            .arg("-L")
            .arg(&self.socket)
            .arg("-f")
            .arg(&self.conf)
            .env_remove("TMUX");
        command
    }

    async fn output<I, S>(&self, args: I) -> Result<Output>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        self.command()
            .args(args)
            .output()
            .await
            .context("running tmux")
    }

    async fn run<I, S>(&self, args: I) -> Result<String>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        let output = self.output(args).await?;
        if !output.status.success() {
            bail!("tmux: {}", String::from_utf8_lossy(&output.stderr).trim());
        }
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    }

    pub async fn reload(&self) -> Result<()> {
        if self.running().await {
            self.run([OsStr::new("source-file"), self.conf.as_os_str()])
                .await?;
        }
        Ok(())
    }

    pub async fn running(&self) -> bool {
        self.output(["list-sessions"])
            .await
            .is_ok_and(|o| o.status.success())
    }

    /// With `preview`, each terminal carries the last few lines of its
    /// active tab.
    pub async fn list(&self, preview: bool) -> Result<Vec<Terminal>> {
        let format = [
            "#{session_id}",
            "#{@airlock_name}",
            "#{session_name}",
            "#{session_created}",
            "#{session_activity}",
            "#{window_id}",
            "#{window_index}",
            "#{window_active}",
            "#{window_name}",
            "#{automatic-rename}",
            "#{pane_current_path}",
            "#{pane_current_command}",
        ]
        .join(&SEP.to_string());
        let output = self.output(["list-windows", "-a", "-F", &format]).await?;
        if !output.status.success() {
            // No server yet means no terminals yet.
            return Ok(Vec::new());
        }
        let mut terminals: Vec<Terminal> = Vec::new();
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            let fields: Vec<&str> = line.split(SEP).collect();
            let [
                session,
                name,
                session_name,
                created,
                activity,
                window,
                index,
                active,
                window_name,
                auto,
                cwd,
                command,
            ] = fields[..]
            else {
                continue;
            };
            let Some(id) = parse_id(session, '$') else {
                continue;
            };
            let Some(tab_id) = parse_id(window, '@') else {
                continue;
            };
            let tab = Tab {
                id: tab_id,
                index: index.parse().unwrap_or_default(),
                name: if auto == "1" {
                    String::new()
                } else {
                    window_name.to_owned()
                },
                active: active == "1",
                folder: folder_of(cwd),
                cwd: cwd.to_owned(),
                command: command.to_owned(),
            };
            match terminals.iter_mut().find(|t| t.id == id) {
                Some(terminal) => terminal.tabs.push(tab),
                None => terminals.push(Terminal {
                    id,
                    name: if name.is_empty() {
                        session_name.to_owned()
                    } else {
                        name.to_owned()
                    },
                    created_at: created.parse().unwrap_or_default(),
                    activity_at: activity.parse().unwrap_or_default(),
                    tabs: vec![tab],
                    preview: Vec::new(),
                }),
            }
        }
        terminals.sort_by_key(|t| (t.created_at, t.id));
        for terminal in &mut terminals {
            terminal.tabs.sort_by_key(|tab| tab.index);
            if preview {
                terminal.preview = self.preview(terminal.id, 4).await.unwrap_or_default();
            }
        }
        Ok(terminals)
    }

    pub async fn preview(&self, terminal: u32, lines: usize) -> Result<Vec<String>> {
        let screen = self
            .run(["capture-pane", "-p", "-J", "-t", &session(terminal)])
            .await?;
        let mut kept: Vec<String> = screen
            .lines()
            .map(|line| line.trim_end().to_owned())
            .collect();
        while kept.last().is_some_and(String::is_empty) {
            kept.pop();
        }
        let start = kept.len().saturating_sub(lines);
        Ok(kept.split_off(start))
    }

    pub async fn scrollback(&self, tab: u32, lines: u32) -> Result<String> {
        let start = format!("-{lines}");
        let text = self
            .run([
                "capture-pane",
                "-p",
                "-e",
                "-J",
                "-S",
                &start,
                "-t",
                &format!("@{tab}"),
            ])
            .await?;
        Ok(text.trim_end().to_owned())
    }

    /// The server's socket path, as `$TMUX` names it inside its terminals.
    /// `None` while the server isn't running.
    pub async fn socket_path(&self) -> Option<String> {
        let out = self
            .run(["display-message", "-p", "#{socket_path}"])
            .await
            .ok()?;
        let path = out.trim();
        (!path.is_empty()).then(|| path.to_owned())
    }

    /// Each pane's shell process, with the terminal and tab it is in.
    pub async fn panes(&self) -> Result<std::collections::HashMap<i32, (u32, u32)>> {
        let format = format!("#{{pane_pid}}{SEP}#{{session_id}}{SEP}#{{window_id}}");
        let output = self.output(["list-panes", "-a", "-F", &format]).await?;
        let mut panes = std::collections::HashMap::new();
        if !output.status.success() {
            return Ok(panes);
        }
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            let mut fields = line.split(SEP);
            if let (Some(pid), Some(session), Some(window)) =
                (fields.next(), fields.next(), fields.next())
                && let (Ok(pid), Some(terminal), Some(tab)) = (
                    pid.parse::<i32>(),
                    parse_id(session, '$'),
                    parse_id(window, '@'),
                )
            {
                panes.insert(pid, (terminal, tab));
            }
        }
        Ok(panes)
    }

    /// The terminal and tab holding `pane` (like `%12`) on this server.
    pub async fn locate(&self, pane: &str) -> Option<(u32, u32)> {
        let format = format!("#{{session_id}}{SEP}#{{window_id}}");
        let out = self
            .run(["display-message", "-p", "-t", pane, &format])
            .await
            .ok()?;
        let (session, window) = out.trim().split_once(SEP)?;
        Some((parse_id(session, '$')?, parse_id(window, '@')?))
    }

    pub async fn exists(&self, terminal: u32) -> bool {
        self.output(["has-session", "-t", &session(terminal)])
            .await
            .is_ok_and(|o| o.status.success())
    }

    pub async fn create(&self, name: &str, cwd: &Path) -> Result<u32> {
        let id = self
            .run([
                OsStr::new("new-session"),
                OsStr::new("-d"),
                OsStr::new("-P"),
                OsStr::new("-F"),
                OsStr::new("#{session_id}"),
                OsStr::new("-c"),
                cwd.as_os_str(),
            ])
            .await?;
        let id = parse_id(id.trim(), '$').context("tmux gave no session id")?;
        self.rename(id, name).await?;
        Ok(id)
    }

    pub async fn run_in(&self, terminal: u32, text: &str) -> Result<()> {
        let target = session(terminal);
        self.run(["send-keys", "-t", &target, "-l", text]).await?;
        self.run(["send-keys", "-t", &target, "Enter"]).await?;
        Ok(())
    }

    pub async fn rename(&self, terminal: u32, name: &str) -> Result<()> {
        self.run([
            "set-option",
            "-t",
            &session(terminal),
            "@airlock_name",
            name,
        ])
        .await?;
        Ok(())
    }

    pub async fn close(&self, terminal: u32) -> Result<()> {
        self.run(["kill-session", "-t", &session(terminal)]).await?;
        Ok(())
    }

    /// A new tab at the end of a terminal, in `cwd` or else in the folder of
    /// the terminal's active tab. Returns its id.
    pub async fn new_tab(&self, terminal: u32, cwd: Option<&Path>) -> Result<u32> {
        let target = format!("{}:", session(terminal));
        let cwd = cwd.map_or_else(|| OsStr::new("#{pane_current_path}"), Path::as_os_str);
        let id = self
            .run([
                OsStr::new("new-window"),
                OsStr::new("-P"),
                OsStr::new("-F"),
                OsStr::new("#{window_id}"),
                OsStr::new("-t"),
                OsStr::new(&target),
                OsStr::new("-c"),
                cwd,
            ])
            .await?;
        parse_id(id.trim(), '@').context("tmux gave no window id")
    }

    /// Takes a terminal's active tab out of tmux's history view (copy mode),
    /// back to what's running now. A tab that isn't in it stays as it is.
    pub async fn to_bottom(&self, terminal: u32) -> Result<()> {
        // tmux refuses `-X` outside a mode; that refusal means "already there".
        let _ = self
            .run(["send-keys", "-X", "-t", &session(terminal), "cancel"])
            .await;
        Ok(())
    }

    /// A terminal's active tab as plain text, history included, up to
    /// `lines` lines back, wrapped lines joined: for copying.
    pub async fn text(&self, terminal: u32, lines: u32) -> Result<String> {
        let start = format!("-{lines}");
        let text = self
            .run([
                "capture-pane",
                "-p",
                "-J",
                "-S",
                &start,
                "-t",
                &session(terminal),
            ])
            .await?;
        Ok(text.trim_end().to_owned())
    }

    pub async fn select_tab(&self, tab: u32) -> Result<()> {
        self.run(["select-window", "-t", &window(tab)]).await?;
        Ok(())
    }

    /// Names a tab; an empty name hands it back to its folder and command.
    pub async fn rename_tab(&self, tab: u32, name: &str) -> Result<()> {
        if name.is_empty() {
            self.run([
                "set-window-option",
                "-t",
                &window(tab),
                "automatic-rename",
                "on",
            ])
            .await?;
        } else {
            self.run(["rename-window", "-t", &window(tab), name])
                .await?;
        }
        Ok(())
    }

    pub async fn close_tab(&self, tab: u32) -> Result<()> {
        self.run(["kill-window", "-t", &window(tab)]).await?;
        Ok(())
    }

    pub fn attach_command(&self, terminal: u32) -> pty_process::Command {
        pty_process::Command::new("tmux")
            .arg("-L")
            .arg(&self.socket)
            .arg("-f")
            .arg(&self.conf)
            .arg("attach-session")
            .arg("-t")
            .arg(session(terminal))
            .env("TERM", "xterm-256color")
            .env_remove("TMUX")
    }

    /// The command that attaches the terminal you run it in, as it is, to
    /// one of Airlock's: `airlock attach`.
    pub fn attach_here(&self, terminal: u32) -> std::process::Command {
        let mut command = std::process::Command::new("tmux");
        command
            .arg("-L")
            .arg(&self.socket)
            .arg("-f")
            .arg(&self.conf)
            .arg("attach-session")
            .arg("-t")
            .arg(session(terminal))
            .env_remove("TMUX");
        command
    }

    #[cfg(test)]
    pub(crate) async fn type_line(&self, terminal: u32, keys: &str) -> Result<()> {
        self.run(["send-keys", "-t", &session(terminal), "-l", keys])
            .await?;
        self.run(["send-keys", "-t", &session(terminal), "Enter"])
            .await?;
        Ok(())
    }
}

/// The terminal `which` names among `terminals`, listed oldest first: its
/// number in that list (from 1), its name (any case), or the start of one
/// name only.
pub fn find<'a>(terminals: &'a [Terminal], which: &str) -> Option<&'a Terminal> {
    let which = which.trim();
    if let Ok(number) = which.parse::<usize>() {
        return number.checked_sub(1).and_then(|index| terminals.get(index));
    }
    let lower = which.to_lowercase();
    if let Some(exact) = terminals.iter().find(|t| t.name.to_lowercase() == lower) {
        return Some(exact);
    }
    let mut starting = terminals
        .iter()
        .filter(|t| !lower.is_empty() && t.name.to_lowercase().starts_with(&lower));
    match (starting.next(), starting.next()) {
        (Some(only), None) => Some(only),
        _ => None,
    }
}

fn session(id: u32) -> String {
    format!("${id}")
}

fn window(id: u32) -> String {
    format!("@{id}")
}

fn parse_id(text: &str, prefix: char) -> Option<u32> {
    text.strip_prefix(prefix)?.parse().ok()
}

fn folder_of(cwd: &str) -> String {
    match Path::new(cwd).file_name() {
        Some(name) => name.to_string_lossy().into_owned(),
        None => cwd.to_owned(),
    }
}

#[cfg(test)]
pub(crate) mod testing {
    use super::Tmux;

    /// A throwaway tmux server, killed when dropped.
    pub struct ScratchTmux {
        pub tmux: Tmux,
        _dir: tempfile::TempDir,
    }

    impl ScratchTmux {
        pub fn new() -> Self {
            let dir = tempfile::tempdir().unwrap();
            let conf = dir.path().join("tmux.conf");
            std::fs::write(&conf, super::TMUX_CONF).unwrap();
            let socket = format!("airlock-test-{}", crate::token::id());
            Self {
                tmux: Tmux::new(socket, conf),
                _dir: dir,
            }
        }

        pub fn dir(&self) -> &std::path::Path {
            self._dir.path()
        }
    }

    impl Drop for ScratchTmux {
        fn drop(&mut self) {
            use std::os::unix::fs::MetadataExt;
            let _ = std::process::Command::new("tmux")
                .args(["-L", self.tmux.socket(), "kill-server"])
                .output();
            // tmux can leave its socket file behind; this one is ours.
            if let Ok(me) = std::fs::metadata("/proc/self") {
                let base = std::env::var_os("TMUX_TMPDIR").unwrap_or_else(|| "/tmp".into());
                let socket = std::path::Path::new(&base)
                    .join(format!("tmux-{}", me.uid()))
                    .join(self.tmux.socket());
                let _ = std::fs::remove_file(socket);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::{testing::ScratchTmux, *};

    #[test]
    fn names_are_cleaned() {
        assert_eq!(clean_name("  claude \u{7}"), "claude");
        assert_eq!(clean_name(&"x".repeat(80)).len(), NAME_MAX);
    }

    #[test]
    fn a_terminal_is_found_by_number_name_or_a_unique_start() {
        let terminal = |id: u32, name: &str| Terminal {
            id,
            name: name.to_owned(),
            created_at: 0,
            activity_at: 0,
            tabs: Vec::new(),
            preview: Vec::new(),
        };
        let terminals = [
            terminal(4, "website"),
            terminal(7, "api"),
            terminal(9, "api-tests"),
        ];
        let id = |which: &str| find(&terminals, which).map(|t| t.id);
        assert_eq!(id("2"), Some(7), "by its place in the list");
        assert_eq!(id("0"), None);
        assert_eq!(id("4"), None, "a place, never tmux's id");
        assert_eq!(id("Website"), Some(4));
        assert_eq!(id("api"), Some(7), "a whole name beats a start");
        assert_eq!(id("api-"), Some(9));
        assert_eq!(id("web"), Some(4));
        assert_eq!(id("a"), None, "more than one starts so");
        assert_eq!(id(""), None);
    }

    #[tokio::test]
    async fn no_server_means_no_terminals() {
        let scratch = ScratchTmux::new();
        assert!(scratch.tmux.list(false).await.unwrap().is_empty());
        assert!(!scratch.tmux.running().await);
    }

    #[tokio::test]
    async fn terminals_and_tabs_live_in_tmux() {
        let scratch = ScratchTmux::new();
        let tmux = &scratch.tmux;
        let cwd = scratch.dir();

        let id = tmux.create("bakery", cwd).await.unwrap();
        let listed = tmux.list(false).await.unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "bakery");
        assert_eq!(listed[0].tabs.len(), 1);
        assert_eq!(
            Path::new(&listed[0].tabs[0].cwd),
            cwd.canonicalize().unwrap()
        );

        let second = tmux.new_tab(id, None).await.unwrap();
        let tabs = &tmux.list(false).await.unwrap()[0].tabs;
        assert_eq!(tabs.len(), 2);
        assert!(tabs[1].active, "a new tab is the active one");
        assert_eq!(tabs[1].id, second);
        assert_eq!(
            tabs[1].cwd, tabs[0].cwd,
            "a new tab opens in the same folder"
        );

        tmux.rename_tab(second, "claude").await.unwrap();
        assert_eq!(tmux.list(false).await.unwrap()[0].tabs[1].name, "claude");
        tmux.rename_tab(second, "").await.unwrap();
        assert_eq!(tmux.list(false).await.unwrap()[0].tabs[1].name, "");

        let first = tabs[0].id;
        tmux.select_tab(first).await.unwrap();
        assert!(tmux.list(false).await.unwrap()[0].tabs[0].active);

        tmux.close_tab(second).await.unwrap();
        assert_eq!(tmux.list(false).await.unwrap()[0].tabs.len(), 1);

        tmux.rename(id, "bakery docs").await.unwrap();
        assert_eq!(tmux.list(false).await.unwrap()[0].name, "bakery docs");
        assert!(tmux.exists(id).await);
        tmux.close(id).await.unwrap();
        assert!(!tmux.exists(id).await);
        assert!(tmux.list(false).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn the_preview_shows_the_screen_tail() {
        let scratch = ScratchTmux::new();
        let id = scratch.tmux.create("preview", scratch.dir()).await.unwrap();
        scratch
            .tmux
            .type_line(id, "echo airlock-preview-marker")
            .await
            .unwrap();
        let mut found = false;
        // Generous: the shell loads your bashrc, and other tests run too.
        for _ in 0..150 {
            let terminals = scratch.tmux.list(true).await.unwrap();
            if terminals[0]
                .preview
                .iter()
                .any(|line| line == "airlock-preview-marker")
            {
                found = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        assert!(found, "the echoed line shows in the preview");
    }
}
