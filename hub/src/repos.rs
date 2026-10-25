//! Git runs read-only and politely: `GIT_OPTIONAL_LOCKS=0` so it never takes
//! the index lock out from under you, no fsmonitor, no pager, no prompts, and
//! a time limit.

use std::{
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::process::Command;

const TIME_LIMIT: Duration = Duration::from_secs(15);
const DIFF_MAX_BYTES: usize = 1_500_000;

async fn run(mut command: Command, what: &str) -> Result<String> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let output = tokio::time::timeout(TIME_LIMIT, command.output())
        .await
        .with_context(|| format!("{what} took longer than {} seconds", TIME_LIMIT.as_secs()))?
        .with_context(|| format!("running {what}"))?;
    if !output.status.success() {
        bail!("{what}: {}", String::from_utf8_lossy(&output.stderr).trim());
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

pub async fn git(dir: &Path, args: &[&str]) -> Result<String> {
    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(dir)
        .args([
            "-c",
            "core.fsmonitor=false",
            "-c",
            "color.ui=false",
            "-c",
            "core.quotepath=false",
        ])
        .args(args)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_PAGER", "cat")
        .env("LC_ALL", "C");
    run(command, "git").await
}

pub async fn gh(args: &[&str]) -> Result<String> {
    let mut command = Command::new("gh");
    command
        .args(args)
        .env("GH_PROMPT_DISABLED", "1")
        .env("GH_NO_UPDATE_NOTIFIER", "1")
        .env("NO_COLOR", "1");
    run(command, "gh").await
}

pub fn repo_key(common_dir: &Path) -> String {
    let digest = Sha256::digest(common_dir.as_os_str().as_encoded_bytes());
    hex::encode(&digest[..6])
}

/// The repo `dir` belongs to: its common git directory, shared by all of its
/// worktrees. `None` when `dir` isn't in a git repo.
pub async fn common_dir(dir: &Path) -> Option<PathBuf> {
    let out = git(
        dir,
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )
    .await
    .ok()?;
    let path = PathBuf::from(out.trim());
    path.is_absolute().then_some(path)
}

pub fn github_slug(url: &str) -> Option<String> {
    let url = url.trim().trim_end_matches('/');
    let rest = url
        .strip_prefix("git@github.com:")
        .or_else(|| url.strip_prefix("ssh://git@github.com/"))
        .or_else(|| url.strip_prefix("https://github.com/"))
        .or_else(|| url.strip_prefix("http://github.com/"))?;
    let rest = rest.strip_suffix(".git").unwrap_or(rest);
    let (owner, name) = rest.split_once('/')?;
    let valid = |part: &str| {
        !part.is_empty()
            && part
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
    };
    (valid(owner) && valid(name)).then(|| format!("{owner}/{name}"))
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Worktree {
    pub path: String,
    pub name: String,
    /// `None` when detached.
    pub branch: Option<String>,
    pub head: String,
    /// What `ahead` and `behind` count against: the upstream, or else the
    /// repo's base branch.
    pub compared_to: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    /// Files changed and not committed (untracked included).
    pub changes: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Repo {
    pub key: String,
    /// The main worktree's folder name.
    pub name: String,
    /// `owner/name` on GitHub, if the `origin` remote is there.
    pub github: Option<String>,
    pub base: Option<String>,
    /// The main worktree first.
    pub worktrees: Vec<Worktree>,
    #[serde(skip)]
    pub common_dir: PathBuf,
}

/// Bare and missing worktrees are left out.
fn parse_worktree_list(text: &str) -> Vec<(String, String, Option<String>)> {
    let mut found = Vec::new();
    for block in text.split("\n\n") {
        let mut path = None;
        let mut head = String::new();
        let mut branch = None;
        let mut skip = false;
        for line in block.lines() {
            if let Some(rest) = line.strip_prefix("worktree ") {
                path = Some(rest.to_owned());
            } else if let Some(rest) = line.strip_prefix("HEAD ") {
                head = rest.chars().take(7).collect();
            } else if let Some(rest) = line.strip_prefix("branch ") {
                branch = Some(rest.strip_prefix("refs/heads/").unwrap_or(rest).to_owned());
            } else if line == "bare" || line.starts_with("prunable") {
                skip = true;
            }
        }
        if let Some(path) = path
            && !skip
        {
            found.push((path, head, branch));
        }
    }
    found
}

#[derive(Debug, Default, PartialEq)]
struct Status {
    upstream: Option<String>,
    ahead: u32,
    behind: u32,
    changes: u32,
}

fn parse_status(text: &str) -> Status {
    let mut status = Status::default();
    for line in text.lines() {
        if let Some(upstream) = line.strip_prefix("# branch.upstream ") {
            status.upstream = Some(upstream.to_owned());
        } else if let Some(counts) = line.strip_prefix("# branch.ab ") {
            for count in counts.split_whitespace() {
                if let Some(ahead) = count.strip_prefix('+') {
                    status.ahead = ahead.parse().unwrap_or_default();
                } else if let Some(behind) = count.strip_prefix('-') {
                    status.behind = behind.parse().unwrap_or_default();
                }
            }
        } else if !line.starts_with('#') && !line.is_empty() {
            status.changes += 1;
        }
    }
    status
}

async fn base_branch(dir: &Path) -> Option<String> {
    if let Ok(out) = git(
        dir,
        &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
    )
    .await
    {
        let name = out.trim();
        return Some(name.strip_prefix("origin/").unwrap_or(name).to_owned());
    }
    for name in ["main", "master"] {
        let reference = format!("refs/heads/{name}");
        if git(dir, &["show-ref", "--verify", "--quiet", &reference])
            .await
            .is_ok()
        {
            return Some(name.to_owned());
        }
    }
    None
}

async fn load_worktree(
    path: String,
    head: String,
    branch: Option<String>,
    base: Option<&str>,
) -> Worktree {
    let dir = Path::new(&path);
    let status = git(
        dir,
        &[
            "status",
            "--porcelain=v2",
            "--branch",
            "--untracked-files=normal",
        ],
    )
    .await
    .map(|out| parse_status(&out))
    .unwrap_or_default();
    let mut worktree = Worktree {
        name: folder_of(&path),
        path: path.clone(),
        branch: branch.clone(),
        head,
        compared_to: status.upstream.clone(),
        ahead: status.ahead,
        behind: status.behind,
        changes: status.changes,
    };
    if status.upstream.is_none()
        && let Some(base) = base
        && branch.as_deref() != Some(base)
    {
        let range = format!("{base}...HEAD");
        if let Ok(out) = git(dir, &["rev-list", "--left-right", "--count", &range]).await {
            let mut counts = out
                .split_whitespace()
                .map(|n| n.parse::<u32>().unwrap_or_default());
            worktree.behind = counts.next().unwrap_or_default();
            worktree.ahead = counts.next().unwrap_or_default();
            worktree.compared_to = Some(base.to_owned());
        }
    }
    worktree
}

pub fn folder_of(path: &str) -> String {
    Path::new(path).file_name().map_or_else(
        || path.to_owned(),
        |name| name.to_string_lossy().into_owned(),
    )
}

pub async fn load(common_dir: &Path) -> Result<Repo> {
    let anchor = common_dir.parent().unwrap_or(common_dir);
    let list = git(common_dir, &["worktree", "list", "--porcelain"]).await?;
    let entries = parse_worktree_list(&list);
    let main = entries
        .first()
        .map(|(path, _, _)| PathBuf::from(path))
        .unwrap_or_else(|| anchor.to_path_buf());
    let base = base_branch(&main).await;
    let github = git(&main, &["remote", "get-url", "origin"])
        .await
        .ok()
        .and_then(|url| github_slug(&url));
    let worktrees = futures_util::future::join_all(
        entries
            .into_iter()
            .filter(|(path, _, _)| Path::new(path).is_dir())
            .map(|(path, head, branch)| load_worktree(path, head, branch, base.as_deref())),
    )
    .await;
    Ok(Repo {
        key: repo_key(common_dir),
        name: folder_of(&main.to_string_lossy()),
        github,
        base,
        worktrees,
        common_dir: common_dir.to_path_buf(),
    })
}

/// `added` and `removed` are `None` for binary files.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct FileChange {
    pub path: String,
    pub added: Option<u32>,
    pub removed: Option<u32>,
}

fn parse_numstat(text: &str) -> Vec<FileChange> {
    text.lines()
        .filter_map(|line| {
            let mut parts = line.splitn(3, '\t');
            let added = parts.next()?;
            let removed = parts.next()?;
            let path = parts.next()?;
            Some(FileChange {
                path: path.to_owned(),
                added: added.parse().ok(),
                removed: removed.parse().ok(),
            })
        })
        .collect()
}

async fn fork_point(worktree: &Path, base: Option<&str>) -> String {
    if let Some(base) = base
        && let Ok(out) = git(worktree, &["merge-base", "HEAD", base]).await
    {
        return out.trim().to_owned();
    }
    "HEAD".to_owned()
}

/// Committed or not, most changed first.
pub async fn branch_files(worktree: &Path, base: Option<&str>) -> Result<Vec<FileChange>> {
    let from = fork_point(worktree, base).await;
    let out = git(worktree, &["diff", "--numstat", "--find-renames", &from]).await?;
    let mut files = parse_numstat(&out);
    files
        .sort_by_key(|file| std::cmp::Reverse(file.added.unwrap_or(0) + file.removed.unwrap_or(0)));
    Ok(files)
}

/// The worktree's full diff since it left `base`, committed or not.
pub async fn branch_diff(worktree: &Path, base: Option<&str>) -> Result<Diff> {
    let from = fork_point(worktree, base).await;
    let out = git(
        worktree,
        &["diff", "--no-ext-diff", "--find-renames", "-U3", &from],
    )
    .await?;
    Ok(parse_diff(&out))
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct DiffLine {
    /// `add`, `del` or `ctx`.
    pub kind: &'static str,
    pub text: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Hunk {
    pub header: String,
    pub lines: Vec<DiffLine>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct DiffFile {
    pub path: String,
    pub old_path: Option<String>,
    /// `added`, `deleted`, `renamed` or `modified`.
    pub status: &'static str,
    pub binary: bool,
    pub added: u32,
    pub removed: u32,
    pub hunks: Vec<Hunk>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct Diff {
    pub files: Vec<DiffFile>,
    pub truncated: bool,
}

fn diff_path(text: &str) -> String {
    let text = text.trim();
    text.strip_prefix("a/")
        .or_else(|| text.strip_prefix("b/"))
        .unwrap_or(text)
        .to_owned()
}

pub fn parse_diff(text: &str) -> Diff {
    let mut diff = Diff::default();
    let (text, truncated) = if text.len() > DIFF_MAX_BYTES {
        let mut end = DIFF_MAX_BYTES;
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        (&text[..end], true)
    } else {
        (text, false)
    };
    diff.truncated = truncated;
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("diff --git ") {
            let path = rest
                .split_once(" b/")
                .map_or_else(|| diff_path(rest), |(_, b)| b.to_owned());
            diff.files.push(DiffFile {
                path,
                old_path: None,
                status: "modified",
                binary: false,
                added: 0,
                removed: 0,
                hunks: Vec::new(),
            });
            continue;
        }
        let Some(file) = diff.files.last_mut() else {
            continue;
        };
        if line.starts_with("@@") {
            file.hunks.push(Hunk {
                header: line.to_owned(),
                lines: Vec::new(),
            });
        } else if let Some(hunk) = file.hunks.last_mut() {
            let (kind, body) = match line.chars().next() {
                Some('+') => ("add", &line[1..]),
                Some('-') => ("del", &line[1..]),
                Some(' ') => ("ctx", &line[1..]),
                // "\ No newline at end of file" and the like.
                _ => continue,
            };
            match kind {
                "add" => file.added += 1,
                "del" => file.removed += 1,
                _ => {}
            }
            hunk.lines.push(DiffLine {
                kind,
                text: body.to_owned(),
            });
        } else if line.starts_with("new file mode") {
            file.status = "added";
        } else if line.starts_with("deleted file mode") {
            file.status = "deleted";
        } else if let Some(from) = line.strip_prefix("rename from ") {
            file.status = "renamed";
            file.old_path = Some(from.to_owned());
        } else if let Some(to) = line.strip_prefix("rename to ") {
            file.path = to.to_owned();
        } else if line.starts_with("Binary files") || line == "GIT binary patch" {
            file.binary = true;
        }
    }
    diff
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PullRequest {
    pub number: u32,
    pub title: String,
    /// `OPEN`, `MERGED` or `CLOSED`.
    pub state: String,
    #[serde(rename(deserialize = "headRefName"))]
    pub head: String,
    pub url: String,
    #[serde(rename(deserialize = "isDraft"), default)]
    pub draft: bool,
    /// Its checks in a word: `failed`, `running`, `passed` or `none`.
    #[serde(skip_deserializing)]
    pub checks: &'static str,
    /// `APPROVED`, `CHANGES_REQUESTED`, `REVIEW_REQUIRED`, or empty.
    #[serde(rename(deserialize = "reviewDecision"), default)]
    pub review: String,
    #[serde(rename(deserialize = "statusCheckRollup"), default, skip_serializing)]
    rollup: Vec<serde_json::Value>,
}

fn checks_in_a_word(checks: &[Check]) -> &'static str {
    let any = |outcome: &str| checks.iter().any(|check| check.outcome == outcome);
    if any("failed") {
        "failed"
    } else if any("running") {
        "running"
    } else if any("passed") {
        "passed"
    } else {
        "none"
    }
}

pub async fn pull_requests(slug: &str) -> Result<Vec<PullRequest>> {
    let out = gh(&[
        "pr",
        "list",
        "--repo",
        slug,
        "--state",
        "all",
        "--limit",
        "12",
        "--json",
        "number,title,state,headRefName,url,isDraft,reviewDecision,statusCheckRollup",
    ])
    .await?;
    let mut pulls: Vec<PullRequest> =
        serde_json::from_str(&out).context("reading gh's pull requests")?;
    for pull in &mut pulls {
        let checks: Vec<Check> = pull.rollup.iter().map(check_of).collect();
        pull.checks = checks_in_a_word(&checks);
        pull.rollup = Vec::new();
    }
    Ok(pulls)
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Check {
    pub name: String,
    /// `passed`, `failed`, `running`, `skipped` or `other`.
    pub outcome: &'static str,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct PullDetail {
    pub number: u32,
    pub title: String,
    pub state: String,
    pub draft: bool,
    pub head: String,
    pub base: String,
    pub additions: u32,
    pub deletions: u32,
    pub changed_files: u32,
    pub created_at: String,
    pub merged_at: Option<String>,
    pub closed_at: Option<String>,
    pub url: String,
    pub checks: Vec<Check>,
    pub files: Vec<FileChange>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GhPull {
    number: u32,
    title: String,
    state: String,
    #[serde(default)]
    is_draft: bool,
    head_ref_name: String,
    base_ref_name: String,
    #[serde(default)]
    additions: u32,
    #[serde(default)]
    deletions: u32,
    #[serde(default)]
    changed_files: u32,
    #[serde(default)]
    created_at: String,
    merged_at: Option<String>,
    closed_at: Option<String>,
    url: String,
    #[serde(default)]
    status_check_rollup: Vec<serde_json::Value>,
    #[serde(default)]
    files: Vec<GhFile>,
}

#[derive(Deserialize)]
struct GhFile {
    path: String,
    #[serde(default)]
    additions: u32,
    #[serde(default)]
    deletions: u32,
}

/// A check from gh's `statusCheckRollup`: a CheckRun or a commit status.
fn check_of(item: &serde_json::Value) -> Check {
    let text = |key: &str| item.get(key).and_then(|v| v.as_str()).unwrap_or_default();
    let name = [text("name"), text("context")]
        .into_iter()
        .find(|name| !name.is_empty())
        .unwrap_or("check")
        .to_owned();
    let outcome = match (text("status"), text("conclusion"), text("state")) {
        (_, "SUCCESS", _) | (_, _, "SUCCESS") => "passed",
        (_, "FAILURE" | "TIMED_OUT" | "STARTUP_FAILURE" | "ACTION_REQUIRED", _)
        | (_, _, "FAILURE" | "ERROR") => "failed",
        (_, "SKIPPED" | "NEUTRAL" | "CANCELLED", _) => "skipped",
        ("IN_PROGRESS" | "QUEUED" | "PENDING" | "WAITING" | "REQUESTED", _, _)
        | (_, _, "PENDING" | "EXPECTED") => "running",
        _ => "other",
    };
    Check { name, outcome }
}

pub async fn pull_request(slug: &str, number: u32) -> Result<PullDetail> {
    let number_text = number.to_string();
    let out = gh(&[
        "pr", "view", &number_text, "--repo", slug, "--json",
        "number,title,state,isDraft,headRefName,baseRefName,additions,deletions,changedFiles,createdAt,mergedAt,closedAt,url,statusCheckRollup,files",
    ])
    .await?;
    let pull: GhPull = serde_json::from_str(&out).context("reading gh's pull request")?;
    let mut files: Vec<FileChange> = pull
        .files
        .into_iter()
        .map(|file| FileChange {
            path: file.path,
            added: Some(file.additions),
            removed: Some(file.deletions),
        })
        .collect();
    files
        .sort_by_key(|file| std::cmp::Reverse(file.added.unwrap_or(0) + file.removed.unwrap_or(0)));
    Ok(PullDetail {
        number: pull.number,
        title: pull.title,
        state: pull.state,
        draft: pull.is_draft,
        head: pull.head_ref_name,
        base: pull.base_ref_name,
        additions: pull.additions,
        deletions: pull.deletions,
        changed_files: pull.changed_files,
        created_at: pull.created_at,
        merged_at: pull.merged_at,
        closed_at: pull.closed_at,
        url: pull.url,
        checks: pull.status_check_rollup.iter().map(check_of).collect(),
        files,
    })
}

pub async fn pull_diff(slug: &str, number: u32) -> Result<Diff> {
    let number_text = number.to_string();
    let out = gh(&["pr", "diff", &number_text, "--repo", slug]).await?;
    Ok(parse_diff(&out))
}

#[cfg(test)]
pub(crate) mod testing {
    use std::path::Path;

    pub fn git(dir: &Path, args: &[&str]) -> String {
        let output = std::process::Command::new("git")
            .arg("-C")
            .arg(dir)
            .args([
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.com",
                "-c",
                "init.defaultBranch=main",
            ])
            .args(args)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).into_owned()
    }

    /// A repo with a commit on `main`, a GitHub `origin`, and a second
    /// worktree on a `feature` branch two commits ahead with one uncommitted
    /// change. Returns (main, feature).
    pub fn repo_with_worktree(root: &Path) -> (std::path::PathBuf, std::path::PathBuf) {
        let main = root.join("app");
        std::fs::create_dir_all(&main).unwrap();
        git(&main, &["init", "-q"]);
        std::fs::write(main.join("README.md"), "hello\n").unwrap();
        git(&main, &["add", "."]);
        git(&main, &["commit", "-q", "-m", "First"]);
        git(
            &main,
            &["remote", "add", "origin", "git@github.com:someone/app.git"],
        );
        let feature = root.join("app-feature");
        git(
            &main,
            &[
                "worktree",
                "add",
                "-q",
                "-b",
                "feature",
                feature.to_str().unwrap(),
            ],
        );
        for (name, body) in [("one.txt", "1\n"), ("two.txt", "2\n2\n")] {
            std::fs::write(feature.join(name), body).unwrap();
            git(&feature, &["add", name]);
            git(&feature, &["commit", "-q", "-m", &format!("Add {name}")]);
        }
        std::fs::write(feature.join("README.md"), "hello\nworld\n").unwrap();
        (main, feature)
    }
}

#[cfg(test)]
mod tests {
    use super::{testing::repo_with_worktree, *};

    #[test]
    fn github_remotes_in_every_form() {
        for url in [
            "git@github.com:someone/bakery.git",
            "https://github.com/someone/bakery",
            "https://github.com/someone/bakery.git/",
            "ssh://git@github.com/someone/bakery.git",
        ] {
            assert_eq!(github_slug(url).as_deref(), Some("someone/bakery"), "{url}");
        }
        assert_eq!(github_slug("https://gitlab.com/a/b"), None);
        assert_eq!(github_slug("https://github.com/a/b;rm -rf"), None);
    }

    #[tokio::test]
    async fn a_repo_with_two_worktrees_is_read() {
        let dir = tempfile::tempdir().unwrap();
        let (main, feature) = repo_with_worktree(dir.path());
        let common = common_dir(&feature).await.expect("in a repo");
        assert_eq!(
            common_dir(&main).await,
            Some(common.clone()),
            "worktrees share a repo"
        );

        let repo = load(&common).await.unwrap();
        assert_eq!(repo.name, "app");
        assert_eq!(repo.github.as_deref(), Some("someone/app"));
        assert_eq!(repo.base.as_deref(), Some("main"));
        assert_eq!(repo.worktrees.len(), 2);
        let main_tree = &repo.worktrees[0];
        assert_eq!(main_tree.branch.as_deref(), Some("main"));
        assert_eq!((main_tree.ahead, main_tree.changes), (0, 0));
        let feature_tree = &repo.worktrees[1];
        assert_eq!(feature_tree.name, "app-feature");
        assert_eq!(feature_tree.branch.as_deref(), Some("feature"));
        assert_eq!(feature_tree.compared_to.as_deref(), Some("main"));
        assert_eq!(
            (
                feature_tree.ahead,
                feature_tree.behind,
                feature_tree.changes
            ),
            (2, 0, 1)
        );

        let files = branch_files(&feature, repo.base.as_deref()).await.unwrap();
        let paths: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(paths.len(), 3, "{paths:?}");
        assert_eq!(files[0].path, "two.txt", "most changed first");

        let diff = branch_diff(&feature, repo.base.as_deref()).await.unwrap();
        let readme = diff.files.iter().find(|f| f.path == "README.md").unwrap();
        assert_eq!((readme.added, readme.removed), (1, 0));
        let one = diff.files.iter().find(|f| f.path == "one.txt").unwrap();
        assert_eq!(one.status, "added");
    }

    #[test]
    fn git_status_is_read() {
        let status = parse_status(
            "# branch.oid abc\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +3 -1\n1 .M N... 100644 100644 100644 a b README.md\n? new.txt\n",
        );
        assert_eq!(
            status,
            Status {
                upstream: Some("origin/main".to_owned()),
                ahead: 3,
                behind: 1,
                changes: 2
            }
        );
    }

    #[test]
    fn diffs_are_split_by_file_and_capped() {
        let text = "diff --git a/x.rs b/y.rs\nsimilarity index 90%\nrename from x.rs\nrename to y.rs\n@@ -1,2 +1,2 @@\n a\n-b\n+c\n\\ No newline at end of file\ndiff --git a/img.png b/img.png\nBinary files a/img.png and b/img.png differ\n";
        let diff = parse_diff(text);
        assert_eq!(diff.files.len(), 2);
        let renamed = &diff.files[0];
        assert_eq!((renamed.status, renamed.path.as_str()), ("renamed", "y.rs"));
        assert_eq!(renamed.old_path.as_deref(), Some("x.rs"));
        assert_eq!((renamed.added, renamed.removed), (1, 1));
        assert_eq!(renamed.hunks[0].lines.len(), 3);
        assert!(diff.files[1].binary);
        assert!(!diff.truncated);

        let huge = format!(
            "diff --git a/a b/a\n@@ -0,0 +1 @@\n{}",
            "+x\n".repeat(DIFF_MAX_BYTES)
        );
        assert!(parse_diff(&huge).truncated);
    }

    #[test]
    fn checks_are_read_from_either_kind() {
        let run = serde_json::json!({"__typename": "CheckRun", "name": "test", "status": "COMPLETED", "conclusion": "FAILURE"});
        let status = serde_json::json!({"__typename": "StatusContext", "context": "ci/deploy", "state": "SUCCESS"});
        let running =
            serde_json::json!({"name": "lint", "status": "IN_PROGRESS", "conclusion": ""});
        assert_eq!(
            check_of(&run),
            Check {
                name: "test".to_owned(),
                outcome: "failed"
            }
        );
        assert_eq!(check_of(&status).outcome, "passed");
        assert_eq!(check_of(&running).outcome, "running");

        let outcomes = |list: &[serde_json::Value]| {
            checks_in_a_word(&list.iter().map(check_of).collect::<Vec<_>>())
        };
        assert_eq!(outcomes(&[status.clone(), run.clone()]), "failed");
        assert_eq!(outcomes(&[status.clone(), running]), "running");
        assert_eq!(outcomes(&[status]), "passed");
        assert_eq!(outcomes(&[]), "none");
    }

    #[test]
    fn a_listed_pull_request_keeps_its_review_and_drops_its_checks() {
        let listed: PullRequest = serde_json::from_value(serde_json::json!({
            "number": 7,
            "title": "Faster search",
            "state": "OPEN",
            "headRefName": "search",
            "url": "https://github.com/acme/shop/pull/7",
            "isDraft": false,
            "reviewDecision": "APPROVED",
            "statusCheckRollup": [{"name": "test", "status": "COMPLETED", "conclusion": "SUCCESS"}],
        }))
        .unwrap();
        assert_eq!(listed.review, "APPROVED");
        assert_eq!(listed.rollup.len(), 1);
        let shown = serde_json::to_value(&listed).unwrap();
        assert!(shown.get("rollup").is_none(), "{shown}");
        assert!(shown.get("statusCheckRollup").is_none(), "{shown}");
    }
}
