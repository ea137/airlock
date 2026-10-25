//! Every process on the laptop, for the phone's Processes tab. The package
//! that installed a program is asked only when you open it.

use std::{
    collections::HashMap,
    path::Path,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

use axum::{
    Extension, Json, Router,
    extract::{Path as UrlPath, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::{
    phone::{Paired, unpaired},
    state::AppState,
    system::{self, Proc, TerminalLink},
};

const COMMAND_MAX: usize = 300;
const UNITS_FRESH: Duration = Duration::from_secs(30);

#[derive(Clone, Debug, Serialize)]
pub struct ProcessRow {
    pub pid: i32,
    pub ppid: i32,
    pub started: u64,
    /// As you'd say it: `chrome renderer`, `astro dev`.
    pub name: String,
    pub program: String,
    pub command: String,
    pub user: String,
    pub mine: bool,
    /// `running`, `sleeping`, `disk`, `stopped`, `zombie` or `idle`.
    pub state: &'static str,
    pub threads: u32,
    pub nice: i32,
    /// Share of one CPU since the last look.
    pub cpu: Option<f32>,
    /// Its share at the last few looks, oldest first.
    pub cpu_history: Vec<u8>,
    pub memory: u64,
    pub running_for: u64,
    pub cwd: Option<String>,
    pub ports: Vec<u16>,
    pub terminal: Option<TerminalLink>,
    pub unit: Option<String>,
    /// The app it belongs to, by name, so its helpers group under it.
    pub app: Option<String>,
    /// `app`, `dev`, `terminal`, `service`, `desktop`, `system` or `other`.
    pub kind: &'static str,
    pub about: Option<String>,
    /// Why it can't be stopped from the phone, if it can't.
    pub keep: Option<&'static str>,
}

/// A name ending in `*` matches any name starting with the rest.
const KNOWN: &[(&str, &str)] = &[
    (
        "systemd",
        "Starts and looks after the other programs and services: one for the whole computer, one for your login.",
    ),
    (
        "gnome-shell",
        "The GNOME desktop itself: the top bar, windows, the app grid and notifications.",
    ),
    (
        "Xwayland",
        "Lets older apps that only speak X11 show their windows on the Wayland desktop.",
    ),
    (
        "Xorg",
        "The X11 display server, which draws windows on screen.",
    ),
    (
        "pipewire",
        "Moves sound and screen-sharing video between apps and devices.",
    ),
    (
        "pipewire-pulse",
        "Lets apps made for PulseAudio play and record sound through PipeWire.",
    ),
    (
        "wireplumber",
        "Decides where sound goes: which speaker, headset or microphone each app uses.",
    ),
    (
        "dbus-daemon",
        "The message bus apps and services use to talk to each other.",
    ),
    (
        "dbus-broker*",
        "The message bus apps and services use to talk to each other.",
    ),
    (
        "tracker-miner*",
        "Indexes your files so search in Files and the app grid can find them.",
    ),
    (
        "localsearch*",
        "Indexes your files so search in Files and the app grid can find them.",
    ),
    (
        "evolution-*",
        "Keeps your calendars, contacts and online accounts ready for apps.",
    ),
    (
        "gvfsd*",
        "Lets Files open network shares, phones, the trash and other places that aren't plain folders.",
    ),
    (
        "gvfs-*",
        "Notices disks, phones and network places as they come and go, for Files.",
    ),
    (
        "goa-*",
        "GNOME Online Accounts: your signed-in Google and other accounts, for apps.",
    ),
    (
        "gsd-*",
        "A GNOME settings helper: power, sound, keyboard, displays, printers and the like.",
    ),
    (
        "ibus-*",
        "Typing: keyboard layouts, emoji and other ways to type.",
    ),
    (
        "xdg-desktop-portal*",
        "Lets sandboxed apps (Snap, Flatpak) open files, share the screen and show dialogs safely.",
    ),
    (
        "xdg-document-portal",
        "Gives sandboxed apps the files you chose for them, and only those.",
    ),
    (
        "xdg-permission-store",
        "Remembers which permissions you gave sandboxed apps.",
    ),
    (
        "at-spi*",
        "Accessibility: lets screen readers and other assistive tools see into apps.",
    ),
    (
        "gnome-keyring-d*",
        "Keeps your saved passwords and keys, unlocked when you log in.",
    ),
    (
        "gnome-session*",
        "Starts your desktop session and its helpers, and ends them when you log out.",
    ),
    ("gnome-terminal-*", "GNOME Terminal: its windows and tabs."),
    ("nautilus", "Files, the file manager."),
    ("snapd", "Installs and updates Snap packages."),
    ("snap-store", "App Center, Ubuntu's software store."),
    ("packagekitd", "Looks for and installs software updates."),
    (
        "unattended-upgr*",
        "Installs security updates in the background.",
    ),
    ("update-notifier", "Tells you when updates are ready."),
    (
        "tailscaled",
        "Tailscale: the private network your phone uses to reach this laptop.",
    ),
    ("sshd", "Lets other computers log in to this one over SSH."),
    ("cupsd", "Printing."),
    ("cups-browsed", "Finds printers on your network."),
    ("NetworkManager", "Wi-Fi, Ethernet and VPN connections."),
    (
        "wpa_supplicant",
        "Joins Wi-Fi networks and handles their passwords.",
    ),
    (
        "avahi-daemon*",
        "Finds printers and other devices on the local network.",
    ),
    (
        "systemd-resolved",
        "Looks up website names (DNS) for every app.",
    ),
    ("systemd-journal*", "Keeps the system's logs."),
    (
        "systemd-logind",
        "Keeps track of who is logged in, and handles the lid and power button.",
    ),
    ("systemd-udevd", "Sets up devices as they are plugged in."),
    ("systemd-timesyncd", "Keeps the clock right."),
    (
        "systemd-oomd",
        "Stops the heaviest programs before the computer runs out of memory.",
    ),
    ("rsyslogd", "Writes the system's logs to files."),
    ("cron", "Runs scheduled jobs."),
    ("thermald", "Keeps the processor from overheating."),
    ("upowerd", "Reports battery and power to the desktop."),
    (
        "power-profiles-daemon",
        "Switches between power saver, balanced and performance.",
    ),
    ("udisksd", "Mounts disks and USB drives."),
    (
        "polkitd",
        "Decides which programs may do administrator things, and asks for your password.",
    ),
    ("bluetoothd", "Bluetooth."),
    ("ModemManager", "Mobile broadband modems."),
    ("colord", "Colour profiles for screens and printers."),
    ("fwupd", "Looks for and installs firmware updates."),
    (
        "switcheroo-control",
        "Picks which graphics chip an app uses.",
    ),
    ("kerneloops", "Reports kernel crashes."),
    (
        "whoopsie",
        "Sends crash reports to Ubuntu, if you allowed it.",
    ),
    (
        "rtkit-daemon",
        "Gives sound its real-time priority, so it doesn't stutter.",
    ),
    ("dockerd", "Docker: runs containers."),
    ("containerd*", "Runs containers for Docker."),
    ("postgres", "PostgreSQL, a database server."),
    ("redis-server", "Redis, an in-memory database and cache."),
    ("mysqld", "MySQL, a database server."),
    (
        "tmux: server",
        "tmux: keeps terminal sessions running in the background.",
    ),
    ("airlock", "Airlock's hub: the laptop side of this app."),
    ("airlock-app", "Airlock's laptop app."),
    ("claude", "Claude Code, working in a terminal."),
    (
        "chrome",
        "Google Chrome. Each tab, extension and helper runs as its own process.",
    ),
    ("chrome_crashpad*", "Collects crash reports for Chrome."),
    (
        "firefox",
        "Firefox. Its tabs and helpers run as separate processes.",
    ),
    (
        "code",
        "Visual Studio Code. The editor, its extensions and helpers each run as their own process.",
    ),
    ("obsidian", "Obsidian, the notes app."),
    ("evince", "Document Viewer, for PDFs."),
    ("gjs*", "A GNOME helper written in JavaScript."),
    ("bash", "A shell: the command line in a terminal."),
    ("zsh", "A shell: the command line in a terminal."),
    ("fish", "A shell: the command line in a terminal."),
    ("node", "Node.js, running a JavaScript program."),
    ("python3", "Python, running a program."),
];

pub fn known(name: &str) -> Option<&'static str> {
    KNOWN.iter().find_map(|(key, about)| {
        let matches = match key.strip_suffix('*') {
            Some(prefix) => name.starts_with(prefix),
            None => name == *key,
        };
        matches.then_some(*about)
    })
}

pub fn state_word(state: char) -> &'static str {
    match state {
        'R' => "running",
        'D' => "disk",
        'T' | 't' => "stopped",
        'Z' => "zombie",
        'I' => "idle",
        _ => "sleeping",
    }
}

/// The cgroup a process runs in, like
/// `/user.slice/user-1000.slice/user@1000.service/app.slice/app-gnome-code-4242.scope`.
fn cgroup(pid: i32) -> Option<String> {
    let text = std::fs::read_to_string(format!("/proc/{pid}/cgroup")).ok()?;
    text.lines()
        .find_map(|line| line.strip_prefix("0::"))
        .map(str::to_owned)
}

/// systemd's escaping in unit names: `\x2d` is `-`.
fn unescape(text: &str) -> String {
    let mut out = String::new();
    let mut rest = text;
    while let Some(at) = rest.find("\\x") {
        out.push_str(&rest[..at]);
        let code = rest
            .get(at + 2..at + 4)
            .and_then(|hex| u8::from_str_radix(hex, 16).ok());
        match code {
            Some(byte) => {
                out.push(byte as char);
                rest = &rest[at + 4..];
            }
            None => {
                out.push_str("\\x");
                rest = &rest[at + 2..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// The app id in a cgroup, from the scope or slice the desktop started it
/// in: `app-gnome-google\x2dchrome-4242.scope` is `google-chrome`,
/// `app-org.gnome.Terminal.slice` is `org.gnome.Terminal`,
/// `snap.firefox.firefox-<id>.scope` is `firefox`.
pub fn app_id(cgroup: &str) -> Option<String> {
    for part in cgroup.split('/').rev() {
        if let Some(rest) = part.strip_prefix("snap.") {
            return rest.split('.').next().map(str::to_owned);
        }
        let Some(rest) = part.strip_prefix("app-") else {
            continue;
        };
        let rest = rest
            .strip_suffix(".scope")
            .or_else(|| rest.strip_suffix(".slice"))
            .or_else(|| rest.strip_suffix(".service"))?;
        let rest = rest.split('@').next().unwrap_or(rest);
        // The launcher that started it: gnome, flatpak, kde.
        let rest = ["gnome-", "flatpak-", "kde-", "dbus-:1.2-"]
            .iter()
            .find_map(|launcher| rest.strip_prefix(launcher))
            .unwrap_or(rest);
        // A trailing process number or id.
        let rest = match rest.rsplit_once('-') {
            Some((head, tail))
                if !head.is_empty() && tail.chars().all(|c| c.is_ascii_hexdigit()) =>
            {
                head
            }
            _ => rest,
        };
        let id = unescape(rest);
        if !id.is_empty() && id != "slice" {
            return Some(id);
        }
    }
    None
}

fn unit_of(cgroup: &str) -> Option<String> {
    cgroup
        .split('/')
        .rev()
        .find(|part| part.ends_with(".service") || part.ends_with(".scope"))
        .map(unescape)
}

/// An app's name and description, from its desktop entry.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Entry {
    pub name: Option<String>,
    pub comment: Option<String>,
}

pub fn parse_entry(text: &str) -> Entry {
    let mut entry = Entry::default();
    let mut main = false;
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            main = line == "[Desktop Entry]";
            continue;
        }
        if !main {
            continue;
        }
        if let Some(name) = line.strip_prefix("Name=") {
            entry.name.get_or_insert_with(|| name.to_owned());
        } else if let Some(comment) = line.strip_prefix("Comment=") {
            entry.comment.get_or_insert_with(|| comment.to_owned());
        }
    }
    entry
}

fn exec_program(text: &str) -> Option<String> {
    let line = text
        .lines()
        .find_map(|line| line.trim().strip_prefix("Exec="))?;
    // `env FOO=1 app`, `/usr/bin/app %U`.
    let program = line
        .split_whitespace()
        .find(|word| *word != "env" && !word.contains('='))?;
    Some(base(program))
}

struct Entries {
    by_id: HashMap<String, Entry>,
    by_program: HashMap<String, Entry>,
}

fn entries() -> &'static Entries {
    static ENTRIES: OnceLock<Entries> = OnceLock::new();
    ENTRIES.get_or_init(|| {
        let home = std::env::var("HOME").unwrap_or_default();
        let dirs = [
            format!("{home}/.local/share/applications"),
            "/usr/share/applications".to_owned(),
            "/var/lib/snapd/desktop/applications".to_owned(),
            "/var/lib/flatpak/exports/share/applications".to_owned(),
        ];
        let mut found = Entries {
            by_id: HashMap::new(),
            by_program: HashMap::new(),
        };
        for dir in dirs {
            let Ok(files) = std::fs::read_dir(&dir) else {
                continue;
            };
            for file in files.flatten() {
                let path = file.path();
                let Some(id) = path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .and_then(|name| name.strip_suffix(".desktop"))
                    .map(str::to_owned)
                else {
                    continue;
                };
                let Ok(text) = std::fs::read_to_string(&path) else {
                    continue;
                };
                let entry = parse_entry(&text);
                if let Some(program) = exec_program(&text) {
                    found
                        .by_program
                        .entry(program)
                        .or_insert_with(|| entry.clone());
                }
                found.by_id.entry(id).or_insert(entry);
            }
        }
        found
    })
}

/// The desktop entry for an app id (a Snap's is `<name>_<name>`).
fn entry_for_id(id: &str) -> Option<Entry> {
    let entries = entries();
    entries
        .by_id
        .get(id)
        .or_else(|| entries.by_id.get(&format!("{id}_{id}")))
        .cloned()
}

/// The app a process runs inside, by name: `Terminal` for a GNOME Terminal
/// tab, `Visual Studio Code` for its terminal, and so on. `None` when it
/// isn't running or isn't in an app.
pub fn host_app(pid: i32) -> Option<String> {
    let id = app_id(&cgroup(pid)?)?;
    Some(entry_for_id(&id).and_then(|entry| entry.name).unwrap_or(id))
}

fn users() -> &'static HashMap<u32, String> {
    static USERS: OnceLock<HashMap<u32, String>> = OnceLock::new();
    USERS.get_or_init(|| {
        std::fs::read_to_string("/etc/passwd")
            .unwrap_or_default()
            .lines()
            .filter_map(|line| {
                let mut fields = line.split(':');
                let name = fields.next()?;
                let uid = fields.nth(1)?.parse().ok()?;
                Some((uid, name.to_owned()))
            })
            .collect()
    })
}

#[derive(Deserialize)]
struct UnitRow {
    unit: String,
    #[serde(default)]
    description: String,
}

/// Unit name → its description, and when they were read.
type Descriptions = Mutex<Option<(Instant, HashMap<String, String>)>>;
/// A program file → the package that installed it and its summary.
type Packages = Mutex<HashMap<String, Option<(String, String)>>>;

async fn unit_descriptions() -> HashMap<String, String> {
    static SEEN: OnceLock<Descriptions> = OnceLock::new();
    let seen = SEEN.get_or_init(Mutex::default);
    if let Some((at, known)) = seen.lock().unwrap_or_else(|p| p.into_inner()).as_ref()
        && at.elapsed() < UNITS_FRESH
    {
        return known.clone();
    }
    let mut found = HashMap::new();
    for scope in [&["--user"][..], &[][..]] {
        let output = tokio::process::Command::new("systemctl")
            .args(scope)
            .args(["list-units", "--all", "--output=json", "--no-pager"])
            .output()
            .await;
        if let Ok(output) = output
            && let Ok(rows) = serde_json::from_slice::<Vec<UnitRow>>(&output.stdout)
        {
            for row in rows {
                found.entry(row.unit).or_insert(row.description);
            }
        }
    }
    *seen.lock().unwrap_or_else(|p| p.into_inner()) = Some((Instant::now(), found.clone()));
    found
}

fn base(path: &str) -> String {
    Path::new(path).file_name().map_or_else(
        || path.to_owned(),
        |name| name.to_string_lossy().into_owned(),
    )
}

pub async fn processes(state: &AppState) -> serde_json::Value {
    let panes = state.tmux.panes().await.unwrap_or_default();
    let units = unit_descriptions().await;
    let state = state.clone();
    // Hundreds of small reads of /proc, kept off the threads that serve
    // requests and terminals.
    tokio::task::spawn_blocking(move || processes_now(&state, &panes, &units))
        .await
        .expect("reading the processes panicked")
}

fn processes_now(
    state: &AppState,
    panes: &HashMap<i32, (u32, u32)>,
    units: &HashMap<String, String>,
) -> serde_json::Value {
    let processes = system::all_processes();
    let cpu = state.sampler.sample(&processes);
    let resources = system::resources();
    let totals = state.sampler.totals(resources.memory_used);
    let me = system::my_uid();
    let mine: Vec<Proc> = processes.iter().filter(|p| p.uid == me).cloned().collect();
    let owners = system::socket_owners(&mine);
    let mut ports_of: HashMap<i32, Vec<u16>> = HashMap::new();
    let mut tables = String::new();
    for table in ["/proc/net/tcp", "/proc/net/tcp6"] {
        if let Ok(text) = std::fs::read_to_string(table) {
            tables.push_str(&text);
            tables.push('\n');
        }
    }
    for listener in system::parse_listeners(&tables) {
        if let Some(pid) = owners.get(&listener.inode) {
            let ports = ports_of.entry(*pid).or_default();
            if !ports.contains(&listener.port) {
                ports.push(listener.port);
            }
        }
    }
    let by_pid: HashMap<i32, &Proc> = processes.iter().map(|p| (p.pid, p)).collect();
    let terminal_of = |process: &Proc| -> Option<TerminalLink> {
        let mut pid = process.pid;
        for _ in 0..32 {
            if let Some(&(terminal, tab)) = panes.get(&pid) {
                return Some(TerminalLink { terminal, tab });
            }
            pid = by_pid.get(&pid)?.ppid;
        }
        None
    };
    let up = system::uptime();
    let ticks = system::clock_ticks() as f64;
    let hub = std::process::id() as i32;

    // App ids with no desktop entry, as a last resort for a name.
    let mut hints: HashMap<i32, String> = HashMap::new();
    let mut rows: Vec<ProcessRow> = processes
        .iter()
        .map(|process| {
            let is_mine = process.uid == me;
            let name = system::label(process);
            let program = process.args.first().map_or_else(
                || process.comm.clone(),
                |first| base(first.split(' ').next().unwrap_or(first)),
            );
            let group = cgroup(process.pid).unwrap_or_default();
            let unit = unit_of(&group);
            // Started in a GNOME Terminal tab: it's in a terminal, not part
            // of the Terminal app.
            let in_tab = group
                .rsplit('/')
                .next()
                .is_some_and(|leaf| leaf.starts_with("vte-spawn-"));
            // Apps D-Bus starts on demand (Files, Disk Usage…) run inside
            // the bus's own service; that service says nothing about them.
            let on_demand =
                unit.as_deref() == Some("dbus.service") && !process.comm.starts_with("dbus");
            let id = (!in_tab).then(|| app_id(&group)).flatten();
            let app_entry = id.as_deref().and_then(entry_for_id).or_else(|| {
                (!in_tab)
                    .then(|| entries().by_program.get(&program).cloned())
                    .flatten()
            });
            if let (Some(id), None) = (&id, &app_entry) {
                hints.insert(process.pid, id.clone());
            }
            let app = app_entry.as_ref().and_then(|entry| entry.name.clone());
            let terminal = if is_mine { terminal_of(process) } else { None };
            let ports = ports_of.get(&process.pid).cloned().unwrap_or_default();
            let kind = if is_mine
                && (system::looks_like_dev_server(&name)
                    || (!ports.is_empty() && (process.tty != 0 || terminal.is_some())))
            {
                "dev"
            } else if is_mine && (terminal.is_some() || process.tty != 0 || in_tab) {
                "terminal"
            } else if system::SESSION.contains(&process.comm.as_str()) {
                "desktop"
            } else if app.is_some() {
                "app"
            } else if group.contains("/session.slice/") {
                "desktop"
            } else if unit
                .as_deref()
                .is_some_and(|unit| unit.ends_with(".service"))
            {
                "service"
            } else if is_mine {
                "other"
            } else {
                "system"
            };
            let about = known(&process.comm)
                .or_else(|| known(&program))
                .or_else(|| known(name.split(' ').next().unwrap_or_default()))
                .map(str::to_owned)
                .or_else(|| app_entry.as_ref().and_then(|entry| entry.comment.clone()))
                .or_else(|| {
                    unit.as_ref()
                        .filter(|unit| unit.ends_with(".service") && !on_demand)
                        .and_then(|unit| units.get(unit))
                        .filter(|text| !text.is_empty())
                        .cloned()
                });
            let keep = if !is_mine {
                Some("It isn't yours: it belongs to another user, like the system.")
            } else if process.pid == hub {
                Some("That would stop Airlock itself.")
            } else {
                system::refuse_stop(state, process, &mine)
            };
            let mut command = process.args.join(" ");
            if command.len() > COMMAND_MAX {
                let mut cut = COMMAND_MAX;
                while !command.is_char_boundary(cut) {
                    cut -= 1;
                }
                command.truncate(cut);
                command.push('…');
            }
            ProcessRow {
                pid: process.pid,
                ppid: process.ppid,
                started: process.started,
                name,
                program,
                command,
                user: users()
                    .get(&process.uid)
                    .cloned()
                    .unwrap_or_else(|| process.uid.to_string()),
                mine: is_mine,
                state: state_word(process.state),
                threads: process.threads,
                nice: process.nice,
                cpu: cpu.get(&(process.pid, process.started)).copied(),
                cpu_history: state
                    .sampler
                    .history_of(process.pid, process.started)
                    .into_iter()
                    .map(|share| share.round().clamp(0.0, 255.0) as u8)
                    .collect(),
                memory: process.rss_bytes,
                running_for: (up - process.started as f64 / ticks).max(0.0) as u64,
                cwd: is_mine
                    .then(|| std::fs::read_link(format!("/proc/{}/cwd", process.pid)).ok())
                    .flatten()
                    .map(|path| path.to_string_lossy().into_owned()),
                ports,
                terminal,
                unit,
                app,
                kind,
                about,
                keep,
            }
        })
        .collect();

    // Helpers an app started take its name, and what it is, from the
    // nearest process above them that has one.
    let named: HashMap<i32, (String, Option<String>)> = rows
        .iter()
        .filter_map(|row| Some((row.pid, (row.app.clone()?, row.about.clone()))))
        .collect();
    let parents: HashMap<i32, i32> = rows.iter().map(|row| (row.pid, row.ppid)).collect();
    for row in rows
        .iter_mut()
        .filter(|row| row.app.is_none() && row.mine && !matches!(row.kind, "terminal" | "dev"))
    {
        let mut pid = row.ppid;
        for _ in 0..8 {
            if let Some((app, about)) = named.get(&pid) {
                row.app = Some(app.clone());
                row.kind = "app";
                if row.about.is_none() {
                    row.about.clone_from(about);
                }
                break;
            }
            match parents.get(&pid) {
                Some(parent) if *parent > 1 => pid = *parent,
                _ => break,
            }
        }
        if row.app.is_none()
            && let Some(id) = hints.get(&row.pid)
        {
            row.app = Some(id.clone());
            row.kind = "app";
        }
    }
    for row in &mut rows {
        if row.about.is_none()
            && let Some(unit) = row
                .unit
                .as_deref()
                .filter(|unit| unit.ends_with(".service"))
        {
            row.about = Some(format!(
                "Part of the service {}.",
                unit.trim_end_matches(".service")
            ));
        }
    }

    json!({
        "processes": rows,
        "cpus": resources.cpus,
        "memory_total": resources.memory_total,
        "cpu": totals.iter().map(|(cpu, _)| (cpu * 10.0).round() / 10.0).collect::<Vec<f32>>(),
        "memory": totals.iter().map(|(_, memory)| *memory).collect::<Vec<u64>>(),
    })
}

/// The package that installed `exe`, and what it says about itself.
async fn package_of(exe: &str) -> Option<(String, String)> {
    static PACKAGES: OnceLock<Packages> = OnceLock::new();
    let cache = PACKAGES.get_or_init(Mutex::default);
    if let Some(found) = cache.lock().unwrap_or_else(|p| p.into_inner()).get(exe) {
        return found.clone();
    }
    let found = if let Some(rest) = exe.strip_prefix("/snap/") {
        rest.split('/').next().map(|snap| {
            (
                snap.to_owned(),
                format!("Installed as the Snap package {snap}."),
            )
        })
    } else {
        let owner = tokio::process::Command::new("dpkg")
            .args(["-S", exe])
            .output()
            .await
            .ok()
            .filter(|output| output.status.success())
            .and_then(|output| {
                let text = String::from_utf8_lossy(&output.stdout).into_owned();
                let package = text.lines().next()?.split(':').next()?.trim().to_owned();
                (!package.is_empty()).then_some(package)
            });
        match owner {
            Some(package) => {
                let summary = tokio::process::Command::new("dpkg-query")
                    .args(["-W", "-f=${binary:Summary}", &package])
                    .output()
                    .await
                    .ok()
                    .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_owned())
                    .unwrap_or_default();
                Some((package, summary))
            }
            None => None,
        }
    };
    cache
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .insert(exe.to_owned(), found.clone());
    found
}

