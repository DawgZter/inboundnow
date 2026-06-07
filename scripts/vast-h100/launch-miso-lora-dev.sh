#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

MANIFEST="${MISO_LORA_MANIFEST:-configs/miso-lora/manifest.example.json}"
TRAIN_ENTRYPOINT="${MISO_LORA_TRAIN_ENTRYPOINT:-}"

node scripts/vast-h100/validate-miso-lora-manifest.mjs "$MANIFEST"

if [[ -z "$TRAIN_ENTRYPOINT" ]]; then
  cat >&2 <<'MSG'
MISO_LORA_TRAIN_ENTRYPOINT is required.

The public MisoTTS repo currently provides local inference/prompted-generation code,
not a committed upstream LoRA trainer. Point this variable at the local trainer you
are developing or evaluating, for example:

  MISO_LORA_TRAIN_ENTRYPOINT=experiments/train_miso_lora.py scripts/vast-h100/launch-miso-lora-dev.sh

The launcher will pass --manifest <path> and preserve the local-only consent manifest
as the run contract.
MSG
  exit 2
fi

if [[ ! -f "$TRAIN_ENTRYPOINT" ]]; then
  echo "Training entrypoint not found: $TRAIN_ENTRYPOINT" >&2
  exit 1
fi

if [[ ! -d .venv-miso-lora ]]; then
  echo ".venv-miso-lora is missing. Run scripts/vast-h100/setup-miso-lora-dev.sh first." >&2
  exit 1
fi

source .venv-miso-lora/bin/activate
accelerate launch "$TRAIN_ENTRYPOINT" --manifest "$MANIFEST" "$@"
