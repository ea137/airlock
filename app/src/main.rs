//! Airlock's laptop app. It talks to the hub only through the admin socket ([`Admin`]). The window
//! may call only the commands below (see `capabilities/main.json`). Closing
//! the window keeps the app in the tray, so alerts still arrive; `--hidden`
//! starts it there, for starting at login.

mod screens;

use std::time::Duration;

use airlock_hub::{
    client::{Admin, AdminError},
    config::Paths,
    events::Event,
    store::{AuditEntry, Device, Pairing, Settings},
    terminals::Tmux,
};
use notify_rust::{Notification, Urgency};
use serde::Serialize;
use serde_json::Value;
use tauri::{
    AppHandle, Emitter, Manager, State, WindowEvent,
    ipc::{Channel, InvokeResponseBody},
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
};

use crate::screens::Screens;

/// Waits before following the hub's events again after losing them.
const RETRY_FIRST: Duration = Duration::from_secs(1);
const RETRY_MOST: Duration = Duration::from_secs(10);

/// A failed call, as the window sees it: `kind` is `hub_down`, `refused` or
/// `broken`, and `message` says why.
#[derive(Debug, PartialEq, Serialize)]
struct Failure {
    kind: &'static str,
    message: String,
}

impl From<AdminError> for Failure {
    fn from(error: AdminError) -> Self {
        let kind = match error {
            AdminError::HubDown(_) => "hub_down",
            AdminError::Refused { .. } => "refused",
            AdminError::Broken(_) => "broken",
        };
        Self {
            kind,
            message: error.to_string(),
        }
    }
}

type Answer<T> = Result<T, Failure>;

#[tauri::command]
async fn pairings(admin: State<'_, Admin>) -> Answer<Vec<Pairing>> {
    Ok(admin.pairings().await?)
}

#[tauri::command]
async fn approve(admin: State<'_, Admin>, id: String) -> Answer<Pairing> {
    Ok(admin.approve(&id).await?)
}

#[tauri::command]
async fn deny(admin: State<'_, Admin>, id: String) -> Answer<Pairing> {
    Ok(admin.deny(&id).await?)
}

#[tauri::command]
async fn devices(admin: State<'_, Admin>) -> Answer<Vec<Device>> {
    Ok(admin.devices().await?)
}

#[tauri::command]
async fn revoke(admin: State<'_, Admin>, id: String) -> Answer<Device> {
    Ok(admin.revoke(&id).await?)
}

#[tauri::command]
async fn activity(admin: State<'_, Admin>) -> Answer<Vec<AuditEntry>> {
    Ok(admin.audit().await?)
}

#[tauri::command]
async fn changes(admin: State<'_, Admin>) -> Answer<Value> {
    Ok(admin.changes().await?)
}

#[tauri::command]
async fn change(admin: State<'_, Admin>, id: String) -> Answer<Value> {
    Ok(admin.change(&id).await?)
}

/// Writes the phone's edit: `with` is `phone` or `merge`.
#[tauri::command]
async fn apply_change(
    admin: State<'_, Admin>,
    id: String,
    with: String,
    overwrite: bool,
) -> Answer<Value> {
    Ok(admin.apply_change(&id, &with, overwrite).await?)
}

#[tauri::command]
async fn decline_change(admin: State<'_, Admin>, id: String) -> Answer<()> {
    Ok(admin.decline_change(&id).await?)
}

#[tauri::command]
async fn settings(admin: State<'_, Admin>) -> Answer<Settings> {
    Ok(admin.settings().await?)
}

#[tauri::command]
async fn save_settings(admin: State<'_, Admin>, settings: Settings) -> Answer<Settings> {
    Ok(admin.save_settings(&settings).await?)
}

#[tauri::command]
async fn terminals(admin: State<'_, Admin>) -> Answer<Value> {
    Ok(admin.terminals().await?)
}

#[tauri::command]
async fn sessions(admin: State<'_, Admin>) -> Answer<Value> {
    Ok(admin.sessions().await?)
}

#[tauri::command]
async fn session(admin: State<'_, Admin>, id: String) -> Answer<Value> {
    Ok(admin.session(&id).await?)
}

#[tauri::command]
async fn history(admin: State<'_, Admin>) -> Answer<Value> {
    Ok(admin.history().await?)
}

#[tauri::command]
async fn terminal_record(admin: State<'_, Admin>, key: String) -> Answer<Value> {
    Ok(admin.terminal_record(&key).await?)
}

#[tauri::command]
async fn delete_terminal_record(admin: State<'_, Admin>, key: String) -> Answer<()> {
    Ok(admin.delete_terminal_record(&key).await?)
}

