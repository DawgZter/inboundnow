#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

SESSION=${TMUX_SESSION:-inboundnow-h100}
ROOM=${LIVEKIT_ROOM:-inboundnow-h100}
LAB_PORT=${LAB_PORT:-4199}
TOKEN_PORT=${TOKEN_SERVER_PORT:-4301}
MOSS_PORT=${MOSS_RUNTIME_PORT:-4321}
LLM_PORT=${LLM_PORT:-4311}
ASR_PORT=${ASR_PORT:-4341}
TTS_PORT=${TTS_PORT:-4331}
LLM_MODEL=${LLM_MODEL:-Qwen/Qwen3.6-27B}
LLM_MODEL_NAME=${LLM_SERVED_MODEL_NAME:-qwen3.6-27b}
ASR_PROVIDER_NAME=${ASR_PROVIDER:-parakeet-stub}
TTS_RUNTIME=${TTS_RUNTIME:-miso-one}
TTS_PROVIDER_NAME=${TTS_PROVIDER:-vibevoice-stub}
PROOF_MODE=${H100_PROOF_MODE:-0}
AGENT_MODE_NAME=${AGENT_MODE:-simulated}
if [[ "$PROOF_MODE" == "1" ]]; then
  AGENT_MODE_NAME=${AGENT_MODE:-verified}
  ENABLE_LLM_RUNTIME=${ENABLE_LLM_RUNTIME:-1}
  ENABLE_ASR_RUNTIME=${ENABLE_ASR_RUNTIME:-1}
  ENABLE_TTS_RUNTIME=${ENABLE_TTS_RUNTIME:-1}
fi

echo "Building local Moss retrieval artifact..."
if [[ "$PROOF_MODE" == "1" ]]; then
  npm run moss:index:remote
  MOSS_INDEX_PATH_NAME=${MOSS_INDEX_PATH:-artifacts/moss/remote-com-local-index.json}
else
  npm run moss:index
  MOSS_INDEX_PATH_NAME=${MOSS_INDEX_PATH:-artifacts/moss/local-index.json}
fi

if [[ "${ENABLE_TTS_RUNTIME:-0}" == "1" ]]; then
  if [[ "$TTS_RUNTIME" == "miso-one" ]]; then
    TTS_PROVIDER_NAME=local-miso-one
    TTS_QUANTIZATION_NAME=${TTS_QUANTIZATION:-none}
  else
    TTS_PROVIDER_NAME=local-vibevoice
    TTS_QUANTIZATION_NAME=${TTS_QUANTIZATION:-llm-int8}
  fi
fi
TTS_QUANTIZATION_NAME=${TTS_QUANTIZATION_NAME:-${TTS_QUANTIZATION:-llm-int8}}

if [[ "${ENABLE_ASR_RUNTIME:-0}" == "1" ]]; then
  ASR_PROVIDER_NAME=local-parakeet
fi

if ! command -v tmux >/dev/null 2>&1; then
  echo "tmux is required. Run scripts/vast-h100/bootstrap-instance.sh first." >&2
  exit 1
fi

tmux has-session -t "$SESSION" 2>/dev/null && {
  echo "tmux session $SESSION already exists."
  echo "Attach with: tmux attach -t $SESSION"
  exit 0
}

tmux new-session -d -s "$SESSION" -n livekit "cd '$ROOT_DIR' && livekit-server --dev"
tmux new-window -t "$SESSION" -n token "cd '$ROOT_DIR' && TOKEN_SERVER_PORT=$TOKEN_PORT TOKEN_SERVER_HOST=127.0.0.1 LIVEKIT_URL=ws://127.0.0.1:7880 ENABLE_SIM_BRIDGE=0 npm run dev:token"
tmux new-window -t "$SESSION" -n moss "cd '$ROOT_DIR' && MOSS_RUNTIME_PORT=$MOSS_PORT MOSS_RUNTIME_PROVIDER=local-artifact MOSS_INDEX_PATH=$MOSS_INDEX_PATH_NAME npm run dev:moss-runtime"
if [[ "${ENABLE_LLM_RUNTIME:-0}" == "1" ]]; then
  tmux new-window -t "$SESSION" -n qwen "cd '$ROOT_DIR' && LLM_PORT=$LLM_PORT LLM_MODEL=$LLM_MODEL LLM_SERVED_MODEL_NAME=$LLM_MODEL_NAME LLM_MAX_MODEL_LEN=${LLM_MAX_MODEL_LEN:-8192} LLM_GPU_MEMORY_UTILIZATION=${LLM_GPU_MEMORY_UTILIZATION:-0.72} LLM_DTYPE=${LLM_DTYPE:-auto} LLM_QUANTIZATION=${LLM_QUANTIZATION:-} scripts/vast-h100/start-qwen-vllm.sh"
