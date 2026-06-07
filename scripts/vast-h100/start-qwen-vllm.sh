#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -d .venv-h100 ]]; then
  echo ".venv-h100 is missing. Run scripts/vast-h100/bootstrap-instance.sh first." >&2
  exit 1
fi

source .venv-h100/bin/activate

MODEL=${LLM_MODEL:-Qwen/Qwen2.5-7B-Instruct}
SERVED_MODEL_NAME=${LLM_SERVED_MODEL_NAME:-qwen-local}
PORT=${LLM_PORT:-4311}
MAX_MODEL_LEN=${LLM_MAX_MODEL_LEN:-8192}
GPU_MEMORY_UTILIZATION=${LLM_GPU_MEMORY_UTILIZATION:-0.72}

echo "Starting vLLM OpenAI-compatible endpoint:"
echo "  model: $MODEL"
echo "  served name: $SERVED_MODEL_NAME"
echo "  url: http://127.0.0.1:$PORT/v1"

python -m vllm.entrypoints.openai.api_server \
  --host 127.0.0.1 \
  --port "$PORT" \
  --model "$MODEL" \
  --served-model-name "$SERVED_MODEL_NAME" \
  --max-model-len "$MAX_MODEL_LEN" \
  --gpu-memory-utilization "$GPU_MEMORY_UTILIZATION" \
  --dtype auto
