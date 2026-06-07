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
    echo "Expected an H100 GPU. Set ALLOW_NON_H100=1 only for dry-run dependency setup." >&2
    nvidia-smi --query-gpu=name,memory.total --format=csv,noheader >&2 || true
    exit 1
  fi
fi

PYTHON_BIN="${PYTHON_BIN:-python3.10}"
if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  PYTHON_BIN=python3
fi
"$PYTHON_BIN" - <<'PY'
import sys
if sys.version_info < (3, 10) or sys.version_info >= (3, 13):
    raise SystemExit("MisoTTS requires Python >=3.10,<3.13; got %s" % (sys.version.split()[0],))
PY
"$PYTHON_BIN" -m venv .venv-miso-lora
source .venv-miso-lora/bin/activate
python -m pip install --upgrade pip wheel setuptools

MISO_TTS_REPO_DIR="${MISO_TTS_REPO_DIR:-artifacts/vendor/MisoTTS}"
if [[ ! -d "$MISO_TTS_REPO_DIR/.git" ]]; then
  mkdir -p "$(dirname "$MISO_TTS_REPO_DIR")"
  git clone https://github.com/MisoLabsAI/MisoTTS.git "$MISO_TTS_REPO_DIR"
fi
python -m pip install -e "$MISO_TTS_REPO_DIR"
python -m pip install \
  "accelerate" \
  "peft" \
  "bitsandbytes" \
  "datasets" \
  "huggingface_hub" \
  "safetensors"

python - <<'PY'
from huggingface_hub import snapshot_download

snapshot_download(
    repo_id="MisoLabs/MisoTTS",
    local_dir="artifacts/models/MisoLabs-MisoTTS",
    local_dir_use_symlinks=False,
)
PY

node scripts/vast-h100/validate-miso-lora-manifest.mjs "${MISO_LORA_MANIFEST:-configs/miso-lora/manifest.example.json}"

cat <<'MSG'
Miso LoRA dev environment is ready.
Next:
  1. Replace configs/miso-lora/manifest.example.json with a consented local dataset manifest.
  2. Set MISO_LORA_TRAIN_ENTRYPOINT to the local training entrypoint once the LoRA trainer is implemented or selected.
  3. Run scripts/vast-h100/launch-miso-lora-dev.sh.
MSG
