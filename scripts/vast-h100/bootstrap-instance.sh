#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

if ! command -v nvidia-smi >/dev/null 2>&1; then
  echo "nvidia-smi is missing. Use a Vast.ai GPU instance with the PyTorch template." >&2
  exit 1
fi

GPU_LINE="$(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader | head -n 1)"
if [[ "$GPU_LINE" != *H100* ]]; then
  echo "This lane requires an H100. Detected: $GPU_LINE" >&2
  exit 1
fi

echo "Detected H100: $GPU_LINE"
echo "Installing OS packages, Node.js, LiveKit server, repo dependencies, and GPU Python deps."

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  build-essential \
  ca-certificates \
  curl \
  ffmpeg \
  git \
  git-lfs \
  jq \
  python3-venv \
  rsync \
  tmux

if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'Number(process.versions.node.split(".")[0])')" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

if ! command -v livekit-server >/dev/null 2>&1; then
  curl -sSL https://get.livekit.io | bash
fi

npm ci

python3 -m venv .venv-h100
source .venv-h100/bin/activate
python -m pip install --upgrade pip wheel setuptools
python -m pip install \
  "huggingface_hub[cli]>=0.26" \
  "openai>=1.51" \
  "vllm>=0.6.6"

echo
echo "Bootstrap complete."
echo "Next:"
echo "  source .venv-h100/bin/activate"
echo "  huggingface-cli login   # if the selected models require it"
echo "  scripts/vast-h100/start-qwen-vllm.sh"
echo "  scripts/vast-h100/start-dev-stack.sh"
