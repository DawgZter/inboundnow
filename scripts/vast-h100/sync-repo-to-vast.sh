#!/usr/bin/env bash
set -euo pipefail

: "${VAST_HOST:?Set VAST_HOST to the instance host, for example 142.214.185.187}"
: "${VAST_PORT:?Set VAST_PORT to the SSH port from the Vast instance card}"

REMOTE_USER=${REMOTE_USER:-root}
REMOTE_DIR=${REMOTE_DIR:-/workspace/inboundnow}
SSH_KEY_ARG=()
if [[ -n "${SSH_KEY:-}" ]]; then
  SSH_KEY_ARG=(-i "$SSH_KEY")
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

ssh "${SSH_KEY_ARG[@]}" -p "$VAST_PORT" "$REMOTE_USER@$VAST_HOST" "mkdir -p '$REMOTE_DIR'"
rsync -az --delete \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude 'artifacts/' \
  --exclude '.venv-h100/' \
  -e "ssh ${SSH_KEY:+-i $SSH_KEY} -p $VAST_PORT" \
  "$ROOT_DIR/" "$REMOTE_USER@$VAST_HOST:$REMOTE_DIR/"

echo "Synced repo to $REMOTE_USER@$VAST_HOST:$REMOTE_DIR"
