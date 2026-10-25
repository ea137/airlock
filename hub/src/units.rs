//! Services and timers, yours and the system's, for the phone's Services
//! tab: what each is (its own description), whether it runs, since when,
//! what it uses, and when a timer runs next and ran last. Yours can be
//! stopped from the phone (see [`crate::system`]); the system's are for
//! looking, since stopping them needs your password.

use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

use axum::{
    Extension, Json, Router,
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::{
    phone::{Paired, unpaired},
    state::AppState,
    system,
};

const FRESH: Duration = Duration::from_secs(5);

#[derive(Debug, Deserialize)]
struct ListRow {
    unit: String,
    #[serde(default)]
    load: String,
    #[serde(default)]
    active: String,
    #[serde(default)]
    sub: String,
    #[serde(default)]
    description: String,
}

#[derive(Debug, Deserialize)]
struct TimerRow {
    unit: String,
    #[serde(default)]
    activates: String,
    /// Microseconds since the epoch; 0 when not scheduled.
    #[serde(default)]
    next: u64,
    #[serde(default)]
    last: u64,
}

#[derive(Clone, Debug, Serialize)]
pub struct ServiceView {
    pub unit: String,
    /// `user` (yours) or `system`.
    pub scope: &'static str,
    pub description: String,
    /// `active`, `inactive`, `failed`, `activating`…
    pub active: String,
    /// `running`, `exited`, `dead`, `failed`…
    pub sub: String,
    /// `enabled` (starts by itself), `disabled`, `static`…
    pub enabled: Option<String>,
    /// When it last started, in seconds since the epoch.
    pub since: Option<i64>,
    pub pid: Option<u32>,
    pub memory: Option<u64>,
    /// CPU time used since it started, in seconds.
    pub cpu_seconds: Option<f64>,
    pub restarts: Option<u32>,
    /// Why it can't be stopped from the phone, if it can't.
    pub keep: Option<&'static str>,
}

#[derive(Clone, Debug, Serialize)]
pub struct TimerView {
    pub unit: String,
    pub scope: &'static str,
    pub description: String,
    pub activates: String,
    /// When it runs next and ran last, in seconds since the epoch.
    pub next: Option<i64>,
    pub last: Option<i64>,
    pub keep: Option<&'static str>,
}

/// `Key=value` blocks from `systemctl show`, one per unit, by `Id`.
pub fn parse_show(text: &str) -> HashMap<String, HashMap<String, String>> {
    let mut units = HashMap::new();
    for block in text.split("\n\n") {
        let fields: HashMap<String, String> = block
            .lines()
            .filter_map(|line| line.split_once('='))
            .map(|(key, value)| (key.to_owned(), value.to_owned()))
            .collect();
        if let Some(id) = fields.get("Id").cloned() {
            units.insert(id, fields);
        }
    }
    units
}

/// A `systemctl --timestamp=unix` time (`@1792189530`) in seconds.
fn unix(value: &str) -> Option<i64> {
    value
        .strip_prefix('@')?
        .trim()
        .parse()
        .ok()
        .filter(|at| *at > 0)
}

/// A count systemd reports, which is "unset" as the largest number.
fn count(value: &str) -> Option<u64> {
    value
        .parse::<u64>()
        .ok()
        .filter(|n| *n != u64::MAX && *n < (1 << 62))
}

async fn systemctl(scope: &[&str], args: &[&str]) -> Option<Vec<u8>> {
    let output = tokio::process::Command::new("systemctl")
        .args(scope)
        .args(args)
        .arg("--no-pager")
        .output()
        .await
        .ok()?;
    Some(output.stdout)
}

async fn read_scope(scope: &'static str) -> (Vec<ServiceView>, Vec<TimerView>) {
    let flag: &[&str] = if scope == "user" { &["--user"] } else { &[] };
    let listed: Vec<ListRow> = systemctl(
        flag,
        &[
            "list-units",
            "--type=service,timer",
            "--all",
            "--output=json",
        ],
    )
    .await
    .and_then(|bytes| serde_json::from_slice(&bytes).ok())
    .unwrap_or_default();
    let listed: Vec<ListRow> = listed
        .into_iter()
        .filter(|row| row.load == "loaded")
        // The system's stopped services are many and say little; yours all show.
        .filter(|row| scope == "user" || row.active != "inactive" || row.unit.ends_with(".timer"))
        .collect();
    let names: Vec<&str> = listed
        .iter()
        .filter(|row| row.unit.ends_with(".service"))
        .map(|row| row.unit.as_str())
        .collect();
    let mut args = vec![
        "show",
        "--timestamp=unix",
        "-p",
        "Id,MainPID,MemoryCurrent,CPUUsageNSec,ActiveEnterTimestamp,UnitFileState,NRestarts",
    ];
    args.extend(names.iter().copied());
    let shown = if names.is_empty() {
        HashMap::new()
    } else {
        systemctl(flag, &args)
            .await
            .map(|bytes| parse_show(&String::from_utf8_lossy(&bytes)))
            .unwrap_or_default()
    };
    let keep = |unit: &str| -> Option<&'static str> {
        if scope == "system" {
            Some(
                "A system service: stopping it needs your password, so it isn't stopped from here.",
            )
        } else if system::protected_unit(unit) {
            Some("It keeps your session or Airlock running; it isn't stopped from here.")
        } else {
            None
        }
    };
    let services = listed
        .iter()
        .filter(|row| row.unit.ends_with(".service"))
        .map(|row| {
            let fields = shown.get(&row.unit);
            let field = |key: &str| {
                fields
                    .and_then(|fields| fields.get(key))
                    .map(String::as_str)
            };
            ServiceView {
                unit: row.unit.clone(),
                scope,
                description: row.description.clone(),
                active: row.active.clone(),
                sub: row.sub.clone(),
                enabled: field("UnitFileState")
                    .filter(|state| !state.is_empty())
                    .map(str::to_owned),
                since: field("ActiveEnterTimestamp").and_then(unix),
                pid: field("MainPID")
                    .and_then(|pid| pid.parse::<u32>().ok())
                    .filter(|pid| *pid > 0),
                memory: field("MemoryCurrent").and_then(count),
                cpu_seconds: field("CPUUsageNSec")
                    .and_then(count)
                    .map(|ns| ns as f64 / 1e9),
                restarts: field("NRestarts").and_then(|n| n.parse().ok()),
                keep: keep(&row.unit),
            }
        })
        .collect();

    let descriptions: HashMap<&str, &str> = listed
        .iter()
        .map(|row| (row.unit.as_str(), row.description.as_str()))
        .collect();
    let timers: Vec<TimerRow> = systemctl(flag, &["list-timers", "--all", "--output=json"])
        .await
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    let timers = timers
        .into_iter()
        .map(|timer| TimerView {
            description: descriptions
                .get(timer.unit.as_str())
                .map(|text| (*text).to_owned())
                .unwrap_or_default(),
            scope,
            next: (timer.next > 0).then_some((timer.next / 1_000_000) as i64),
            last: (timer.last > 0).then_some((timer.last / 1_000_000) as i64),
            keep: keep(&timer.unit),
            activates: timer.activates,
            unit: timer.unit,
        })
        .collect();
    (services, timers)
}

