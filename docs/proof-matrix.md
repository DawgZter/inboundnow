# Proof Matrix

This is the public source of truth for what InboundNow currently proves.

Status values:

- `verified`: exercised locally with a committed smoke, browser run, or test.
- `configured`: code path exists, but the full runtime proof has not been captured.
- `stub`: deterministic local stub proves wiring only.
- `not_proven`: target behavior is not yet proven.
- `forbidden`: behavior is intentionally out of bounds for this MVP.

| Subsystem | Status | Evidence | Boundary |
| --- | --- | --- | --- |
| OpenClicky-Web action bus | verified | `npm test`, browser smokes, `packages/action-protocol` | Widget owns visible cursor, scroll, highlight, click, and Cal UI. |
| Action protocol validation | verified | `test/action-protocol.test.mjs` | `payrollFlow` remains a lab macro until primitive actions replace it. |
| Cal confirmation gate | verified | Browser smoke on bridge and LiveKit paths | Cal iframe `src` is empty before confirmation and set only after `confirmBooking`. |
| LiveKit token/config/SDK asset | verified | `npm run smoke:local`, `npm run smoke:livekit` | Local dev JWTs only; not LiveKit Cloud. |
| Token server security guardrails | verified | `test/token-server.test.mjs` | Loopback-only host/LiveKit URL, hostile CORS rejection, bridge disable, JWT claims/signature, and bridge payload cap. |
| LiveKit room/data-channel control | verified | `npm run smoke:livekit`, browser LiveKit smoke with `ENABLE_SIM_BRIDGE=0` | Proves control/data messages, not ASR or TTS. |
| Browser LiveKit connection | verified | Browser smoke on `http://127.0.0.1:4193/direct` with bridge disabled | Browser joined local room and received `agent.action` over LiveKit. |
| Browser mic publication | configured | `connectLiveKitRoom()` requests mic after `Connect local transport` | Mic publication is not ASR proof; permission behavior varies by browser. |
| WebSocket fallback bridge | verified | `npm run smoke:local` | Simulated fallback for local dev only; not the target transport. |
| Parakeet ASR | not_proven | `apps/agent/adapters/asr/parakeet-stub.mjs` | Stub only; no audio frames transcribed by `nvidia/parakeet-tdt-0.6b-v3`. |
| Qwen local LLM | not_proven | `qwen-stub`, `qwen-openai-local` adapter | Local OpenAI-compatible endpoint support exists; real vLLM/SGLang completion not captured. |
| LLM planner JSON validation | verified | `test/llm-planner.test.mjs`, `npm run smoke:planner` | Proves strict JSON/action validation and deterministic fallback against a local stub, not real Qwen reasoning. |
| Browser streamed speech fallback | verified | `npm run smoke:local`, `npm run smoke:livekit` | Worker emits `agent.speech.start/chunk/end`; browser queues chunks through `speechSynthesis`. This is streamed fallback speech, not VibeVoice model proof. |
| Dynamic voice switching | verified | `test/voice-session.test.mjs`, `npm run smoke:voice:switching` | Per-session voice profile changes propagate over bridge/agent messages and streamed speech metadata; browser fallback voice/rate/pitch changes are not model-audio proof. |
| Local VibeVoice TTS adapter contract | configured | `npm run smoke:tts:local`, `apps/agent/adapters/tts/local-vibevoice.mjs` | Localhost-only VibeVoice-compatible endpoint boundary with prewarm, cache key, dtype, and LLM-only quantization metadata. Fake endpoint smoke is not model proof. |
| VibeVoice model audio | not_proven | `scripts/vast-h100/smoke-vibevoice-endpoint.mjs` | Requires an H100-local `microsoft/VibeVoice-Realtime-0.5B` compatible endpoint plus browser proof before claiming real audio. |
| Miso One LoRA development lane | configured | `docs/miso-lora-runbook.md`, `configs/miso-lora/manifest.example.json`, `packages/miso-lora` | Manifest validation, H100 setup, launch wrapper, and runtime metadata only. No trained LoRA adapter or generated Miso One audio is proven. |
| Moss fixture retrieval | verified | `npm run smoke:adapters`, `npm run smoke:local`, `npm run smoke:livekit` | Fixture retrieval proves wiring, not local artifact or hosted Moss runtime proof. |
| Local retrieval artifact through Moss boundary | verified | `npm run smoke:moss:local` | Queries a prebuilt local JSON artifact through the local runtime/client path; not hosted Moss or Moss SDK proof. Runtime must not use `autoRefresh`, cloud polling, `pushIndex()`, runtime/session document upload, or session embedding upload. |
| Remote.com scrape corpus retrieval | verified | `npm run moss:index:remote`, `npm run smoke:moss:remote` | Indexes the partial 2026-06-07 Remote.com scrape corpus into a local artifact and queries it through the local Moss runtime/client path. Not hosted Moss or Moss SDK runtime proof; raw fetch payloads are omitted from git. |
| Vast.ai H100 local-model lane | configured | docs/vast-h100-runbook.md, scripts/vast-h100/ | Requires H100 preflight plus Qwen/ASR/TTS smokes before any real-model claim. |
| Hosted Moss runtime behavior | forbidden | README hard constraint | No hosted runtime behavior in local MVP. |
| Production native desktop control | forbidden | README hard constraint | Production visitors must be browser-native. |
| Stagehand execution | forbidden for MVP | README hard constraint | Stagehand may resolve selectors later but must not execute visible UI. |

