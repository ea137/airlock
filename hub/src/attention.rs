//! The phone's Home: what needs you now, across everything Airlock sees.
//!
//! Each thing has a level: `act` (it waits on you), `look` (worth a glance)
//! or `fyi`. Its id stays the same while the thing does, so the phone can
//! hide one you've seen until it changes. Everything here comes from what
//! the hub already reads for Work and System, through their caches; pull
//! requests are only those already read, so Home never waits on GitHub.

use std::{
    sync::Mutex,
    time::{Duration, Instant},
};

use axum::{
    Extension, Json, Router,
    extract::State,
    response::{IntoResponse, Response},
    routing::get,
};
use serde::Serialize;
use serde_json::json;

use crate::{
    center::{self, SessionView},
    claude::State as SessionState,
    phone::{Paired, unpaired},
    ports, projects,
    repos::PullRequest,
    state::AppState,
    store::{self, Change},
    system::{self, Overview, Sampler},
    units::{self, ServiceView},
};

const FINISHED_FOR_SECS: i64 = 6 * 3600;
const DECIDED_FOR_SECS: i64 = 24 * 3600;
const CLOSED_SHOWN_SECS: i64 = 3600;
const SYSTEM_FRESH: Duration = Duration::from_secs(15);
const FULL_PERCENT: u64 = 90;
const LOW_BATTERY: u8 = 15;

