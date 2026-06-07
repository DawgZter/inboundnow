#!/usr/bin/env bash
set -euo pipefail

if ! command -v vastai >/dev/null 2>&1; then
  echo "vastai CLI is not installed. Install with: pip install vastai" >&2
  exit 1
fi

: "${OFFER_ID:?Set OFFER_ID to the Vast.ai offer ID returned by search-offers.sh}"

DISK_GB=${DISK_GB:-180}
PYTORCH_IMAGE=${PYTORCH_IMAGE:-pytorch/pytorch:2.4.0-cuda12.4-cudnn9-runtime}
PYTORCH_TEMPLATE_HASH=${PYTORCH_TEMPLATE_HASH:-661d064bbda1f2a133816b6d55da07c3}
USE_TEMPLATE_HASH=${USE_TEMPLATE_HASH:-1}

if [[ "$USE_TEMPLATE_HASH" == "1" ]]; then
  echo "Creating instance from the Vast PyTorch cuDNN Devel template hash."
  echo "If Vast changes the template, select the PyTorch template in the UI instead."
  vastai create instance "$OFFER_ID" \
    --template_hash "$PYTORCH_TEMPLATE_HASH" \
    --disk "$DISK_GB"
else
  echo "Creating instance from image: $PYTORCH_IMAGE"
  vastai create instance "$OFFER_ID" \
    --image "$PYTORCH_IMAGE" \
    --disk "$DISK_GB" \
    --ssh \
    --direct \
    --onstart-cmd "nvidia-smi && mkdir -p /workspace/inboundnow"
fi
