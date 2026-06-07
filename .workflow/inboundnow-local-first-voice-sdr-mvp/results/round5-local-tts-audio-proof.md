# Round 5 Local TTS Audio Proof

## Scope

Added the non-H100 contract path for streamed local VibeVoice-compatible model audio:

- Worker prewarms and streams from `TTS_PROVIDER=local-vibevoice`.
- Worker emits `agent.tts.start`, `agent.tts.chunk`, and `agent.tts.end` with base64 PCM16 chunk metadata.
- Browser suppresses duplicate `speechSynthesis` when model audio is active and schedules PCM16 chunks through Web Audio.
- Browser ignores stale interrupted TTS events and handles out-of-order or duplicate chunk sequences.
- Fake endpoint proof stays `proofLevel: contract`; `localVibeVoiceProven` remains `false` until an explicit H100 real-model evidence run.

## Sidecar Review Integrated

James flagged overclaiming fake endpoint audio as real VibeVoice proof, stale interrupted audio handling, action/audio ordering policy, duplicate/out-of-order chunk behavior, and misleading TTS error fallback copy.

Accepted fixes:

- Replaced fake endpoint proof truthiness with contract-level proof metadata.
- Documented that browser actions may overlap pending/playing model audio for latency.
- Added stale interrupted audio rejection.
- Added duplicate and out-of-order PCM chunk handling.
- Clarified TTS failure copy as text-caption fallback, not audible replay.

## Verification

- `npm run smoke:tts:agent` passed at `artifacts/smoke/agent-tts-local-2026-06-07T14-04-22-864Z/result.json`.
- `npm run smoke:browser:asr-ui` passed at `artifacts/smoke/browser-asr-ui-2026-06-07T14-04-27-938Z/result.json`.
- `npm run check` passed after these changes.

## Remaining Boundary

This is not real VibeVoice model audio proof. The real-model claim still requires `npm run smoke:tts:h100` against a Vast.ai H100-local VibeVoice-compatible endpoint with `TTS_REAL_MODEL_PROOF=1` only for that captured evidence run.
