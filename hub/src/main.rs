//! `airlock`: runs the hub, and lets you approve and revoke devices from a
//! laptop terminal, as the laptop app does.

use std::{
    fs,
    io::{IsTerminal, Write, stderr},
    os::unix::{fs::PermissionsExt, process::CommandExt},
    process::ExitCode,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use airlock_hub::{
    admin,
    claude::{self, HookReport},
    client::Admin,
    config::{Config, Paths},
    events::Event,
    hooks, phone, preview,
    state::AppState,
    store::{self, Device, Pairing, Store},
    tab,
    terminals::{self, Tmux},
};
use anyhow::{Context, Result, bail};
use clap::{Parser, Subcommand};
use tokio::{
    io::AsyncReadExt,
    signal::unix::{SignalKind, signal},
};
use tracing_subscriber::EnvFilter;

#[derive(Parser)]
#[command(
    name = "airlock",
    version,
    about = "Reach this laptop from your phone, over Tailscale only."
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Run the hub: the server the phone reaches, and the admin socket.
    Serve,
    /// List the pairing requests waiting for you.
    Pairings,
    /// Let a device in, by the code it shows (or the request id).
    Approve { request: String },
    /// Turn a pairing request away.
    Deny { request: String },
    /// List the paired devices.
    Devices,
    /// Cut a device off at once, by its name or id.
    Revoke { device: String },
    /// Show the latest audit log entries.
    Log,
    /// Print the hub's events as they happen, until it stops.
    Watch,
    /// For Claude Code's hooks: pass the event on stdin to the hub, for the
    /// command center. Prints nothing and always succeeds, so it never gets
    /// in Claude's way.
    Hook,
    /// For Claude Code's status line: pass the session's context and the
    /// plan's usage to the hub, and print a short line for the terminal.
    #[command(hide = true)]
    Statusline,
    /// The command center's Claude Code hooks, in ~/.claude/settings.json.
    Hooks {
        #[command(subcommand)]
        action: HooksAction,
    },
    /// Print where the hub listens, as `name=value` lines, for scripts.
    Config,
    /// For a terminal tab: run your shell in it, shared with the phone.
    /// `~/.bashrc` starts it once `airlock tabs install` has added it.
    #[command(hide = true)]
    Tab,
    /// For `airlock tab`: holds the tab's keyboard while a program runs in
    /// its shell, so the terminal app asks before closing the tab.
    #[command(hide = true)]
    TabKeyboard,
    /// Whether new GNOME Terminal tabs show on the phone, in ~/.bashrc.
    Tabs {
        #[command(subcommand)]
        action: TabsAction,
    },
    /// Join one of Airlock's terminals from this terminal. Name it by its
    /// number in the list or its name; without one, pick from the list.
    Attach {
        terminal: Option<String>,
        /// The terminal by its id, as the laptop app names it.
        #[arg(long, conflicts_with = "terminal")]
        id: Option<u32>,
    },
}

#[derive(Subcommand)]
enum TabsAction {
    /// Say whether they do.
    Show,
    /// Start sharing new tabs (a backup of ~/.bashrc is kept).
    Install,
    /// Stop sharing new tabs; the ones open now stay shared until closed.
    Remove,
}

fn bashrc() -> Result<std::path::PathBuf> {
    Ok(
        std::path::PathBuf::from(std::env::var_os("HOME").context("HOME is not set")?)
            .join(".bashrc"),
    )
}

fn replace_file(path: &std::path::Path, text: &str) -> Result<()> {
    let backup = path.with_file_name(format!(
        "{}.airlock-backup",
        path.file_name()
            .map_or_else(Default::default, |name| name.to_string_lossy())
    ));
    let mode = fs::metadata(path)
        .map(|meta| meta.permissions().mode())
        .ok();
    if mode.is_some() && !backup.exists() {
        fs::copy(path, &backup).with_context(|| format!("backing up {}", path.display()))?;
    }
    let temporary = path.with_extension("airlock-new");
    fs::write(&temporary, text).with_context(|| format!("writing {}", temporary.display()))?;
    if let Some(mode) = mode {
        fs::set_permissions(&temporary, fs::Permissions::from_mode(mode))?;
    }
    fs::rename(&temporary, path).with_context(|| format!("replacing {}", path.display()))
}

