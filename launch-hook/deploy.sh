#!/usr/bin/env bash
# Cheapest mainnet deploy: reserve EXACTLY the binary size (no 2x upgrade headroom),
# so program-account rent is ~halved vs Playground's default. Run wherever the
# Solana CLI + your keypair live. You keep the key; this just deploys.
#
#   ./deploy.sh path/to/launch_hook.so keys/launch.json
set -euo pipefail

SO=${1:-target/deploy/launch_hook.so}
KEY=${2:-keys/launch.json}
RPC=${RPC:-https://api.mainnet-beta.solana.com}

LEN=$(wc -c < "$SO")
echo "binary: $SO  size: $LEN bytes"
# rough rent estimate: (128 + max_len) * 6960 lamports
EST=$(( (128 + LEN) * 6960 ))
echo "approx programdata rent at --max-len=$LEN : $(echo "scale=4; $EST/1000000000" | bc) SOL"

solana program deploy "$SO" \
  --keypair "$KEY" \
  --url "$RPC" \
  --max-len "$LEN"
