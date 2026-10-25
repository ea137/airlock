//! What's running on the laptop, for the phone's System screen: resources,
//! listening ports and who can reach them, dev servers, background jobs whose
//! terminal is gone, heavy processes, and your services and timers.
//!
//! Stopping anything is your call twice: the phone confirms first, the hub
//! asks politely (SIGTERM, or `systemctl --user stop`), and only if a process
//! is still running after 5 seconds can the phone, after confirming again,
//! force it (SIGKILL). The hub holds to that order: it forces only a process
//! it asked to stop in the last ten minutes. Signals go through a pidfd
//! opened before the start time is checked, so a pid reused since the phone
//! looked is never signalled. Only your own processes and user services,
//! never your desktop session, the hub itself, or Airlock's terminals.

use std::{
    collections::{HashMap, HashSet},
    net::{IpAddr, Ipv4Addr, Ipv6Addr},
    os::unix::fs::MetadataExt,
    path::Path,
    sync::Mutex,
    time::{Duration, Instant},
};

use axum::{
    Extension, Json, Router,
    body::Bytes,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::{
    phone::{Paired, unpaired},
    ports,
    state::{AppState, internal_error},
};

const STOP_GRACE: Duration = Duration::from_secs(5);
const HEAVY_MAX: usize = 6;

/// Processes that are part of your desktop session: never stopped from here.
pub(crate) const SESSION: [&str; 22] = [
    "systemd",
    "gnome-shell",
    "gnome-session-b",
    "gnome-session-c",
    "gnome-session",
    "Xwayland",
    "Xorg",
    "dbus-daemon",
    "dbus-broker",
    "pipewire",
    "pipewire-pulse",
    "wireplumber",
    "gdm-wayland-ses",
    "gnome-keyring-d",
    "ibus-daemon",
    "at-spi-bus-laun",
    "at-spi2-registr",
    "xdg-desktop-por",
    "xdg-permission-",
    "xdg-document-po",
    "tailscaled",
    "sshd",
];

/// User units that keep your session working: never stopped from here.
const PROTECTED_UNITS: [&str; 14] = [
    "airlock",
    "dbus",
    "pipewire",
    "wireplumber",
    "gnome-",
    "org.gnome.",
    "xdg-",
    "at-spi",
    "gvfs",
    "systemd-",
    "evolution",
    "tracker",
    "gpg-agent",
    "ssh-agent",
];

pub(crate) fn clock_ticks() -> u64 {
    // SAFETY: sysconf only reads a configuration value.
    let ticks = unsafe { libc::sysconf(libc::_SC_CLK_TCK) };
    if ticks > 0 { ticks as u64 } else { 100 }
}

fn page_size() -> u64 {
    // SAFETY: sysconf only reads a configuration value.
    let size = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
    if size > 0 { size as u64 } else { 4096 }
}

pub(crate) fn my_uid() -> u32 {
    // SAFETY: getuid has no preconditions and can't fail.
    unsafe { libc::getuid() }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Proc {
    pub pid: i32,
    pub ppid: i32,
    pub comm: String,
    pub args: Vec<String>,
    /// Clock ticks since boot when it started: with the pid, it names the
    /// process even if the pid is reused.
    pub started: u64,
    pub cpu_ticks: u64,
    pub rss_bytes: u64,
    /// Its controlling terminal, 0 when it has none.
    pub tty: i64,
    /// `R` running, `S` sleeping, `D` waiting on the disk, `T` stopped,
    /// `Z` finished but not collected, `I` idle.
    pub state: char,
    pub nice: i32,
    pub threads: u32,
    pub uid: u32,
}

/// `/proc/<pid>/stat`, read past the command name, which can hold spaces
/// and parentheses.
pub fn parse_stat(pid: i32, text: &str) -> Option<Proc> {
    let open = text.find('(')?;
    let close = text.rfind(')')?;
    let comm = text.get(open + 1..close)?.to_owned();
    let fields: Vec<&str> = text.get(close + 2..)?.split_whitespace().collect();
    let number = |index: usize| fields.get(index)?.parse::<i64>().ok();
    Some(Proc {
        pid,
        ppid: number(1)? as i32,
        tty: number(4)?,
        cpu_ticks: (number(11)? + number(12)?) as u64,
        started: number(19)? as u64,
        rss_bytes: number(21)?.max(0) as u64 * page_size(),
        state: fields.first()?.chars().next()?,
        nice: number(16)? as i32,
        threads: number(17)?.max(0) as u32,
        uid: 0,
        comm,
        args: Vec::new(),
    })
}

pub fn own_processes() -> Vec<Proc> {
    read_processes(Some(my_uid()))
}

/// Everyone's processes, kernel threads left out.
pub fn all_processes() -> Vec<Proc> {
    read_processes(None)
        .into_iter()
        .filter(|process| !(process.args.is_empty() && (process.ppid == 2 || process.pid == 2)))
        .collect()
}

fn read_processes(only: Option<u32>) -> Vec<Proc> {
    let mut found = Vec::new();
    let Ok(entries) = std::fs::read_dir("/proc") else {
        return found;
    };
    for entry in entries.flatten() {
        let Ok(pid) = entry.file_name().to_string_lossy().parse::<i32>() else {
            continue;
        };
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if only.is_some_and(|uid| meta.uid() != uid) {
            continue;
        }
        let Ok(stat) = std::fs::read_to_string(entry.path().join("stat")) else {
            continue;
        };
        let Some(mut process) = parse_stat(pid, &stat) else {
            continue;
        };
        process.uid = meta.uid();
        process.args = std::fs::read(entry.path().join("cmdline"))
            .map(|bytes| {
                bytes
                    .split(|&byte| byte == 0)
                    .filter(|part| !part.is_empty())
                    .map(|part| String::from_utf8_lossy(part).into_owned())
                    .collect()
            })
            .unwrap_or_default();
        found.push(process);
    }
    found
}

/// A process's arguments as it was started. Chrome, Electron apps and
/// others rewrite theirs into one string with spaces, which is split back;
/// a title like `postgres: 16/main: checkpointer` is kept whole.
fn arguments(process: &Proc) -> Vec<String> {
    match process.args.as_slice() {
        [only]
            if only.contains(' ')
                && !only
                    .split(' ')
                    .next()
                    .is_some_and(|word| word.ends_with(':')) =>
        {
            only.split_whitespace().map(str::to_owned).collect()
        }
        args => args.to_vec(),
    }
}

/// A process's name as you'd say it: `astro dev`, `vite`, `python -m
/// http.server`, `chrome renderer`.
pub fn label(process: &Proc) -> String {
    let base = |text: &str| {
        Path::new(text)
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| text.to_owned())
    };
    let args = arguments(process);
    let Some(first) = args.first() else {
        return process.comm.clone();
    };
    // A title the program gave itself.
    if first.contains(": ") {
        return first.chars().take(48).collect();
    }
    let program = base(first);
    // Started from a file named for its version
    // (`~/.local/share/claude/versions/2.1.293`): the folder names it. Started
    // as `/proc/self/exe`: its own name says more.
    let version =
        |text: &str| !text.is_empty() && text.chars().all(|c| c.is_ascii_digit() || c == '.');
    let program = if version(&program) {
        Path::new(first)
            .components()
            .rev()
            .map(|part| part.as_os_str().to_string_lossy().into_owned())
            .find(|part| {
                !version(part) && !["versions", "bin", "lib", "/"].contains(&part.as_str())
            })
            .unwrap_or_else(|| process.comm.clone())
    } else if program == "exe" {
        process.comm.clone()
    } else {
        program
    };
    // Chrome and Electron helpers say what they are with --type.
    if let Some(kind) = args.iter().find_map(|arg| arg.strip_prefix("--type=")) {
        return format!("{program} {}", kind.replace('-', " "));
    }
    let interpreters = [
        "node", "nodejs", "bun", "deno", "python", "python3", "ruby", "php",
    ];
    if !interpreters
        .iter()
        .any(|name| program == *name || program.starts_with("python3."))
    {
        let sub = args
            .get(1)
            .filter(|arg| !arg.starts_with('-') && arg.len() <= 12 && !arg.contains('/'));
        return match sub {
            Some(sub)
                if ["dev", "serve", "run", "start", "preview", "watch"].contains(&sub.as_str()) =>
            {
                format!("{program} {sub}")
            }
            _ => program,
        };
    }
    let mut rest = args.iter().skip(1);
    while let Some(arg) = rest.next() {
        if arg == "-m" {
            return match rest.next() {
                Some(module) => format!("{program} -m {module}"),
                None => program,
            };
        }
        if arg.starts_with('-') {
            continue;
        }
        let script = base(arg);
        let script = script
            .strip_suffix(".js")
            .or_else(|| script.strip_suffix(".mjs"))
            .or_else(|| script.strip_suffix(".cjs"))
            .or_else(|| script.strip_suffix(".py"))
            .unwrap_or(&script)
            .to_owned();
        let script = if script == "cli" || script == "index" || script == "bin" {
            // `node_modules/vite/bin/vite.js` and the like: the package name.
            Path::new(arg)
                .components()
                .rev()
                .map(|part| part.as_os_str().to_string_lossy().into_owned())
                .find(|part| {
                    !["bin", "dist", "cli", "index.js", "cli.js", "bin.js"].contains(&part.as_str())
                        && !part.ends_with(".js")
                })
                .unwrap_or(script)
        } else {
            script
        };
        return match rest
            .next()
            .filter(|sub| !sub.starts_with('-') && sub.len() <= 12)
        {
            Some(sub) => format!("{script} {sub}"),
            None => script,
        };
    }
    program
}

#[derive(Clone, Debug, PartialEq)]
pub struct Listener {
    pub address: IpAddr,
    pub port: u16,
    pub uid: u32,
    pub inode: u64,
}

/// `0100007F:1F90` (little-endian words) as an address and port.
fn parse_endpoint(text: &str) -> Option<(IpAddr, u16)> {
    let (address, port) = text.split_once(':')?;
    let port = u16::from_str_radix(port, 16).ok()?;
    let words: Vec<u32> = (0..address.len() / 8)
        .map(|i| u32::from_str_radix(&address[i * 8..i * 8 + 8], 16).map(u32::from_be))
        .collect::<Result<_, _>>()
        .ok()?;
    let address = match words.as_slice() {
        [word] => IpAddr::V4(Ipv4Addr::from(word.to_be_bytes())),
        [a, b, c, d] => {
            let mut bytes = [0u8; 16];
            for (i, word) in [a, b, c, d].iter().enumerate() {
                bytes[i * 4..i * 4 + 4].copy_from_slice(&word.to_be_bytes());
            }
            let v6 = Ipv6Addr::from(bytes);
            v6.to_ipv4_mapped().map_or(IpAddr::V6(v6), IpAddr::V4)
        }
        _ => return None,
    };
    Some((address, port))
}

pub fn parse_listeners(table: &str) -> Vec<Listener> {
    table
        .lines()
        .skip(1)
        .filter_map(|line| {
            let fields: Vec<&str> = line.split_whitespace().collect();
            if fields.get(3) != Some(&"0A") {
                return None;
            }
            let (address, port) = parse_endpoint(fields.get(1)?)?;
            Some(Listener {
                address,
                port,
                uid: fields.get(7)?.parse().ok()?,
                inode: fields.get(9)?.parse().ok()?,
            })
        })
        .collect()
}

/// Who can reach a listening address: `laptop`, `tailnet`, `all` or `one`.
pub fn exposure(address: &IpAddr) -> &'static str {
    match address {
        address if address.is_loopback() => "laptop",
        address if address.is_unspecified() => "all",
        IpAddr::V4(v4) if v4.octets()[0] == 100 && (64..128).contains(&v4.octets()[1]) => "tailnet",
        IpAddr::V6(v6) if v6.segments()[..3] == [0xfd7a, 0x115c, 0xa1e0] => "tailnet",
        _ => "one",
    }
}