fn manage_tabs(action: TabsAction) -> Result<()> {
    let path = bashrc()?;
    let before = match fs::read_to_string(&path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => return Err(error).with_context(|| format!("reading {}", path.display())),
    };
    match action {
        TabsAction::Show => {
            if tab::has_block(&before) {
                println!(
                    "New GNOME Terminal tabs show on the phone ({}).",
                    path.display()
                );
            } else {
                println!(
                    "New GNOME Terminal tabs don't show on the phone. `airlock tabs install` turns it on."
                );
            }
        }
        TabsAction::Install => {
            let binary = std::env::current_exe().context("finding this airlock binary")?;
            let after = tab::with_block(&before, &binary);
            if after == before {
                println!("New GNOME Terminal tabs already show on the phone.");
            } else {
                replace_file(&path, &after)?;
                println!("Added to the top of {}.", path.display());
                println!("Tabs you open from now on show on the phone; the ones open now don't.");
            }
        }
        TabsAction::Remove => {
            let after = tab::without_block(&before);
            if after == before {
                println!("Airlock wasn't in {}.", path.display());
            } else {
                replace_file(&path, &after)?;
                println!(
                    "Took Airlock out of {}. New tabs are the laptop's alone.",
                    path.display()
                );
            }
        }
    }
    Ok(())
}

#[derive(Subcommand)]
enum HooksAction {
    /// Say whether they're installed.
    Show,
    /// Add them, keeping everything else in the settings (a backup is kept).
    Install,
    /// Take them out again.
    Remove,
}

fn claude_settings() -> Result<std::path::PathBuf> {
    let dir = match std::env::var_os("CLAUDE_CONFIG_DIR") {
        Some(dir) => std::path::PathBuf::from(dir),
        None => std::path::PathBuf::from(std::env::var_os("HOME").context("HOME is not set")?)
            .join(".claude"),
    };
    Ok(dir.join("settings.json"))
}

fn manage_hooks(action: HooksAction) -> Result<()> {
    let path = claude_settings()?;
    let before = hooks::read(&path)?;
    match action {
        HooksAction::Show => {
            if hooks::installed(&before) {
                println!("Installed in {}.", path.display());
            } else {
                println!(
                    "Not installed. `airlock hooks install` adds them to {}.",
                    path.display()
                );
            }
            return Ok(());
        }
        HooksAction::Install => {
            let binary = std::env::current_exe().context("finding this airlock binary")?;
            let after = hooks::install(&before, &hooks::command_for(&binary))?;
            let existed = path.exists();
            if hooks::write(&path, &before, &after)? {
                println!("Added the hooks to {}.", path.display());
                if existed {
                    println!(
                        "The file as it was is in {}.airlock-backup.",
                        path.display()
                    );
                }
                println!("Claude Code sessions started from now on report to Airlock.");
            } else {
                println!("The hooks were already installed in {}.", path.display());
            }
        }
        HooksAction::Remove => {
            let after = hooks::remove(&before)?;
            if hooks::write(&path, &before, &after)? {
                println!("Took the hooks out of {}.", path.display());
            } else {
                println!("No Airlock hooks were in {}.", path.display());
            }
        }
    }
    Ok(())
}

#[tokio::main]
async fn main() -> ExitCode {
    let cli = Cli::parse();
    if matches!(cli.command, Command::Hook) {
        hook().await;
        return ExitCode::SUCCESS;
    }
    if matches!(cli.command, Command::Statusline) {
        statusline().await;
        return ExitCode::SUCCESS;
    }
    if matches!(cli.command, Command::Tab) {
        let admin = Paths::from_env()
            .map(|paths| paths.admin_socket())
            .unwrap_or_default();
        // Straight out: a read of the terminal may still be waiting.
        std::process::exit(tab::run(admin).await);
    }
    if matches!(cli.command, Command::TabKeyboard) {
        std::process::exit(tab::keyboard().await);
    }
    match run(cli).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("airlock: {error:#}");
            ExitCode::FAILURE
        }
    }
}

async fn run(cli: Cli) -> Result<()> {
    let paths = Paths::from_env()?;
    let admin = Admin::new(paths.admin_socket());
    match cli.command {
        Command::Serve => serve(paths).await,
        Command::Pairings => {
            print_pairings(&admin.pairings().await?);
            Ok(())
        }
        Command::Approve { request } => {
            let pairing = admin.approve(&request).await?;
            println!(
                "Approved {} ({}). It gets in the next time it checks, within seconds.",
                pairing.name, pairing.login
            );
            Ok(())
        }
        Command::Deny { request } => {
            let pairing = admin.deny(&request).await?;
            println!("Denied {} ({}).", pairing.name, pairing.login);
            Ok(())
        }
        Command::Devices => {
            print_devices(&admin.devices().await?);
            Ok(())
        }
        Command::Revoke { device } => {
            let device = admin.revoke(&device).await?;
            println!("Revoked {}. Its open connections are closed.", device.name);
            Ok(())
        }
        Command::Log => {
            for entry in admin.audit().await?.iter().rev() {
                println!(
                    "{:>9}  {:<6}  {}: {}",
                    ago(entry.at),
                    entry.actor,
                    entry.action,
                    entry.detail
                );
            }
            Ok(())
        }
        Command::Watch => {
            let mut events = admin.events().await?;
            while let Some(event) = events.next().await {
                println!("{}", serde_json::to_string(&event?)?);
            }
            println!("The hub stopped.");
            Ok(())
        }
        Command::Hook | Command::Statusline | Command::Tab | Command::TabKeyboard => Ok(()),
        Command::Hooks { action } => manage_hooks(action),
        Command::Tabs { action } => manage_tabs(action),
        Command::Config => {
            let config = Config::load(&paths)?;
            println!("listen={}", config.listen);
            if let Some(preview) = config.preview_listen {
                println!("preview_listen={preview}");
                println!("preview_port={}", config.preview_port);
            }
            Ok(())
        }
        Command::Attach { terminal, id } => attach(&paths, terminal.as_deref(), id).await,
    }
}

