//! Where Airlock keeps its files, and the settings in `config.toml`.

use std::{net::SocketAddr, path::PathBuf};

use anyhow::{Context, Result, bail};
use serde::Deserialize;

/// The three places Airlock keeps files. Each can be moved with an
/// environment variable, which the tests use.
#[derive(Clone, Debug)]
pub struct Paths {
    /// Secrets and settings: `~/.config/airlock` (`AIRLOCK_CONFIG_DIR`).
    pub config: PathBuf,
    /// The database: `~/.local/state/airlock` (`AIRLOCK_STATE_DIR`).
    pub state: PathBuf,
    /// The admin socket: `$XDG_RUNTIME_DIR/airlock` (`AIRLOCK_RUNTIME_DIR`).
    pub runtime: PathBuf,
}

impl Paths {
    pub fn from_env() -> Result<Self> {
        let var = |name: &str| std::env::var_os(name).map(PathBuf::from);
        let home = var("HOME").context("HOME is not set")?;
        let runtime = match var("AIRLOCK_RUNTIME_DIR") {
            Some(dir) => dir,
            None => var("XDG_RUNTIME_DIR")
                .context("XDG_RUNTIME_DIR is not set")?
                .join("airlock"),
        };
        Ok(Self {
            config: var("AIRLOCK_CONFIG_DIR").unwrap_or_else(|| home.join(".config/airlock")),
            state: var("AIRLOCK_STATE_DIR").unwrap_or_else(|| home.join(".local/state/airlock")),
            runtime,
        })
    }

    pub fn config_file(&self) -> PathBuf {
        self.config.join("config.toml")
    }

    pub fn database(&self) -> PathBuf {
        self.state.join("airlock.db")
    }

    pub fn admin_socket(&self) -> PathBuf {
        self.runtime.join("admin.sock")
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    /// Where the phone-facing server listens. It must be loopback: Tailscale
    /// Serve is the only way in.
    #[serde(default = "default_listen")]
    pub listen: SocketAddr,
    /// The Tailscale logins allowed in, as Serve reports them in the
    /// `Tailscale-User-Login` header.
    pub allowed_logins: Vec<String>,
    /// The name of Airlock's tmux server (`tmux -L <name>`). Tests use their
    /// own so they never touch yours.
    #[serde(default = "default_tmux_socket")]
    pub tmux_socket: String,
    /// Where your projects are, when `project_roots` isn't set. Defaults to
    /// `~/Projects`.
    #[serde(default)]
    pub projects_dir: Option<PathBuf>,
    /// The folders that hold your projects, each a group in the command
    /// center and in the new terminal's folders, in this order:
    /// `["~/Freelance", "~/Projects", "~/Learning"]`. A project is a folder
    /// directly inside one, git repo or not. Defaults to `projects_dir`.
    #[serde(default)]
    pub project_roots: Option<Vec<String>>,
    /// A Face ID device locks after this many seconds without a request.
    #[serde(default = "default_face_id_lock_secs")]
    pub face_id_lock_secs: i64,
    /// The folder the phone's files view is confined to. Defaults to your
    /// home; `~/Projects` shows less.
    #[serde(default)]
    pub files_root: Option<PathBuf>,
    /// Where dev-server previews are served, on their own origin so a
    /// previewed app can't reach Airlock. Loopback only; Tailscale Serve
    /// publishes it on `preview_port`. No previews when unset.
    #[serde(default)]
    pub preview_listen: Option<SocketAddr>,
    /// The port previews have on your tailnet address.
    #[serde(default = "default_preview_port")]
    pub preview_port: u16,
    /// The program a terminal runs Claude Code with, when a session is
    /// carried on in Airlock: `claude`, from the terminal's PATH, unless set.
    #[serde(default = "default_claude_command")]
    pub claude_command: String,
}

fn default_claude_command() -> String {
    "claude".to_owned()
}

fn default_face_id_lock_secs() -> i64 {
    crate::faceid::LOCK_AFTER_SECS
}

fn default_preview_port() -> u16 {
    8443
}

fn home() -> PathBuf {
    std::env::var_os("HOME").map_or_else(|| PathBuf::from("/"), PathBuf::from)
}

impl Config {
    pub fn projects(&self) -> PathBuf {
        self.projects_dir
            .clone()
            .unwrap_or_else(|| home().join("Projects"))
    }

    /// [`Config::project_roots`] (`~/` meaning your home), or just
    /// [`Config::projects`].
    pub fn project_roots(&self) -> Vec<PathBuf> {
        match &self.project_roots {
            Some(roots) if !roots.is_empty() => roots
                .iter()
                .map(|root| match root.strip_prefix("~/") {
                    Some(rest) => home().join(rest),
                    None if root == "~" => home(),
                    None => PathBuf::from(root),
                })
                .collect(),
            _ => vec![self.projects()],
        }
    }

    pub fn files_root(&self) -> PathBuf {
        let root = self.files_root.clone().unwrap_or_else(home);
        root.canonicalize().unwrap_or(root)
    }
}

fn default_listen() -> SocketAddr {
    SocketAddr::from(([127, 0, 0, 1], 7690))
}

fn default_tmux_socket() -> String {
    "airlock".to_owned()
}

impl Config {
    pub fn load(paths: &Paths) -> Result<Self> {
        let file = paths.config_file();
        let text = std::fs::read_to_string(&file)
            .with_context(|| format!("reading {}", file.display()))?;
        let config: Self =
            toml::from_str(&text).with_context(|| format!("parsing {}", file.display()))?;
        config.check()?;
        Ok(config)
    }

    pub fn check(&self) -> Result<()> {
        if !self.listen.ip().is_loopback() {
            bail!("listen must be a loopback address: Tailscale Serve is the only way in");
        }
        if self.allowed_logins.is_empty() {
            bail!("allowed_logins is empty, so nobody could use Airlock");
        }
        if self.face_id_lock_secs < 1 {
            bail!("face_id_lock_secs must be at least 1");
        }
        if let Some(preview) = self.preview_listen
            && !preview.ip().is_loopback()
        {
            bail!("preview_listen must be a loopback address: Tailscale Serve is the only way in");
        }
        Ok(())
    }
}
