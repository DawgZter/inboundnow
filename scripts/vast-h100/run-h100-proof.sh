#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

timestamp="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
RUN_DIR="${H100_PROOF_RUN_DIR:-artifacts/smoke/h100-proof-run-$timestamp}"
LOG_DIR="$RUN_DIR/logs"
SESSION="${TMUX_SESSION:-inboundnow-h100}"
mkdir -p "$LOG_DIR"

log() {
  printf '[h100-proof] %s\n' "$*"
}

fail() {
  printf '[h100-proof] ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required. Run scripts/vast-h100/bootstrap-instance.sh first."
}

run_logged() {
  local name="$1"
  shift
  log "$name: $*"
  "$@" 2>&1 | tee "$LOG_DIR/$name.log"
}

if [[ "${ALLOW_NON_H100:-0}" != "1" ]]; then
  require_command nvidia-smi
  gpu_line="$(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader | head -n 1)"
  [[ "$gpu_line" == *H100* ]] || fail "expected an H100 GPU; detected: $gpu_line"
  log "GPU: $gpu_line"
fi

require_command node
require_command npm
require_command tmux
require_command ffmpeg
require_command livekit-server

free_kb="$(df -Pk . | awk 'NR==2 {print $4}')"
min_kb="${H100_MIN_FREE_DISK_KB:-62914560}"
if [[ -n "$free_kb" && "$free_kb" -lt "$min_kb" ]]; then
  fail "low free disk: ${free_kb}KB available; set H100_MIN_FREE_DISK_KB to override"
fi

if [[ ! -d node_modules ]]; then
  run_logged npm-ci npm ci
fi

if [[ ! -d .venv-h100 ]]; then
  if [[ "${H100_RUN_BOOTSTRAP:-0}" == "1" ]]; then
    run_logged bootstrap bash scripts/vast-h100/bootstrap-instance.sh
  else
    fail ".venv-h100 is missing. Run bash scripts/vast-h100/bootstrap-instance.sh or set H100_RUN_BOOTSTRAP=1."
  fi
fi

if [[ ! -d .venv-miso-lora ]]; then
  if [[ "${H100_RUN_MISO_SETUP:-0}" == "1" ]]; then
    run_logged miso-setup bash scripts/vast-h100/setup-miso-lora-dev.sh
  else
    fail ".venv-miso-lora is missing. Run bash scripts/vast-h100/setup-miso-lora-dev.sh or set H100_RUN_MISO_SETUP=1."
  fi
fi

if [[ "${H100_PROOF_INSTALL_PLAYWRIGHT:-0}" == "1" ]]; then
  run_logged playwright-install npx playwright install chromium
fi

if [[ "${H100_PROOF_RESTART:-1}" == "1" ]]; then
  tmux kill-session -t "$SESSION" >/dev/null 2>&1 || true
fi

if [[ "${H100_PROOF_SKIP_STACK:-0}" != "1" ]]; then
  run_logged start-stack env H100_PROOF_MODE=1 TMUX_SESSION="$SESSION" bash scripts/vast-h100/start-dev-stack.sh
fi

if [[ -z "${SMOKE_TARGET_URL:-}" && "${ALLOW_FIXTURE_TARGET:-0}" != "1" ]]; then
  export SMOKE_TARGET_URL="https://remote.com/"
  export ALLOW_REMOTE_TARGET="${ALLOW_REMOTE_TARGET:-1}"
  log "Using Remote.com as browser proof target via the local website lab proxy."
elif [[ "${ALLOW_FIXTURE_TARGET:-0}" == "1" ]]; then
  log "ALLOW_FIXTURE_TARGET=1: browser proof may use the local toy target."
fi

preflight_attempts="${H100_PREFLIGHT_ATTEMPTS:-60}"
preflight_sleep="${H100_PREFLIGHT_SLEEP_SECONDS:-10}"
for attempt in $(seq 1 "$preflight_attempts"); do
  log "preflight attempt $attempt/$preflight_attempts"
  if H100_PROOF_MODE=1 npm run h100:preflight >"$LOG_DIR/preflight-$attempt.log" 2>&1; then
    cp "$LOG_DIR/preflight-$attempt.log" "$RUN_DIR/preflight.log"
    break
  fi
  if [[ "$attempt" == "$preflight_attempts" ]]; then
    tail -120 "$LOG_DIR/preflight-$attempt.log" >&2 || true
    fail "stack preflight did not pass"
  fi
  sleep "$preflight_sleep"
done

if [[ "${REQUIRE_MANUAL_MIC:-0}" != "1" && -z "${ASR_SMOKE_AUDIO_PATH:-}" && -z "${BROWSER_MIC_AUDIO_PATH:-}" ]]; then
  if [[ "${H100_GENERATE_PROOF_AUDIO:-1}" == "1" ]]; then
    export PROOF_AUDIO_PATH="$RUN_DIR/global-payroll.wav"
    run_logged proof-audio npm run h100:proof-audio
    export ASR_SMOKE_AUDIO_PATH="$PROOF_AUDIO_PATH"
    export BROWSER_MIC_AUDIO_PATH="$PROOF_AUDIO_PATH"
    export ASR_EXPECTED_PATTERN="${ASR_EXPECTED_PATTERN:-Remote|payroll|global}"
  else
    fail "ASR_SMOKE_AUDIO_PATH or BROWSER_MIC_AUDIO_PATH is required unless REQUIRE_MANUAL_MIC=1."
  fi
fi

run_logged proof-suite env \
  H100_PROOF_MODE=1 \
  SMOKE_TARGET_URL="${SMOKE_TARGET_URL:-}" \
  ALLOW_REMOTE_TARGET="${ALLOW_REMOTE_TARGET:-0}" \
  ASR_SMOKE_AUDIO_PATH="${ASR_SMOKE_AUDIO_PATH:-}" \
  BROWSER_MIC_AUDIO_PATH="${BROWSER_MIC_AUDIO_PATH:-}" \
  ASR_EXPECTED_PATTERN="${ASR_EXPECTED_PATTERN:-Remote|payroll|global}" \
  npm run smoke:h100:proof-suite

latest_manifest="$(find artifacts/smoke -path '*/manifest.json' -type f -print0 | xargs -0 ls -t 2>/dev/null | head -n 1 || true)"
if [[ -n "$latest_manifest" ]]; then
  cp "$latest_manifest" "$RUN_DIR/proof-suite-manifest.json"
fi

cat >"$RUN_DIR/summary.json" <<JSON
{
  "ok": true,
  "createdAt": "$timestamp",
  "session": "$SESSION",
  "target": "${SMOKE_TARGET_URL:-fixture}",
  "manualMic": "${REQUIRE_MANUAL_MIC:-0}",
  "runDir": "$RUN_DIR",
  "proofSuiteManifest": "${latest_manifest:-}"
}
JSON

log "done: $RUN_DIR"
