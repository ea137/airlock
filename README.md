# Airlock

Reach this laptop from your phone, over Tailscale only: what needs you, terminals with tabs, your projects and Claude Code sessions, files, and what's running. A laptop app lets devices in, reviews the phone's edits, shows the phone's terminals and sessions with two weeks of history, and alerts you. See [the design](docs/design.md) for how it fits together and the security model.

- `hub/`: the hub, a Rust service (`airlock`). It serves the phone through Tailscale Serve and the laptop app through a Unix socket only you can open.
- `app/`: the laptop app (Tauri, `airlock-app`).
- `ui/`: the web UI (Svelte and TypeScript) for the phone and for the laptop app's window, built into their binaries.
- `tailscale-policy.hujson`: the tailnet access policy. Your devices reach each other only on 443 (Airlock) and 8443 (its previews); the server is `tag:server` and can't reach the laptop. The laptop's address and your login are placeholders; `./policy.sh` prints the policy filled in, ready to paste into the admin console (Access controls).

## Install

Turn on HTTPS certificates once in the Tailscale admin console (DNS page). Then:

```
sudo apt install tmux qrencode libwebkit2gtk-4.1-dev   # tmux for terminals; WebKitGTK for the app
sudo tailscale set --operator=$USER                     # once, so install.sh can configure Tailscale Serve
./build.sh
./install.sh
```

`install.sh` puts `airlock` and `airlock-app` in `~/.local/bin`, runs the hub as a user service (`systemctl --user status airlock`), adds the app to the app grid and starts it in the tray at login, points Tailscale Serve at the hub (`https://<laptop>/`) and at its previews (port 8443), and adds Claude Code's hooks. It prints the address and a QR code to scan with the phone. Re-run both scripts to update; that works from a terminal on the phone too, since restarting the hub leaves Airlock's terminals running and the phone reconnects to them. If the new hub doesn't answer within 15 seconds, `install.sh` puts the one from before back and stops there, so an update never leaves a phone far away without a way in.

Paste the policy from `./policy.sh` into the admin console so the phone can reach previews on 8443.

## The hub

The hub reads `~/.config/airlock/config.toml`:

```toml
listen = "127.0.0.1:7690"                 # loopback only; Tailscale Serve is the way in
allowed_logins = ["you@example.com"]      # your Tailscale login
tmux_socket = "airlock"                   # optional; the tmux server holding the terminals
projects_dir = "/home/you/Projects"       # optional; where Work looks for repos
face_id_lock_secs = 300                   # optional; a quiet Face ID phone locks after this long
project_roots = ["~/Freelance", "~/Projects", "~/Learning"]   # optional; Work's groups
files_root = "/home/you"                  # optional; the phone's files view stays inside this folder
preview_listen = "127.0.0.1:7691"         # optional; dev-server previews, on their own origin
preview_port = 8443                       # where Tailscale Serve publishes previews
claude_command = "claude"                 # optional; how a terminal starts Claude Code to carry a session on
```

A phone that opens Airlock asks to pair and shows a six-digit code; you let it in from the laptop app, or from a terminal:

```
airlock pairings          # requests waiting, with their codes
airlock approve 421946    # let that device in
airlock devices           # paired devices
airlock revoke iPhone     # cut a device off at once
airlock log               # the audit log
airlock watch             # the hub's events as they happen
airlock config            # where the hub listens
```

Device tokens rotate every 10 minutes of use, and a copied token that comes back gets the device revoked.

Once paired, the phone offers Face ID. With it set up, Airlock locks as soon as you leave it (another app, the home screen, the phone locking), and after 5 minutes without use in any case (`face_id_lock_secs` in the config); typing in a terminal counts as use. Locking also ends the terminals open on the phone (they keep running on the laptop). Only this phone's passkey unlocks it; a copied cookie on another device stays locked out. `airlock devices` and the laptop app show which devices have Face ID.

## The laptop app

`airlock-app` has four sections:

- **Approvals**: devices asking to pair, each with the code it shows; the phone's edits to review; paired devices, each with Revoke; settings; and the audit log.
- **Terminals**: the terminals open on the hub, the ones you started from the phone included, each with its tabs and last lines. Open here attaches to one in the window, live, as the phone does.
- **Sessions**: Claude Code sessions, with where each runs and what it did; one in an Airlock terminal opens there with Open its terminal here.
- **History**: terminals and sessions that have closed or ended, with their last screen and steps. Each is kept for two weeks after it was last active, then deleted; Delete removes one sooner.

It talks to the hub only through the admin socket. A desktop notification tells you when a device asks to pair, when the phone proposes an edit, and when Airlock cuts a device off because a copy of its token turned up.

Closing the window leaves the app in the top bar's tray, so the alerts keep coming; Quit is in the tray menu. Opening the app again shows the window that's already running. `airlock-app --hidden` starts it in the tray, which is how it starts at login.

## Home

Once paired, the phone opens on Home: what needs you, from every part of Airlock. Waiting on you comes first: Claude sessions stuck on a permission prompt (answered right there), a session that stopped on an error, your pull requests with failing checks or changes asked for, your own services that failed, a disk over 90% full (with how much is left), and a battery under 15% that isn't charging. Worth a look comes next: sessions that finished in the last six hours, pull requests ready to merge, a database open to every network (it opens that port's details), jobs still running after their terminal closed, the system's failed services, memory over 90% used, and what became of your edits. A line on top says what is running: sessions working, terminals, dev servers. Anything that doesn't wait on you can be hidden on this phone; it comes back if it changes. Pull requests show once Work or Home has read them from GitHub, so Home never waits on GitHub.