type Reading = Mutex<Option<(Instant, Vec<ServiceView>, Vec<TimerView>)>>;

pub async fn units() -> (Vec<ServiceView>, Vec<TimerView>) {
    static SEEN: OnceLock<Reading> = OnceLock::new();
    let seen = SEEN.get_or_init(Mutex::default);
    if let Some((at, services, timers)) = seen.lock().unwrap_or_else(|p| p.into_inner()).as_ref()
        && at.elapsed() < FRESH
    {
        return (services.clone(), timers.clone());
    }
    let ((mut services, mut timers), (system_services, system_timers)) =
        tokio::join!(read_scope("user"), read_scope("system"));
    services.extend(system_services);
    timers.extend(system_timers);
    *seen.lock().unwrap_or_else(|p| p.into_inner()) =
        Some((Instant::now(), services.clone(), timers.clone()));
    (services, timers)
}

async fn units_route(Extension(Paired(device)): Extension<Paired>) -> Response {
    if device.is_none() {
        return unpaired();
    }
    let (services, timers) = units().await;
    Json(json!({"services": services, "timers": timers})).into_response()
}

const WHY_LINES: &str = "15";
const WHY_LIMIT: Duration = Duration::from_secs(3);

#[derive(Debug, Default, PartialEq, Serialize)]
pub struct Why {
    /// systemd's word for how it last ended: `success`, `exit-code`,
    /// `signal`, `timeout`, `core-dump`, `start-limit-hit`…
    pub result: Option<String>,
    /// Its main process's exit status, when it exited with one.
    pub exit_status: Option<i32>,
    /// Its last log lines, oldest first.
    pub log: Vec<String>,
    /// Why there are no log lines, when there are none.
    pub log_note: Option<String>,
    pub package: Option<String>,
    /// The file it was made from: its init script, or its unit file.
    pub file: Option<String>,
}

