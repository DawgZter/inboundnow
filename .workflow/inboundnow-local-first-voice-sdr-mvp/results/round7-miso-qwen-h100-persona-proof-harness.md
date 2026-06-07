# Round 7: Miso/Qwen H100 Persona Proof Harness

Date: 2026-06-07

## Target Alignment

This round aligns the repo with the clarified InboundNow target: an embeddable conversational agent that can speak with a site visitor, interact with the current page, qualify/support the visitor, and run the model stack locally on a Vast.ai H100.

The local H100 target is:

- local LiveKit for media/control
- local Moss retrieval/runtime
- local Qwen 3.6 27B planner endpoint
- local Parakeet v3 ASR endpoint
- local Miso One/MisoTTS streaming TTS, with cloned voices represented by consented LoRA finetunes rather than in-context voice cloning

## Changes Integrated

- The main planner/router path now emits primitive browser actions instead of relying on the deprecated `payrollFlow` demo macro.
- Planner proof mode can fail closed instead of silently accepting bad local-LLM output.
- Qwen H100 launch defaults now point at `Qwen/Qwen3.6-27B` with explicit dtype/quantization knobs.
- A primary `local-miso-one` TTS adapter, endpoint launcher, endpoint smoke, and H100 persona chain smoke were added.
- `smoke:tts:h100` now targets the Miso One/MisoTTS H100 smoke. Legacy VibeVoice is kept under `smoke:tts:vibevoice`.
- H100 proof mode starts the local stack with fail-closed planner behavior and real-model-proof flags.
- Docs now describe the Vast.ai PyTorch template flow, H100 boundary, Miso LoRA development lane, and proof matrix status.

## Verification

`npm run check` passed on 2026-06-07. It covered 53 unit tests, planner/router primitive-action validation, adapter checks, local Moss/ASR/TTS/voice smokes, browser Cal gate smoke, browser ASR UI smoke, and Miso LoRA manifest validation.

## Remaining Proof

Not proven yet:

- real Vast.ai H100 run of Qwen 3.6 27B + Parakeet v3 + Moss + LiveKit + Miso One/MisoTTS
- browser microphone to real Parakeet ASR
- browser playback of real Miso One audio
- trained/applied Miso One LoRA clone with consented adapter evidence
- full click-to-start persona session against the target stack