pub fn routes() -> Router<AppState> {
    Router::new().route("/api/attention", get(attention))
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "to", rename_all = "snake_case")]
pub enum Link {
    Session { id: String },
    Pull { repo: String, number: u32 },
    System { tab: &'static str },
    Port { port: u16 },
    Service { unit: String, scope: &'static str },
    Edits,
}

#[derive(Debug, PartialEq, Serialize)]
pub struct Item {
    pub id: String,
    /// `act`, `look` or `fyi`.
    pub level: &'static str,
    /// `finished`, `stopped`, `pull`, `job`, `port`, `service`, `disk`,
    /// `memory`, `battery`, `edit` or `edits`.
    pub kind: &'static str,
    pub title: String,
    pub detail: Option<String>,
    /// When it happened, in seconds since the epoch, if that's known.
    pub since: Option<i64>,
    pub link: Link,
}

#[derive(Debug, Default, PartialEq, Serialize)]
pub struct Now {
    pub working: usize,
    pub terminals: usize,
    /// Dev servers, by name and port.
    pub servers: Vec<(String, u16)>,
}

static SYSTEM: Mutex<Option<(Instant, Overview)>> = Mutex::new(None);

async fn system_overview(state: &AppState) -> Overview {
    if let Some((at, overview)) = SYSTEM.lock().unwrap_or_else(|p| p.into_inner()).as_ref()
        && at.elapsed() < SYSTEM_FRESH
    {
        return overview.clone();
    }
    // Its own sampler: Home doesn't need CPU, and the System screen's
    // readings stay its own.
    let overview = system::overview(state, &Sampler::default()).await;
    *SYSTEM.lock().unwrap_or_else(|p| p.into_inner()) = Some((Instant::now(), overview.clone()));
    overview
}

fn project_of(session: &SessionView, roots: &[projects::Root]) -> String {
    if let Some((_, project)) = projects::place_of(roots, &session.cwd) {
        return project.name.clone();
    }
    session.repo_name.clone().unwrap_or_else(|| {
        std::path::Path::new(&session.cwd).file_name().map_or_else(
            || session.cwd.clone(),
            |name| name.to_string_lossy().into_owned(),
        )
    })
}

pub(crate) fn session_items(
    sessions: &[SessionView],
    roots: &[projects::Root],
    now: i64,
) -> Vec<Item> {
    sessions
        .iter()
        .filter(|s| s.state == SessionState::Idle && now - s.updated_at < FINISHED_FOR_SECS)
        .map(|session| {
            let failed = session.doing.starts_with("Stopped on an error");
            let name = session.title.clone().unwrap_or_else(|| "Claude".to_owned());
            Item {
                id: format!("session:{}:{}", session.id, session.updated_at),
                level: if failed { "act" } else { "look" },
                kind: if failed { "stopped" } else { "finished" },
                title: if failed {
                    format!("{name} stopped on an error")
                } else {
                    format!("{name} finished")
                },
                detail: Some(project_of(session, roots)),
                since: Some(session.updated_at),
                link: Link::Session {
                    id: session.id.clone(),
                },
            }
        })
        .collect()
}

pub fn pull_items(repo_key: &str, repo_name: &str, pulls: &[PullRequest]) -> Vec<Item> {
    pulls
        .iter()
        .filter(|pull| pull.state == "OPEN" && !pull.draft)
        .filter_map(|pull| {
            let (level, why) = if pull.checks == "failed" {
                ("act", "Checks failed")
            } else if pull.review == "CHANGES_REQUESTED" {
                ("act", "Changes requested")
            } else if pull.review == "APPROVED" && pull.checks != "running" {
                ("look", "Ready to merge")
            } else {
                return None;
            };
            Some(Item {
                id: format!("pull:{repo_key}:{}:{why}", pull.number),
                level,
                kind: "pull",
                title: format!("{why}: #{} {}", pull.number, pull.title),
                detail: Some(repo_name.to_owned()),
                since: None,
                link: Link::Pull {
                    repo: repo_key.to_owned(),
                    number: pull.number,
                },
            })
        })
        .collect()
}

fn size(bytes: u64) -> String {
    let gb = bytes as f64 / 1e9;
    if gb >= 100.0 {
        format!("{gb:.0} GB")
    } else if gb >= 1.0 {
        format!("{gb:.1} GB")
    } else {
        format!("{:.0} MB", bytes as f64 / 1e6)
    }
}

pub fn system_items(overview: &Overview) -> Vec<Item> {
    let mut items = Vec::new();
    for port in overview
        .ports
        .iter()
        .filter(|port| port.about.verdict == ports::Verdict::Worry)
    {
        let reach = if port.exposure == "all" {
            "every network"
        } else {
            "a network"
        };
        items.push(Item {
            id: format!("port:{}:{}", port.port, port.exposure),
            level: "look",
            kind: "port",
            title: format!("{} is open to {reach}", port.about.kind.title()),
            detail: Some(format!("{} · port {}", port.name, port.port)),
            since: None,
            link: Link::Port { port: port.port },
        });
    }
    for job in overview.jobs.iter().filter(|job| job.orphaned) {
        let on = match job.ports.as_slice() {
            [] => String::new(),
            [port] => format!(" on :{port}"),
            ports => format!(" on {} ports", ports.len()),
        };
        items.push(Item {
            id: format!("job:{}:{}", job.pid, job.started),
            level: "look",
            kind: "job",
            title: format!("{}{on} is still running", job.label),
            detail: Some("Its terminal is gone.".to_owned()),
            since: None,
            link: Link::System { tab: "overview" },
        });
    }
    let r = &overview.resources;
    let percent = |used: u64, total: u64| (used * 100).checked_div(total).unwrap_or(0);
    let disk = percent(r.disk_used, r.disk_total);
    if disk >= FULL_PERCENT {
        items.push(Item {
            id: "disk".to_owned(),
            level: "act",
            kind: "disk",
            title: format!("The disk is {disk}% full"),
            detail: Some(format!(
                "{} left of {}",
                size(r.disk_total.saturating_sub(r.disk_used)),
                size(r.disk_total)
            )),
            since: None,
            link: Link::System { tab: "overview" },
        });
    }
    let memory = percent(r.memory_used, r.memory_total);
    if memory >= FULL_PERCENT {
        items.push(Item {
            id: "memory".to_owned(),
            level: "look",
            kind: "memory",
            title: format!("Memory is {memory}% used"),
            detail: None,
            since: None,
            link: Link::System { tab: "processes" },
        });
    }
    if let Some(battery) = r.battery
        && battery <= LOW_BATTERY
        && r.charging != Some(true)
    {
        items.push(Item {
            id: "battery".to_owned(),
            level: "act",
            kind: "battery",
            title: format!("The laptop's battery is at {battery}%"),
            detail: Some("It isn't charging.".to_owned()),
            since: None,
            link: Link::System { tab: "overview" },
        });
    }
    items
}

pub fn service_items(services: &[ServiceView]) -> Vec<Item> {
    services
        .iter()
        .filter(|service| service.active == "failed")
        .map(|service| Item {
            id: format!("service:{}:{}", service.unit, service.since.unwrap_or(0)),
            level: if service.scope == "user" {
                "act"
            } else {
                "look"
            },
            kind: "service",
            title: format!("{} failed", service.unit),
            // A unit without a description gives its own name, already said.
            detail: Some(service.description.clone())
                .filter(|text| !text.is_empty() && *text != service.unit),
            since: service.since,
            link: Link::Service {
                unit: service.unit.clone(),
                scope: service.scope,
            },
        })
        .collect()
}

pub fn edit_items(changes: &[Change], now: i64) -> Vec<Item> {
    let mut items = Vec::new();
    let waiting = changes.iter().filter(|c| c.state == "pending").count();
    if waiting > 0 {
        items.push(Item {
            id: format!("edits:{waiting}"),
            level: "fyi",
            kind: "edits",
            title: format!(
                "{waiting} {} waiting on the laptop",
                if waiting == 1 { "edit" } else { "edits" }
            ),
            detail: None,
            since: None,
            link: Link::Edits,
        });
    }
    for change in changes.iter().filter(|c| {
        matches!(c.state.as_str(), "written" | "declined")
            && c.decided_at.is_some_and(|at| now - at < DECIDED_FOR_SECS)
    }) {
        let name = change.path.rsplit('/').next().unwrap_or(&change.path);
        items.push(Item {
            id: format!("edit:{}:{}", change.id, change.state),
            level: if change.state == "declined" {
                "look"
            } else {
                "fyi"
            },
            kind: "edit",
            title: format!("Your edit to {name} was {}", change.state),
            detail: change.outcome.clone(),
            since: change.decided_at,
            link: Link::Edits,
        });
    }
    items
}

pub fn rank(items: &mut [Item]) {
    let order = |level: &str| match level {
        "act" => 0,
        "look" => 1,
        _ => 2,
    };
    items.sort_by_key(|item| {
        (
            order(item.level),
            std::cmp::Reverse(item.since.unwrap_or(0)),
        )
    });
}

async fn attention(
    State(state): State<AppState>,
    Extension(Paired(device)): Extension<Paired>,
) -> Response {
    let Some(device) = device else {
        return unpaired();
    };
    let now = store::now();
    let (snapshot, overview, (services, _), terminals) = tokio::join!(
        center::snapshot(&state),
        system_overview(&state),
        units::units(),
        state.tmux.list(false),
    );
    let mut items = session_items(&snapshot.sessions, &snapshot.roots, now);
    for repo in &snapshot.repos {
        if let Some(slug) = &repo.github
            && let Some(pulls) = state.center.pulls_known(slug)
        {
            items.extend(pull_items(&repo.key, &repo.name, &pulls));
        }
    }
    items.extend(system_items(&overview));
    items.extend(service_items(&services));
    let changes = state
        .store()
        .changes(Some(&device.id), 10)
        .unwrap_or_default();
    items.extend(edit_items(&changes, now));
    rank(&mut items);

    let needs_you: Vec<&SessionView> = snapshot
        .sessions
        .iter()
        .filter(|s| s.state == SessionState::NeedsYou)
        .collect();
    let mut sessions: Vec<&SessionView> = snapshot
        .sessions
        .iter()
        .filter(|s| s.state != SessionState::Ended || now - s.updated_at < CLOSED_SHOWN_SECS)
        .collect();
    sessions.sort_by_key(|s| {
        let order = match s.state {
            SessionState::NeedsYou => 0,
            SessionState::Working => 1,
            SessionState::Idle if !s.background.is_empty() => 2,
            SessionState::Idle => 3,
            SessionState::Ended => 4,
        };
        (order, std::cmp::Reverse(s.updated_at))
    });
    let going_on = Now {
        working: snapshot
            .sessions
            .iter()
            .filter(|s| s.state == SessionState::Working)
            .count(),
        terminals: terminals.map_or(0, |terminals| terminals.len()),
        servers: overview
            .ports
            .iter()
            .filter(|port| port.dev)
            .map(|port| (port.name.clone(), port.port))
            .collect(),
    };
    Json(json!({"needs_you": needs_you, "items": items, "now": going_on, "sessions": sessions, "usage": state.claude.usage()}))
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pull(number: u32, checks: &'static str, review: &str) -> PullRequest {
        serde_json::from_value::<PullRequest>(json!({
            "number": number,
            "title": "Faster search",
            "state": "OPEN",
            "headRefName": "search",
            "url": "https://github.com/acme/shop/pull/1",
            "reviewDecision": review,
        }))
        .map(|mut pull| {
            pull.checks = checks;
            pull
        })
        .unwrap()
    }

    #[test]
    fn pull_requests_show_only_when_they_wait_on_you() {
        let pulls = [
            pull(1, "failed", ""),
            pull(2, "passed", "CHANGES_REQUESTED"),
            pull(3, "passed", "APPROVED"),
            pull(4, "running", "APPROVED"),
            pull(5, "passed", "REVIEW_REQUIRED"),
        ];
        let items = pull_items("k1", "shop", &pulls);
        let titles: Vec<(&str, &str)> = items
            .iter()
            .map(|item| (item.level, item.title.as_str()))
            .collect();
        assert_eq!(
            titles,
            [
                ("act", "Checks failed: #1 Faster search"),
                ("act", "Changes requested: #2 Faster search"),
                ("look", "Ready to merge: #3 Faster search"),
            ]
        );
        assert_eq!(
            items[0].link,
            Link::Pull {
                repo: "k1".to_owned(),
                number: 1
            }
        );
    }

    #[test]
    fn edits_say_how_many_wait_and_what_became_of_the_others() {
        let change = |id: &str, state: &str, decided_at: Option<i64>| Change {
            id: id.to_owned(),
            path: "~/notes/plan.md".to_owned(),
            device_id: "d1".to_owned(),
            device_name: "Test phone".to_owned(),
            base_hash: String::new(),
            base_text: String::new(),
            new_text: String::new(),
            created_at: 0,
            state: state.to_owned(),
            decided_at,
            outcome: None,
        };
        let now = 100_000;
        let items = edit_items(
            &[
                change("a", "pending", None),
                change("b", "pending", None),
                change("c", "written", Some(now - 60)),
                change("d", "declined", Some(now - 2 * DECIDED_FOR_SECS)),
            ],
            now,
        );
        let titles: Vec<&str> = items.iter().map(|item| item.title.as_str()).collect();
        assert_eq!(
            titles,
            [
                "2 edits waiting on the laptop",
                "Your edit to plan.md was written"
            ]
        );
    }

    #[test]
    fn what_waits_on_you_comes_first_then_the_newest() {
        let item = |id: &str, level: &'static str, since: Option<i64>| Item {
            id: id.to_owned(),
            level,
            kind: "job",
            title: id.to_owned(),
            detail: None,
            since,
            link: Link::Edits,
        };
        let mut items = vec![
            item("fyi", "fyi", Some(50)),
            item("old look", "look", Some(10)),
            item("act", "act", None),
            item("new look", "look", Some(20)),
        ];
        rank(&mut items);
        let ids: Vec<&str> = items.iter().map(|item| item.id.as_str()).collect();
        assert_eq!(ids, ["act", "new look", "old look", "fyi"]);
    }

    fn overview(resources: system::Resources, ports: Vec<system::PortView>) -> Overview {
        Overview {
            resources,
            ports,
            jobs: Vec::new(),
            heavy: Vec::new(),
            firewall: Some(false),
        }
    }

    fn resources(disk_used: u64, disk_total: u64, battery: Option<u8>) -> system::Resources {
        system::Resources {
            load: 0.5,
            cpus: 8,
            memory_used: 50,
            memory_total: 100,
            disk_used,
            disk_total,
            battery,
            charging: Some(false),
        }
    }

    #[test]
    fn a_full_disk_and_a_low_battery_wait_on_you() {
        let items = system_items(&overview(
            resources(223_200_000_000, 236_300_000_000, Some(9)),
            Vec::new(),
        ));
        let kinds: Vec<(&str, &str)> = items.iter().map(|item| (item.kind, item.level)).collect();
        assert_eq!(kinds, [("disk", "act"), ("battery", "act")]);
        assert_eq!(items[0].title, "The disk is 94% full");
        assert_eq!(items[0].detail.as_deref(), Some("13.1 GB left of 236 GB"));
    }

    #[test]
    fn a_database_open_to_every_network_is_worth_a_look() {
        let port = |port: u16, exposure: &'static str, image: &str| {
            let containers = [ports::Container {
                name: format!("shop-{port}"),
                image: image.to_owned(),
                ports: vec![port],
            }];
            system::PortView {
                port,
                address: "0.0.0.0".to_owned(),
                exposure,
                name: format!("shop-{port}"),
                pid: None,
                started: None,
                dev: false,
                terminal: None,
                about: ports::about(port, exposure, None, &containers),
            }
        };
        let items = system_items(&overview(
            resources(10, 100, None),
            vec![
                port(6379, "all", "redis:7"),
                port(5432, "laptop", "postgres:16"),
                port(8080, "all", "nginx"),
            ],
        ));
        assert_eq!(items.len(), 1, "only the open database: {items:?}");
        assert_eq!(items[0].title, "Redis is open to every network");
        assert_eq!(items[0].detail.as_deref(), Some("shop-6379 · port 6379"));
        assert_eq!((items[0].kind, items[0].level), ("port", "look"));
        assert_eq!(items[0].link, Link::Port { port: 6379 });
    }
}