#[derive(Deserialize)]
struct WhyQuery {
    unit: String,
    scope: String,
}

async fn run_briefly(program: &str, args: &[&str]) -> Option<(String, String)> {
    let mut command = tokio::process::Command::new(program);
    command
        .args(args)
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true);
    let output = tokio::time::timeout(WHY_LIMIT, command.output())
        .await
        .ok()?
        .ok()?;
    Some((
        String::from_utf8_lossy(&output.stdout).into_owned(),
        String::from_utf8_lossy(&output.stderr).into_owned(),
    ))
}

/// The package in `dpkg-query -S` output: `virtualbox-6.1: /usr/lib/…`.
fn package_in(text: &str) -> Option<String> {
    let line = text.lines().next()?;
    let (packages, path) = line.split_once(": ")?;
    if !path.starts_with('/') {
        return None;
    }
    let first = packages.split(", ").next()?.trim();
    (!first.is_empty() && !first.contains(' ')).then(|| first.to_owned())
}

pub async fn why(unit: &str, scope: &'static str) -> Why {
    let flag: &[&str] = if scope == "user" { &["--user"] } else { &[] };
    let mut show = flag.to_vec();
    show.extend([
        "show",
        "--no-pager",
        "-p",
        "Id,Result,ExecMainStatus,ExecMainCode,FragmentPath,SourcePath",
        "--",
        unit,
    ]);
    let mut journal = flag.to_vec();
    journal.extend(["-u", unit, "-n", WHY_LINES, "--no-pager", "-o", "cat"]);
    let (shown, logged) = tokio::join!(
        run_briefly("systemctl", &show),
        run_briefly("journalctl", &journal)
    );
    let fields = shown
        .map(|(text, _)| parse_show(&text))
        .and_then(|mut units| units.remove(unit))
        .unwrap_or_default();
    let field = |key: &str| {
        fields
            .get(key)
            .map(String::as_str)
            .filter(|v| !v.is_empty())
    };
    // `ExecMainCode` 1 is "exited": only then is the status an exit status.
    let exit_status = field("ExecMainStatus")
        .filter(|_| field("ExecMainCode") == Some("1"))
        .and_then(|status| status.parse().ok());
    let (log, log_note) = match logged {
        Some((text, errors)) => {
            let lines: Vec<String> = text.lines().map(str::to_owned).collect();
            let note = lines.is_empty().then(|| {
                if errors.contains("insufficient permissions") || errors.contains("not seeing messages") {
                    "Airlock can't read the system's log: your user isn't in the systemd-journal group.".to_owned()
                } else {
                    "Its log is empty.".to_owned()
                }
            });
            (lines, note)
        }
        None => (Vec::new(), Some("The log couldn't be read.".to_owned())),
    };
    // A unit made from an init script names the script, and either file may
    // be a package's, unless systemd wrote it at boot.
    let files: Vec<&str> = [field("SourcePath"), field("FragmentPath")]
        .into_iter()
        .flatten()
        .filter(|path| !path.starts_with("/run/"))
        .collect();
    let mut package = None;
    for path in &files {
        package = run_briefly("dpkg-query", &["-S", path])
            .await
            .and_then(|(text, _)| package_in(&text));
        if package.is_some() {
            break;
        }
    }
    Why {
        result: field("Result").map(str::to_owned),
        exit_status,
        log,
        log_note,
        package,
        file: files.first().map(|path| (*path).to_owned()),
    }
}

