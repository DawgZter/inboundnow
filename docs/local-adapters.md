# Local Adapter Boundaries

This document is the proof boundary for the local voice-agent harness.

## Current Proof

- LiveKit token shape: implemented by `services/token-server` with local `devkey` / `secret` defaults.
- Agent transport for the MVP: local LiveKit data channels are verified for control messages; the WebSocket bridge remains a simulated local fallback.
- Prospect question input: browser text input, simulated final transcript messages, and local ASR audio payload messages. Browser mic publication is configured; turn-based LiveKit audio buffering is wired, but real Parakeet model transcription still requires the H100 endpoint proof.
- Agent reasoning: deterministic local keyword router by default; fail-closed local Qwen 3.6 27B planning is the H100 proof target.
- Speech output: streamed browser `speechSynthesis` fallback chunks when model audio is unavailable; caption-only `agent.speech.*` plus `agent.tts.*` PCM16 audio chunks when a local model-audio path such as Miso One is enabled.
- Voice switching: browser, bridge, and LiveKit messages carry a per-session voice profile; typed commands such as "switch to a warmer voice" update the session voice without restarting.
- Adapter plumbing: dependency-free local stubs and status reporting under
  `apps/agent/adapters`.
- Moss retrieval: local fixture retrieval from `fixtures/moss/remote-snippets.json`; local artifact retrieval is exercised by `npm run smoke:moss:local`; the partial Remote.com scrape corpus can be built with `npm run moss:index:remote`, smoked through the local runtime with `npm run smoke:moss:remote`, and smoked through a LiveKit agent turn with `npm run smoke:livekit:moss-remote`.
- Browser action execution: `window.OpenClickyWeb.dispatch(...)` inside the proxied Remote page.

## GPU Requirement

Real local-model proof requires an H100-class GPU, not a laptop-only smoke. The recommended path is Vast.ai with the PyTorch CUDA/cuDNN template; see docs/vast-h100-runbook.md and scripts/vast-h100/.

## Parakeet ASR Adapter

Target model: `nvidia/parakeet-tdt-0.6b-v3`.

The model card describes Parakeet v3 as a 600M-parameter multilingual ASR model. The MVP remains English-first, but the model itself supports more languages; use `ASR_LANGUAGE=en` unless deliberately testing another language.

Responsibilities:

- Consume local LiveKit audio frames or local microphone audio.
- Produce partial/final English transcripts with timing/confidence metadata when available.
- Expose model health and latency.
- Keep endpoint calls localhost-only through `ASR_BASE_URL`, `ASR_HEALTH_PATH`, and `ASR_TRANSCRIBE_PATH` validation.
- Accept explicit `prospect.transcript.final` messages as a transcript fallback without calling that Parakeet proof.

The `parakeet-stub` adapter proves only registry wiring. `local-parakeet` proves only a localhost adapter contract until the model is loaded locally and transcripts are produced from actual audio. Browser text input, `Send simulated transcript`, and fake endpoint smokes are not Parakeet model proof.

Local proof commands:

- `npm run smoke:asr:local` validates transcript-final turns and a fake localhost Parakeet-compatible endpoint.
- `npm run smoke:asr:h100` requires `ASR_SMOKE_AUDIO_PATH` and a real H100-local Parakeet endpoint before it can pass.

## Local LLM Adapter

Target runtime: local Qwen 3.6 27B behind a vLLM or SGLang OpenAI-compatible `/v1` API.

Responsibilities:

- Accept transcript, page snapshot, Moss snippets, and session state.
- Return answer text plus typed OpenClicky-Web actions.
- Avoid hosted model calls unless explicitly labeled as a fallback.

Current keyword routing and `qwen-stub` are simulated planners, not local LLM
proof. `qwen-openai-local` only becomes proof after a localhost vLLM/SGLang
completion is exercised and captured.

The worker only uses the local LLM planner when `AGENT_PLANNER=local-llm` and `LLM_PROVIDER=qwen-openai-local`. Planner JSON is parsed strictly and validated through `packages/action-protocol` before the answer or actions are sent. Deprecated demo macros are rejected. Malformed JSON or invalid actions fall back to the deterministic router unless `AGENT_PLANNER_FAIL_CLOSED=1` or `H100_PROOF_MODE=1` is set.

## Local Model-Audio TTS Adapter

Primary target model: `MisoLabs/MisoTTS` through `TTS_PROVIDER=local-miso-one`. The cloned-voice path is a consented LoRA adapter artifact, not in-context voice prompt cloning. Legacy VibeVoice remains available through `TTS_PROVIDER=local-vibevoice` for older compatibility smokes.

Responsibilities:

- Turn agent answer text into local audio.
- Stream audio through a localhost-only model endpoint.
- Stream browser fallback speech in short text chunks when model audio is unavailable.
- Emit `agent.tts.start`, `agent.tts.chunk`, and `agent.tts.end` audio events when `TTS_PROVIDER=local-miso-one` or `TTS_PROVIDER=local-vibevoice` and model audio is enabled.
- Prewarm the runtime before the first real answer.
- Use stable cache keys that include text, model, voice, style, LoRA adapter, and quantization policy.
- Report latency, cache-hit, dtype, quantization, and fallback state.

Latency controls:

