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
LLM_MODEL_NAME=${LLM_SERVED_MODEL_NAME:-qwen-local}

echo "Building local Moss retrieval artifact..."
npm run moss:index

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
tmux new-window -t "$SESSION" -n moss "cd '$ROOT_DIR' && MOSS_RUNTIME_PORT=$MOSS_PORT MOSS_RUNTIME_PROVIDER=local-artifact npm run dev:moss-runtime"
tmux new-window -t "$SESSION" -n agent "cd '$ROOT_DIR' && TOKEN_SERVER_URL=http://127.0.0.1:$TOKEN_PORT LIVEKIT_ROOM=$ROOM AGENT_TRANSPORT=livekit AGENT_PLANNER=local-llm LLM_PROVIDER=qwen-openai-local LLM_BASE_URL=http://127.0.0.1:$LLM_PORT/v1 LLM_MODEL=$LLM_MODEL_NAME MOSS_PROVIDER=local-runtime-client MOSS_RUNTIME_URL=http://127.0.0.1:$MOSS_PORT npm run dev:agent:livekit"
tmux new-window -t "$SESSION" -n lab "cd '$ROOT_DIR' && PORT=$LAB_PORT TOKEN_SERVER_URL=http://127.0.0.1:$TOKEN_PORT LIVEKIT_ROOM=$ROOM npm run dev:lab"

echo "Started tmux session: $SESSION"
echo "Attach with: tmux attach -t $SESSION"
echo "Tunnel from your laptop:"
echo "  ssh -p <vast-ssh-port> root@<vast-host> -L $LAB_PORT:127.0.0.1:$LAB_PORT -L $TOKEN_PORT:127.0.0.1:$TOKEN_PORT -L 7880:127.0.0.1:7880 -L $LLM_PORT:127.0.0.1:$LLM_PORT -L $MOSS_PORT:127.0.0.1:$MOSS_PORT"