/// Socket inode → the pid of yours holding it.
pub(crate) fn socket_owners(processes: &[Proc]) -> HashMap<u64, i32> {
    let mut owners = HashMap::new();
    for process in processes {
        let Ok(fds) = std::fs::read_dir(format!("/proc/{}/fd", process.pid)) else {
            continue;
        };
        for fd in fds.flatten() {
            if let Ok(target) = std::fs::read_link(fd.path())
                && let Some(inode) = target
                    .to_str()
                    .and_then(|text| text.strip_prefix("socket:["))
                    .and_then(|text| text.strip_suffix(']'))
                    .and_then(|text| text.parse::<u64>().ok())
            {
                owners.insert(inode, process.pid);
            }
        }
    }
    owners
}

const DEV_WORDS: [&str; 24] = [
    "vite",
    "next",
    "astro",
    "webpack",
    "nuxt",
    "remix",
    "svelte",
    "react-scripts",
    "parcel",
    "serve",
    "http.server",
    "rails",
    "flask",
    "uvicorn",
    "gunicorn",
    "manage",
    "hugo",
    "jekyll",
    "eleventy",
    "storybook",
    "expo",
    "trunk",
    "wrangler",
    "dev",
];

pub(crate) fn looks_like_dev_server(label: &str) -> bool {
    let label = label.to_lowercase();
    // Another Airlock hub (a test's, or the installed one seen from a test).
    !label.starts_with("airlock") && DEV_WORDS.iter().any(|word| label.contains(word))
}

