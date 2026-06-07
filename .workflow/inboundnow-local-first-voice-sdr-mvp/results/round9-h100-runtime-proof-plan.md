# Round 9: H100 runtime proof path

## Goal

Move the project from local contract smokes toward a real Vast.ai H100 proof
run for the all-local browser voice persona.

## Success Criteria For This Round

- The repo makes the real H100 bringup path more executable, preferably through
  a single local command or a clearer supervisor/runbook split.
- The path validates local-only endpoints for LiveKit, Moss, Parakeet, Qwen,
  and Miso One/MisoTTS before blessing a proof run.
- The proof suite keeps rejecting dry runs, fake endpoints, deterministic demo
  fallbacks, and weak browser mic evidence as completion proof.
- Any committed docs distinguish sanitized manifests and hashes from raw mic
  audio, token-bearing logs, traces, or bulky artifacts.

## Delegated Packets

- Godel (019ea2fd-aaf7-7f33-96fa-cb56a31c6b38): H100 one-command runtime and
  proof path audit.
- Noether (019ea2fd-ad45-7801-bee5-fa0bc59ab31a): non-scripted planner path
  audit.
- Carver (019ea2fd-afe5-73b3-9f45-0ed1547f7280): real model proof-gate audit.

## Local Implementation Lane

Inspect the current H100 scripts and implement the narrowest slice that makes
the real run easier to execute or harder to mis-report. Keep code changes local
to the runtime/proof path unless subagent findings point to a sharper blocker.

## Subagent Findings Integrated

- Godel found that the H100 proof gates are stricter than the launch path:
  Miso setup is not guaranteed by bootstrap, services have no readiness gate,
  required audio inputs are placeholders, browser proof can still fall back to a
  toy fixture target, and proof artifacts are scattered across ignored folders.
- Noether found that the H100 script path already forces local-LLM planning and
  fail-closed proof behavior, but normal verified or real agent modes still
  defaulted to deterministic planning unless env flags opted in.
- Carver found that base Miso audio proof and cloned LoRA proof must remain
  separate: the current Miso wrapper honestly reports no LoRA runtime loader,
  so clone proof must fail until loraRuntimeSupported and loraAdapterApplied are
  real endpoint evidence.

## Changes Landed

- Added an H100 stack preflight command that checks local endpoints, H100 GPU
  identity, LiveKit TCP readiness, token server bridge state, local Moss
  runtime health, Qwen models, Parakeet health, Miso One health, and the lab.
- Made the H100 proof suite run that preflight as its first real step.
- Made verified, real, and H100 proof agent modes default to local-LLM planner
  mode instead of the deterministic router unless explicitly overridden.
- Documented the preflight command in the Vast H100 runbook.

## Verification

- Targeted syntax checks for touched scripts.
- Targeted dry-run proof-suite or env validation when available.
- git diff --check.
- Clean commit metadata check before committing.
