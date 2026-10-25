#!/usr/bin/env bash
# Builds the UIs, checks and tests them, then builds the hub and the laptop
# app with their UIs inside: target/release/airlock and
# target/release/airlock-app.
set -euo pipefail
cd "$(dirname "$0")"

(
  cd ui
  npm ci --no-fund --no-audit
  npm run check
  npm test
  npm run build
)
cargo build --release --workspace
echo "built target/release/airlock and target/release/airlock-app"