/// Your services' processes are in a `.service` cgroup.
fn in_service(pid: i32) -> bool {
    std::fs::read_to_string(format!("/proc/{pid}/cgroup")).is_ok_and(|cgroup| {
        cgroup
            .lines()
            .any(|line| line.trim_end().ends_with(".service"))
    })
}

/// Seconds since boot.
pub(crate) fn uptime() -> f64 {
    std::fs::read_to_string("/proc/uptime")
        .ok()
        .and_then(|text| text.split_whitespace().next()?.parse().ok())
        .unwrap_or(0.0)
}

#[derive(Clone, Debug, Serialize)]
pub struct ProcessView {
    pub pid: i32,
    pub started: u64,
    pub label: String,
    pub comm: String,
    /// Seconds it has been running.
    pub running_for: u64,
    pub cpu: Option<f32>,
    pub memory: u64,
    pub cwd: Option<String>,
    pub terminal: Option<TerminalLink>,
    pub orphaned: bool,
    pub ports: Vec<u16>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct TerminalLink {
    pub terminal: u32,
    pub tab: u32,
}

#[derive(Clone, Debug, Serialize)]
pub struct PortView {
    pub port: u16,
    pub address: String,
    /// `laptop`, `tailnet`, `all` or `one`.
    pub exposure: &'static str,
    pub name: String,
    pub pid: Option<i32>,
    /// The owning process's start time, for stopping it.
    pub started: Option<u64>,
    pub dev: bool,
    pub terminal: Option<TerminalLink>,
    #[serde(flatten)]
    pub about: ports::About,
}

/// CPU time used by each process, named by pid and start time.
type CpuTimes = HashMap<(i32, u64), u64>;

/// How many looks back the CPU and memory history goes.
pub const HISTORY: usize = 30;

/// The laptop's busy and total CPU time at the last look, and its CPU and
/// memory at the last few looks.
type Totals = Mutex<(Option<(u64, u64)>, std::collections::VecDeque<(f32, u64)>)>;

/// CPU use between two looks at the processes, and the last few looks.
#[derive(Default)]
pub struct Sampler {
    last: Mutex<Option<(Instant, CpuTimes)>>,
    /// Each process's share of a CPU at the last few looks, oldest first.
    history: Mutex<HashMap<(i32, u64), std::collections::VecDeque<f32>>>,
    totals: Totals,
}

/// Busy and total CPU time since boot, from `/proc/stat`'s first line.
fn cpu_times(stat: &str) -> Option<(u64, u64)> {
    let line = stat.lines().next()?.strip_prefix("cpu ")?;
    let numbers: Vec<u64> = line
        .split_whitespace()
        .filter_map(|part| part.parse().ok())
        .collect();
    let field = |index: usize| numbers.get(index).copied().unwrap_or(0);
    // user, nice, system, idle, iowait, irq, softirq, steal.
    let busy = field(0) + field(1) + field(2) + field(5) + field(6) + field(7);
    Some((busy, busy + field(3) + field(4)))
}

impl Sampler {
    pub fn history_of(&self, pid: i32, started: u64) -> Vec<f32> {
        self.history
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(&(pid, started))
            .map(|shares| shares.iter().copied().collect())
            .unwrap_or_default()
    }

    /// Takes the laptop's CPU and memory now, and returns the last few
    /// looks: CPU as a share of all cores, memory in bytes.
    pub fn totals(&self, memory_used: u64) -> Vec<(f32, u64)> {
        let mut totals = self
            .totals
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let now = std::fs::read_to_string("/proc/stat")
            .ok()
            .and_then(|stat| cpu_times(&stat));
        if let (Some((busy, total)), Some((busy_before, total_before))) = (now, totals.0) {
            let spent = total.saturating_sub(total_before);
            if spent > 0 {
                let share = busy.saturating_sub(busy_before) as f32 / spent as f32 * 100.0;
                totals.1.push_back((share, memory_used));
                while totals.1.len() > HISTORY {
                    totals.1.pop_front();
                }
            }
        }
        totals.0 = now.or(totals.0);
        totals.1.iter().copied().collect()
    }

    /// Each process's share of a CPU since the last look, if there was one
    /// in the last minute.
    fn cpu(&self, processes: &[Proc]) -> HashMap<(i32, u64), f32> {
        let now = Instant::now();
        let current: HashMap<(i32, u64), u64> = processes
            .iter()
            .map(|p| ((p.pid, p.started), p.cpu_ticks))
            .collect();
        let mut last = self
            .last
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut shares = HashMap::new();
        if let Some((at, before)) = last.as_ref() {
            let seconds = now.duration_since(*at).as_secs_f32();
            if (0.2..60.0).contains(&seconds) {
                let ticks = clock_ticks() as f32;
                for (key, used) in &current {
                    if let Some(earlier) = before.get(key) {
                        let share = used.saturating_sub(*earlier) as f32 / ticks / seconds * 100.0;
                        shares.insert(*key, share);
                    }
                }
            }
        }
        *last = Some((now, current));
        drop(last);
        if !shares.is_empty() {
            let mut history = self
                .history
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            history.retain(|key, _| shares.contains_key(key));
            for (key, share) in &shares {
                let past = history.entry(*key).or_default();
                past.push_back(*share);
                while past.len() > HISTORY {
                    past.pop_front();
                }
            }
        }
        shares
    }

