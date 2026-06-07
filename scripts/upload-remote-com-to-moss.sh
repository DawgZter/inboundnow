#!/usr/bin/env bash
set -euo pipefail

INDEX_NAME="${MOSS_INDEX_NAME:-remote-com-2026-06-07}"
MODEL="${MOSS_MODEL:-moss-minilm}"
DOCS_PATH="${REMOTE_COM_MOSS_DOCS_PATH:-artifacts/moss/remote-com-documents.json}"

npm run moss:docs:remote

if ! command -v moss >/dev/null 2>&1; then
  cat >&2 <<'EOF'
The Moss CLI is not installed.

Install and authenticate first:

  pip install moss-cli
  moss init

Then rerun:

  npm run moss:upload:remote
EOF
  exit 1
fi

moss index create "$INDEX_NAME" -f "$DOCS_PATH" --model "$MODEL" --wait
moss index get "$INDEX_NAME"

