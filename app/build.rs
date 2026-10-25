// Lists the app's own commands, so the window may call only the ones its
// capability grants (capabilities/main.json).
fn main() {
    let commands = tauri_build::AppManifest::new().commands(&[
        "pairings",
        "approve",
        "deny",
        "devices",
        "revoke",
        "activity",
        "changes",
        "change",
        "apply_change",
        "decline_change",
        "settings",
        "save_settings",
        "terminals",
        "sessions",
        "session",
        "history",
        "terminal_record",
        "delete_terminal_record",
        "session_record",
        "delete_session_record",
        "open_terminal",
        "terminal_input",
        "terminal_resize",
        "close_terminal",
        "open_in_terminal_app",
    ]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(commands))
        .expect("building the Tauri context");
}