    pub fn sample(&self, processes: &[Proc]) -> HashMap<(i32, u64), f32> {
        self.cpu(processes)
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct Resources {
    pub load: f32,
    pub cpus: usize,
    pub memory_used: u64,
    pub memory_total: u64,
    pub disk_used: u64,
    pub disk_total: u64,
    pub battery: Option<u8>,
    pub charging: Option<bool>,
}

fn meminfo(text: &str, key: &str) -> u64 {
    text.lines()
        .find_map(|line| {
            line.strip_prefix(key)?
                .split_whitespace()
                .next()?
                .parse::<u64>()
                .ok()
        })
        .unwrap_or(0)
        * 1024
}

fn disk(path: &str) -> (u64, u64) {
    let Ok(path) = std::ffi::CString::new(path) else {
        return (0, 0);
    };
    // SAFETY: statvfs fills the zeroed struct for a valid C string path.
    let mut stat: libc::statvfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statvfs(path.as_ptr(), &mut stat) } != 0 {
        return (0, 0);
    }
    let block = stat.f_frsize;
    let total = stat.f_blocks * block;
    let free = stat.f_bavail * block;
    (total.saturating_sub(free), total)
}

pub fn resources() -> Resources {
    let load = std::fs::read_to_string("/proc/loadavg")
        .ok()
        .and_then(|text| text.split_whitespace().next()?.parse().ok())
        .unwrap_or(0.0);
    let mem = std::fs::read_to_string("/proc/meminfo").unwrap_or_default();
    let total = meminfo(&mem, "MemTotal:");
    let available = meminfo(&mem, "MemAvailable:");
    let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_owned());
    let (disk_used, disk_total) = disk(&home);
    let battery = std::fs::read_dir("/sys/class/power_supply")
        .ok()
        .and_then(|entries| {
            entries
                .flatten()
                .find(|entry| entry.file_name().to_string_lossy().starts_with("BAT"))
        })
        .map(|entry| entry.path());
    let read = |name: &str| {
        battery
            .as_ref()
            .and_then(|dir| std::fs::read_to_string(dir.join(name)).ok())
            .map(|text| text.trim().to_owned())
    };
    Resources {
        load,
        cpus: std::thread::available_parallelism().map_or(1, |n| n.get()),
        memory_used: total.saturating_sub(available),
        memory_total: total,
        disk_used,
        disk_total,
        battery: read("capacity").and_then(|text| text.parse().ok()),
        charging: read("status").map(|status| status != "Discharging"),
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct Overview {
    pub resources: Resources,
    pub ports: Vec<PortView>,
    pub jobs: Vec<ProcessView>,
    pub heavy: Vec<ProcessView>,
    /// Whether the firewall is on; `None` without one Airlock knows.
    pub firewall: Option<bool>,
}

/// Ports the hub itself listens on: never previewed, never stopped.
fn own_ports(state: &AppState) -> HashSet<u16> {
    let mut ports = HashSet::from([state.config.listen.port()]);
    if let Some(preview) = state.config.preview_listen {
        ports.insert(preview.port());
    }
    ports
}

pub async fn overview(state: &AppState, sampler: &Sampler) -> Overview {
    let processes = tokio::task::spawn_blocking(own_processes)
        .await
        .unwrap_or_default();
    let cpu = sampler.cpu(&processes);
    let panes = state.tmux.panes().await.unwrap_or_default();
    let mut tables = String::new();
    for table in ["/proc/net/tcp", "/proc/net/tcp6"] {
        if let Ok(text) = std::fs::read_to_string(table) {
            tables.push_str(&text);
            tables.push('\n');
        }
    }
    // Both tables carry a header line; the second one's is skipped as junk.
    let listeners = parse_listeners(&tables);
    let owners = socket_owners(&processes);
    let by_pid: HashMap<i32, &Proc> = processes.iter().map(|p| (p.pid, p)).collect();
    let hub_ports = own_ports(state);
    let containers = ports::containers().await;
    let up = uptime();
    let ticks = clock_ticks() as f64;

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
    let mut ports_of: HashMap<i32, Vec<u16>> = HashMap::new();
    let mut seen = HashSet::new();
    let mut ports = Vec::new();
    for listener in &listeners {
        if !seen.insert((listener.port, listener.address)) {
            continue;
        }
        let pid = owners.get(&listener.inode).copied();
        let process = pid.and_then(|pid| by_pid.get(&pid));
        if let Some(pid) = pid {
            ports_of.entry(pid).or_default().push(listener.port);
        }
        let dev = process.is_some_and(|process| {
            listener.port >= 1024
                && !hub_ports.contains(&listener.port)
                && (looks_like_dev_server(&label(process))
                    || process.tty != 0
                    || terminal_of(process).is_some())
        });
        let exposure = exposure(&listener.address);
        let program = process.map(|process| (process.comm.as_str(), dev));
        let mut about = ports::about(listener.port, exposure, program, &containers);
        if hub_ports.contains(&listener.port) {
            about.kind = ports::Kind::Airlock;
            about.verdict = ports::verdict(about.kind, exposure);
        }
        let name = match (process, &about.container) {
            _ if about.kind == ports::Kind::Airlock => "Airlock".to_owned(),
            (Some(process), _) => label(process),
            (None, Some(container)) => container.clone(),
            (None, None) if about.kind == ports::Kind::Unknown => {
                "another user's program".to_owned()
            }
            (None, None) => about.kind.title().to_owned(),
        };
        ports.push(PortView {
            port: listener.port,
            address: listener.address.to_string(),
            exposure,
            name,
            pid,
            started: process.map(|process| process.started),
            dev,
            terminal: process.and_then(|process| terminal_of(process)),
            about,
        });
    }
    // The same port on IPv4 and IPv6 is one row; the wider exposure wins.
    let rank = |exposure: &str| match exposure {
        "all" => 3,
        "one" => 2,
        "tailnet" => 1,
        _ => 0,
    };
    ports.sort_by_key(|port| (port.port, std::cmp::Reverse(rank(port.exposure))));
    ports.dedup_by_key(|port| port.port);
    ports.sort_by_key(|port| (!port.dev, std::cmp::Reverse(rank(port.exposure)), port.port));

    let view = |process: &Proc| ProcessView {
        pid: process.pid,
        started: process.started,
        label: label(process),
        comm: process.comm.clone(),
        running_for: (up - process.started as f64 / ticks).max(0.0) as u64,
        cpu: cpu.get(&(process.pid, process.started)).copied(),
        memory: process.rss_bytes,
        cwd: std::fs::read_link(format!("/proc/{}/cwd", process.pid))
            .ok()
            .map(|path| path.to_string_lossy().into_owned()),
        terminal: terminal_of(process),
        orphaned: process.tty == 0
            && terminal_of(process).is_none()
            && by_pid
                .get(&process.ppid)
                .is_none_or(|parent| parent.comm == "systemd"),
        ports: ports_of.get(&process.pid).cloned().unwrap_or_default(),
    };

    // Background jobs: a dev server or listener left behind by a closed
    // terminal, not one of your services.
    let me = std::process::id() as i32;
    let jobs: Vec<ProcessView> = processes
        .iter()
        .filter(|process| process.pid != me)
        .map(&view)
        .filter(|process| {
            process.orphaned
                && (!process.ports.is_empty() || looks_like_dev_server(&process.label))
                && !in_service(process.pid)
                && process.running_for >= 60
        })
        .collect();

    let mut heavy: Vec<ProcessView> = processes
        .iter()
        .filter(|process| process.pid != me)
        .map(&view)
        .collect();
    heavy.sort_by(|a, b| {
        let key = |p: &ProcessView| (p.cpu.unwrap_or(0.0), p.memory);
        key(b)
            .partial_cmp(&key(a))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    heavy.truncate(HEAVY_MAX);

    Overview {
        resources: resources(),
        ports,
        jobs,
        heavy,
        firewall: ports::firewall(),
    }
}

pub(crate) fn refuse_stop(
    state: &AppState,
    process: &Proc,
    processes: &[Proc],
) -> Option<&'static str> {
    let me = std::process::id() as i32;
    // The hub and everything above it.
    let mut pid = me;
    let by_pid: HashMap<i32, &Proc> = processes.iter().map(|p| (p.pid, p)).collect();
    for _ in 0..32 {
        if process.pid == pid {
            return Some("That would stop Airlock itself.");
        }
        match by_pid.get(&pid) {
            Some(parent) => pid = parent.ppid,
            None => break,
        }
    }
    if process.pid <= 1 || SESSION.contains(&process.comm.as_str()) {
        return Some("That's part of your desktop session; Airlock won't stop it.");
    }
    if process.comm.starts_with("tmux") && process.args.iter().any(|arg| arg == state.tmux.socket())
    {
        return Some("That's Airlock's terminals; close them from Terminals instead.");
    }
    None
}

#[derive(Deserialize)]
struct StopRequest {
    pid: i32,
    /// The process's start time, from the System screen, so a reused pid
    /// is never stopped by mistake.
    started: u64,
    #[serde(default)]
    force: bool,
}

fn refusal(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({"error": message}))).into_response()
}

fn alive(pid: i32, started: u64) -> bool {
    std::fs::read_to_string(format!("/proc/{pid}/stat"))
        .ok()
        .and_then(|text| parse_stat(pid, &text))
        .is_some_and(|process| process.started == started)
}

const FORCE_WITHIN: Duration = Duration::from_secs(10 * 60);

/// The processes asked to stop lately: only those may be forced, so the
/// second confirmation is the hub's rule, not only the phone's.
#[derive(Default)]
pub struct AskedToStop(Mutex<HashMap<(i32, u64), Instant>>);

impl AskedToStop {
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<(i32, u64), Instant>> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn note(&self, pid: i32, started: u64) {
        let mut asked = self.lock();
        asked.retain(|_, at| at.elapsed() < FORCE_WITHIN);
        asked.insert((pid, started), Instant::now());
    }

