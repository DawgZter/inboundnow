#!/usr/bin/env bash
set -euo pipefail

if ! command -v vastai >/dev/null 2>&1; then
  echo "vastai CLI is not installed. Install with: pip install vastai" >&2
  exit 1
fi

QUERY=${VAST_QUERY:-'gpu_name in ["H100_SXM", "H100_PCIE", "H100_NVL"] num_gpus=1 verified=true rentable=true rented=false direct_port_count>=1 gpu_ram>=70000'}
ORDER=${VAST_ORDER:-'dlperf_usd-'}

echo "Searching Vast.ai offers with:"
echo "  $QUERY"
echo "Order: $ORDER"
echo
vastai search offers "$QUERY" -o "$ORDER"
