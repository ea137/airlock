#!/usr/bin/env bash
# Installs Airlock for the current user: the hub as a user service, the
# laptop app with its launcher and login item, Tailscale Serve, Claude
# Code's hooks, and GNOME Terminal's tabs shared with the phone. Run
# ./build.sh first. Safe to re-run: it updates in place.
# It also takes out the old phone terminal (ttyd and its page) if it's there.
set -euo pipefail

repo=$(cd "$(dirname "$0")" && pwd)
bin=~/.local/bin
units=~/.config/systemd/user
apps=~/.local/share/applications
icons=~/.local/share/icons/hicolor
autostart=~/.config/autostart
config=~/.config/airlock
desktop=dev.airlock.laptop

for file in airlock airlock-app; do
  [ -x "$repo/target/release/$file" ] || { echo "missing target/release/$file: run ./build.sh first"; exit 1; }
done
for cmd in tmux tailscale git systemctl; do
  command -v "$cmd" >/dev/null || { echo "missing: $cmd"; exit 1; }
done
loginctl show-user "$USER" -p Linger | grep -q yes \
  || echo "note: run 'sudo loginctl enable-linger $USER' so the hub runs while you're logged out"

# Binaries: copied beside, then moved into place, so a running one is never
# half-written. The hub from before is kept, to go back to if the new one
# doesn't come up.
mkdir -p "$bin"
[ -x "$bin/airlock" ] && cp -f "$bin/airlock" "$bin/.airlock.previous"
for file in airlock airlock-app; do
  install -m 755 "$repo/target/release/$file" "$bin/.$file.new"
  mv -f "$bin/.$file.new" "$bin/$file"
done

mkdir -p "$config"
chmod 700 "$config"
if [ ! -s "$config/config.toml" ]; then
  login=$(sed -n 's/^TAILNET_USER=//p' "$config/policy.env" 2>/dev/null || true)
  [ -n "$login" ] || { echo "write $config/config.toml first (see the README), or TAILNET_USER in $config/policy.env"; exit 1; }
  printf 'listen = "127.0.0.1:7690"\nallowed_logins = ["%s"]\n' "$login" >"$config/config.toml"
fi
grep -q '^preview_listen' "$config/config.toml" \
  || printf '\n# Dev-server previews, on their own origin (Tailscale Serve on 8443).\npreview_listen = "127.0.0.1:7691"\n' >>"$config/config.toml"
chmod 600 "$config/config.toml"
eval "$("$bin/airlock" config)"

mkdir -p "$units"
install -m 644 "$repo/systemd/airlock.service" "$units/airlock.service"
systemctl --user daemon-reload
systemctl --user enable airlock.service >/dev/null
systemctl --user restart airlock.service
# The new hub answers within 15 seconds, or the one from before goes back:
# an update run from a phone far away never leaves it without a way in.
up=
for _ in $(seq 30); do
  if "$bin/airlock" devices >/dev/null 2>&1; then up=1; break; fi
  sleep 0.5
done
if [ -z "$up" ]; then
  echo "The new hub didn't come up. Its last log lines:" >&2
  journalctl --user -u airlock.service -n 20 --no-pager >&2 || true
  if [ -x "$bin/.airlock.previous" ]; then
    mv -f "$bin/.airlock.previous" "$bin/airlock"
    systemctl --user restart airlock.service
    echo "The hub from before is back; the rest of the install was skipped." >&2
  fi
  exit 1
fi

for size in 32 128 512; do
  src="$repo/app/icons/${size}x${size}.png"
  [ "$size" = 512 ] && src="$repo/app/icons/icon.png"
  install -D -m 644 "$src" "$icons/${size}x${size}/apps/$desktop.png"
done
gtk-update-icon-cache -q -t "$icons" 2>/dev/null || true
desktop-file-install --dir="$apps" --set-key=Exec --set-value="$bin/airlock-app" "$repo/app/$desktop.desktop"
update-desktop-database -q "$apps" 2>/dev/null || true
mkdir -p "$autostart"
desktop-file-install --dir="$autostart" --set-key=Exec --set-value="$bin/airlock-app --hidden" \
  --set-key=X-GNOME-Autostart-enabled --set-value=true "$repo/app/$desktop.desktop"

# The old phone terminal: its services, page and settings. Its tmux server
# (tmux -L phone) keeps any shells you left there until you close them.
for unit in phone-term.service phone-page.service; do
  if [ -e "$units/$unit" ]; then
    systemctl --user disable --now "$unit" 2>/dev/null || true
    rm -f "$units/$unit"
    echo "removed the old $unit"
  fi
done
systemctl --user daemon-reload
rm -rf ~/.local/share/phone-term ~/.config/phone-term
# The old secret path is no key to anything any more.
rm -f "$config/secret"

port=${listen##*:}
if tailscale serve reset \
  && tailscale serve --bg --https=443 "http://127.0.0.1:$port" >/dev/null \
  && { [ -z "${preview_listen:-}" ] \
    || tailscale serve --bg --https="$preview_port" "http://127.0.0.1:${preview_listen##*:}" >/dev/null; }; then
  echo "tailscale serve: configured"
else
  echo "tailscale serve failed; once: sudo tailscale set --operator=$USER (HTTPS certificates on in the admin console)"
  exit 1
fi

"$bin/airlock" hooks install
"$bin/airlock" tabs install

# The app, now, in the tray (opening it again shows the window). One already
# running is the old version, and a new one would only hand over to it, so it
# is closed first.
if [ -n "${WAYLAND_DISPLAY:-}${DISPLAY:-}" ]; then
  pkill -x airlock-app 2>/dev/null || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    pgrep -x airlock-app >/dev/null || break
    sleep 0.3
  done
  setsid -f "$bin/airlock-app" --hidden >/dev/null 2>&1 || true
fi

host=$(tailscale status --json | grep -m1 '"DNSName"' | cut -d'"' -f4 | sed 's/\.$//')
url="https://$host/"
echo "Airlock: $url"
echo "On the phone, open it and ask to pair; let it in from the Airlock app on the laptop."
[ -z "${preview_listen:-}" ] \
  || echo "Previews use port $preview_port: allow it in the tailnet policy (./policy.sh prints it)."
if [ -t 1 ] && command -v qrencode >/dev/null; then qrencode -t ansiutf8 "$url"; fi