/// Returns only if it couldn't.
async fn attach(paths: &Paths, which: Option<&str>, id: Option<u32>) -> Result<()> {
    let config = Config::load(paths)?;
    let tmux = Tmux::new(config.tmux_socket, paths.runtime.join("tmux.conf"));
    let terminals = tmux.list(false).await.unwrap_or_default();
    let chosen = match (which, terminals.as_slice()) {
        (_, []) => bail!("No terminals are open. Open one from the phone or the laptop app."),
        _ if id.is_some() => terminals
            .iter()
            .find(|terminal| Some(terminal.id) == id)
            .context("That terminal has closed.")?,
        (Some(which), _) => terminals::find(&terminals, which).with_context(|| {
            format!("No terminal is called {which:?}. `airlock attach` lists them.")
        })?,
        (None, [only]) => only,
        (None, _) => {
            for (number, terminal) in terminals.iter().enumerate() {
                println!("{:>3}  {}", number + 1, describe(terminal));
            }
            print!("Which one? ");
            std::io::stdout().flush()?;
            let mut answer = String::new();
            std::io::stdin().read_line(&mut answer)?;
            if answer.trim().is_empty() {
                return Ok(());
            }
            terminals::find(&terminals, &answer)
                .with_context(|| format!("No terminal is called {:?}.", answer.trim()))?
        }
    };
    let error = tmux.attach_here(chosen.id).exec();
    Err(error).context("running tmux")
}

fn describe(terminal: &terminals::Terminal) -> String {
    let active = terminal.tabs.iter().find(|tab| tab.active);
    let place = active.map_or(String::new(), |tab| match tab.command.as_str() {
        "" | "bash" | "zsh" | "fish" | "sh" => format!("  {}", tab.folder),
        command => format!("  {} · {command}", tab.folder),
    });
    let tabs = match terminal.tabs.len() {
        0 | 1 => String::new(),
        count => format!(", {count} tabs"),
    };
    format!(
        "{}{place}{tabs}  (used {})",
        terminal.name,
        ago(terminal.activity_at)
    )
}

/// Every failure is silent: no hub, no event, nothing to do.
async fn hook() {
    // A question asked from the phone isn't a session to show in Work.
    if std::env::var_os("AIRLOCK_ASK").is_some() {
        return;
    }
    let Ok(paths) = Paths::from_env() else {
        return;
    };
    let mut input = Vec::new();
    let read = tokio::time::timeout(
        Duration::from_secs(5),
        tokio::io::stdin().read_to_end(&mut input),
    )
    .await;
    if !matches!(read, Ok(Ok(_))) {
        return;
    }
    let Ok(event) = serde_json::from_slice::<serde_json::Value>(&input) else {
        return;
    };
    let at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| since.as_millis() as i64);
    let report = HookReport {
        event: claude::trim_event(&event),
        tmux: std::env::var("TMUX").ok(),
        pane: std::env::var("TMUX_PANE").ok(),
        at_ms,
        claude_pid: claude::claude_above(),
    };
    let admin = Admin::new(paths.admin_socket());
    let _ = tokio::time::timeout(Duration::from_secs(3), admin.report_hook(&report)).await;
}

/// Never fails: with no hub, the line still prints.
async fn statusline() {
    let mut input = Vec::new();
    let read = tokio::time::timeout(
        Duration::from_secs(2),
        tokio::io::stdin().read_to_end(&mut input),
    )
    .await;
    let status = match read {
        Ok(Ok(_)) => serde_json::from_slice::<serde_json::Value>(&input).unwrap_or_default(),
        _ => serde_json::Value::Null,
    };
    let report = claude::StatusReport::from_status_line(&status);
    let model = status["model"]["display_name"].as_str().unwrap_or("Claude");
    match report.context {
        Some(context) => println!("{model} · context {:.0}%", context.used),
        None => println!("{model}"),
    }
    if report.session_id.is_empty() || std::env::var_os("AIRLOCK_ASK").is_some() {
        return;
    }
    let Ok(paths) = Paths::from_env() else {
        return;
    };
    let admin = Admin::new(paths.admin_socket());
    let _ = tokio::time::timeout(Duration::from_secs(1), admin.report_status(&report)).await;
}

