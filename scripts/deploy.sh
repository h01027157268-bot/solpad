#!/usr/bin/env bash
# Deploy SolPad to a cluster and initialise the platform config.
#
#   ./scripts/deploy.sh devnet
#   ./scripts/deploy.sh localnet
#
# Needs the Solana CLI (which provides `solana` and `cargo build-sbf`) and the
# Anchor CLI on PATH. cargo-build-sbf does not run natively on Windows - use WSL
# or a Linux box.
set -euo pipefail

CLUSTER="${1:-devnet}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEYPAIR="${KEYPAIR:-$HOME/.config/solana/id.json}"
RPC_URL="${RPC_URL:-}"

case "$CLUSTER" in
  localnet) RPC_URL="${RPC_URL:-http://127.0.0.1:8899}" ;;
  devnet)   RPC_URL="${RPC_URL:-https://api.devnet.solana.com}" ;;
  mainnet*) RPC_URL="${RPC_URL:-https://api.mainnet-beta.solana.com}" ;;
esac

echo "cluster : $CLUSTER"
echo "rpc     : $RPC_URL"
echo "keypair : $KEYPAIR"

solana config set --url "$RPC_URL" --keypair "$KEYPAIR" >/dev/null

if [ "$CLUSTER" = "localnet" ]; then
  if ! solana cluster-version >/dev/null 2>&1; then
    echo "starting a local validator..."
    solana-test-validator --reset --quiet &
    sleep 5
  fi
else
  BALANCE=$(solana balance --keypair "$KEYPAIR" | awk '{print $1}')
  echo "balance : $BALANCE SOL"
  if [ "${BALANCE%.*}" -lt 3 ]; then
    solana airdrop 2 --keypair "$KEYPAIR" || true
  fi
fi

cd "$ROOT"
anchor build
anchor deploy --provider.cluster "$RPC_URL" --provider.wallet "$KEYPAIR"

PROGRAM_ID=$(solana address -k target/deploy/launchpad-keypair.json)
echo "program : $PROGRAM_ID"

TREASURY="${TREASURY:-${NEXT_PUBLIC_TREASURY:-EYB8XKsysDpSkK4PdBg4Rx3EMqY5NJ1LGfmvUdiKkqaQ}}"
echo "creating the platform config with treasury $TREASURY..."
echo
echo "  Run the initialise instruction from the app scripts, e.g."
echo "    node scripts/init-config.mjs $PROGRAM_ID $TREASURY"
echo
echo "Next:"
echo "  cp target/idl/launchpad.json app/src/lib/solana/idl.json"
echo "  cd app && NEXT_PUBLIC_PROGRAM_ID=$PROGRAM_ID npm run dev"