Claude sessions comes last: every session going on, wherever it runs (an Airlock terminal, a GNOME Terminal tab, another terminal), and those closed in the last hour. Each says where it is and how it stands: waiting on you (and for what), working (and on what), done and waiting for your next message, done but still running something, or closed. "Still running" names what: a command Claude left running in the background, like a dev server or a long test run, or one of its agents still at work. Each says the name you gave its Airlock terminal (or its laptop tab's title) and how full its context window is, and opens its session; ⊘ hides one from the list on this phone (Show hidden brings it back, and a prompt from it still waits on top). Claude usage shows the plan's 5-hour and weekly limits, how much of each is used and when it starts over. Both come from a Claude Code status line that `airlock hooks install` adds when you have none of your own: it prints the model and the context in the terminal, and passes those numbers to the hub. A session that starts waiting on you, goes to work, finishes or ends shows at once, on Home, in Work and on its own screen; the rest refreshes every 10 seconds.

## Terminals

The phone's Terminals lists the laptop's terminals and opens new ones in a folder you pick: one already open in a terminal, or one of your projects, most recently changed first. Each terminal is a tmux session on the hub's own tmux server, and its tabs are the session's windows, so closing the phone's page leaves them running, and so does the hub restarting (an update, a crash); a restart of the laptop ends them. On the laptop, the app opens one in its window or in a Terminal window, and `airlock attach` joins one from any terminal: it lists them and asks which, or takes a number or a name (`airlock attach 2`, `airlock attach website`). The phone's keyboard comes up only from the keyboard button at the start of the key bar, which puts it away again; opening a terminal, tapping it or using the key bar's keys never brings it up, and a hardware keyboard types in either way. Swipe scrolls history, and To the bottom brings it back to what's running now; pinch zooms, and the key bar's Ctrl and Alt work on the next key, or stay on with a double tap. Copy shows the terminal's last 2,000 lines as text to select, opened at the newest. Text anywhere in Airlock can be selected and copied. Its Go to… button picks a folder (one open in a terminal, or a project) and types the `cd` for you; the buttons are in `ui/src/features/terminals/keys.ts`.

Your GNOME Terminal tabs show there too, under On the laptop, as they are. Open one to watch it and type into it; typing on the laptop still works as before. While you type on the phone, the tab takes the phone's width, and typing on the laptop gives it back. On the laptop nothing changes: the same window, scrollback, selection and title, closing the tab ends it, and GNOME Terminal still asks first while a program runs in it. `install.sh` turns it on for tabs opened from then on; tabs already open stay the laptop's alone. It runs each new tab's shell inside `airlock tab`, from a marked block at the top of `~/.bashrc`:

```sh
airlock tabs show       # whether new tabs are shared
airlock tabs remove     # take the block out; new tabs are the laptop's alone
airlock tabs install    # put it back
```

## Work: projects and sessions

The phone's Work section shows your projects grouped by the folders that hold them: `project_roots` in the config, like `["~/Freelance", "~/Projects", "~/Learning"]` (`~/Projects` when unset). Every folder directly inside a root is a project, git repo or not; repos and sessions outside the roots are under Elsewhere. Groups fold away, and Edit hides projects or whole groups on this phone. A repo shows its worktrees, branches, how far ahead or behind they are, uncommitted changes and pull requests; a plain folder shows its sessions and terminals. A session waiting for permission shows on top; Allow once, Always and Deny are typed into its terminal for you, after the hub checks the prompt is on its screen. Diffs and pull requests are for reading; nothing here checks out, commits or opens pull requests.

A session shows its terminal, live, with the 300 lines before its screen to scroll back through (it stays on the newest lines until you do) and magnifier buttons to zoom, and you can type into it and use its keys; that includes a session in one of your GNOME Terminal tabs, whose permission prompts are answered from Home and Work like any other. One open in a terminal Airlock can't reach (a tab opened before sharing was on, or another terminal app) offers Share with the phone. Claude quits in that terminal, then `claude --resume` carries the conversation on in a new Airlock terminal, which the laptop app also opens in a Terminal window: the session is in both places again, and there's never a second Claude on the same conversation. It waits until Claude has finished its turn. One that has ended offers Continue here. The hub refuses to resume a session while a Claude still runs it. Each step it took opens in full, from the session's transcript: the command and its output, the edit as a diff, the file it read, the search and what it found.

Sessions report through Claude Code hooks, which run `airlock hook` in the background and print nothing. `install.sh` adds them; to manage them by hand:

```
airlock hooks install     # add them to ~/.claude/settings.json (a backup is kept)
airlock hooks show        # are they there?
airlock hooks remove      # take them out
```

Pull requests and checks come from the GitHub CLI (`gh`), signed in as you.

## Files

The phone's Files section browses and reads your home folder (or `files_root` in the config): source with colours, Markdown rendered (any HTML in it shown as text), web pages in a sandbox that can't run scripts or reach Airlock, and images. A folder shows as a list or as a grid with thumbnails of its small images, sorted A–Z, Z–A, by last or first modified, by size or by type, folders first; the phone remembers the view and the order. Search finds files by name. "Terminal here" opens a terminal in the folder, and "Open on laptop" opens it on the laptop's screen (programs are never started).

Edits from the phone are never written straight away. They wait in the laptop app's "Edits from the phone", which shows what changed. Write it and the hub writes the file, keeping its permissions, but only if it's still as the phone read it. If it changed on the laptop since, you see both changes and choose: merge them (when they don't overlap), use the phone's version, or keep the laptop's. The phone sees what became of each edit and can take back one that's still waiting.

Files that look like secrets (`.env`, keys, credentials, `~/.ssh`, `~/.aws` and the like) are readable on the phone while the laptop app's "The phone may read sensitive files" is on (it is by default). Airlock's own config and state are never shown.

## System and dev servers

The phone's System section has three tabs. Overview: load, memory, disk (free, out of its size) and battery; every listening port with who can reach it (laptop only, tailnet, all networks); background jobs whose terminal is gone; and the busiest processes. Processes: every process, live, with the laptop's CPU and memory over the last couple of minutes; search, filter by kind (apps, dev servers, terminals, services, desktop, system), sort, and group each app's helpers under it; open one for its command, owner, state, threads, ports and the package that installed it, and a note on what it is. Services & timers: yours and the system's, with their state, how long they have run, memory, restarts, and when timers run next and last; the system's are for looking only. A failed one says why: how it ended, its last log lines and the package it came from, with whether it matters (safe to ignore, worth a look, worth fixing) and what to do, for the ones laptops commonly have, like VirtualBox's driver or the network wait at startup. A failed service on Home opens straight to that. A "?" beside each term explains it. Stopping anything asks first. A process is asked to stop politely, and only if it is still running after 5 seconds are you asked again before it is forced; the hub refuses to force a process it didn't ask to stop first. Your desktop session, the hub and Airlock's terminals are never stopped from here, and every stop goes in the audit log.

Tapping a listening port says what it is (a database, SSH, printing, a dev server, a Docker container, one of your programs), who runs it and who can reach it, and gives a verdict. **Safe**: only this laptop or your own devices on Tailscale can reach it. **Worth a look**: anything else open to other networks. **Worth fixing**: a database (PostgreSQL, MySQL, Redis, MongoDB, Memcached) open to other networks. Each verdict that isn't Safe comes with what to do: publish a container's port on `127.0.0.1` only, or the command that turns off a system service, ready to copy. It says when the firewall (ufw) is off, and that Docker's ports get past it anyway. Your own program is stopped from the sheet like any process. A Docker container that publishes a port is stopped with `docker stop`, which keeps it stopped until you start it again. The system's services are only looked at.

A dev server (a port of yours that looks like `vite`, `astro dev`, `http.server` and the like, or one started from a terminal) opens in a live preview. Previews are served by the hub's second listener on their own origin, so the app being previewed can't reach Airlock, and none of Airlock's cookies are passed to it. They need `preview_listen` in the config, Tailscale Serve publishing it on port 8443 (`preview_port`), and that port allowed in the tailnet policy.

## Notifications

The phone gets a notification when a Claude session starts waiting on you, finishes, or stops on an error, even with Airlock closed and the phone locked. It names the terminal or project, never the command or the question, since it shows on the lock screen; tapping it opens that session.

On an iPhone, Airlock has to be on the Home Screen first: in Safari, Share, then Add to Home Screen, and open it from its icon. The Home Screen app keeps its own cookies, so it asks to pair once (approve its code as usual, or with `airlock approve <code>` from a terminal in Safari's Airlock). Then Settings, Notifications, Turn on notifications, and Send a test to check.

## Ask Claude

Ask Claude answers a question about the laptop, or about what you're looking at, as it comes. Ask Claude about the laptop is on Home; a listening port, a failed service and a process each have Ask Claude about it, which passes on what the screen shows. Suggested questions start it, and follow-ups carry the conversation on until you ask about something else. Above the answer, a line says what Claude is checking.

Answers come from Claude Code on the laptop (`claude -p`), with your login, in your home folder. It looks around and can't change anything: it reads files and searches, runs only read-only commands (`systemctl status`, `ps`, `ss`, `df`, `docker ps`, `git status` and the like), and searches the web. It never reads Airlock's config, SSH and GPG keys, Claude Code's credentials, the keyring or other programs' environments. It runs without your MCP servers, keeps no session, and isn't reported to Home or Work. An answer stops after 3 minutes, and two questions run at once at most.

Sonnet 5.5 answers unless you choose Opus 5.5 (most thorough) or Haiku 5.5 (fastest) in Settings.

## Settings

The sliders button at the top of the phone's main screens opens Settings, kept in the phone's browser only: the theme, Ask Claude's model, and the secret games' sound.

### Themes

The themes are Current, Matrix, 8-bit, Teletext, Handheld console, Game Boy, 90s workstation, Vector display and Hacker. Each theme has its own colours and type, its own header, and its own layout for the terminal list; the other screens take its colours and type. In the Game Boy theme the screens sit inside the console, and its D-pad, A, B, Select and Start work: up and down move through what's on screen, A opens it, B goes back, left and right switch sections, Select opens Files and Start a new terminal. A terminal or a preview gets the whole phone.

Two switches go with the theme. "Terminal colours follow the theme" gives the terminal the theme's colours, font and ANSI palette; off, it keeps plain black and white. "Motion" turns the moving parts on or off (code rain, blinking cursors, glitches); they also stay still while the phone asks for less motion. The laptop app keeps the current look.

## The secret games

Hold a finger on the top of any screen for a moment (not on a link or a button) and a card offers two games, the one you played last first. On a keyboard, ↑ ↑ ↓ ↓ ← → ← → B A opens it too.

Hop Count is a platform game for while you wait, in which a packet crosses the network zone after zone, with no last level. Each zone has its own scenery, bugs, music and twist (ice, wind, conveyors, beat blocks, flipped gravity, swimming, lights out, and more), and every fourth hop ends with a boss. Its world map comes up after every clear, and from the title and the pause menu: it shows the zones reached and the next one, still shut, and plays any hop you've opened, with each one's keys and best time. The game takes the theme's colours and look, and its sound follows the theme as well; in the Game Boy theme it plays in the console's screen, on the console's buttons.

- On the phone: ◀ and ▶ move, A jumps (hold it for a higher jump), B runs and, with the ping power-up, fires, ▼ goes down a warp pipe, and Pause pauses.
- On a keyboard: arrows or WASD, Z or Space to jump, X or Shift to run, Enter to pause, M for sound, Esc to close.
- In the Game Boy case: the D-pad, A, B and Start; B and Select together close the game.

Keepalive is a story to play over a few hours. Gran, the gateway of Loopback, the last town on the network that still answers, makes a ping called Echo and sends it out with one question: "Are you still there?" Four companions join on the way, each with their own reason and their own move: Cron the scheduler stops time, Sudo breaks walls and shoves what's heavy, Float carries you over gaps, and old Tel talks to terminals. Puzzles and bosses need them together. What you say to them changes how far they trust you, what they tell you, the side quests they open and how it ends. Five chapters each have their own places, music and look, in the theme's colours (and in the Game Boy theme, in the console), and the world map shows where you've been, the secrets you've found there, where the story goes next and the side quests waiting, and takes you back to places you've reached.

- On the phone: the arrows move, A talks, opens and uses the move of the companion in front, B pings (relays light, bugs stop, hidden things show), the button above them puts the next companion in front, and Menu has the map, the quests, the companions and the log. Tap what's being said to see all of it, and tap a choice to answer.
- On a keyboard: arrows or WASD, Z or Space for A, X for B, C or Q to switch, Enter for the menu, M for sound, Esc to close.
- In the Game Boy case: the D-pad, A, B and Start; Select switches; B and Select together close the game.

Closing either game (✕, Esc, or leaving Airlock) pauses it and saves it in this browser, and opening it again picks up where it was. Nothing of them runs while closed or hidden, their sound respects the phone's silent switch, and Settings turns it off for both. New game is in Hop Count's pause menu and on Keepalive's title. In private browsing they play without saving.

## Secrets

Everything secret or personal lives together in `~/.config/airlock` (mode 700), never in the repo:

- `config.toml`: the hub's settings.
- `policy.env`: `LAPTOP_IP` (this laptop's tailnet address) and `TAILNET_USER` (your tailnet login), for `policy.sh`.

The hub's database is in `~/.local/state/airlock` (mode 700). It holds device tokens and pairing secrets only as hashes, and passkeys only as public keys.

`.gitignore` also blocks `.env` files, `*.local.*` files and a `secrets/` folder, in case one lands in the repo.

## Work on the UI

In `ui/`:

```
npm ci              # once
npm run check       # types, including the end-to-end tests
npm test            # unit tests
npm run build       # the phone UI into ui/dist, the laptop window into ui/dist-laptop
npm run e2e         # builds, then end-to-end tests in WebKit against a real hub
```

A debug hub (`cargo run -- serve`) reads `ui/dist` from disk, so after `npm run build` a reload shows the change. Release builds, and every build of the laptop app (`cargo build -p airlock-app`), embed the built UI, which is why `./build.sh` builds the UI first.

The end-to-end tests need WebKit and Chromium from `npx playwright install webkit chromium`; Face ID runs in Chromium, whose virtual authenticator stands in for the iPhone's passkey. Each test starts its own hub with its own config, database, files folder and tmux server, behind HTTPS fronts that add the Tailscale identity header as Tailscale Serve would, so they never touch your real terminals or files. The laptop window's tests run it in WebKit, the engine Tauri uses on Linux, with a stand-in for Tauri that sends each command to the test hub's admin socket as the app does.
