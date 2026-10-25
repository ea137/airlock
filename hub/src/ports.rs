//! What a listening port is, and whether it should worry you: a port open
//! to your own laptop or your tailnet is safe; one open to every network
//! is worth a look, and a database open to every network is a worry,
//! since anyone on the same Wi-Fi can try it.
//!
//! Ports Docker publishes are held by Docker's proxy, which runs as root;
//! `docker ps` says which container each one leads to. It is asked at
//! most every 30 seconds, and not at all without Docker.

use std::{
    sync::Mutex,
    time::{Duration, Instant},
};

use axum::{
    Extension, Json,
    body::Bytes,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::{
    phone::{Paired, unpaired},
    state::{AppState, internal_error},
};

const CONTAINERS_FRESH: Duration = Duration::from_secs(30);
const DOCKER_LIST_LIMIT: Duration = Duration::from_secs(3);
/// Docker's own 10 seconds, and some.
const DOCKER_STOP_LIMIT: Duration = Duration::from_secs(20);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Airlock,
    Tailscale,
    Ssh,
    Dns,
    Rpcbind,
    Printing,
    Postgres,
    Mysql,
    Redis,
    Mongodb,
    Memcached,
    Dev,
    Container,
    Program,
    Unknown,
}

impl Kind {
    pub fn title(self) -> &'static str {
        match self {
            Self::Airlock => "Airlock",
            Self::Tailscale => "Tailscale",
            Self::Ssh => "SSH",
            Self::Dns => "DNS",
            Self::Rpcbind => "rpcbind",
            Self::Printing => "Printing (CUPS)",
            Self::Postgres => "PostgreSQL",
            Self::Mysql => "MySQL",
            Self::Redis => "Redis",
            Self::Mongodb => "MongoDB",
            Self::Memcached => "Memcached",
            Self::Dev => "Dev server",
            Self::Container => "A container",
            Self::Program => "A program of yours",
            Self::Unknown => "Unknown",
        }
    }

    fn database(self) -> bool {
        matches!(
            self,
            Self::Postgres | Self::Mysql | Self::Redis | Self::Mongodb | Self::Memcached
        )
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Verdict {
    Safe,
    Look,
    Worry,
}

/// `exposure` is [`crate::system::exposure`]'s word for who can reach it.
pub fn verdict(kind: Kind, exposure: &str) -> Verdict {
    match exposure {
        "laptop" | "tailnet" => Verdict::Safe,
        _ if matches!(kind, Kind::Airlock | Kind::Tailscale) => Verdict::Safe,
        _ if kind.database() => Verdict::Worry,
        _ => Verdict::Look,
    }
}

fn kind_of_image(image: &str) -> Kind {
    let name = image
        .rsplit('/')
        .next()
        .unwrap_or(image)
        .split([':', '@'])
        .next()
        .unwrap_or(image)
        .to_lowercase();
    match name.as_str() {
        name if name.starts_with("postgres") || name == "postgis" => Kind::Postgres,
        name if name.starts_with("mysql") || name.starts_with("mariadb") => Kind::Mysql,
        name if name.starts_with("redis") || name.starts_with("valkey") => Kind::Redis,
        name if name.starts_with("mongo") => Kind::Mongodb,
        name if name.starts_with("memcached") => Kind::Memcached,
        _ => Kind::Container,
    }
}

fn kind_of_program(comm: &str, dev: bool) -> Kind {
    match comm {
        "postgres" => Kind::Postgres,
        "mysqld" | "mariadbd" => Kind::Mysql,
        "redis-server" | "valkey-server" => Kind::Redis,
        "mongod" => Kind::Mongodb,
        "memcached" => Kind::Memcached,
        "sshd" => Kind::Ssh,
        _ if dev => Kind::Dev,
        _ => Kind::Program,
    }
}

fn kind_of_port(port: u16, exposure: &str) -> Kind {
    match port {
        22 => Kind::Ssh,
        53 => Kind::Dns,
        111 => Kind::Rpcbind,
        631 => Kind::Printing,
        // Tailscale Serve, in front of the phone's page and its previews.
        443 | 8443 if exposure == "tailnet" => Kind::Airlock,
        // tailscaled's own, on the tailnet address.
        _ if exposure == "tailnet" => Kind::Tailscale,
        3306 => Kind::Mysql,
        5432 | 5433 => Kind::Postgres,
        6379 => Kind::Redis,
        11211 => Kind::Memcached,
        27017 => Kind::Mongodb,
        _ => Kind::Unknown,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Owner {
    /// You: the phone can stop it.
    You,
    /// A Docker container: the phone can stop the container.
    Docker,
    /// The system, or another user: only looked at.
    System,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct About {
    pub kind: Kind,
    pub verdict: Verdict,
    pub owner: Owner,
    pub container: Option<String>,
    pub image: Option<String>,
}

/// The listener on `port`: yours when `program` (its process name, and
/// whether it is a dev server) is known, else a container's or the system's.
pub fn about(
    port: u16,
    exposure: &str,
    program: Option<(&str, bool)>,
    containers: &[Container],
) -> About {
    let container = containers.iter().find(|c| c.ports.contains(&port));
    let (kind, owner) = match (program, container) {
        (Some((comm, dev)), _) => (kind_of_program(comm, dev), Owner::You),
        (None, Some(container)) => (kind_of_image(&container.image), Owner::Docker),
        (None, None) => (kind_of_port(port, exposure), Owner::System),
    };
    About {
        kind,
        verdict: verdict(kind, exposure),
        owner,
        container: container
            .filter(|_| program.is_none())
            .map(|c| c.name.clone()),
        image: container
            .filter(|_| program.is_none())
            .map(|c| c.image.clone()),
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Container {
    pub name: String,
    pub image: String,
    pub ports: Vec<u16>,
}

/// `0.0.0.0:5432->5432/tcp, [::]:5432->5432/tcp`: the host's TCP ports.
fn published(ports: &str) -> Vec<u16> {
    let mut found: Vec<u16> = ports
        .split(", ")
        .filter_map(|mapping| {
            let (host, inside) = mapping.split_once("->")?;
            if !inside.ends_with("/tcp") {
                return None;
            }
            // A range publishes `0.0.0.0:8000-8002->8000-8002/tcp`; its first.
            let port = host.rsplit(':').next()?;
            port.split('-').next()?.parse().ok()
        })
        .collect();
    found.sort_unstable();
    found.dedup();
    found
}

pub fn parse_containers(text: &str) -> Vec<Container> {
    text.lines()
        .filter_map(|line| {
            let mut fields = line.split('\t');
            let name = fields.next()?.trim();
            let image = fields.next()?.trim();
            let ports = published(fields.next().unwrap_or(""));
            (!name.is_empty()).then(|| Container {
                name: name.to_owned(),
                image: image.to_owned(),
                ports,
            })
        })
        .collect()
}

async fn list_containers() -> Vec<Container> {
    let mut command = tokio::process::Command::new("docker");
    command
        .args(["ps", "--format", "{{.Names}}\t{{.Image}}\t{{.Ports}}"])
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true);
    match tokio::time::timeout(DOCKER_LIST_LIMIT, command.output()).await {
        Ok(Ok(output)) if output.status.success() => {
            parse_containers(&String::from_utf8_lossy(&output.stdout))
        }
        _ => Vec::new(),
    }
}

static CONTAINERS: Mutex<Option<(Instant, Vec<Container>)>> = Mutex::new(None);

pub async fn containers() -> Vec<Container> {
    if let Some((at, containers)) = CONTAINERS
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .as_ref()
        && at.elapsed() < CONTAINERS_FRESH
    {
        return containers.clone();
    }
    fresh_containers().await
}

async fn fresh_containers() -> Vec<Container> {
    let containers = list_containers().await;
    *CONTAINERS.lock().unwrap_or_else(|p| p.into_inner()) =
        Some((Instant::now(), containers.clone()));
    containers
}

/// Whether the laptop's firewall (ufw) is on; `None` without ufw.
pub fn firewall() -> Option<bool> {
    let conf = std::fs::read_to_string("/etc/ufw/ufw.conf").ok()?;
    conf.lines().find_map(|line| {
        let value = line.trim().strip_prefix("ENABLED=")?;
        Some(value.trim_matches(['"', '\'']).eq_ignore_ascii_case("yes"))
    })
}

#[derive(Deserialize)]
struct ContainerRequest {
    name: String,
}

fn refusal(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({"error": message}))).into_response()
}

pub async fn stop_container(
    State(state): State<AppState>,
    Extension(Paired(device)): Extension<Paired>,
    bytes: Bytes,
) -> Response {
    let Some(device) = device else {
        return unpaired();
    };
    let Ok(ContainerRequest { name }) = serde_json::from_slice(&bytes) else {
        return refusal(StatusCode::BAD_REQUEST, "Expected {\"name\"}.");
    };
    // Only a container running now, with a port on the laptop.
    let running = fresh_containers().await;
    let Some(container) = running
        .iter()
        .find(|c| c.name == name && !c.ports.is_empty())
    else {
        return refusal(StatusCode::NOT_FOUND, "That container isn't running.");
    };
    let mut command = tokio::process::Command::new("docker");
    command
        .args(["stop", "--", &container.name])
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true);
    let output = match tokio::time::timeout(DOCKER_STOP_LIMIT, command.output()).await {
        Ok(Ok(output)) => output,
        Ok(Err(error)) => return internal_error(error.into()),
        Err(_) => {
            return refusal(
                StatusCode::GATEWAY_TIMEOUT,
                "Docker didn't stop it within 20 seconds.",
            );
        }
    };
    fresh_containers().await;
    if !output.status.success() {
        return refusal(
            StatusCode::CONFLICT,
            &format!("docker: {}", String::from_utf8_lossy(&output.stderr).trim()),
        );
    }
    let detail = format!(
        "{} ({}) from {}",
        container.name, container.image, device.name
    );
    if let Err(error) = state.store().audit("phone", "container stopped", &detail) {
        return internal_error(error);
    }
    Json(json!({"stopped": true})).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn container(name: &str, image: &str, ports: &[u16]) -> Container {
        Container {
            name: name.to_owned(),
            image: image.to_owned(),
            ports: ports.to_vec(),
        }
    }

    #[test]
    fn docker_ps_gives_each_container_its_host_ports() {
        let text = "shop-postgres\tpostgres:15-alpine\t0.0.0.0:5432->5432/tcp, [::]:5432->5432/tcp\n\
                    cache\tbitnami/redis:7\t127.0.0.1:6380->6379/tcp\n\
                    worker\tacme/worker:1\t8080/tcp\n\
                    dns\tcoredns/coredns\t0.0.0.0:53->53/udp, 0.0.0.0:9000-9002->9000-9002/tcp\n";
        assert_eq!(
            parse_containers(text),
            [
                container("shop-postgres", "postgres:15-alpine", &[5432]),
                container("cache", "bitnami/redis:7", &[6380]),
                container("worker", "acme/worker:1", &[]),
                container("dns", "coredns/coredns", &[9000]),
            ]
        );
        assert_eq!(parse_containers(""), []);
    }

    #[test]
    fn an_image_names_its_database() {
        assert_eq!(kind_of_image("redis:7-alpine"), Kind::Redis);
        assert_eq!(kind_of_image("bitnami/postgresql:16"), Kind::Postgres);
        assert_eq!(kind_of_image("mariadb@sha256:abc"), Kind::Mysql);
        assert_eq!(kind_of_image("mongo"), Kind::Mongodb);
        assert_eq!(kind_of_image("ghcr.io/acme/api:2"), Kind::Container);
    }

    #[test]
    fn a_database_open_to_every_network_is_a_worry() {
        let docker = [container("shop-redis", "redis:7-alpine", &[6379])];
        let redis = about(6379, "all", None, &docker);
        assert_eq!(
            redis,
            About {
                kind: Kind::Redis,
                verdict: Verdict::Worry,
                owner: Owner::Docker,
                container: Some("shop-redis".to_owned()),
                image: Some("redis:7-alpine".to_owned()),
            }
        );
        // The same database kept to the laptop is fine.
        assert_eq!(about(5433, "laptop", None, &[]).verdict, Verdict::Safe);
        assert_eq!(about(5433, "laptop", None, &[]).kind, Kind::Postgres);
    }

    #[test]
    fn other_open_ports_are_worth_a_look_and_your_own_devices_are_safe() {
        assert_eq!(about(22, "all", None, &[]).kind, Kind::Ssh);
        assert_eq!(about(22, "all", None, &[]).verdict, Verdict::Look);
        assert_eq!(about(111, "all", None, &[]).verdict, Verdict::Look);
        assert_eq!(about(631, "laptop", None, &[]).verdict, Verdict::Safe);
        assert_eq!(about(443, "tailnet", None, &[]).kind, Kind::Airlock);
        assert_eq!(about(57659, "tailnet", None, &[]).kind, Kind::Tailscale);
        assert_eq!(about(57659, "tailnet", None, &[]).verdict, Verdict::Safe);
        assert_eq!(about(40000, "one", None, &[]).kind, Kind::Unknown);
        assert_eq!(about(40000, "one", None, &[]).owner, Owner::System);
    }

    #[test]
    fn your_own_listener_is_yours_whatever_docker_publishes() {
        let docker = [container("web", "nginx", &[5173])];
        let vite = about(5173, "all", Some(("node", true)), &docker);
        assert_eq!(
            (vite.kind, vite.owner, vite.verdict, vite.container),
            (Kind::Dev, Owner::You, Verdict::Look, None)
        );
        assert_eq!(
            about(6379, "laptop", Some(("redis-server", false)), &[]).kind,
            Kind::Redis
        );
        assert_eq!(
            about(9000, "laptop", Some(("python3", false)), &[]).kind,
            Kind::Program
        );
    }
}
