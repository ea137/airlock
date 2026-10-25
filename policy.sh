#!/usr/bin/env bash
# Prints the tailnet access policy with this laptop's values filled in, ready to
# paste into the admin console. The values live in ~/.config/airlock/policy.env.
set -euo pipefail

env_file=~/.config/airlock/policy.env
[ -r "$env_file" ] || { echo "missing $env_file: set LAPTOP_IP and TAILNET_USER there" >&2; exit 1; }
set -a
. "$env_file"
set +a
envsubst '$LAPTOP_IP $TAILNET_USER' <"$(dirname "$0")/tailscale-policy.hujson"