fi
if [[ "${ENABLE_ASR_RUNTIME:-0}" == "1" ]]; then
  tmux new-window -t "$SESSION" -n asr "cd '$ROOT_DIR' && ASR_PORT=$ASR_PORT ASR_MODEL=${ASR_MODEL:-nvidia/parakeet-tdt-0.6b-v3} npm run dev:asr:parakeet"
fi
if [[ "${ENABLE_TTS_RUNTIME:-0}" == "1" ]]; then
  if [[ "$TTS_RUNTIME" == "miso-one" ]]; then
    tmux new-window -t "$SESSION" -n tts "cd '$ROOT_DIR' && TTS_PORT=$TTS_PORT TTS_MODEL=${TTS_MODEL:-MisoLabs/MisoTTS} TTS_DTYPE=${TTS_DTYPE:-bfloat16} TTS_QUANTIZATION=$TTS_QUANTIZATION_NAME MISO_LORA_ADAPTER=${MISO_LORA_ADAPTER:-artifacts/miso-lora/adapters/miso-one-lora-dev} npm run dev:tts:miso-one"
  else
    tmux new-window -t "$SESSION" -n tts "cd '$ROOT_DIR' && TTS_PORT=$TTS_PORT TTS_MODEL=${TTS_MODEL:-microsoft/VibeVoice-Realtime-0.5B} TTS_DTYPE=${TTS_DTYPE:-bfloat16} TTS_QUANTIZATION=$TTS_QUANTIZATION_NAME npm run dev:tts:realtime"
  fi
fi
tmux new-window -t "$SESSION" -n agent "cd '$ROOT_DIR' && TOKEN_SERVER_URL=http://127.0.0.1:$TOKEN_PORT LIVEKIT_ROOM=$ROOM AGENT_MODE=$AGENT_MODE_NAME AGENT_TRANSPORT=livekit H100_PROOF_MODE=$PROOF_MODE AGENT_PLANNER=local-llm AGENT_PLANNER_FAIL_CLOSED=$PROOF_MODE LLM_PROVIDER=qwen-openai-local LLM_BASE_URL=http://127.0.0.1:$LLM_PORT/v1 LLM_MODEL=$LLM_MODEL_NAME ASR_PROVIDER=$ASR_PROVIDER_NAME ASR_BASE_URL=http://127.0.0.1:$ASR_PORT MOSS_PROVIDER=local-runtime-client MOSS_RUNTIME_URL=http://127.0.0.1:$MOSS_PORT TTS_PROVIDER=$TTS_PROVIDER_NAME TTS_BASE_URL=http://127.0.0.1:$TTS_PORT TTS_MODEL=${TTS_MODEL:-MisoLabs/MisoTTS} TTS_REAL_MODEL_PROOF=$PROOF_MODE TTS_DTYPE=${TTS_DTYPE:-bfloat16} TTS_QUANTIZATION=$TTS_QUANTIZATION_NAME TTS_CACHE_DIR=${TTS_CACHE_DIR:-artifacts/cache/tts} MISO_LORA_ADAPTER=${MISO_LORA_ADAPTER:-artifacts/miso-lora/adapters/miso-one-lora-dev} npm run dev:agent:livekit"
tmux new-window -t "$SESSION" -n lab "cd '$ROOT_DIR' && PORT=$LAB_PORT TOKEN_SERVER_URL=http://127.0.0.1:$TOKEN_PORT LIVEKIT_ROOM=$ROOM REQUIRE_LIVEKIT=$PROOF_MODE H100_PROOF_MODE=$PROOF_MODE npm run dev:lab"

echo "Started tmux session: $SESSION"
echo "Attach with: tmux attach -t $SESSION"
echo "Tunnel from your laptop:"
echo "  ssh -p <vast-ssh-port> root@<vast-host> -L $LAB_PORT:127.0.0.1:$LAB_PORT -L $TOKEN_PORT:127.0.0.1:$TOKEN_PORT -L 7880:127.0.0.1:7880 -L $LLM_PORT:127.0.0.1:$LLM_PORT -L $MOSS_PORT:127.0.0.1:$MOSS_PORT -L $ASR_PORT:127.0.0.1:$ASR_PORT -L $TTS_PORT:127.0.0.1:$TTS_PORT"
echo "Enable Qwen tmux pane with: ENABLE_LLM_RUNTIME=1 bash scripts/vast-h100/start-dev-stack.sh"
echo "Enable Parakeet ASR tmux pane with: ENABLE_ASR_RUNTIME=1 bash scripts/vast-h100/start-dev-stack.sh"
echo "Enable Miso One tmux pane with: ENABLE_TTS_RUNTIME=1 TTS_RUNTIME=miso-one bash scripts/vast-h100/start-dev-stack.sh"
echo "Enable legacy VibeVoice tmux pane with: ENABLE_TTS_RUNTIME=1 TTS_RUNTIME=vibevoice bash scripts/vast-h100/start-dev-stack.sh"
echo "Full H100 proof-mode stack: H100_PROOF_MODE=1 bash scripts/vast-h100/start-dev-stack.sh"
