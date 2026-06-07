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
| LiveKit room/data-channel control | verified | `npm run smoke:livekit`, browser LiveKit smoke with `ENABLE_SIM_BRIDGE=0` | Proves control/data messages, not ASR or TTS. |
| Browser LiveKit connection | verified | Browser smoke on `http://127.0.0.1:4193/direct` with bridge disabled | Browser joined local room and received `agent.action` over LiveKit. |
| Browser mic publication | configured | `connectLiveKitRoom()` requests mic after `Connect` | Mic publication is not ASR proof; permission behavior varies by browser. |
| WebSocket fallback bridge | verified simulated | `npm run smoke:local` | Fallback for local dev only; not the target transport. |
| Parakeet ASR | not_proven | `apps/agent/adapters/asr/parakeet-stub.mjs` | Stub only; no audio frames transcribed by `nvidia/parakeet-tdt-0.6b-v3`. |
| Qwen local LLM | not_proven | `qwen-stub`, `qwen-openai-local` adapter | Local OpenAI-compatible endpoint support exists; real vLLM/SGLang completion not captured. |
| VibeVoice-style TTS | not_proven | `vibevoice-stub`, browser speech fallback | Browser `speechSynthesis` is fallback only. |
| Moss fixture retrieval | verified stub | `npm run smoke:adapters`, `npm run smoke:local`, `npm run smoke:livekit` | Fixture retrieval proves wiring, not real Moss runtime. |
| Moss local runtime over prebuilt artifact | not_proven | `services/moss-runtime` fixture service | Runtime must not use `autoRefresh`, cloud polling, `pushIndex()`, or session uploads. |
| Hosted Moss runtime behavior | forbidden | README hard constraint | No hosted runtime behavior in local MVP. |
| Production native desktop control | forbidden | README hard constraint | Production visitors must be browser-native. |
| Stagehand execution | forbidden for MVP | README hard constraint | Stagehand may resolve selectors later but must not execute visible UI. |

## Latest Evidence

- `npm run smoke:livekit` passed with `bridgeDisabled: true` at `artifacts/smoke/livekit-2026-06-07T08-21-40-550Z/result.json`.
- Browser LiveKit smoke passed on June 7, 2026: `Connect` joined local LiveKit with `ENABLE_SIM_BRIDGE=0`, `Ask agent` received a LiveKit `agent.action`, the page scrolled/highlighted, Cal stayed unloaded before confirmation, and Cal opened after confirmation.