- `TTS_TEXT_CHUNK_CHARS` / `VIBEVOICE_TEXT_CHUNK_CHARS`: max text chunk size for streaming speech events.
- `TTS_PREWARM_TEXT`: warmup text for the local endpoint.
- `TTS_CACHE_DIR`: local artifact cache for prompt/audio reuse.
- `TTS_DTYPE`: model dtype hint; default `bfloat16` for the H100 lane.
- `TTS_QUANTIZATION`: `none`, `llm-int8`, or `llm-int4`. For compatible endpoints that support it, quantization policies intentionally target only the LLM trunk and preserve audio decoder precision to avoid unfair whole-model quantization quality loss. The current public MisoTTS wrapper defaults to `none` and reports Miso quantization as unsupported until a real implementation exists.
- `TTS_VOICE_STYLE`: voice style hint included in the local endpoint payload and cache key.
- `TTS_LORA_ADAPTER` / `MISO_LORA_ADAPTER`: local adapter path included in the endpoint payload and cache key.

Current verified behavior:

- Without model audio, the worker emits `agent.speech.start`, `agent.speech.chunk`, and `agent.speech.end`; the browser queues chunks through `speechSynthesis`.
- With `local-miso-one` or `local-vibevoice` model audio enabled, the worker emits caption-only `agent.speech.*` immediately, starts a local model-audio stream in parallel, and emits `agent.tts.start/chunk/end` with base64 PCM16 chunks.
- Browser actions are allowed to overlap pending or playing model audio for latency. The action bus must not wait for a slow prewarm or first audio chunk.
- The browser suppresses duplicate `speechSynthesis` while model audio is active, schedules PCM16 chunks with Web Audio, buffers out-of-order chunks until the missing sequence arrives, ignores duplicate chunks, and ignores stale chunks after interruption.
- Fake endpoint smokes are `proofLevel: contract` and must keep model-proof flags false. Set `TTS_REAL_MODEL_PROOF=1` only in an H100 evidence run that is explicitly being captured as real model proof, and pair it with endpoint health plus browser playback evidence.

`vibevoice-stub` and browser `speechSynthesis` are only demo fallbacks and
must not be described as VibeVoice proof.

`local-miso-one` is configured with `TTS_PROVIDER=local-miso-one`; `TTS_BASE_URL` must point at localhost. `npm run smoke:tts:miso-one` or `npm run smoke:tts:h100` must pass against a real H100-local Miso endpoint before calling it generated-audio proof. `MISO_REQUIRE_LORA=1` is a fail-closed clone-proof gate until a real MisoTTS LoRA loader exists; cloned-voice proof requires applied-adapter evidence such as `loraAdapterApplied: true`. `local-vibevoice` and `npm run smoke:tts:vibevoice` remain legacy compatibility proof only.

## Dynamic Voice Session Adapter

The shared voice profile registry lives in `packages/voice-session`. It supports:

- default, warm, calm, and bright browser/TTS profiles.
- `miso_lora_dev`, a configured Miso One LoRA development profile for `MisoLabs/MisoTTS`.
- in-session voice switching based on user language such as "switch to a warmer voice" or "use Miso One".
- per-session persistence in the worker keyed by `sessionId`, sender identity, or fallback default.

`npm run smoke:voice:switching` proves the bridge path can switch to `warm`, stream speech metadata with that voice, and keep it for the next question. This remains metadata/browser fallback proof until real TTS audio is attached.

## Miso One LoRA Development Adapter

The Miso lane is development support, not voice-clone proof. See `docs/miso-lora-runbook.md`.

Current configured pieces:

- `configs/miso-lora/manifest.example.json`
- `packages/miso-lora` manifest validator
- `scripts/vast-h100/setup-miso-lora-dev.sh`
- `scripts/vast-h100/launch-miso-lora-dev.sh`
- `scripts/vast-h100/start-miso-one-tts.sh` and `scripts/vast-h100/miso-one-tts-server.py`
- `scripts/vast-h100/smoke-miso-one-endpoint.mjs`
- `miso_lora_dev` voice profile metadata

The manifest requires explicit consent, `localOnly: true`, `syntheticImpersonationAllowed: false`, and local filesystem paths. The launcher requires an explicit `MISO_LORA_TRAIN_ENTRYPOINT` because no MisoTTS LoRA trainer is proven in this repo yet.

## Moss Runtime Adapter

Responsibilities:

- Query a prebuilt local Moss index/runtime artifact.
- Return source snippets for the agent planner.
- Avoid `autoRefresh`, cloud polling, `pushIndex()`, runtime document uploads, session document uploads, and session embedding uploads.

The `local-fixture` adapter proves only local retrieval wiring against a checked
in fixture. Real Moss proof requires querying a prebuilt local Moss artifact at
runtime without the forbidden cloud/upload behaviors.

Local artifact retrieval is not hosted Moss and not Moss SDK proof; it only proves querying a prebuilt local JSON retrieval artifact through the Moss adapter boundary.

queryLocalIndex scores over the full local document text but returns bounded query-centered excerpts with source metadata, original document length, matched tokens, and excerpted status. Agent messages preserve localOnly and artifact metadata so browser/LiveKit evidence can prove the runtime boundary without shipping full page bodies.

The imported Remote.com scrape corpus lives under `data/remote-com/scrape-2026-06-07`. It is partial and locale-heavy: 10,842 completed pages were imported from the source artifact, while 31,343 selected URLs remained unfinished. The parser converts `pages/**/*.md` plus `*.metadata.json` into Moss-style `{id,title,url,text,tags,metadata}` records; raw fetch payloads and Firecrawl job records are intentionally omitted from git.

To hand the corpus to hosted Moss, run `npm run moss:docs:remote`, configure the official Moss CLI with `moss init`, then run `npm run moss:upload:remote`. That hosted upload path is index-generation proof only; runtime use for this MVP still loads local artifacts and must remain free of forbidden cloud polling/upload behavior.

## Stagehand Boundary

Stagehand belongs later as an offscreen resolver for selectors/actions. It should not execute the visible prospect-facing cursor, scroll, highlight, click, or Cal flow.
