//! The API behind the phone's Work section (once the command center, hence
//! `center`): Claude Code sessions, organised by repo, then worktree. Every
//! route needs a paired device.

use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant},
};

use axum::{
    Extension, Json, Router,
    body::Bytes,
    extract::{Path as UrlPath, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::{
    answer::{self, Choice, Reach},
    background,
    claude::{self, Session, State as SessionState, Step, Waiting},
    events::Event,
    phone::{Paired, unpaired},
    procs,
    projects::{self, Root},
    repos::{self, FileChange, PullRequest, Repo, Worktree},
    state::{AppState, internal_error},
    store,
    system::{self, Quit},
    transcript,
};

const QUIT_WAIT: Duration = Duration::from_secs(5);

const DIR_FRESH: Duration = Duration::from_secs(60);
const REPO_FRESH: Duration = Duration::from_secs(4);
/// How old a repo's status may be and still be shown at once, while a newer
/// one is read in the background; older, the phone waits for git.
const REPO_SHOWN: Duration = Duration::from_secs(60);
const PULLS_FRESH: Duration = Duration::from_secs(120);
const FILES_MAX: usize = 200;

type Pulls = Result<Vec<PullRequest>, String>;

/// What the command center read lately, so a phone refreshing every few
/// seconds doesn't run git over every repo each time.
#[derive(Default)]
pub struct Cache {
    /// Folder → the repo's common git directory (`None`: not in a repo).
    dirs: Mutex<HashMap<PathBuf, (Instant, Option<PathBuf>)>>,
    repos: Mutex<HashMap<PathBuf, (Instant, Repo)>>,
    repos_loading: Mutex<HashSet<PathBuf>>,
    pulls: Mutex<HashMap<String, (Instant, Pulls)>>,
    pulls_loading: Mutex<HashSet<String>>,
}

fn locked<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl Cache {
    async fn common_dir(&self, dir: &Path) -> Option<PathBuf> {
        if let Some((at, found)) = locked(&self.dirs).get(dir)
            && at.elapsed() < DIR_FRESH
        {
            return found.clone();
        }
        let found = repos::common_dir(dir).await;
        locked(&self.dirs).insert(dir.to_path_buf(), (Instant::now(), found.clone()));
        found
    }

    /// The repo's status: the last one read, unless it's too old to show;
    /// one past its freshness is read again in the background, once however
    /// many ask, so a phone's poll never waits on git and git never runs
    /// over a repo twice at a time.
    async fn repo(self: &std::sync::Arc<Self>, common_dir: &Path) -> Option<Repo> {
        let known = locked(&self.repos).get(common_dir).cloned();
        match known {
            Some((at, repo)) if at.elapsed() < REPO_FRESH => Some(repo),
            Some((at, repo)) if at.elapsed() < REPO_SHOWN => {
                self.refresh_repo(common_dir);
                Some(repo)
            }
            _ => self.load_repo(common_dir).await,
        }
    }

    fn refresh_repo(self: &std::sync::Arc<Self>, common_dir: &Path) {
        if !locked(&self.repos_loading).insert(common_dir.to_path_buf()) {
            return;
        }
        let cache = self.clone();
        let common_dir = common_dir.to_path_buf();
        tokio::spawn(async move {
            cache.load_repo(&common_dir).await;
            locked(&cache.repos_loading).remove(&common_dir);
        });
    }

    async fn load_repo(&self, common_dir: &Path) -> Option<Repo> {
        match repos::load(common_dir).await {
            Ok(repo) => {
                locked(&self.repos)
                    .insert(common_dir.to_path_buf(), (Instant::now(), repo.clone()));
                Some(repo)
            }
            Err(error) => {
                tracing::warn!(dir = %common_dir.display(), "reading a repo: {error:#}");
                None
            }
        }
    }

    async fn pulls(self: &std::sync::Arc<Self>, slug: &str) -> Result<Vec<PullRequest>, String> {
        let known = locked(&self.pulls).get(slug).cloned();
        match known {
            Some((at, pulls)) if at.elapsed() < PULLS_FRESH => pulls,
            Some((_, pulls)) => {
                self.refresh_pulls(slug);
                pulls
            }
            None => {
                let pulls = repos::pull_requests(slug)
                    .await
                    .map_err(|error| format!("{error:#}"));
                locked(&self.pulls).insert(slug.to_owned(), (Instant::now(), pulls.clone()));
                pulls
            }
        }
    }

    /// The repo's pull requests if they have been read, without waiting on
    /// GitHub: stale or missing ones are read again in the background.
    pub(crate) fn pulls_known(self: &std::sync::Arc<Self>, slug: &str) -> Option<Vec<PullRequest>> {
        let known = locked(&self.pulls).get(slug).cloned();
        if known
            .as_ref()
            .is_none_or(|(at, _)| at.elapsed() >= PULLS_FRESH)
        {
            self.refresh_pulls(slug);
        }
        known.and_then(|(_, pulls)| pulls.ok())
    }

    fn refresh_pulls(self: &std::sync::Arc<Self>, slug: &str) {
        if !locked(&self.pulls_loading).insert(slug.to_owned()) {
            return;
        }
        let cache = self.clone();
        let slug = slug.to_owned();
        tokio::spawn(async move {
            let pulls = repos::pull_requests(&slug)
                .await
                .map_err(|error| format!("{error:#}"));
            locked(&cache.pulls).insert(slug.clone(), (Instant::now(), pulls));
            locked(&cache.pulls_loading).remove(&slug);
        });
    }
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/center", get(overview))
        .route("/api/center/sessions/{id}", get(session_detail))
        .route("/api/center/sessions/{id}/answer", post(answer_prompt))
        .route("/api/center/sessions/{id}/steps/{seq}", get(step_detail))
        .route("/api/center/sessions/{id}/screen", get(session_screen))
        .route("/api/center/sessions/{id}/type", post(type_into_session))
        .route("/api/center/sessions/{id}/continue", post(continue_here))
        .route("/api/center/sessions/{id}/move", post(move_here))
        .route("/api/center/folder", get(folder_detail))
        .route("/api/center/repos/{key}", get(repo_detail))
        .route("/api/center/repos/{key}/diff", get(worktree_diff))
        .route("/api/center/repos/{key}/prs/{number}", get(pull_detail))
        .route("/api/center/repos/{key}/prs/{number}/diff", get(pull_diff))
}

#[derive(Clone, Debug, Serialize)]
struct TerminalLink {
    terminal: u32,
    tab: u32,
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct SessionView {
    pub(crate) id: String,
    pub(crate) title: Option<String>,
    pub(crate) state: SessionState,
    pub(crate) doing: String,
    waiting: Option<Waiting>,
    started_at: i64,
    pub(crate) updated_at: i64,
    pub(crate) cwd: String,
    repo: Option<String>,
    pub(crate) repo_name: Option<String>,
    worktree: Option<String>,
    branch: Option<String>,
    terminal: Option<TerminalLink>,
    /// The laptop tab it runs in, when it runs in one the phone reaches.
    laptop_tab: Option<u32>,
    pub(crate) background: Vec<String>,
    context: Option<crate::claude::Context>,
    terminal_name: Option<String>,
    answerable: bool,
    place: Place,
}

#[derive(Clone, Debug, Serialize)]
struct Place {
    /// `airlock`: in one of Airlock's terminals. `tmux`: in another tmux,
    /// which the phone can watch and type into. `laptop`: in a tab of the
    /// laptop's terminal app that is shared, likewise. `elsewhere`: in a
    /// terminal Airlock can't reach. `unknown`: its hooks never said.
    kind: &'static str,
    app: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
struct RepoView {
    key: String,
    name: String,
    github: Option<String>,
    base: Option<String>,
    worktrees: Vec<Worktree>,
    needs_you: usize,
    working: usize,
    idle: usize,
}

pub(crate) struct Snapshot {
    pub(crate) sessions: Vec<SessionView>,
    pub(crate) repos: Vec<Repo>,
    pub(crate) roots: Vec<Root>,
}

/// A project as the center lists it: a folder in a project root (or a repo
/// or session folder outside them), with its git state when it is a repo,
/// and how its sessions are doing.
#[derive(Clone, Debug, Serialize)]
struct ProjectView {
    name: String,
    path: String,
    repo: Option<String>,
    branch: Option<String>,
    changes: u32,
    ahead: u32,
    behind: u32,
    worktrees: usize,
    needs_you: usize,
    working: usize,
    idle: usize,
    /// The latest of its sessions' activity and the folder's last change.
    active_at: i64,
}

/// A project root, or the projects outside all of them (`path: None`).
#[derive(Clone, Debug, Serialize)]
struct GroupView {
    name: String,
    path: Option<String>,
    projects: Vec<ProjectView>,
}

fn within(dir: &str, folder: &str) -> bool {
    dir == folder || dir.starts_with(&format!("{folder}/"))
}

/// The one project a session counts for: the project folder it is in, else
/// its repo's main worktree, else its own folder.
fn home_of(session: &SessionView, roots: &[Root], repos: &[Repo]) -> String {
    if let Some((_, project)) = projects::place_of(roots, &session.cwd) {
        return project.path.clone();
    }
    session
        .repo
        .as_deref()
        .and_then(|key| repos.iter().find(|repo| repo.key == key))
        .and_then(|repo| repo.worktrees.first())
        .map_or_else(|| session.cwd.clone(), |main| main.path.clone())
}

fn project_view(
    name: &str,
    path: &str,
    changed_at: i64,
    repo: Option<&Repo>,
    sessions: &[(String, &SessionView)],
) -> ProjectView {
    let mine: Vec<&SessionView> = sessions
        .iter()
        .filter(|(home, _)| home == path)
        .map(|(_, session)| *session)
        .collect();
    let count = |state: SessionState| mine.iter().filter(|s| s.state == state).count();
    let main = repo.and_then(|repo| repo.worktrees.first());
    ProjectView {
        name: name.to_owned(),
        path: path.to_owned(),
        repo: repo.map(|repo| repo.key.clone()),
        branch: main.and_then(|worktree| worktree.branch.clone()),
        changes: main.map_or(0, |worktree| worktree.changes),
        ahead: main.map_or(0, |worktree| worktree.ahead),
        behind: main.map_or(0, |worktree| worktree.behind),
        worktrees: repo.map_or(0, |repo| repo.worktrees.len()),
        needs_you: count(SessionState::NeedsYou),
        working: count(SessionState::Working),
        idle: count(SessionState::Idle),
        active_at: mine
            .iter()
            .map(|s| s.updated_at)
            .max()
            .unwrap_or(0)
            .max(changed_at),
    }
}

fn by_urgency(a: &ProjectView, b: &ProjectView) -> std::cmp::Ordering {
    (b.needs_you, b.working, b.active_at)
        .cmp(&(a.needs_you, a.working, a.active_at))
        .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
}

fn groups(snapshot: &Snapshot) -> Vec<GroupView> {
    let repo_at = |path: &str| {
        snapshot
            .repos
            .iter()
            .find(|repo| repo.worktrees.iter().any(|worktree| worktree.path == path))
    };
    let sessions: Vec<(String, &SessionView)> = snapshot
        .sessions
        .iter()
        .map(|s| (home_of(s, &snapshot.roots, &snapshot.repos), s))
        .collect();
    let mut groups: Vec<GroupView> = snapshot
        .roots
        .iter()
        .map(|root| {
            let mut projects: Vec<ProjectView> = root
                .projects
                .iter()
                .map(|project| {
                    project_view(
                        &project.name,
                        &project.path,
                        project.changed_at,
                        repo_at(&project.path),
                        &sessions,
                    )
                })
                .collect();
            projects.sort_by(by_urgency);
            GroupView {
                name: root.name.clone(),
                path: Some(root.path.clone()),
                projects,
            }
        })
        .collect();

    let in_a_root = |dir: &str| projects::place_of(&snapshot.roots, dir).is_some();
    let mut elsewhere: Vec<ProjectView> = snapshot
        .repos
        .iter()
        .filter_map(|repo| {
            let main = repo.worktrees.first()?;
            (!in_a_root(&main.path))
                .then(|| project_view(&repo.name, &main.path, 0, Some(repo), &sessions))
        })
        .collect();
    let mut loose: Vec<&str> = sessions
        .iter()
        .filter(|(home, s)| {
            *home == s.cwd && s.repo.is_none() && !s.cwd.is_empty() && !in_a_root(&s.cwd)
        })
        .map(|(home, _)| home.as_str())
        .collect();
    loose.sort_unstable();
    loose.dedup();
    elsewhere.extend(
        loose
            .into_iter()
            .map(|cwd| project_view(&repos::folder_of(cwd), cwd, 0, None, &sessions)),
    );
    if !elsewhere.is_empty() {
        elsewhere.sort_by(by_urgency);
        groups.push(GroupView {
            name: "Elsewhere".to_owned(),
            path: None,
            projects: elsewhere,
        });
    }
    groups
}

fn worktree_of<'a>(repos: &'a [Repo], dir: &str) -> Option<(&'a Repo, &'a Worktree)> {
    repos
        .iter()
        .flat_map(|repo| repo.worktrees.iter().map(move |worktree| (repo, worktree)))
        .filter(|(_, worktree)| {
            dir == worktree.path || dir.starts_with(&format!("{}/", worktree.path))
        })
        .max_by_key(|(_, worktree)| worktree.path.len())
}

async fn repo_dirs(roots: &[Root]) -> Vec<PathBuf> {
    let mut found = Vec::new();
    for project in roots.iter().flat_map(|root| &root.projects) {
        let path = PathBuf::from(&project.path);
        if tokio::fs::try_exists(path.join(".git"))
            .await
            .unwrap_or(false)
        {
            found.push(path);
        }
    }
    found
}

/// Whether a Claude process still runs `session`: neither its process nor
/// its tmux pane, whichever the hooks gave, has gone. With neither known,
/// it may.
async fn still_runs(session: &Session) -> bool {
    let process = session.pid.is_none_or(claude::is_claude);
    process
        && match &session.pane {
            Some(pane) => answer::pane_alive(pane).await,
            None => true,
        }
}

pub(crate) async fn snapshot(state: &AppState) -> Snapshot {
    let now = store::now();
    let mut sessions = state.claude.list(now);
    // A session whose Claude process or pane is gone has ended, whatever its
    // last hook said.
    for session in &mut sessions {
        if session.state != SessionState::Ended && !still_runs(session).await {
            state.claude.end(&session.id, now);
            state.events.send(Event::SessionsChanged);
            session.state = SessionState::Ended;
            session.waiting = None;
            session.doing = "Ended".to_owned();
        }
    }
    let going: Vec<(String, Option<i32>)> = sessions
        .iter()
        .filter(|session| session.state != SessionState::Ended)
        .map(|session| (session.id.clone(), session.pid))
        .collect();
    let mut background: HashMap<String, Vec<String>> = if going.is_empty() {
        HashMap::new()
    } else {
        tokio::task::spawn_blocking(move || {
            let processes = system::own_processes();
            let claude = transcript::claude_dir();
            let now = std::time::SystemTime::now();
            going
                .into_iter()
                .map(|(id, pid)| {
                    let found = background::of(&id, pid, &processes, &claude, now);
                    (id, found)
                })
                .collect()
        })
        .await
        .unwrap_or_default()
    };

    let terminals = state.tmux.list(false).await.unwrap_or_default();
    let roots = projects::roots(&state.config).await;
    let mut dirs: Vec<PathBuf> = repo_dirs(&roots).await;
    dirs.extend(
        sessions
            .iter()
            .filter(|s| !s.cwd.is_empty())
            .map(|s| PathBuf::from(&s.cwd)),
    );
    dirs.extend(
        terminals
            .iter()
            .flat_map(|t| t.tabs.iter().map(|tab| PathBuf::from(&tab.cwd))),
    );
    dirs.sort();
    dirs.dedup();
    let mut common_dirs = Vec::new();
    for dir in &dirs {
        if let Some(common) = state.center.common_dir(dir).await
            && !common_dirs.contains(&common)
        {
            common_dirs.push(common);
        }
    }
    let repos: Vec<Repo> =
        futures_util::future::join_all(common_dirs.iter().map(|common| state.center.repo(common)))
            .await
            .into_iter()
            .flatten()
            .collect();

    let ours = state.tmux.socket_path().await;
    let tab_titles: HashMap<u32, String> = state
        .laptop_tabs
        .list()
        .into_iter()
        .filter_map(|tab| Some((tab.id, tab.title?)))
        .collect();
    let mut views = Vec::with_capacity(sessions.len());
    for session in sessions {
        let place = worktree_of(&repos, &session.cwd);
        let terminal = match (&session.pane, &ours) {
            (Some(pane), Some(ours)) if pane.socket == *ours => state
                .tmux
                .locate(&pane.pane)
                .await
                .map(|(terminal, tab)| TerminalLink { terminal, tab }),
            _ => None,
        };
        let app = session.pid.and_then(procs::host_app);
        let laptop_tab = match (&session.pane, session.pid) {
            (None, Some(pid)) => state.laptop_tabs.holding(pid),
            _ => None,
        };
        let terminal_name = match (&terminal, laptop_tab) {
            (Some(link), _) => terminals.iter().find(|t| t.id == link.terminal).map(|t| {
                match t
                    .tabs
                    .iter()
                    .find(|tab| tab.id == link.tab && !tab.name.is_empty())
                {
                    Some(tab) if t.tabs.len() > 1 => format!("{} · {}", t.name, tab.name),
                    _ => t.name.clone(),
                }
            }),
            (None, Some(id)) => tab_titles.get(&id).cloned(),
            _ => None,
        };
        let runs_in = match (&session.pane, &ours) {
            (Some(pane), Some(ours)) if pane.socket == *ours => Place {
                kind: "airlock",
                app: None,
            },
            (Some(_), _) => Place { kind: "tmux", app },
            (None, _) if laptop_tab.is_some() => Place {
                kind: "laptop",
                app,
            },
            (None, _) if session.pid.is_some_and(claude::is_claude) => Place {
                kind: "elsewhere",
                app,
            },
            _ => Place {
                kind: "unknown",
                app: None,
            },
        };
        views.push(SessionView {
            place: runs_in,
            answerable: session.pane.is_some() || laptop_tab.is_some(),
            laptop_tab,
            background: background.remove(&session.id).unwrap_or_default(),
            context: state.claude.context(&session.id),
            terminal_name,
            id: session.id,
            title: session.title,
            state: session.state,
            doing: session.doing,
            waiting: session.waiting,
            started_at: session.started_at,
            updated_at: session.updated_at,
            repo: place.map(|(repo, _)| repo.key.clone()),
            repo_name: place.map(|(repo, _)| repo.name.clone()),
            worktree: place.map(|(_, worktree)| worktree.path.clone()),
            branch: place.and_then(|(_, worktree)| worktree.branch.clone()),
            cwd: session.cwd,
            terminal,
        });
    }
    Snapshot {
        sessions: views,
        repos,
        roots,
    }
}

pub async fn sessions_json(state: &AppState) -> serde_json::Value {
    json!({"sessions": snapshot(state).await.sessions})
}

pub async fn session_json(state: &AppState, id: &str) -> Option<serde_json::Value> {
    let view = snapshot(state)
        .await
        .sessions
        .into_iter()
        .find(|s| s.id == id)?;
    let timeline: Vec<Step> = state
        .claude
        .get(id)
        .map(|session| session.timeline.into_iter().collect())
        .unwrap_or_default();
    Some(json!({"session": view, "timeline": timeline}))
}

fn repo_view(repo: &Repo, sessions: &[SessionView]) -> RepoView {
    let count = |state: SessionState| {
        sessions
            .iter()
            .filter(|s| s.repo.as_deref() == Some(&repo.key) && s.state == state)
            .count()
    };
    RepoView {
        key: repo.key.clone(),
        name: repo.name.clone(),
        github: repo.github.clone(),
        base: repo.base.clone(),
        worktrees: repo.worktrees.clone(),
        needs_you: count(SessionState::NeedsYou),
        working: count(SessionState::Working),
        idle: count(SessionState::Idle),
    }
}

async fn overview(
    State(state): State<AppState>,
    Extension(Paired(device)): Extension<Paired>,
) -> Response {
    if device.is_none() {
        return unpaired();
    }
    let snapshot = snapshot(&state).await;
    let last_seen = |key: &str| {
        snapshot
            .sessions
            .iter()
            .filter(|s| s.repo.as_deref() == Some(key))
            .map(|s| s.updated_at)
            .max()
            .unwrap_or(0)
    };
    let mut repos: Vec<RepoView> = snapshot
        .repos
        .iter()
        .map(|repo| repo_view(repo, &snapshot.sessions))
        .collect();
    repos.sort_by(|a, b| {
        (b.needs_you, b.working, last_seen(&b.key))
            .cmp(&(a.needs_you, a.working, last_seen(&a.key)))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    let groups = groups(&snapshot);
    Json(json!({"sessions": snapshot.sessions, "repos": repos, "groups": groups})).into_response()
}

#[derive(Deserialize)]
struct FolderQuery {
    path: String,
}

async fn folder_detail(
    State(state): State<AppState>,
    Extension(Paired(device)): Extension<Paired>,
    Query(FolderQuery { path }): Query<FolderQuery>,
) -> Response {
    if device.is_none() {
        return unpaired();
    }
    let snapshot = snapshot(&state).await;
    let sessions: Vec<&SessionView> = snapshot
        .sessions
        .iter()
        .filter(|s| within(&s.cwd, &path))
        .collect();
    let session_tabs: HashSet<u32> = sessions
        .iter()
        .filter_map(|s| s.terminal.as_ref().map(|link| link.tab))
        .collect();
    let terminals = state.tmux.list(false).await.unwrap_or_default();
    let tabs = tabs_where(&terminals, |cwd| within(cwd, &path), &session_tabs);
    Json(json!({
        "name": repos::folder_of(&path),
        "path": path,
        "sessions": sessions,
        "tabs": tabs,
    }))
    .into_response()
}

fn tabs_where(
    terminals: &[crate::terminals::Terminal],
    here: impl Fn(&str) -> bool,
    session_tabs: &HashSet<u32>,
) -> Vec<TabView> {
    terminals
        .iter()
        .flat_map(|terminal| {
            terminal
                .tabs
                .iter()
                .filter(|tab| here(&tab.cwd) && !session_tabs.contains(&tab.id))
                .map(|tab| TabView {
                    terminal: terminal.id,
                    terminal_name: terminal.name.clone(),
                    tab: tab.id,
                    index: tab.index,
                    name: tab.name.clone(),
                    folder: tab.folder.clone(),
                    command: tab.command.clone(),
                    active: tab.active,
                })
        })
        .collect()
}

fn refusal(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({"error": message}))).into_response()
}

fn github_branch_url(slug: Option<&str>, branch: Option<&str>) -> Option<String> {
    Some(format!("https://github.com/{}/tree/{}", slug?, branch?))
}

async fn session_detail(
    State(state): State<AppState>,
    Extension(Paired(device)): Extension<Paired>,
    UrlPath(id): UrlPath<String>,
) -> Response {
    if device.is_none() {
        return unpaired();
    }
    let snapshot = snapshot(&state).await;
    let Some(view) = snapshot.sessions.into_iter().find(|s| s.id == id) else {
        return refusal(StatusCode::NOT_FOUND, "That session is gone.");
    };
    let timeline: Vec<Step> = state
        .claude
        .get(&id)
        .map(|session: Session| session.timeline.into_iter().collect())
        .unwrap_or_default();
    let repo = view
        .repo
        .as_deref()
        .and_then(|key| snapshot.repos.iter().find(|repo| repo.key == key));
    let (mut files, mut compared_to) = (Vec::<FileChange>::new(), None);
    if let (Some(repo), Some(worktree)) = (repo, view.worktree.as_deref()) {
        files = repos::branch_files(Path::new(worktree), repo.base.as_deref())
            .await
            .unwrap_or_default();
        files.truncate(FILES_MAX);
        compared_to = repo.base.clone();
    }
    let github_url = github_branch_url(
        repo.and_then(|repo| repo.github.as_deref()),
        view.branch.as_deref(),
    );
    Json(json!({
        "session": view,
        "timeline": timeline,
        "files": files,
        "compared_to": compared_to,
        "github_url": github_url,
    }))
    .into_response()
}

#[derive(Deserialize)]
struct Answer {
    choice: Choice,
}

async fn answer_prompt(
    State(state): State<AppState>,
    Extension(Paired(device)): Extension<Paired>,
    UrlPath(id): UrlPath<String>,
    bytes: Bytes,
) -> Response {
    if device.is_none() {
        return unpaired();
    }
    let Ok(Answer { choice }) = serde_json::from_slice(&bytes) else {
        return refusal(
            StatusCode::BAD_REQUEST,
            "Expected {\"choice\": \"once\" | \"always\" | \"deny\"}.",
        );
    };
    let Some(session) = state.claude.get(&id) else {
        return refusal(StatusCode::NOT_FOUND, "That session is gone.");
    };
    let asking = session
        .waiting
        .as_ref()
        .is_some_and(|waiting| waiting.kind == "permission");
    if session.state != SessionState::NeedsYou || !asking {
        return refusal(StatusCode::CONFLICT, "It isn't asking for permission now.");
    }
    let Some(reach) = reach(&state, &session) else {
        return refusal(
            StatusCode::CONFLICT,
            "It runs in a terminal Airlock can't reach, so it can't type into it. Answer it on the laptop.",
        );
    };
    match reach.answer(choice).await {
        Ok(()) => {
            state.claude.answered(&id, store::now());
            state.events.send(Event::SessionsChanged);
            StatusCode::NO_CONTENT.into_response()
        }
        Err(error) => refusal(StatusCode::CONFLICT, &format!("{error:#}")),
    }
}

async fn step_detail(
    State(state): State<AppState>,
    Extension(Paired(device)): Extension<Paired>,
    UrlPath((id, seq)): UrlPath<(String, u64)>,
) -> Response {
    if device.is_none() {
        return unpaired();
    }
    let Some(session) = state.claude.get(&id) else {
        return refusal(StatusCode::NOT_FOUND, "That session is gone.");
    };
    let Some(step) = session
        .timeline
        .iter()
        .find(|step| step.seq == seq)
        .cloned()
    else {
        return refusal(StatusCode::NOT_FOUND, "That step is gone.");
    };
    let Some(tool) = step.tool.clone() else {
        return refusal(StatusCode::NOT_FOUND, "There's nothing more to that step.");
    };
    let Some(path) = transcript::transcript_of(&id, &transcript::claude_dir()) else {
        return refusal(
            StatusCode::NOT_FOUND,
            "Its transcript isn't on this laptop.",
        );
    };
    let kept = step.input.clone().unwrap_or_else(|| json!({}));
    let tool_use_id = step.tool_use_id.clone();
    let found = tokio::task::spawn_blocking(move || {
        let text = std::fs::read_to_string(path).ok()?;
        transcript::find_call(&text, tool_use_id.as_deref(), &tool, &kept)
    })
    .await
    .ok()
    .flatten();
    match found {
        Some(call) => Json(json!({"step": step, "call": call, "cwd": session.cwd})).into_response(),
        None => refusal(
            StatusCode::NOT_FOUND,
            "That step isn't in its transcript any more (Claude may have compacted it).",
        ),
    }
}

fn reach<'a>(state: &'a AppState, session: &'a Session) -> Option<Reach<'a>> {
    if let Some(pane) = &session.pane {
        return Some(Reach::Pane(pane));
    }
    let id = state.laptop_tabs.holding(session.pid?)?;
    Some(Reach::Tab {
        id,
        tabs: &state.laptop_tabs,
    })
}

async fn session_screen(
    State(state): State<AppState>,
    Extension(Paired(device)): Extension<Paired>,
    UrlPath(id): UrlPath<String>,
) -> Response {
    if device.is_none() {
        return unpaired();
    }
    let Some(session) = state.claude.get(&id) else {
        return refusal(StatusCode::NOT_FOUND, "That session is gone.");
    };
    let Some(reach) = reach(&state, &session) else {
        return refusal(
            StatusCode::CONFLICT,
            "It runs in a terminal Airlock can't reach, so it can't see its screen.",
        );
    };
    match reach.in_colour().await {
        Ok((text, width, height)) => {
            Json(json!({"text": text, "width": width, "height": height})).into_response()
        }
        Err(error) => refusal(StatusCode::CONFLICT, &format!("{error:#}")),
    }
}

#[derive(Deserialize)]
struct Typed {
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    key: Option<String>,
}

async fn type_into_session(
    State(state): State<AppState>,
    Extension(Paired(device)): Extension<Paired>,
    UrlPath(id): UrlPath<String>,
    bytes: Bytes,
) -> Response {
    if device.is_none() {
        return unpaired();
    }
    let Ok(Typed { text, key }) = serde_json::from_slice(&bytes) else {
        return refusal(StatusCode::BAD_REQUEST, "Expected {\"text\"} or {\"key\"}.");
    };
    if text.as_ref().is_some_and(|text| text.len() > 8000) {
        return refusal(StatusCode::BAD_REQUEST, "That's too much to type at once.");
    }
    let Some(session) = state.claude.get(&id) else {
        return refusal(StatusCode::NOT_FOUND, "That session is gone.");
    };
    let Some(reach) = reach(&state, &session) else {
        return refusal(
            StatusCode::CONFLICT,
            "It runs in a terminal Airlock can't reach, so it can't type into it.",
        );
    };
    match reach.type_into(text.as_deref(), key.as_deref()).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => refusal(StatusCode::CONFLICT, &format!("{error:#}")),
    }
}

/// Picks a session up in a new Airlock terminal: `claude --resume <id>` in
/// its folder, once no Claude runs it. Two on one conversation would each
/// carry on from the same point and diverge; one still open in a laptop
/// terminal is moved instead ([`move_here`]).
async fn continue_here(
    State(state): State<AppState>,
    Extension(Paired(device)): Extension<Paired>,
    UrlPath(id): UrlPath<String>,
) -> Response {
    if device.is_none() {
        return unpaired();
    }
    let Some(session) = state.claude.get(&id) else {
        return refusal(StatusCode::NOT_FOUND, "That session is gone.");
    };
    let known = session.pid.is_some() || session.pane.is_some();
    if known && still_runs(&session).await {
        return refusal(
            StatusCode::CONFLICT,
            if reach(&state, &session).is_some() {
                "It's still running in a terminal the phone already reaches."
            } else {
                "It's still open in a terminal on the laptop. Share it with the phone instead, so only one Claude carries it on."
            },
        );
    }
    match resume(&state, &session).await {
        Ok(terminal) => Json(json!({"terminal": terminal})).into_response(),
        Err(refused) => *refused,
    }
}

/// Shares a session open in a laptop terminal Airlock can't reach: Claude
/// there is asked to quit (it saves as it goes), and once it has, the
/// conversation carries on in a new Airlock terminal, which the laptop app
/// opens in a window, so it is on the laptop and the phone at once. Not
/// while it is working, which would cut its turn short.
async fn move_here(
    State(state): State<AppState>,
    Extension(Paired(device)): Extension<Paired>,
    UrlPath(id): UrlPath<String>,
) -> Response {
    let Some(device) = device else {
        return unpaired();
    };
    let Some(session) = state.claude.get(&id) else {
        return refusal(StatusCode::NOT_FOUND, "That session is gone.");
    };
    if reach(&state, &session).is_some() {
        return refusal(
            StatusCode::CONFLICT,
            "It runs in a terminal the phone already reaches.",
        );
    }
    // Checked before Claude is asked to quit, so a move that can't finish
    // never starts.
    if let Some(refused) = unresumable(&session) {
        return refused;
    }
    if let Some(pid) = session.pid.filter(|pid| claude::is_claude(*pid)) {
        if session.state == SessionState::Working {
            return refusal(
                StatusCode::CONFLICT,
                "It's working. Share it once it has finished its turn.",
            );
        }
        match system::quit(pid, QUIT_WAIT, claude::is_claude).await {
            Quit::Exited => {}
            Quit::StillRunning => {
                return refusal(
                    StatusCode::CONFLICT,
                    "Claude didn't quit on the laptop within 5 seconds, so nothing was shared.",
                );
            }
            Quit::Refused => {
                return refusal(StatusCode::CONFLICT, "Airlock can't stop that Claude.");
            }
        }
        state.claude.end(&id, store::now());
        state.events.send(Event::SessionsChanged);
        let detail = format!("{} ({id}) from {}", session.cwd, device.name);
        if let Err(error) = state.store().audit("phone", "session shared", &detail) {
            return internal_error(error);
        }
    }
    match resume(&state, &session).await {
        Ok(terminal) => {
            state.events.send(Event::SessionShared { terminal });
            Json(json!({"terminal": terminal})).into_response()
        }
        Err(refused) => *refused,
    }
}

fn unresumable(session: &Session) -> Option<Response> {
    let plain = session
        .id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-');
    if !plain {
        return Some(refusal(
            StatusCode::BAD_REQUEST,
            "That isn't a session id Claude would use.",
        ));
    }
    if !Path::new(&session.cwd).is_dir() {
        return Some(refusal(
            StatusCode::CONFLICT,
            "Its folder isn't there any more.",
        ));
    }
    None
}

async fn resume(state: &AppState, session: &Session) -> Result<u32, Box<Response>> {
    if let Some(refused) = unresumable(session) {
        return Err(Box::new(refused));
    }
    let id = &session.id;
    let cwd = Path::new(&session.cwd);
    let name: String = session
        .title
        .as_deref()
        .unwrap_or("claude")
        .chars()
        .take(30)
        .collect();
    let terminal = state
        .tmux
        .create(&name, cwd)
        .await
        .map_err(|error| Box::new(internal_error(error)))?;
    // The program is the laptop's own setting, typed as one word for the
    // shell (quoted only when it needs to be, so an alias still works); the
    // id is letters, digits and dashes.
    let program = &state.config.claude_command;
    let plain = program
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || "/-_.~".contains(c));
    let claude = if plain {
        program.clone()
    } else {
        format!("'{}'", program.replace('\'', r"'\''"))
    };
    state
        .tmux
        .run_in(terminal, &format!("{claude} --resume {id}"))
        .await
        .map_err(|error| Box::new(internal_error(error)))?;
    Ok(terminal)
}

async fn find_repo(state: &AppState, key: &str) -> Option<(Repo, Vec<SessionView>)> {
    let snapshot = snapshot(state).await;
    let repo = snapshot.repos.into_iter().find(|repo| repo.key == key)?;
    Some((repo, snapshot.sessions))
}

#[derive(Serialize)]
struct TabView {
    terminal: u32,
    terminal_name: String,
    tab: u32,
    index: u32,
    name: String,
    folder: String,
    command: String,
    active: bool,
}

async fn repo_detail(
    State(state): State<AppState>,
    Extension(Paired(device)): Extension<Paired>,
    UrlPath(key): UrlPath<String>,
) -> Response {
    if device.is_none() {
        return unpaired();
    }
    let Some((repo, sessions)) = find_repo(&state, &key).await else {
        return refusal(StatusCode::NOT_FOUND, "That repo isn't in view any more.");
    };
    let terminals = state.tmux.list(false).await.unwrap_or_default();
    let session_tabs: HashSet<u32> = sessions
        .iter()
        .filter_map(|s| s.terminal.as_ref().map(|link| link.tab))
        .collect();
    let repos = std::slice::from_ref(&repo);
    let worktrees: Vec<serde_json::Value> = repo
        .worktrees
        .iter()
        .map(|worktree| {
            let here = |dir: &str| {
                worktree_of(repos, dir).is_some_and(|(_, found)| found.path == worktree.path)
            };
            let in_here: Vec<&SessionView> = sessions
                .iter()
                .filter(|s| s.worktree.as_deref() == Some(&worktree.path))
                .collect();
            let tabs = tabs_where(&terminals, here, &session_tabs);
            json!({"worktree": worktree, "sessions": in_here, "tabs": tabs})
        })
        .collect();
    let (pulls, pulls_note) = match repo.github.as_deref() {
        None => (None, Some("This repo isn't on GitHub.".to_owned())),
        Some(slug) => match state.center.pulls(slug).await {
            Ok(pulls) => (Some(pulls), None),
            Err(error) => (None, Some(format!("GitHub didn't answer: {error}"))),
        },
    };
    let view = repo_view(&repo, &sessions);
    Json(json!({
        "repo": view,
        "worktrees": worktrees,
        "pulls": pulls,
        "pulls_note": pulls_note,
    }))
    .into_response()
}

#[derive(Deserialize)]
struct WorktreeQuery {
    worktree: String,
}

async fn worktree_diff(
    State(state): State<AppState>,
    Extension(Paired(device)): Extension<Paired>,
    UrlPath(key): UrlPath<String>,
    Query(query): Query<WorktreeQuery>,
) -> Response {
    if device.is_none() {
        return unpaired();
    }
    let Some((repo, _)) = find_repo(&state, &key).await else {
        return refusal(StatusCode::NOT_FOUND, "That repo isn't in view any more.");
    };
    // Only one of the repo's own worktrees, never any folder the phone names.
    if !repo.worktrees.iter().any(|w| w.path == query.worktree) {
        return refusal(
            StatusCode::NOT_FOUND,
            "That worktree isn't part of the repo.",
        );
    }
    match repos::branch_diff(Path::new(&query.worktree), repo.base.as_deref()).await {
        Ok(diff) => Json(json!({"diff": diff, "compared_to": repo.base})).into_response(),
        Err(error) => internal_error(error),
    }
}

async fn pull_detail(
    State(state): State<AppState>,
    Extension(Paired(device)): Extension<Paired>,
    UrlPath((key, number)): UrlPath<(String, u32)>,
) -> Response {
    if device.is_none() {
        return unpaired();
    }
    let Some(slug) = find_repo(&state, &key)
        .await
        .and_then(|(repo, _)| repo.github)
    else {
        return refusal(StatusCode::NOT_FOUND, "That repo isn't on GitHub.");
    };
    match repos::pull_request(&slug, number).await {
        Ok(pull) => Json(pull).into_response(),
        Err(error) => refusal(
            StatusCode::BAD_GATEWAY,
            &format!("GitHub didn't answer: {error:#}"),
        ),
    }
}

async fn pull_diff(
    State(state): State<AppState>,
    Extension(Paired(device)): Extension<Paired>,
    UrlPath((key, number)): UrlPath<(String, u32)>,
) -> Response {
    if device.is_none() {
        return unpaired();
    }
    let Some(slug) = find_repo(&state, &key)
        .await
        .and_then(|(repo, _)| repo.github)
    else {
        return refusal(StatusCode::NOT_FOUND, "That repo isn't on GitHub.");
    };
    match repos::pull_diff(&slug, number).await {
        Ok(diff) => Json(json!({"diff": diff})).into_response(),
        Err(error) => refusal(
            StatusCode::BAD_GATEWAY,
            &format!("GitHub didn't answer: {error:#}"),
        ),
    }
}

#[cfg(test)]
mod tests {
    use axum::{body::Body, http::Request};
    use http_body_util::BodyExt;
    use serde_json::Value;
    use tower::ServiceExt;

    use super::*;
    use crate::{
        claude::HookReport,
        repos::testing::{git, repo_with_worktree},
        state::testing::state_in,
        store::Device,
        terminals::testing::ScratchTmux,
    };

    #[tokio::test]
    async fn a_repo_past_its_freshness_is_shown_at_once_and_read_again_behind() {
        let root = tempfile::tempdir().unwrap();
        let (main, _) = repo_with_worktree(root.path());
        let cache = std::sync::Arc::new(Cache::default());
        let common = repos::common_dir(&main).await.unwrap();
        let changes = |repo: &Repo| repo.worktrees[0].changes;
        assert_eq!(changes(&cache.repo(&common).await.unwrap()), 0);

        std::fs::write(main.join("new.txt"), "new\n").unwrap();
        let stale = Instant::now() - REPO_FRESH - Duration::from_secs(1);
        locked(&cache.repos).get_mut(&common).unwrap().0 = stale;
        // Shown as it was, at once, however many ask; read again once.
        let (one, other) = tokio::join!(cache.repo(&common), cache.repo(&common));
        assert_eq!(changes(&one.unwrap()), 0);
        assert_eq!(changes(&other.unwrap()), 0);
        assert_eq!(locked(&cache.repos_loading).len(), 1);
        let deadline = Instant::now() + Duration::from_secs(10);
        while locked(&cache.repos)[&common].0 == stale {
            assert!(Instant::now() < deadline, "the repo wasn't read again");
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert_eq!(changes(&cache.repo(&common).await.unwrap()), 1);

        // Too old to show: the phone waits for git.
        std::fs::write(main.join("newer.txt"), "newer\n").unwrap();
        locked(&cache.repos).get_mut(&common).unwrap().0 = Instant::now() - REPO_SHOWN;
        assert_eq!(changes(&cache.repo(&common).await.unwrap()), 2);
    }

    /// The center's routes as a paired phone reaches them; pairing itself is
    /// tested with the phone server.
    fn phone(state: AppState) -> Router {
        let device = Device {
            id: "d1".to_owned(),
            name: "Test phone".to_owned(),
            login: "you@example.com".to_owned(),
            created_at: 0,
            last_seen: 0,
            face_id: false,
        };
        routes()
            .layer(Extension(Paired(Some(device))))
            .with_state(state)
    }

    async fn call(router: &Router, method: &str, uri: &str, body: &str) -> (StatusCode, Value) {
        let request = Request::builder()
            .method(method)
            .uri(uri)
            .body(Body::from(body.to_owned()))
            .unwrap();
        let response = router.clone().oneshot(request).await.unwrap();
        let status = response.status();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        )
    }

    #[tokio::test]
    async fn sessions_show_up_under_their_repo_and_worktree() {
        let projects = tempfile::tempdir().unwrap();
        let (main, feature) = repo_with_worktree(projects.path());
        // Not on GitHub, so the test never reaches the network.
        git(
            &main,
            &["remote", "set-url", "origin", "https://example.com/app.git"],
        );
        let scratch = ScratchTmux::new();
        let state = state_in(scratch.tmux.clone(), projects.path());
        let terminal = scratch.tmux.create("feature", &feature).await.unwrap();
        let pane = std::process::Command::new("tmux")
            .args(["-L", scratch.tmux.socket(), "display-message", "-p", "-t"])
            .arg(format!("${terminal}"))
            .arg("#{pane_id}")
            .output()
            .unwrap();
        let pane = String::from_utf8_lossy(&pane.stdout).trim().to_owned();
        let socket = scratch.tmux.socket_path().await.unwrap();
        state.claude.record(
            &HookReport {
                event: serde_json::json!({
                    "hook_event_name": "PermissionRequest",
                    "session_id": "s1",
                    "cwd": feature.to_str().unwrap(),
                    "tool_name": "Bash",
                    "tool_input": {"command": "cargo test"},
                }),
                tmux: Some(format!("{socket},1,0")),
                pane: Some(pane),
                at_ms: 1,
                claude_pid: None,
            },
            store::now(),
        );
        let router = phone(state);

        let (status, center) = call(&router, "GET", "/api/center", "").await;
        assert_eq!(status, StatusCode::OK);
        let session = &center["sessions"][0];
        assert_eq!(session["state"], "needs_you");
        assert_eq!(session["waiting"]["detail"], "cargo test");
        assert_eq!(session["worktree"], feature.to_str().unwrap());
        assert_eq!(session["branch"], "feature");
        assert_eq!(session["terminal"]["terminal"], terminal);
        assert_eq!(session["place"]["kind"], "airlock");
        let repo = &center["repos"][0];
        assert_eq!(repo["name"], "app");
        assert_eq!(repo["needs_you"], 1);
        assert_eq!(repo["worktrees"].as_array().unwrap().len(), 2);
        let key = repo["key"].as_str().unwrap().to_owned();

        // By project root: both worktrees are folders of the projects root,
        // and the session counts once, for the folder it is in.
        let group = &center["groups"][0];
        assert_eq!(group["path"], projects.path().to_str().unwrap());
        let project = |name: &str| {
            group["projects"]
                .as_array()
                .unwrap()
                .iter()
                .find(|project| project["name"] == name)
                .cloned()
                .unwrap_or_else(|| panic!("no project {name} in {group}"))
        };
        assert_eq!(project("app-feature")["repo"], key);
        assert_eq!(project("app-feature")["needs_you"], 1);
        assert_eq!(project("app")["repo"], key);
        assert_eq!(project("app")["needs_you"], 0);
        assert_eq!(
            center["groups"].as_array().unwrap().len(),
            1,
            "nothing is elsewhere"
        );

        let (_, detail) = call(&router, "GET", &format!("/api/center/repos/{key}"), "").await;
        assert_eq!(detail["pulls_note"], "This repo isn't on GitHub.");
        assert_eq!(detail["worktrees"][1]["sessions"][0]["id"], "s1");
        // The session's tab shows as the session, not again as a tab.
        assert_eq!(detail["worktrees"][1]["tabs"], serde_json::json!([]));

        let (_, session) = call(&router, "GET", "/api/center/sessions/s1", "").await;
        assert_eq!(session["files"].as_array().unwrap().len(), 3);
        assert_eq!(session["compared_to"], "main");

        let diff = format!(
            "/api/center/repos/{key}/diff?worktree={}",
            feature.display()
        );
        let (status, diff) = call(&router, "GET", &diff, "").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(diff["diff"]["files"].as_array().unwrap().len(), 3);
        // Only the repo's own worktrees, never any folder the phone names.
        let elsewhere = format!("/api/center/repos/{key}/diff?worktree=/etc");
        assert_eq!(
            call(&router, "GET", &elsewhere, "").await.0,
            StatusCode::NOT_FOUND
        );

        // Its pane shows a shell, not a prompt: nothing is typed.
        let (status, refused) = call(
            &router,
            "POST",
            "/api/center/sessions/s1/answer",
            r#"{"choice":"once"}"#,
        )
        .await;
        assert_eq!(status, StatusCode::CONFLICT);
        assert_eq!(refused["error"], "Its terminal isn't asking anything now.");

        // Its screen can be watched and typed into; only named keys are pressed.
        let (status, _) = call(
            &router,
            "POST",
            "/api/center/sessions/s1/type",
            r#"{"text":"echo typed-$((6*7))"}"#,
        )
        .await;
        assert_eq!(status, StatusCode::NO_CONTENT);
        call(
            &router,
            "POST",
            "/api/center/sessions/s1/type",
            r#"{"key":"Enter"}"#,
        )
        .await;
        let mut seen = String::new();
        for _ in 0..50 {
            let (_, screen) = call(&router, "GET", "/api/center/sessions/s1/screen", "").await;
            seen = screen["text"].as_str().unwrap_or_default().to_owned();
            if seen.lines().any(|line| line.trim() == "typed-42") {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
        assert!(seen.lines().any(|line| line.trim() == "typed-42"), "{seen}");
        let (status, _) = call(
            &router,
            "POST",
            "/api/center/sessions/s1/type",
            r#"{"key":"rm -rf /"}"#,
        )
        .await;
        assert_eq!(status, StatusCode::CONFLICT);

        scratch.tmux.close(terminal).await.unwrap();
        let (_, center) = call(&router, "GET", "/api/center", "").await;
        assert_eq!(center["sessions"][0]["state"], "ended");
    }

    #[tokio::test]
    async fn a_project_folder_without_git_still_has_its_sessions() {
        let projects = tempfile::tempdir().unwrap();
        let notes = projects.path().join("notes");
        std::fs::create_dir_all(notes.join("week1")).unwrap();
        let scratch = ScratchTmux::new();
        let state = state_in(scratch.tmux.clone(), projects.path());
        let report = |id: &str, cwd: &str| HookReport {
            event: serde_json::json!({
                "hook_event_name": "UserPromptSubmit",
                "session_id": id,
                "cwd": cwd,
                "prompt": "summarise this week",
            }),
            tmux: None,
            pane: None,
            at_ms: 1,
            claude_pid: None,
        };
        state.claude.record(
            &report("s1", notes.join("week1").to_str().unwrap()),
            store::now(),
        );
        state.claude.record(&report("s2", "/tmp"), store::now());
        let router = phone(state);

        let (_, center) = call(&router, "GET", "/api/center", "").await;
        let notes_view = &center["groups"][0]["projects"][0];
        assert_eq!(notes_view["name"], "notes");
        assert_eq!(notes_view["repo"], Value::Null);
        assert_eq!(notes_view["working"], 1);
        let elsewhere = &center["groups"][1];
        assert_eq!(elsewhere["name"], "Elsewhere");
        assert_eq!(elsewhere["path"], Value::Null);
        assert_eq!(elsewhere["projects"][0]["path"], "/tmp");

        let uri = format!("/api/center/folder?path={}", notes.display());
        let (status, folder) = call(&router, "GET", &uri, "").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(folder["name"], "notes");
        assert_eq!(folder["sessions"][0]["id"], "s1");
    }

    /// A stand-in for Claude Code in a terminal Airlock can't reach: `sleep`
    /// under the name `claude`, so it never starts the real one. A link,
    /// not a copy: a copy just written can't always run at once ("text file
    /// busy") while other tests start processes.
    fn fake_claude(dir: &Path) -> std::process::Child {
        let program = dir.join("claude");
        std::os::unix::fs::symlink("/bin/sleep", &program).unwrap();
        std::process::Command::new(&program)
            .arg("600")
            .spawn()
            .unwrap()
    }

    fn hook_from(pid: u32, cwd: &Path, event: &str, at_ms: i64) -> HookReport {
        HookReport {
            event: serde_json::json!({
                "hook_event_name": event,
                "session_id": "s1",
                "cwd": cwd.to_str().unwrap(),
                "tool_name": "Bash",
                "tool_input": {"command": "cargo test"},
            }),
            tmux: None,
            pane: None,
            at_ms,
            claude_pid: Some(pid as i32),
        }
    }

    #[tokio::test]
    async fn a_session_open_on_the_laptop_is_moved_never_resumed_beside_it() {
        let projects = tempfile::tempdir().unwrap();
        let folder = projects.path().join("app");
        std::fs::create_dir(&folder).unwrap();
        let bin = tempfile::tempdir().unwrap();
        let mut claude = fake_claude(bin.path());
        let pid = claude.id();
        let scratch = ScratchTmux::new();
        let state = state_in(scratch.tmux.clone(), projects.path());
        state
            .claude
            .record(&hook_from(pid, &folder, "PreToolUse", 1), store::now());
        let router = phone(state.clone());

        let (_, center) = call(&router, "GET", "/api/center", "").await;
        assert_eq!(center["sessions"][0]["place"]["kind"], "elsewhere");

        // Resumed beside the one still open, the two would diverge.
        let (status, body) = call(&router, "POST", "/api/center/sessions/s1/continue", "").await;
        assert_eq!(status, StatusCode::CONFLICT);
        assert!(
            body["error"]
                .as_str()
                .unwrap()
                .contains("Share it with the phone")
        );

        let (status, body) = call(&router, "POST", "/api/center/sessions/s1/move", "").await;
        assert_eq!(status, StatusCode::CONFLICT, "{body}");
        assert!(body["error"].as_str().unwrap().contains("working"));
        assert!(claude.try_wait().unwrap().is_none(), "left running");

        // A move that couldn't resume doesn't quit it either.
        state
            .claude
            .record(&hook_from(pid, &folder, "Stop", 2), store::now());
        std::fs::remove_dir(&folder).unwrap();
        let (status, body) = call(&router, "POST", "/api/center/sessions/s1/move", "").await;
        assert_eq!(status, StatusCode::CONFLICT);
        assert_eq!(body["error"], "Its folder isn't there any more.");
        assert!(claude.try_wait().unwrap().is_none(), "left running");

        std::fs::create_dir(&folder).unwrap();
        let mut events = state.events.subscribe();
        let (status, body) = call(&router, "POST", "/api/center/sessions/s1/move", "").await;
        assert_eq!(status, StatusCode::OK, "{body}");
        let terminal = body["terminal"].as_u64().unwrap() as u32;
        // Its session ended on the laptop: the phones hear it too.
        assert_eq!(events.recv().await.unwrap(), Event::SessionsChanged);
        assert_eq!(
            events.recv().await.unwrap(),
            Event::SessionShared { terminal }
        );
        use std::os::unix::process::ExitStatusExt;
        assert_eq!(claude.wait().unwrap().signal(), Some(libc::SIGTERM));
        assert!(scratch.tmux.exists(terminal).await);

        let (_, center) = call(&router, "GET", "/api/center", "").await;
        assert_eq!(center["sessions"][0]["state"], "ended");
    }

    #[tokio::test]
    async fn claude_is_asked_to_quit_and_only_a_claude_is() {
        let bin = tempfile::tempdir().unwrap();
        let mut claude = fake_claude(bin.path());
        let pid = claude.id() as i32;

        // Not the process it is taken for: left alone.
        assert_eq!(system::quit(pid, QUIT_WAIT, |_| false).await, Quit::Refused);
        assert!(claude.try_wait().unwrap().is_none());

        assert_eq!(
            system::quit(pid, QUIT_WAIT, claude::is_claude).await,
            Quit::Exited
        );
        let status = claude.wait().unwrap();
        use std::os::unix::process::ExitStatusExt;
        assert_eq!(status.signal(), Some(libc::SIGTERM));
        // Gone already: nothing to do.
        assert_eq!(
            system::quit(pid, QUIT_WAIT, claude::is_claude).await,
            Quit::Exited
        );
    }
}