#[derive(Deserialize)]
struct Which {
    started: u64,
}

async fn process_detail(
    Extension(Paired(device)): Extension<Paired>,
    UrlPath(pid): UrlPath<i32>,
    Query(Which { started }): Query<Which>,
) -> Response {
    if device.is_none() {
        return unpaired();
    }
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok();
    let Some(process) = stat
        .and_then(|text| system::parse_stat(pid, &text))
        .filter(|process| process.started == started)
    else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({"error": "That process has stopped."})),
        )
            .into_response();
    };
    let args: Vec<String> = std::fs::read(format!("/proc/{pid}/cmdline"))
        .map(|bytes| {
            bytes
                .split(|&byte| byte == 0)
                .filter(|part| !part.is_empty())
                .map(|part| String::from_utf8_lossy(part).into_owned())
                .collect()
        })
        .unwrap_or_default();
    // Your own processes say where their program is; others, by their
    // first argument when it's a full path.
    let exe = std::fs::read_link(format!("/proc/{pid}/exe"))
        .ok()
        .map(|path| {
            path.to_string_lossy()
                .trim_end_matches(" (deleted)")
                .to_owned()
        })
        .or_else(|| {
            args.first()
                .map(|first| first.split(' ').next().unwrap_or(first).to_owned())
                .filter(|first| first.starts_with('/'))
        });
    let package = match &exe {
        Some(exe) => package_of(exe).await,
        None => None,
    };
    let parent = std::fs::read_to_string(format!("/proc/{}/stat", process.ppid))
        .ok()
        .and_then(|text| system::parse_stat(process.ppid, &text))
        .map(|parent| parent.comm);
    Json(json!({
        "pid": pid,
        "command": args.join(" "),
        "exe": exe,
        "parent": parent,
        "package": package.as_ref().map(|(name, _)| name),
        "package_about": package.as_ref().map(|(_, about)| about).filter(|about| !about.is_empty()),
    }))
    .into_response()
}