async fn why_route(
    Extension(Paired(device)): Extension<Paired>,
    Query(query): Query<WhyQuery>,
) -> Response {
    if device.is_none() {
        return unpaired();
    }
    // Only a service the Services tab lists, by its exact name.
    let (services, _) = units().await;
    let Some(service) = services
        .iter()
        .find(|service| service.unit == query.unit && service.scope == query.scope)
    else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({"error": "That service isn't there."})),
        )
            .into_response();
    };
    Json(why(&service.unit, service.scope).await).into_response()
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/system/units", get(units_route))
        .route("/api/system/units/why", get(why_route))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn show_blocks_are_read_by_unit() {
        let text = "Id=airlock.service\nMainPID=4242\nMemoryCurrent=12582912\nCPUUsageNSec=1500000000\nActiveEnterTimestamp=@1792189530\nUnitFileState=enabled\nNRestarts=0\n\nId=idle.service\nMainPID=0\nMemoryCurrent=[not set]\nCPUUsageNSec=18446744073709551615\nActiveEnterTimestamp=\n";
        let units = parse_show(text);
        let airlock = &units["airlock.service"];
        assert_eq!(airlock["MainPID"], "4242");
        assert_eq!(unix(&airlock["ActiveEnterTimestamp"]), Some(1_792_189_530));
        assert_eq!(count(&airlock["MemoryCurrent"]), Some(12_582_912));
        let idle = &units["idle.service"];
        assert_eq!(count(&idle["MemoryCurrent"]), None);
        assert_eq!(count(&idle["CPUUsageNSec"]), None);
        assert_eq!(unix(&idle["ActiveEnterTimestamp"]), None);
    }

    #[test]
    fn the_package_is_the_first_dpkg_names() {
        assert_eq!(
            package_in("virtualbox-6.1: /usr/lib/virtualbox/vboxdrv.sh\n").as_deref(),
            Some("virtualbox-6.1")
        );
        assert_eq!(
            package_in("cups-daemon, cups: /usr/lib/systemd/system/cups.service").as_deref(),
            Some("cups-daemon")
        );
        assert_eq!(package_in(""), None);
        assert_eq!(
            package_in("dpkg-query: no path found matching pattern /x"),
            None
        );
    }

    #[tokio::test]
    async fn why_a_unit_ended_is_read() {
        // Run a unit of yours that fails, when there's a user systemd.
        let unit = format!("airlock-test-why-{}.service", std::process::id());
        let started = std::process::Command::new("systemd-run")
            .args(["--user", "--unit", &unit, "--quiet", "--wait"])
            .args(["sh", "-c", "echo about to fail; exit 3"])
            .status();
        if !started.is_ok_and(|status| status.code().is_some()) {
            return;
        }
        let why = why(&unit, "user").await;
        let _ = std::process::Command::new("systemctl")
            .args(["--user", "reset-failed", &unit])
            .status();
        assert_eq!(why.result.as_deref(), Some("exit-code"), "{why:?}");
        assert_eq!(why.exit_status, Some(3), "{why:?}");
        assert!(
            why.log.iter().any(|line| line.contains("about to fail")),
            "{why:?}"
        );
        // Made at run time, so no package has it.
        assert_eq!(why.package, None);
    }

    #[tokio::test]
    async fn this_laptops_units_are_read() {
        let (services, _timers) = units().await;
        // Some machines run tests without a user session; when there is
        // one, the system's own services at least are there.
        if let Some(service) = services.iter().find(|s| s.scope == "system") {
            assert!(
                service.keep.is_some(),
                "the system's services are for looking"
            );
        }
    }
}