## Latest Evidence

- `npm run smoke:local` passed at `artifacts/smoke/2026-06-07T10-19-09-706Z/result.json`, including `streamedSpeechEvents: true`.
- `npm run smoke:livekit` passed with `bridgeDisabled: true` at `artifacts/smoke/livekit-2026-06-07T09-37-34-190Z/result.json`, including `dataChannelSpeechStream: true`.
- `npm test` passed 43 tests, including token-server security guardrails, local retrieval artifact queries, Remote.com scrape parsing/querying, speech chunking/cache/style/LoRA guardrails, voice-session routing, Miso LoRA manifest validation, local VibeVoice localhost guards, and LLM planner fallback cases.
- `npm run smoke:planner` passed against a temporary local Qwen-compatible stub, proving strict planner JSON parsing and validated action dispatch without real Qwen proof.
- `npm run smoke:moss:local` passed at `artifacts/smoke/moss-local-2026-06-07T09-55-22-728Z/result.json`, proving `provider: local-artifact`, `localOnly: true`, `simulated: false`, local runtime health, direct runtime query, and agent `local-runtime-client` query against a deterministic local artifact.
- `npm run smoke:moss:remote` passed at `artifacts/smoke/moss-remote-2026-06-07T09-55-55-424Z/result.json`, proving a 10,842-document Remote.com scrape corpus local artifact, local runtime health, direct runtime query, and agent `local-runtime-client` query.
- `npm run smoke:tts:local` passed at `artifacts/smoke/tts-streaming-2026-06-07T10-18-08-254Z/result.json`, proving the localhost streaming TTS adapter contract, prewarm call, stable cache key, `style`, `loraAdapter`, `bfloat16`, and `llm-int8` LLM-only quantization metadata against a fake local endpoint only.
- `npm run smoke:voice:switching` passed at `artifacts/smoke/voice-switching-2026-06-07T10-18-08-772Z/result.json`, proving a per-session switch to `warm`, streamed speech voice metadata, and warm-profile persistence on the next bridge turn.
- `npm run miso:lora:validate` passed at `artifacts/miso-lora/validation/miso-one-lora-dev.validation.json`, proving the checked-in Miso One LoRA manifest satisfies local-only consent and path guardrails.
- Browser planner smoke passed on June 7, 2026 with `AGENT_PLANNER=local-llm`, local Qwen-compatible stub, and bridge disabled: the proof line showed `Planner local-llm-json via qwen-openai-local`, booking prompt opened, and Cal stayed unloaded before confirmation.
- Browser LiveKit smoke passed on June 7, 2026: `Connect local transport` joined local LiveKit with `ENABLE_SIM_BRIDGE=0`, `Ask agent` received a LiveKit `agent.action`, the page scrolled/highlighted, Cal stayed unloaded before confirmation, and Cal opened after confirmation.
