# Descartes: Local Models And Moss Boundary

Read-only report received during round 1. No files edited by the subagent.

## Recommended Next Slice

Implement adapter plumbing and local stubs without model downloads or secrets:

- Add an env-driven adapter registry under `apps/agent/adapters`.
- Keep the keyword router as deterministic fallback.
- Replace hardcoded adapter labels in `apps/agent/worker.mjs` with adapter
  health/status from the registry.
- Add smoke tests/scripts that prove adapter wiring, localhost-only guards, and
  Moss fixture retrieval.
- Do not claim real Parakeet/Qwen/VibeVoice/Moss runtime until local
  model/artifact calls are exercised.

## Proof Language

Current honest claim:

> InboundNow currently proves a local browser lab, local LiveKit-compatible token
> issuance, and a simulated browser-agent WebSocket bridge. ASR, LLM, TTS, and
> Moss are adapter boundaries, not verified local model/runtime proof yet.

After stubs:

> InboundNow has local-first adapter contracts and deterministic local stubs for
> Parakeet/Qwen/VibeVoice/Moss boundaries. These stubs prove wiring and
> guardrails only; they do not prove local ASR, local LLM reasoning, local TTS,
> or real Moss retrieval.

## Suggested Layout

```text
apps/agent/adapters/
  contracts.mjs
  registry.mjs
  asr/parakeet-stub.mjs
  llm/qwen-stub.mjs
  llm/qwen-openai-local.mjs
  tts/vibevoice-stub.mjs
  moss/local-fixture.mjs
  moss/local-runtime-client.mjs

apps/agent/scripts/
  smoke-adapters.mjs

services/moss-runtime/
  README.md
  server.mjs

services/model-stubs/
  qwen-openai-compatible.mjs

fixtures/moss/
  remote-snippets.json
```

## Stub Config

```bash
AGENT_MODE=local-stubs
ASR_PROVIDER=parakeet-stub
ASR_STUB_TRANSCRIPT="How does Remote help with global payroll?"
LLM_PROVIDER=qwen-stub
LLM_BASE_URL=http://127.0.0.1:4311/v1
LLM_MODEL=qwen-local-stub
TTS_PROVIDER=vibevoice-stub
TTS_STUB_MODE=manifest
MOSS_PROVIDER=local-fixture
MOSS_FIXTURE_PATH=fixtures/moss/remote-snippets.json
MOSS_ALLOW_NETWORK=0
```

## Boundary

`services/moss-runtime` should only query a prebuilt local artifact or fixture.
Runtime code should explicitly reject or avoid `autoRefresh`, SDK cloud polling,
`pushIndex()`, session doc uploads, and session embedding uploads.
