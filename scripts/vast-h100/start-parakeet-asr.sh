#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

if ! command -v nvidia-smi >/dev/null 2>&1; then
  echo "nvidia-smi is required. Run this on the Vast.ai H100 instance." >&2
  exit 1
fi

if ! nvidia-smi --query-gpu=name --format=csv,noheader | grep -qi "H100"; then
  if [[ "${ALLOW_NON_H100:-0}" != "1" ]]; then
    echo "Expected an H100 GPU. Set ALLOW_NON_H100=1 only for local dependency dry runs." >&2
    nvidia-smi --query-gpu=name,memory.total --format=csv,noheader >&2 || true
    exit 1
  fi
fi

VENV_DIR="${ASR_VENV_DIR:-.venv-h100}"
if [[ ! -d "$VENV_DIR" ]]; then
  python3 -m venv "$VENV_DIR"
fi
source "$VENV_DIR/bin/activate"
python -m pip install --upgrade pip wheel setuptools
python -m pip install "nemo_toolkit[asr]" "huggingface_hub" "soundfile"

ASR_MODEL="${ASR_MODEL:-nvidia/parakeet-tdt-0.6b-v3}" \
ASR_HOST="${ASR_HOST:-127.0.0.1}" \
ASR_PORT="${ASR_PORT:-4341}" \
python scripts/vast-h100/parakeet-asr-server.py