    fn lately(&self, pid: i32, started: u64) -> bool {
        self.lock()
            .get(&(pid, started))
            .is_some_and(|at| at.elapsed() < FORCE_WITHIN)
    }
}

/// A process held by a pidfd, which names that process and no other even
/// after its pid is reused.
struct Held(std::os::fd::OwnedFd);

enum Unsignalled {
    Gone,
    Refused,
}

impl Held {
    /// Takes hold of `pid` if it is still the process that started at
    /// `started`. The pidfd is opened first, so a start time that matches
    /// afterwards is that of the process it holds.
    fn take(pid: i32, started: u64) -> Option<Self> {
        use std::os::fd::FromRawFd;
        // SAFETY: pidfd_open takes a pid and flags, and returns a new file
        // descriptor or -1.
        let fd = unsafe { libc::syscall(libc::SYS_pidfd_open, pid, 0) };
        if fd < 0 {
            return None;
        }
        // SAFETY: the descriptor was just opened, and nothing else owns it.
        let fd = unsafe { std::os::fd::OwnedFd::from_raw_fd(fd as std::os::fd::RawFd) };
        alive(pid, started).then_some(Self(fd))
    }

    fn signal(&self, signal: i32) -> Result<(), Unsignalled> {
        use std::os::fd::AsRawFd;
        // SAFETY: sends a signal through a pidfd this owns, with no info.
        let sent = unsafe {
            libc::syscall(
                libc::SYS_pidfd_send_signal,
                self.0.as_raw_fd(),
                signal,
                std::ptr::null::<libc::siginfo_t>(),
                0,
            )
        };
        match sent {
            0 => Ok(()),
            _ if std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH) => {
                Err(Unsignalled::Gone)
            }
            _ => Err(Unsignalled::Refused),
        }
    }