#[tauri::command]
async fn session_record(admin: State<'_, Admin>, id: String) -> Answer<Value> {
    Ok(admin.session_record(&id).await?)
}

#[tauri::command]
async fn delete_session_record(admin: State<'_, Admin>, id: String) -> Answer<()> {
    Ok(admin.delete_session_record(&id).await?)
}

fn screen_failure(message: String) -> Failure {
    Failure {
        kind: "refused",
        message,
    }
}

/// Opens one of Airlock's terminals in the window: what it prints arrives on
/// `output` (an empty message when it ends). Returns the screen's number for
/// the calls below. The tmux server is the one the hub names.
#[tauri::command]
async fn open_terminal(
    admin: State<'_, Admin>,
    screens: State<'_, Screens>,
    paths: State<'_, Paths>,
    terminal: u32,
    cols: u16,
    rows: u16,
    output: Channel<InvokeResponseBody>,
) -> Answer<u64> {
    let live = admin.terminals().await?;
    let socket = live
        .get("socket")
        .and_then(Value::as_str)
        .ok_or_else(|| screen_failure("The hub didn't say where its terminals are.".to_owned()))?;
    let open = live
        .get("terminals")
        .and_then(Value::as_array)
        .is_some_and(|all| {
            all.iter()
                .any(|known| known.get("id").and_then(Value::as_u64) == Some(u64::from(terminal)))
        });
    if !open {
        return Err(screen_failure("That terminal has closed.".to_owned()));
    }
    let tmux = Tmux::new(socket, paths.runtime.join("tmux.conf"));
    screens
        .open(&tmux, terminal, cols, rows, output)
        .map_err(screen_failure)
}

#[tauri::command]
fn terminal_input(screens: State<'_, Screens>, screen: u64, data: String) -> Answer<()> {
    screens
        .keys(screen, data.into_bytes())
        .map_err(screen_failure)
}

#[tauri::command]
fn terminal_resize(screens: State<'_, Screens>, screen: u64, cols: u16, rows: u16) -> Answer<()> {
    screens.resize(screen, cols, rows).map_err(screen_failure)
}

#[tauri::command]
fn close_terminal(screens: State<'_, Screens>, screen: u64) {
    screens.close(screen);
}

/// The terminal apps tried for Open in Terminal, in order, with the
/// argument that comes before the command each runs.
const TERMINAL_APPS: [(&str, &str); 3] = [
    ("gnome-terminal", "--"),
    ("ptyxis", "--"),
    ("x-terminal-emulator", "-e"),
];

#[tauri::command]
fn open_in_terminal_app(terminal: u32) -> Answer<()> {
    // The airlock beside this app (both are installed together), else the
    // one on the PATH.
    let airlock = std::env::current_exe()
        .ok()
        .and_then(|app| Some(app.parent()?.join("airlock")))
        .filter(|path| path.is_file())
        .map_or_else(|| "airlock".into(), std::path::PathBuf::into_os_string);
    for (app, before) in TERMINAL_APPS {
        let started = std::process::Command::new(app)
            .arg(before)
            .arg(&airlock)
            .args(["attach", "--id", &terminal.to_string()])
            .stdin(std::process::Stdio::null())
            .spawn();
        match started {
            Ok(mut child) => {
                // Reaped once the app's launcher returns.
                std::thread::spawn(move || child.wait());
                return Ok(());
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(screen_failure(format!("Couldn't start {app}: {error}"))),
        }
    }
    Err(screen_failure(
        "No terminal app was found: GNOME Terminal, Ptyxis or x-terminal-emulator.".to_owned(),
    ))
}

#[derive(Debug, PartialEq)]
struct Alert {
    summary: String,
    body: String,
    urgent: bool,
}

fn alert_for(event: &Event) -> Option<Alert> {
    match event {
        Event::PairingRequested { name, code, .. } => {
            let (first, second) = code.split_at(code.len().min(3));
            Some(Alert {
                summary: format!("{name} wants to pair"),
                body: format!(
                    "Code {first} {second}. Let it in from Airlock only if the device shows this code."
                ),
                urgent: false,
            })
        }
        Event::TokenReused { name, .. } => Some(Alert {
            summary: format!("Airlock cut off {name}"),
            body: "Someone used a copy of its token. Pair it again once you have it back."
                .to_owned(),
            urgent: true,
        }),
        Event::ChangeProposed { path, device, .. } => Some(Alert {
            summary: format!("{device} wants to change a file"),
            body: format!("{path}. It's written only once you approve it in Airlock."),
            urgent: false,
        }),
        _ => None,
    }
}

fn notify(app: &AppHandle, alert: Alert) {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let shown = Notification::new()
            .appname("Airlock")
            .summary(&alert.summary)
            .body(&alert.body)
            .icon(if alert.urgent {
                "dialog-warning"
            } else {
                "phone"
            })
            .urgency(if alert.urgent {
                Urgency::Critical
            } else {
                Urgency::Normal
            })
            .action("default", "Open Airlock")
            .show();
        match shown {
            Ok(handle) => handle.wait_for_action(|action| {
                if action == "default" {
                    show(&app);
                }
            }),
            Err(error) => eprintln!("airlock-app: couldn't show a notification: {error}"),
        }
    });
}

