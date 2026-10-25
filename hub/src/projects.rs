//! Your projects: the folders directly inside each project root
//! (`project_roots` in the config, like `~/Freelance`, `~/Projects` and
//! `~/Learning`), whether they are git repos or not. The command center
//! groups by root, and a new terminal offers them by root too.

use std::{
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;

use crate::config::Config;

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Project {
    pub name: String,
    pub path: String,
    /// When the folder last changed, in seconds since the epoch.
    pub changed_at: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Root {
    pub name: String,
    pub path: String,
    pub projects: Vec<Project>,
}

fn seconds(time: SystemTime) -> i64 {
    time.duration_since(UNIX_EPOCH).map_or(0, |since| {
        i64::try_from(since.as_secs()).unwrap_or(i64::MAX)
    })
}

fn name_of(path: &Path) -> String {
    path.file_name().map_or_else(
        || path.to_string_lossy().into_owned(),
        |name| name.to_string_lossy().into_owned(),
    )
}

pub async fn projects_in(root: &Path) -> Vec<Project> {
    let mut found = Vec::new();
    let Ok(mut entries) = tokio::fs::read_dir(root).await else {
        return found;
    };
    while let Ok(Some(entry)) = entries.next_entry().await {
        if entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        // Follows symlinks: a linked project folder counts.
        let Ok(meta) = tokio::fs::metadata(entry.path()).await else {
            continue;
        };
        if meta.is_dir() {
            found.push(Project {
                name: entry.file_name().to_string_lossy().into_owned(),
                path: entry.path().to_string_lossy().into_owned(),
                changed_at: seconds(meta.modified().unwrap_or(UNIX_EPOCH)),
            });
        }
    }
    found.sort_by(|a, b| {
        b.changed_at
            .cmp(&a.changed_at)
            .then_with(|| a.name.cmp(&b.name))
    });
    found
}

pub async fn roots(config: &Config) -> Vec<Root> {
    let mut roots = Vec::new();
    for path in config.project_roots() {
        if !tokio::fs::metadata(&path)
            .await
            .is_ok_and(|meta| meta.is_dir())
        {
            continue;
        }
        roots.push(Root {
            name: name_of(&path),
            projects: projects_in(&path).await,
            path: path.to_string_lossy().into_owned(),
        });
    }
    roots
}

pub fn place_of<'a>(roots: &'a [Root], dir: &str) -> Option<(&'a Root, &'a Project)> {
    roots.iter().find_map(|root| {
        root.projects
            .iter()
            .find(|project| dir == project.path || dir.starts_with(&format!("{}/", project.path)))
            .map(|project| (root, project))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn projects_are_the_visible_folders_newest_first() {
        let root = tempfile::tempdir().unwrap();
        for name in ["older", "newer", ".hidden"] {
            std::fs::create_dir(root.path().join(name)).unwrap();
        }
        std::fs::write(root.path().join("notes.md"), "# not a project\n").unwrap();
        let old = SystemTime::now() - std::time::Duration::from_secs(3600);
        let file = std::fs::File::open(root.path().join("older")).unwrap();
        file.set_modified(old).unwrap();

        let found = projects_in(root.path()).await;
        let names: Vec<&str> = found.iter().map(|project| project.name.as_str()).collect();
        assert_eq!(names, ["newer", "older"]);
        assert!(
            projects_in(Path::new("/no/such/airlock-root"))
                .await
                .is_empty()
        );
    }

    #[test]
    fn a_folder_inside_a_project_belongs_to_it() {
        let project = |name: &str| Project {
            name: name.to_owned(),
            path: format!("/home/me/Projects/{name}"),
            changed_at: 0,
        };
        let roots = [Root {
            name: "Projects".to_owned(),
            path: "/home/me/Projects".to_owned(),
            projects: vec![project("app"), project("app-two")],
        }];
        let found = |dir: &str| place_of(&roots, dir).map(|(_, project)| project.name.clone());
        assert_eq!(found("/home/me/Projects/app/src").as_deref(), Some("app"));
        assert_eq!(
            found("/home/me/Projects/app-two").as_deref(),
            Some("app-two")
        );
        assert_eq!(found("/home/me/Projects"), None);
        assert_eq!(found("/tmp/elsewhere"), None);
    }
}
