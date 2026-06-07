#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -d .venv-miso-lora ]]; then
  echo ".venv-miso-lora is missing. Run scripts/vast-h100/setup-miso-lora-dev.sh first." >&2
  exit 1
fi

source .venv-miso-lora/bin/activate

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

export MISO_TTS_REPO_DIR="${MISO_TTS_REPO_DIR:-artifacts/vendor/MisoTTS}"
DEFAULT_MISO_MODEL="MisoLabs/MisoTTS"
if [[ -d "artifacts/models/MisoLabs-MisoTTS" ]]; then
  DEFAULT_MISO_MODEL="artifacts/models/MisoLabs-MisoTTS"
fi
export TTS_MODEL="${TTS_MODEL:-${MISO_TTS_8B_MODEL:-$DEFAULT_MISO_MODEL}}"
export MISO_TTS_8B_MODEL="${MISO_TTS_8B_MODEL:-$TTS_MODEL}"
export TTS_HOST="${TTS_HOST:-127.0.0.1}"
export TTS_PORT="${TTS_PORT:-4331}"
export TTS_DTYPE="${TTS_DTYPE:-bfloat16}"
export TTS_QUANTIZATION="${TTS_QUANTIZATION:-none}"
export TTS_CACHE_DIR="${TTS_CACHE_DIR:-artifacts/cache/miso-one-tts}"
export HF_HOME="${HF_HOME:-$TTS_CACHE_DIR/huggingface}"
export HF_HUB_CACHE="${HF_HUB_CACHE:-$HF_HOME/hub}"
export MISO_LORA_ADAPTER="${MISO_LORA_ADAPTER:-artifacts/miso-lora/adapters/miso-one-lora-dev}"

echo "Starting Miso One/MisoTTS local endpoint:"
echo "  model: $TTS_MODEL"
echo "  url: http://$TTS_HOST:$TTS_PORT"
echo "  repo: $MISO_TTS_REPO_DIR"
echo "  lora adapter metadata: $MISO_LORA_ADAPTER"
echo "  require lora weights: ${MISO_REQUIRE_LORA:-0}"
echo "  hf cache: $HF_HUB_CACHE"
echo
echo "This wrapper exposes /health, /prewarm, and /v1/tts/stream for the"
echo "InboundNow local TTS adapter. It reports LoRA adapter application honestly;"
echo "metadata alone is not treated as cloned-voice proof, and quantization is"
echo "reported as unsupported until the public MisoTTS loader exposes that path."

python scripts/vast-h100/miso-one-tts-server.py