/// Every event is passed to the window as `hub-event`. The window hears
/// `hub-link` with `up` or `down` as the hub comes and goes.
async fn follow(app: AppHandle, admin: Admin) {
    let mut wait = RETRY_FIRST;
    loop {
        if let Ok(mut events) = admin.events().await {
            wait = RETRY_FIRST;
            let _ = app.emit("hub-link", "up");
            while let Some(Ok(event)) = events.next().await {
                if let Some(alert) = alert_for(&event) {
                    notify(&app, alert);
                }
                // Shared from the phone: open it here too, so it is in both
                // places, as it was before.
                if let Event::SessionShared { terminal } = &event
                    && let Err(failure) = open_in_terminal_app(*terminal)
                {
                    eprintln!(
                        "airlock-app: couldn't open the shared session: {}",
                        failure.message
                    );
                }
                let _ = app.emit("hub-event", &event);
            }
            let _ = app.emit("hub-link", "down");
        }
        tokio::time::sleep(wait).await;
        wait = (wait * 2).min(RETRY_MOST);
    }
}

fn show(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Airlock", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Airlock", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let mut builder = TrayIconBuilder::with_id("airlock")
        .tooltip("Airlock")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show(app),
            "quit" => app.exit(0),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

fn main() {
    let paths = match Paths::from_env() {
        Ok(paths) => paths,
        Err(error) => {
            eprintln!("airlock-app: {error:#}");
            std::process::exit(1);
        }
    };
    let admin = Admin::new(paths.admin_socket());
    let hidden = std::env::args().any(|arg| arg == "--hidden");

    tauri::Builder::default()
        // Opening the app again shows the one already running.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show(app)
        }))
        .manage(admin.clone())
        .manage(paths)
        .manage(Screens::default())
        .invoke_handler(tauri::generate_handler![
            pairings,
            approve,
            deny,
            devices,
            revoke,
            activity,
            changes,
            change,
            apply_change,
            decline_change,
            settings,
            save_settings,
            terminals,
            sessions,
            session,
            history,
            terminal_record,
            delete_terminal_record,
            session_record,
            delete_session_record,
            open_terminal,
            terminal_input,
            terminal_resize,
            close_terminal,
            open_in_terminal_app
        ])
        .setup(move |app| {
            tray(app.handle())?;
            tauri::async_runtime::spawn(follow(app.handle().clone(), admin));
            if !hidden {
                show(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing hides the window; the tray's Quit ends the app.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("running the Airlock app");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pairing_requests_and_copied_tokens_alert_you() {
        let asked = Event::PairingRequested {
            id: "a1".to_owned(),
            code: "421946".to_owned(),
            name: "iPhone".to_owned(),
        };
        assert_eq!(
            alert_for(&asked),
            Some(Alert {
                summary: "iPhone wants to pair".to_owned(),
                body: "Code 421 946. Let it in from Airlock only if the device shows this code."
                    .to_owned(),
                urgent: false,
            })
        );
        let copied = Event::TokenReused {
            id: "d1".to_owned(),
            name: "iPhone".to_owned(),
        };
        let alert = alert_for(&copied).expect("a copied token alerts you");
        assert_eq!(alert.summary, "Airlock cut off iPhone");
        assert!(alert.urgent);
    }

    #[test]
    fn routine_events_stay_quiet() {
        for event in [
            Event::PairingDecided {
                id: "a1".to_owned(),
                approved: true,
            },
            Event::DeviceRevoked {
                id: "d1".to_owned(),
            },
            Event::HubStopping,
        ] {
            assert_eq!(alert_for(&event), None, "{event:?}");
        }
    }

    #[test]
    fn failures_tell_the_window_what_kind() {
        let down = Failure::from(AdminError::HubDown(std::io::ErrorKind::NotFound.into()));
        assert_eq!(down.kind, "hub_down");
        let refused = Failure::from(AdminError::Refused {
            status: tauri::http::StatusCode::NOT_FOUND,
            message: "No paired device has that name or id.".to_owned(),
        });
        assert_eq!(
            refused,
            Failure {
                kind: "refused",
                message: "No paired device has that name or id.".to_owned()
            }
        );
    }
}
