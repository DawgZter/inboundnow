# Local Adapter Boundaries

This document is the proof boundary for the local voice-agent harness.

## Current Proof

- LiveKit token shape: implemented by `services/token-server` with local `devkey` / `secret` defaults.
- Agent transport for the MVP: local LiveKit data channels are verified for control messages; the WebSocket bridge remains a simulated local fallback.
- Prospect question input: browser text input or simulated transcript button. Browser mic publication is configured, but ASR is not attached yet.
- Agent reasoning: deterministic local keyword router.
- Speech output: streamed browser `speechSynthesis` fallback chunks when available.
- Adapter plumbing: dependency-free local stubs and status reporting under
  `apps/agent/adapters`.
- Moss retrieval: local fixture retrieval from `fixtures/moss/remote-snippets.json`; local artifact retrieval is exercised by `npm run smoke:moss:local`.
- Browser action execution: `window.OpenClickyWeb.dispatch(...)` inside the proxied Remote page.

## GPU Requirement

Real local-model proof requires an H100-class GPU, not a laptop-only smoke. The recommended path is Vast.ai with the PyTorch CUDA/cuDNN template; see docs/vast-h100-runbook.md and scripts/vast-h100/.

## Parakeet ASR Adapter

Target model: `nvidia/parakeet-tdt-0.6b-v3`.

Responsibilities:

- Consume local LiveKit audio frames or local microphone audio.
- Produce partial/final English transcripts with timing/confidence metadata when available.
- Expose model health and latency.

The `parakeet-stub` adapter proves only registry wiring. It is not proven until
the model is loaded locally and transcripts are produced from actual audio.
Browser text input and `Send simulated transcript` are not Parakeet proof.

## Local LLM Adapter

Target runtime: local Qwen-class model behind a vLLM or SGLang OpenAI-compatible `/v1` API.

Responsibilities:

- Accept transcript, page snapshot, Moss snippets, and session state.
- Return answer text plus typed OpenClicky-Web actions.
- Avoid hosted model calls unless explicitly labeled as a fallback.

Current keyword routing and `qwen-stub` are simulated planners, not local LLM
proof. `qwen-openai-local` only becomes proof after a localhost vLLM/SGLang
completion is exercised and captured.

The worker only uses the local LLM planner when `AGENT_PLANNER=local-llm` and `LLM_PROVIDER=qwen-openai-local`. Planner JSON is parsed strictly and validated through `packages/action-protocol` before the answer or actions are sent; malformed JSON or invalid actions fall back to the deterministic router.

## VibeVoice-Style TTS Adapter

Target model: `microsoft/VibeVoice-Realtime-0.5B`, because the official VibeVoice docs describe it as the realtime streaming-input TTS variant. It is still a proof target, not current model proof.

Responsibilities:

- Turn agent answer text into local audio.
- Stream audio through a localhost-only VibeVoice-compatible endpoint.
- Stream browser fallback speech in short text chunks when model audio is unavailable.
- Prewarm the runtime before the first real answer.
- Use stable cache keys that include text, model, voice, and quantization policy.
- Report latency, cache-hit, dtype, quantization, and fallback state.

Latency controls:

- `TTS_TEXT_CHUNK_CHARS` / `VIBEVOICE_TEXT_CHUNK_CHARS`: max text chunk size for streaming speech events.
- `TTS_PREWARM_TEXT`: warmup text for the local endpoint.
- `TTS_CACHE_DIR`: local artifact cache for prompt/audio reuse.
- `TTS_DTYPE`: model dtype hint; default `bfloat16` for the H100 lane.
- `TTS_QUANTIZATION`: `none`, `llm-int8`, or `llm-int4`. The quantization policies intentionally target only the LLM trunk and preserve audio decoder precision to avoid unfair whole-model quantization quality loss.

Current verified behavior: the worker emits `agent.speech.start`, `agent.speech.chunk`, and `agent.speech.end` before actions, and the browser queues those chunks through `speechSynthesis`. This improves perceived latency but remains browser fallback speech.

`vibevoice-stub` and browser `speechSynthesis` are only demo fallbacks and
must not be described as VibeVoice proof.

`local-vibevoice` is configured only when `TTS_PROVIDER=local-vibevoice`; `TTS_BASE_URL` must point at localhost. `npm run smoke:tts:local` proves the streaming adapter contract against a fake local endpoint only. `npm run smoke:tts:h100` must pass against a real H100-local VibeVoice-compatible endpoint before changing this to model proof.

## Moss Runtime Adapter

Responsibilities:

- Query a prebuilt local Moss index/runtime artifact.
- Return source snippets for the agent planner.
- Avoid `autoRefresh`, cloud polling, `pushIndex()`, runtime document uploads, session document uploads, and session embedding uploads.

The `local-fixture` adapter proves only local retrieval wiring against a checked
in fixture. Real Moss proof requires querying a prebuilt local Moss artifact at
runtime without the forbidden cloud/upload behaviors.

Local artifact retrieval is not hosted Moss and not Moss SDK proof; it only proves querying a prebuilt local JSON retrieval artifact through the Moss adapter boundary.

## Stagehand Boundary

Stagehand belongs later as an offscreen resolver for selectors/actions. It should not execute the visible prospect-facing cursor, scroll, highlight, click, or Cal flow.