async fn processes_route(
    State(state): State<AppState>,
    Extension(Paired(device)): Extension<Paired>,
) -> Response {
    if device.is_none() {
        return unpaired();
    }
    Json(processes(&state).await).into_response()
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/system/processes", get(processes_route))
        .route("/api/system/processes/{pid}", get(process_detail))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn apps_are_found_by_the_scope_the_desktop_started_them_in() {
        let user = "/user.slice/user-1000.slice/user@1000.service/app.slice";
        assert_eq!(
            app_id(&format!("{user}/app-gnome-google\\x2dchrome-477400.scope")).as_deref(),
            Some("google-chrome")
        );
        assert_eq!(
            app_id(&format!(
                "{user}/app-org.gnome.Terminal.slice/vte-spawn-1f2e.scope"
            ))
            .as_deref(),
            Some("org.gnome.Terminal")
        );
        assert_eq!(
            app_id(&format!("{user}/snap.firefox.firefox-9a1c0b7e.scope")).as_deref(),
            Some("firefox")
        );
        assert_eq!(
            app_id(&format!("{user}/app-gnome-code-12345.scope")).as_deref(),
            Some("code")
        );
        assert_eq!(app_id(&format!("{user}/airlock.service")), None);
        assert_eq!(app_id("/system.slice/postgresql@16-main.service"), None);
        assert_eq!(
            unit_of(&format!("{user}/app-gnome-google\\x2dchrome-477400.scope")).as_deref(),
            Some("app-gnome-google-chrome-477400.scope")
        );
        assert_eq!(
            unit_of("/system.slice/postgresql@16-main.service").as_deref(),
            Some("postgresql@16-main.service")
        );
    }

    #[test]
    fn desktop_entries_give_the_app_its_name() {
        let entry = parse_entry(
            "[Desktop Entry]\nName=Google Chrome\nName[fr]=Google Chrome FR\nComment=Access the Internet\n\n[Desktop Action new-window]\nName=New Window\n",
        );
        assert_eq!(entry.name.as_deref(), Some("Google Chrome"));
        assert_eq!(entry.comment.as_deref(), Some("Access the Internet"));
    }

    #[test]
    fn well_known_programs_are_explained() {
        assert!(known("gnome-shell").is_some());
        assert!(known("gsd-power").unwrap().contains("settings"));
        assert_eq!(known("not-a-real-program-xyz"), None);
        assert_eq!(state_word('R'), "running");
        assert_eq!(state_word('D'), "disk");
        assert_eq!(state_word('S'), "sleeping");
    }

    #[tokio::test]
    #[ignore = "prints this laptop's processes, for a look by eye"]
    async fn print_this_laptops_processes() {
        let state = crate::state::testing::state();
        let first = processes(&state).await;
        tokio::time::sleep(Duration::from_millis(1500)).await;
        let _ = first;
        let all = processes(&state).await;
        let mut rows: Vec<serde_json::Value> = all["processes"].as_array().unwrap().clone();
        rows.sort_by(|a, b| b["memory"].as_u64().cmp(&a["memory"].as_u64()));
        for row in rows.iter().take(45) {
            println!(
                "{:>7} {:<9} {:<28} app={:<22} cpu={:<6} unit={:<40} about={}",
                row["pid"],
                row["kind"].as_str().unwrap(),
                row["name"].as_str().unwrap(),
                row["app"].as_str().unwrap_or("-"),
                row["cpu"],
                row["unit"].as_str().unwrap_or("-"),
                row["about"]
                    .as_str()
                    .unwrap_or("-")
                    .chars()
                    .take(50)
                    .collect::<String>(),
            );
        }
        println!("count {} cpu {}", rows.len(), all["cpu"]);
    }

    #[test]
    fn unit_names_are_unescaped() {
        assert_eq!(unescape("google\\x2dchrome"), "google-chrome");
        assert_eq!(unescape("plain"), "plain");
        assert_eq!(unescape("odd\\xZZ"), "odd\\xZZ");
    }
}
