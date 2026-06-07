# Orchestration: InboundNow local-first voice SDR MVP

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If LiveKit server is unavailable, keep simulated bridge tests green and mark
  LiveKit transport proof incomplete.
- If local ASR/LLM/TTS runtimes are unavailable, land adapter contracts, setup
  scripts, and proof-matrix entries instead of claiming runtime proof.
- If a browser smoke fails, fix the app or narrow the claim before committing
  evidence.
- If a subagent report conflicts with source code or runtime evidence, inspect
  current code/runtime as authoritative.

## Packet Prompts

Round 1 subagents:

- Confucius: LiveKit browser/agent integration plan.
- Averroes: action protocol and regression test design.
- Descartes: local models and Moss runtime boundary plan.
- Hilbert: E2E verification and review plan.

Round 9 subagents:

- Godel: audit the Vast H100 one-command runtime/proof path for local stack
  bringup, process orchestration, env validation, and artifact collection.
- Noether: audit the non-scripted planner path and identify where
  deterministic demo macros still sit on the H100 success path.
- Carver: audit real model proof gates for local Parakeet, Qwen, Moss, and
  Miso One/MisoTTS LoRA streaming evidence.

## Completion Audit

Completion requires current evidence for every deliverable in `plan.md`.
Partial adapter scaffolds, green syntax checks, or simulated bridge success do
not prove the full goal. Keep the goal active until the clean local run proves
the full voice/data/retrieval/action/Cal path.