    /// Whether the process exits within `wait`: a pidfd turns readable
    /// when its process does.
    async fn exits_within(self, wait: Duration) -> bool {
        let interest = tokio::io::Interest::READABLE;
        // SAFETY: an OwnedFd is open, and stays the same descriptor until
        // the AsyncFd that owns it is dropped.
        let Ok(fd) =
            (unsafe { tokio::io::unix::AsyncFd::register_with_interest(self.0, interest) })
        else {
            return false;
        };
        tokio::time::timeout(wait, fd.readable())
            .await
            .is_ok_and(|ready| ready.is_ok())
    }
}

#[derive(Debug, PartialEq)]
pub(crate) enum Quit {
    /// It exited, or was already gone.
    Exited,
    StillRunning,
    /// It isn't the process `is_it` wanted, or the hub may not signal it.
    Refused,
}

/// Asks your process `pid` to quit (SIGTERM) and waits up to `wait` for it
/// to. `is_it` is checked once the process is held by its start time, so a
/// pid reused since can't be hit.
pub(crate) async fn quit(pid: i32, wait: Duration, is_it: impl Fn(i32) -> bool) -> Quit {
    let started = std::fs::read_to_string(format!("/proc/{pid}/stat"))
        .ok()
        .and_then(|stat| parse_stat(pid, &stat))
        .map(|process| process.started);
    let Some(held) = started.and_then(|started| Held::take(pid, started)) else {
        return Quit::Exited;
    };
    if !is_it(pid) {
        return Quit::Refused;
    }
    match held.signal(libc::SIGTERM) {
        Ok(()) => {}
        Err(Unsignalled::Gone) => return Quit::Exited,
        Err(Unsignalled::Refused) => return Quit::Refused,
    }
    if held.exits_within(wait).await {
        Quit::Exited
    } else {
        Quit::StillRunning
    }
}

async fn stop(
    State(state): State<AppState>,
    Extension(Paired(device)): Extension<Paired>,
    bytes: Bytes,
) -> Response {
    let Some(device) = device else {
        return unpaired();
    };
    let Ok(request) = serde_json::from_slice::<StopRequest>(&bytes) else {
        return refusal(StatusCode::BAD_REQUEST, "Expected {\"pid\", \"started\"}.");
    };
    let processes = tokio::task::spawn_blocking(own_processes)
        .await
        .unwrap_or_default();
    let Some(process) = processes
        .iter()
        .find(|p| p.pid == request.pid && p.started == request.started)
    else {
        return refusal(StatusCode::NOT_FOUND, "That process has already stopped.");
    };
    if let Some(reason) = refuse_stop(&state, process, &processes) {
        return refusal(StatusCode::FORBIDDEN, reason);
    }
    if request.force && !state.asked_to_stop.lately(process.pid, process.started) {
        return refusal(
            StatusCode::CONFLICT,
            "Ask it to stop first; it's forced only if it doesn't.",
        );
    }
    let gone = || refusal(StatusCode::NOT_FOUND, "That process has already stopped.");
    let Some(held) = Held::take(process.pid, process.started) else {
        return gone();
    };
    let name = label(process);
    let signal = if request.force {
        libc::SIGKILL
    } else {
        libc::SIGTERM
    };
    match held.signal(signal) {
        Ok(()) => {}
        Err(Unsignalled::Gone) => return gone(),
        Err(Unsignalled::Refused) => {
            return refusal(StatusCode::CONFLICT, "It couldn't be stopped.");
        }
    }
    if !request.force {
        state.asked_to_stop.note(process.pid, process.started);
    }
    let detail = format!("{name} (process {}) from {}", process.pid, device.name);
    let action = if request.force {
        "process forced to stop"
    } else {
        "process asked to stop"
    };
    if let Err(error) = state.store().audit("phone", action, &detail) {
        return internal_error(error);
    }
    Json(json!({"stopped": held.exits_within(STOP_GRACE).await})).into_response()
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Unit {
    pub unit: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Debug, Deserialize)]
struct TimerRow {
    unit: String,
    #[serde(default)]
    activates: String,
    /// Microseconds since the epoch; 0 when not scheduled.
    #[serde(default)]
    next: u64,
}

#[derive(Debug, Serialize)]
pub struct TimerView {
    pub unit: String,
    pub activates: String,
    /// Seconds since the epoch.
    pub next: Option<i64>,
}

pub(crate) fn protected_unit(unit: &str) -> bool {
    PROTECTED_UNITS
        .iter()
        .any(|prefix| unit.starts_with(prefix))
}

async fn systemctl_json<T: serde::de::DeserializeOwned>(args: &[&str]) -> Option<T> {
    let output = tokio::process::Command::new("systemctl")
        .arg("--user")
        .args(args)
        .args(["--output=json", "--no-pager"])
        .output()
        .await
        .ok()?;
    serde_json::from_slice(&output.stdout).ok()
}

pub async fn services() -> (Vec<Unit>, Vec<TimerView>) {
    let running: Vec<Unit> = systemctl_json(&["list-units", "--type=service", "--state=running"])
        .await
        .unwrap_or_default();
    let services = running
        .into_iter()
        .filter(|unit| !protected_unit(&unit.unit))
        .collect();
    let timers: Vec<TimerRow> = systemctl_json(&["list-timers"]).await.unwrap_or_default();
    let timers = timers
        .into_iter()
        .map(|timer| TimerView {
            unit: timer.unit,
            activates: timer.activates,
            next: (timer.next > 0).then_some((timer.next / 1_000_000) as i64),
        })
        .collect();
    (services, timers)
}

async fn overview_route(
    State(state): State<AppState>,
    Extension(Paired(device)): Extension<Paired>,
) -> Response {
    if device.is_none() {
        return unpaired();
    }
    let overview = overview(&state, &state.sampler).await;
    let (services, timers) = services().await;
    Json(json!({
        "resources": overview.resources,
        "ports": overview.ports,
        "jobs": overview.jobs,
        "heavy": overview.heavy,
        "firewall": overview.firewall,
        "services": services,
        "timers": timers,
    }))
    .into_response()
}

#[derive(Deserialize)]
struct UnitRequest {
    unit: String,
}

async fn stop_unit(
    State(state): State<AppState>,
    Extension(Paired(device)): Extension<Paired>,
    bytes: Bytes,
) -> Response {
    let Some(device) = device else {
        return unpaired();
    };
    let Ok(UnitRequest { unit }) = serde_json::from_slice(&bytes) else {
        return refusal(StatusCode::BAD_REQUEST, "Expected {\"unit\"}.");
    };
    let valid = (unit.ends_with(".service") || unit.ends_with(".timer"))
        && unit
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_.@:".contains(c));
    if !valid {
        return refusal(
            StatusCode::BAD_REQUEST,
            "That isn't a service or timer name.",
        );
    }
    if protected_unit(&unit) {
        return refusal(
            StatusCode::FORBIDDEN,
            "That keeps your session or Airlock running; it isn't stopped from here.",
        );
    }
    let (services, timers) = services().await;
    let listed = services.iter().any(|s| s.unit == unit) || timers.iter().any(|t| t.unit == unit);
    if !listed {
        return refusal(StatusCode::NOT_FOUND, "That isn't running.");
    }
    let output = tokio::process::Command::new("systemctl")
        .args(["--user", "stop", &unit])
        .output()
        .await;
    match output {
        Ok(output) if output.status.success() => {
            let _ = state.store().audit(
                "phone",
                "service stopped",
                &format!("{unit} from {}", device.name),
            );
            Json(json!({"stopped": true})).into_response()
        }
        Ok(output) => refusal(
            StatusCode::CONFLICT,
            &format!(
                "systemctl: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ),
        ),
        Err(error) => internal_error(error.into()),
    }
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/system", get(overview_route))
        .route("/api/system/stop", post(stop))
        .route("/api/system/services/stop", post(stop_unit))
        .route("/api/system/containers/stop", post(ports::stop_container))
        .route("/api/system/open", post(open_dev_server))
}

#[derive(Deserialize)]
struct PortRequest {
    port: u16,
}

async fn open_dev_server(
    State(state): State<AppState>,
    Extension(Paired(device)): Extension<Paired>,
    bytes: Bytes,
) -> Response {
    if device.is_none() {
        return unpaired();
    }
    let Ok(PortRequest { port }) = serde_json::from_slice(&bytes) else {
        return refusal(StatusCode::BAD_REQUEST, "Expected {\"port\"}.");
    };
    if !dev_ports(&state).await.contains(&port) {
        return refusal(StatusCode::NOT_FOUND, "That dev server isn't running.");
    }
    let opened = tokio::process::Command::new("gio")
        .args(["open", &format!("http://localhost:{port}/")])
        .kill_on_drop(true)
        .output()
        .await;
    match opened {
        Ok(output) if output.status.success() => StatusCode::NO_CONTENT.into_response(),
        _ => refusal(
            StatusCode::BAD_GATEWAY,
            "The laptop couldn't open its browser.",
        ),
    }
}

/// The dev servers you can preview now: your own listeners on unprivileged
/// ports, not the hub's.
pub async fn dev_ports(state: &AppState) -> Vec<u16> {
    let overview = overview(state, &Sampler::default()).await;
    overview
        .ports
        .into_iter()
        .filter(|port| port.dev)
        .map(|port| port.port)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stat_lines_with_odd_command_names_are_read() {
        let text = "4242 (tmux: server (x)) S 1 4242 4242 0 -1 4194560 100 0 0 0 250 50 0 0 20 0 1 0 123456 1000000 2048 18446744073709551615";
        let process = parse_stat(4242, text).unwrap();
        assert_eq!(process.comm, "tmux: server (x)");
        assert_eq!(process.ppid, 1);
        assert_eq!(process.tty, 0);
        assert_eq!(process.cpu_ticks, 300);
        assert_eq!(process.started, 123456);
        assert_eq!(process.rss_bytes, 2048 * page_size());
    }

    #[test]
    fn listening_sockets_are_read_from_proc() {
        let tcp = "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n   0: 0100007F:1E0A 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 55555 1 0 100 0 0 10 0\n   1: 00000000:1538 00000000:0000 0A 00000000:00000000 00:00000000 00000000   125        0 66666 1 0 100 0 0 10 0\n   2: 0100007F:9C40 0100007F:1E0A 01 00000000:00000000 00:00000000 00000000  1000        0 77777 1 0 100 0 0 10 0\n";
        let listeners = parse_listeners(tcp);
        assert_eq!(listeners.len(), 2, "established connections are left out");
        assert_eq!(listeners[0].address, IpAddr::V4(Ipv4Addr::LOCALHOST));
        assert_eq!(listeners[0].port, 7690);
        assert_eq!(listeners[0].uid, 1000);
        assert_eq!(listeners[1].port, 5432);
        assert_eq!(exposure(&listeners[1].address), "all");

        let tcp6 = "  sl  local_address                         remote_address                        st\n   0: 00000000000000000000000001000000:1F90 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 88888 1\n";
        let six = parse_listeners(tcp6);
        assert_eq!(six[0].address, IpAddr::V6(Ipv6Addr::LOCALHOST));
        assert_eq!(six[0].port, 8080);
    }

    #[test]
    fn exposure_is_named_by_address() {
        assert_eq!(exposure(&"127.0.0.1".parse().unwrap()), "laptop");
        assert_eq!(exposure(&"::".parse().unwrap()), "all");
        assert_eq!(exposure(&"100.64.0.7".parse().unwrap()), "tailnet");
        assert_eq!(exposure(&"fd7a:115c:a1e0::1".parse().unwrap()), "tailnet");
        assert_eq!(exposure(&"192.168.1.20".parse().unwrap()), "one");
    }

    #[test]
    fn processes_are_named_as_you_would() {
        let process = |args: &[&str]| Proc {
            pid: 1,
            ppid: 0,
            comm: "node".to_owned(),
            args: args.iter().map(|a| (*a).to_owned()).collect(),
            started: 0,
            cpu_ticks: 0,
            rss_bytes: 0,
            tty: 0,
            state: 'S',
            nice: 0,
            threads: 1,
            uid: 1000,
        };
        assert_eq!(
            label(&process(&["node", "/app/node_modules/.bin/astro", "dev"])),
            "astro dev"
        );
        // Chrome rewrites its arguments into one string; its helpers say
        // what they are.
        assert_eq!(
            label(&process(&[
                "/opt/google/chrome/chrome --type=renderer --crashpad-handler-pid=4 --enable-crash-reporter=x,"
            ])),
            "chrome renderer"
        );
        assert_eq!(
            label(&process(&[
                "/usr/share/code/code",
                "--type=gpu-process",
                "--no-sandbox"
            ])),
            "code gpu process"
        );
        assert_eq!(
            label(&process(&[
                "/proc/self/exe",
                "--type=utility",
                "--utility-sub-type=node"
            ])),
            "node utility"
        );
        assert_eq!(
            label(&process(&[
                "/home/me/.local/share/claude/versions/2.1.293",
                "--resume"
            ])),
            "claude"
        );
        // A title the program set for itself stays whole.
        assert_eq!(
            label(&process(&["postgres: 16/main: checkpointer "])),
            "postgres: 16/main: checkpointer "
        );
        assert_eq!(
            label(&process(&["node", "/app/node_modules/vite/bin/vite.js"])),
            "vite"
        );
        assert_eq!(
            label(&process(&["python3", "-m", "http.server", "8000"])),
            "python3 -m http.server"
        );
        assert_eq!(
            label(&process(&["/usr/bin/postgres", "-D", "/var/lib"])),
            "postgres"
        );
        assert_eq!(label(&process(&["cargo", "run"])), "cargo run");
        assert_eq!(label(&process(&[])), "node");
        assert!(looks_like_dev_server("astro dev"));
        assert!(!looks_like_dev_server("postgres"));
    }

    #[test]
    fn resources_are_read() {
        let resources = resources();
        assert!(resources.memory_total > 0);
        assert!(resources.memory_used <= resources.memory_total);
        assert!(resources.disk_total > 0);
        assert!(resources.cpus >= 1);
    }

    #[test]
    fn session_units_are_protected() {
        assert!(protected_unit("airlock.service"));
        assert!(protected_unit("pipewire.service"));
        assert!(protected_unit("org.gnome.Shell@wayland.service"));
        assert!(!protected_unit("notes-sync.service"));
        assert!(!protected_unit("backup-poll.timer"));
    }

    #[tokio::test]
    async fn a_process_is_held_by_its_start_time_and_seen_to_exit() {
        let mut child = std::process::Command::new("sleep")
            .arg("30")
            .spawn()
            .unwrap();
        let pid = child.id() as i32;
        let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).unwrap();
        let started = parse_stat(pid, &stat).unwrap().started;

        // Another start time means another process under a reused pid.
        assert!(Held::take(pid, started + 1).is_none());
        let held = Held::take(pid, started).expect("held");
        assert!(held.signal(libc::SIGTERM).is_ok());
        assert!(held.exits_within(Duration::from_secs(5)).await);
        child.wait().unwrap();

        // Asked once, it may be forced; never asked, it may not.
        let asked = AskedToStop::default();
        assert!(!asked.lately(pid, started));
        asked.note(pid, started);
        assert!(asked.lately(pid, started));
        assert!(!asked.lately(pid, started + 1));
    }

    #[tokio::test]
    async fn a_dev_server_in_a_terminal_is_found_and_stopped() {
        use axum::{body::Body, http::Request};
        use http_body_util::BodyExt;
        use tower::ServiceExt;

        use crate::{state::testing::state_with, store::Device, terminals::testing::ScratchTmux};

        let scratch = ScratchTmux::new();
        let state = state_with(scratch.tmux.clone());
        let port = std::net::TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let terminal = scratch.tmux.create("dev", scratch.dir()).await.unwrap();
        let line = format!("python3 -m http.server {port} --bind 127.0.0.1");
        scratch.tmux.type_line(terminal, &line).await.unwrap();

        let mut found = None;
        for _ in 0..150 {
            let overview = overview(&state, &state.sampler).await;
            found = overview.ports.into_iter().find(|p| p.port == port);
            if found.as_ref().is_some_and(|p| p.terminal.is_some()) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        let server = found.expect("the dev server's port is listed");
        assert!(server.dev, "{server:?}");
        assert_eq!(server.name, "python3 -m http.server");
        assert_eq!(server.exposure, "laptop");
        assert_eq!(server.terminal.as_ref().map(|t| t.terminal), Some(terminal));
        assert!(dev_ports(&state).await.contains(&port));

        let device = Device {
            id: "d1".to_owned(),
            name: "Test phone".to_owned(),
            login: "you@example.com".to_owned(),
            created_at: 0,
            last_seen: 0,
            face_id: false,
        };
        let phone = routes()
            .layer(Extension(Paired(Some(device))))
            .with_state(state.clone());
        let stop = |body: serde_json::Value| {
            let phone = phone.clone();
            async move {
                let request = Request::post("/api/system/stop")
                    .body(Body::from(body.to_string()))
                    .unwrap();
                let response = phone.oneshot(request).await.unwrap();
                let status = response.status();
                let bytes = response.into_body().collect().await.unwrap().to_bytes();
                (
                    status,
                    serde_json::from_slice::<serde_json::Value>(&bytes).unwrap(),
                )
            }
        };
        // A pid that's been reused is never stopped: the start time must match.
        let (status, _) = stop(json!({"pid": server.pid, "started": 1})).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        let me = own_processes()
            .into_iter()
            .find(|p| p.pid == std::process::id() as i32)
            .unwrap();
        let (status, refused) = stop(json!({"pid": me.pid, "started": me.started})).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        assert_eq!(refused["error"], "That would stop Airlock itself.");
        // Forcing comes only after asking: the hub holds that rule, whatever
        // the phone sends.
        let (status, refused) =
            stop(json!({"pid": server.pid, "started": server.started, "force": true})).await;
        assert_eq!(status, StatusCode::CONFLICT);
        assert_eq!(
            refused["error"],
            "Ask it to stop first; it's forced only if it doesn't."
        );
        assert!(alive(server.pid.unwrap(), server.started.unwrap()));

        let (status, stopped) = stop(json!({"pid": server.pid, "started": server.started})).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(stopped["stopped"], true);
        assert!(
            !overview(&state, &state.sampler)
                .await
                .ports
                .iter()
                .any(|p| p.port == port)
        );
        assert!(
            state.store().audit_log(1).unwrap()[0]
                .detail
                .contains("python3 -m http.server")
        );
    }
}
