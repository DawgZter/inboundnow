#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -d .venv-h100 ]]; then
  echo ".venv-h100 is missing. Run scripts/vast-h100/bootstrap-instance.sh first." >&2
  exit 1
fi

source .venv-h100/bin/activate

VIBEVOICE_REPO_DIR=${VIBEVOICE_REPO_DIR:-/workspace/VibeVoice}
MODEL=${TTS_MODEL:-microsoft/VibeVoice-Realtime-0.5B}
PORT=${TTS_PORT:-4331}
DEVICE=${TTS_DEVICE:-cuda}
DTYPE=${TTS_DTYPE:-bfloat16}
QUANTIZATION=${TTS_QUANTIZATION:-llm-int8}
CACHE_DIR=${TTS_CACHE_DIR:-artifacts/cache/tts}

if [[ ! -d "$VIBEVOICE_REPO_DIR/.git" ]]; then
  git clone https://github.com/microsoft/VibeVoice.git "$VIBEVOICE_REPO_DIR"
fi

cd "$VIBEVOICE_REPO_DIR"
git pull --ff-only || true
python -m pip install -e ".[streamingtts]"

echo "Starting VibeVoice-Realtime service:"
echo "  repo: $VIBEVOICE_REPO_DIR"
echo "  model: $MODEL"
echo "  port: $PORT"
echo "  device: $DEVICE"
echo "  dtype hint: $DTYPE"
echo "  quantization policy hint: $QUANTIZATION"
echo "  cache dir hint: $ROOT_DIR/$CACHE_DIR"
echo
echo "The official VibeVoice realtime demo is the model server. InboundNow proof"
echo "still requires scripts/vast-h100/smoke-vibevoice-endpoint.mjs against a"
echo "localhost endpoint that exposes /health, /prewarm, and /v1/tts/stream."

python demo/vibevoice_realtime_demo.py \
  --model_path "$MODEL" \
  --port "$PORT" \
  --device "$DEVICE"
