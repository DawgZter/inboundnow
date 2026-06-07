# Round 8: H100 Browser Persona Harness And Proof Guards

Date: 2026-06-07

## What Changed

- Added `scripts/vast-h100/smoke-browser-persona-h100.mjs`, an H100-only browser harness for the click-to-start persona path.
- Added package aliases `smoke:h100:browser-persona` and `smoke:browser:h100-persona`.
- The harness opens the lab, clicks Connect local transport, clicks Start/Stop voice turn, publishes browser media through local LiveKit, rejects bridge fallback, checks local Parakeet ASR, local Qwen planner metadata, local Moss runtime retrieval, local Miso One verified model-audio events, primitive browser actions, and Cal gating.
- Browser telemetry now exposes planner metadata, ASR source/model/proof/transcript, and local Miso/VibeVoice proof flags for TTS events.
- Qwen H100 smoke paths now query `/v1/models` and reject stub/fake/fixture endpoints before accepting a completion.
- MisoTTS wrapper now serializes generation, passes dtype when the public loader supports it, defaults Miso quantization to `none`, and makes `MISO_REQUIRE_LORA=1` fail closed until a real LoRA loader exists.
- Vast/Miso docs now distinguish base MisoTTS audio proof from cloned-voice LoRA proof.

## Subagent Integration

- Browser proof sidecars agreed that the existing browser ASR UI smoke is intentionally a bridge/fake-TTS contract smoke and must not be reused as H100 proof.
- Miso API audit found the current public MisoTTS API supports `load_miso_8b(...).generate(...)` and prompted context, but no proven public LoRA adapter loader.
- Boundary review identified false-green risks around Qwen stubs, bridge fallback, Miso LoRA overclaiming, and contract-only TTS proof.

## Verification

`npm run check` passed on 2026-06-07 after these changes. This covered 53 tests, syntax checks including the new H100 browser harness, local contract smokes, browser Cal gate, browser ASR UI, and Miso LoRA manifest validation.

## Remaining Proof

- The new browser harness has not yet been run on the Vast.ai H100 stack.
- Automated `BROWSER_MIC_AUDIO_PATH` mode is browser media-fixture proof, not a human manual mic proof.
- Base MisoTTS audio proof remains separate from Miso One LoRA cloned-voice proof.
- Real cloned-voice proof still requires a trainer/loader, adapter artifact, and `loraAdapterApplied: true` evidence.
