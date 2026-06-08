#!/bin/bash
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# Install system dependencies required by solana-remote-wallet (hidapi/udev)
apt-get install -y libudev-dev 2>/dev/null || true

# Install Node.js dependencies for the launch-hook client
cd "$CLAUDE_PROJECT_DIR/launch-hook/client"
npm install --legacy-peer-deps

# Pre-fetch Rust crate dependencies for the main workspace
cd "$CLAUDE_PROJECT_DIR"
cargo fetch

# Pre-fetch Rust crate dependencies for the launch-hook Anchor workspace
cd "$CLAUDE_PROJECT_DIR/launch-hook"
cargo fetch
