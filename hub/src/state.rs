//! What every request handler shares.

use std::sync::{Arc, Mutex, MutexGuard};

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
};

use crate::{
    attach::Streams,
    center::Cache,
    claude::Sessions,
    config::Config,
    events::Events,
    faceid::FaceId,
    laptop_tabs::LaptopTabs,
    preview::Ports,
    push::Push,
    store::Store,
    system::{AskedToStop, Sampler},
    terminals::Tmux,
};

#[derive(Clone)]
pub struct AppState {
    store: Arc<Mutex<Store>>,
    pub config: Arc<Config>,
    pub events: Events,
    pub tmux: Tmux,
    pub claude: Sessions,
    pub center: Arc<Cache>,
    pub faceid: Arc<FaceId>,
    pub sampler: Arc<Sampler>,
    pub preview_ports: Arc<Ports>,
    pub streams: Arc<Streams>,
    /// The processes asked to stop lately, which alone may be forced.
    pub asked_to_stop: Arc<AskedToStop>,
    pub laptop_tabs: Arc<LaptopTabs>,
    /// The real key is set as the hub starts.
    pub push: Arc<Push>,
}

impl AppState {
    pub fn new(store: Store, config: Config, tmux: Tmux) -> Self {
        Self {
            store: Arc::new(Mutex::new(store)),
            events: Events::new(),
            tmux,
            claude: Sessions::new(),
            center: Arc::new(Cache::default()),
            faceid: Arc::new(FaceId::new(config.face_id_lock_secs)),
            sampler: Arc::new(Sampler::default()),
            preview_ports: Arc::new(Ports::default()),
            streams: Arc::new(Streams::default()),
            asked_to_stop: Arc::new(AskedToStop::default()),
            laptop_tabs: Arc::new(LaptopTabs::default()),
            push: Arc::new(Push::ephemeral()),
            config: Arc::new(config),
        }
    }

    /// Calls are short, and a guard is never held across an `.await`.
    pub fn store(&self) -> MutexGuard<'_, Store> {
        self.store
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// Logs an unexpected error and answers without details.
pub fn internal_error(error: anyhow::Error) -> Response {
    tracing::error!("{error:#}");
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        "Something went wrong on the laptop.",
    )
        .into_response()
}

#[cfg(test)]
pub(crate) mod testing {
    use super::AppState;
    use crate::{config::Config, store::Store, terminals::Tmux};

    pub const LOGIN: &str = "you@example.com";

    pub fn state() -> AppState {
        let unused = format!("airlock-unused-{}", crate::token::id());
        state_with(Tmux::new(unused, "/dev/null"))
    }

    pub fn state_with(tmux: Tmux) -> AppState {
        state_in(
            tmux,
            std::path::Path::new("/nonexistent/airlock-test-projects"),
        )
    }

    pub fn state_in(tmux: Tmux, projects: &std::path::Path) -> AppState {
        let config = Config {
            listen: "127.0.0.1:0".parse().unwrap(),
            allowed_logins: vec![LOGIN.to_owned()],
            tmux_socket: "unused".to_owned(),
            projects_dir: Some(projects.to_path_buf()),
            project_roots: None,
            face_id_lock_secs: crate::faceid::LOCK_AFTER_SECS,
            files_root: Some(projects.to_path_buf()),
            preview_listen: None,
            preview_port: 8443,
            // Never the real one, should a test resume a session.
            claude_command: "airlock-test-no-claude".to_owned(),
        };
        AppState::new(Store::open_in_memory().unwrap(), config, tmux)
    }
}