async fn serve(paths: Paths) -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .with_ansi(stderr().is_terminal())
        .with_writer(stderr)
        .init();
    let config = Config::load(&paths)?;
    fs::create_dir_all(&paths.state)
        .with_context(|| format!("creating {}", paths.state.display()))?;
    fs::set_permissions(&paths.state, fs::Permissions::from_mode(0o700))?;
    let store = Store::open(&paths.database())?;
    let listen = config.listen;

    let admin_listener = admin::bind(&paths.admin_socket()).await?;
    let tmux_conf = paths.runtime.join("tmux.conf");
    fs::write(&tmux_conf, terminals::TMUX_CONF)
        .with_context(|| format!("writing {}", tmux_conf.display()))?;
    let tmux = Tmux::new(config.tmux_socket.clone(), tmux_conf);
    tmux.reload().await?;
    let mut state = AppState::new(store, config, tmux);
    // Its push key, kept with its other secrets. Without it the hub still
    // runs; only notifications are off.
    match airlock_hub::push::Push::load_or_create(&paths.config) {
        Ok(push) => state.push = std::sync::Arc::new(push),
        Err(error) => tracing::warn!("push notifications are off: {error:#}"),
    }
    airlock_hub::history::restore(&state);
    tokio::spawn(airlock_hub::history::keep(state.clone()));
    let at_the_end = state.clone();

    let phone_listener = tokio::net::TcpListener::bind(listen)
        .await
        .with_context(|| format!("listening on {listen}"))?;
    tracing::info!(%listen, admin = %paths.admin_socket().display(), "airlock hub is up");

    let preview_listener = match state.config.preview_listen {
        Some(address) => Some(
            tokio::net::TcpListener::bind(address)
                .await
                .with_context(|| format!("listening for previews on {address}"))?,
        ),
        None => None,
    };

    let admin_server = axum::serve(admin_listener, admin::router(state.clone()))
        .with_graceful_shutdown(stopped(state.clone()));
    let phone_server = axum::serve(phone_listener, phone::router(state.clone()))
        .with_graceful_shutdown(stopped(state.clone()));
    let preview_server = async {
        match preview_listener {
            Some(listener) => axum::serve(listener, preview::router(state.clone()))
                .with_graceful_shutdown(stopped(state))
                .await
                .context("preview server"),
            None => Ok(()),
        }
    };
    let served = tokio::try_join!(
        async { admin_server.await.context("admin socket") },
        async { phone_server.await.context("phone server") },
        preview_server,
    );
    // Saved once more as it stops, so a restart picks up where it was.
    airlock_hub::history::save(&at_the_end).await;
    let _ = fs::remove_file(paths.admin_socket());
    served.map(|_| ())
}

async fn stopped(state: AppState) {
    let mut terminate = signal(SignalKind::terminate()).expect("installing the SIGTERM handler");
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {}
        _ = terminate.recv() => {}
    }
    state.events.send(Event::HubStopping);
}

fn ago(at: i64) -> String {
    match (store::now() - at).max(0) {
        secs if secs < 60 => format!("{secs}s ago"),
        secs if secs < 3600 => format!("{}m ago", secs / 60),
        secs if secs < 86_400 => format!("{}h ago", secs / 3600),
        secs => format!("{}d ago", secs / 86_400),
    }
}

fn print_pairings(pending: &[Pairing]) {
    if pending.is_empty() {
        println!("No pairing requests are waiting.");
        return;
    }
    for pairing in pending {
        let (first, second) = pairing.code.split_at(pairing.code.len().min(3));
        println!(
            "{first} {second}  {}  {}  asked {}  (id {})",
            pairing.name,
            pairing.login,
            ago(pairing.created_at),
            pairing.id
        );
    }
    println!("Approve one with `airlock approve <code>`.");
}

fn print_devices(devices: &[Device]) {
    if devices.is_empty() {
        println!("No devices are paired.");
        return;
    }
    for device in devices {
        println!(
            "{}  {}  paired {}  seen {}{}  (id {})",
            device.name,
            device.login,
            ago(device.created_at),
            ago(device.last_seen),
            if device.face_id { "  Face ID" } else { "" },
            device.id
        );
    }
}
