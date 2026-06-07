# Vast.ai H100 Runbook

This is the GPU lane for proving the real local-model pieces of InboundNow.

The laptop path can prove LiveKit data/control messages, widget actions, protocol validation, and Cal gating. The real ASR/LLM/TTS lane requires an H100-class GPU. Use Vast.ai for this until we have owned hardware.

## Requirement

Use a single H100 with roughly 80 GB VRAM:

- Recommended GPU names on Vast: H100_SXM, H100_PCIE, or H100_NVL.
- Recommended template: Vast.ai PyTorch / PyTorch (cuDNN Devel) template.
- Recommended disk: at least 180 GB; use more if downloading multiple model variants.
- Recommended disk for Miso LoRA development: at least 220 GB for model files, datasets, checkpoints, and adapter artifacts.
- Recommended access: verified host, direct SSH, direct ports, high reliability.

Do not use H100 proof language unless scripts/vast-h100/bootstrap-instance.sh passes its H100 preflight and the relevant model smoke is captured.

## Local Vast Setup

Install the Vast.ai CLI and authenticate:

    python3 -m pip install --user vastai
    vastai set api-key YOUR_VAST_API_KEY
    vastai show user

Register an SSH key before creating the instance:

    vastai create ssh-key ~/.ssh/id_ed25519.pub

Search for H100 offers:

    scripts/vast-h100/search-offers.sh

The script defaults to verified, rentable, one-GPU H100 offers with direct ports and at least 70 GB VRAM. Override with VAST_QUERY if the marketplace names differ.

## Create The Instance

Recommended UI path:

1. Open the Vast.ai console.
2. Go to Templates.
3. Search for PyTorch.
4. Select the PyTorch CUDA/cuDNN template, preferably PyTorch (cuDNN Devel).
5. Go to create/search, filter to H100_SXM, H100_PCIE, or H100_NVL.
6. Choose one verified machine with direct SSH, at least 180 GB disk, and enough availability for the run.
7. Rent the instance and wait for status running.

Optional CLI path:

    OFFER_ID=123456 scripts/vast-h100/create-instance.example.sh

The CLI script uses Vast's published PyTorch cuDNN Devel template hash by default. If the template hash stops working, use the UI path and select the current PyTorch template manually.

## Connect And Sync

Copy the direct SSH command from the Vast instance card and add port forwards:

    ssh -p <vast-ssh-port> root@<vast-host> \
      -L 4199:127.0.0.1:4199 \
      -L 4301:127.0.0.1:4301 \
      -L 7880:127.0.0.1:7880 \
      -L 4311:127.0.0.1:4311 \
      -L 4321:127.0.0.1:4321 \
      -L 4341:127.0.0.1:4341 \
      -L 4331:127.0.0.1:4331

In another local terminal, sync this repo to the instance:

    VAST_HOST=<vast-host> VAST_PORT=<vast-ssh-port> scripts/vast-h100/sync-repo-to-vast.sh

Alternatively, clone the repo directly on the instance if Git credentials are already available there:

    cd /workspace
    git clone <repo-url> inboundnow
    cd inboundnow

## Bootstrap The H100 Instance

Run on the Vast instance:

    cd /workspace/inboundnow
    bash scripts/vast-h100/bootstrap-instance.sh

This script verifies the GPU name contains H100, installs Node.js 20, LiveKit server, npm deps, and a .venv-h100 Python environment with vLLM and Hugging Face tooling.

If model access requires Hugging Face auth:

    source .venv-h100/bin/activate
    huggingface-cli login

## Start Qwen On The H100

Run this in a tmux window on the instance:

    cd /workspace/inboundnow
    LLM_MODEL=Qwen/Qwen3.6-27B LLM_SERVED_MODEL_NAME=qwen3.6-27b scripts/vast-h100/start-qwen-vllm.sh

When co-hosting ASR and Miso One TTS on the same H100, test full precision first if memory allows. If latency or memory pressure is too high, use an explicit vLLM quantization setting such as `LLM_QUANTIZATION=fp8` or an FP8 model variant, and record that in the proof artifact.

The default endpoint is:

    http://127.0.0.1:4311/v1

Smoke it from another instance shell:

    node scripts/vast-h100/smoke-qwen-endpoint.mjs

Passing this smoke proves the H100-hosted OpenAI-compatible Qwen endpoint is responding locally. It does not by itself prove the browser agent is using Qwen for planning until the worker is run with AGENT_PLANNER=local-llm and the browser/agent flow captures planner metadata.

## Start Parakeet ASR On The H100

Run this in a separate tmux window on the instance:

    cd /workspace/inboundnow
    npm run dev:asr:parakeet

The default endpoint is:

    http://127.0.0.1:4341

The script uses `nvidia/parakeet-tdt-0.6b-v3`, installs NeMo ASR dependencies into `.venv-h100`, and exposes `/health` plus `/v1/asr/transcribe`. The endpoint expects local audio through `audioBase64` or `audioPath`; preferred audio is mono 16kHz WAV/FLAC.

Smoke it from another instance shell with a real local audio file:

    ASR_SMOKE_AUDIO_PATH=/workspace/inboundnow/artifacts/asr-smoke/global-payroll.wav \
    ASR_EXPECTED_PATTERN='global payroll|Remote' \
    npm run smoke:asr:h100

Passing this smoke proves the local Parakeet-compatible endpoint returned a transcript for the supplied audio file. It still does not prove browser mic frames until the LiveKit browser turn captures and transcribes real microphone audio.

## Start Miso One TTS On The H100

Run this in a separate tmux window on the instance:

    cd /workspace/inboundnow
    npm run dev:tts:miso-one

The primary voice target is local Miso One/MisoTTS (`MisoLabs/MisoTTS`) behind the repo-owned localhost HTTP contract: `/health`, `/prewarm`, and `/v1/tts/stream`. Cloned voices must be consented LoRA adapter artifacts, not in-context voice prompt cloning.

Latency and quality knobs:

- `TTS_DTYPE=bfloat16` is the H100 default.
- `TTS_QUANTIZATION=none` is the default for the current public MisoTTS wrapper. Do not claim Miso quantization until the wrapper applies a real lower-level quantization path; use Qwen/vLLM quantization separately when needed.
- `TTS_CACHE_DIR=artifacts/cache/miso-one-tts` is the local cache location.
- `TTS_TEXT_CHUNK_CHARS=140` controls answer chunking before browser playback.
- `TTS_PREWARM_TEXT` controls warmup text for the compatible endpoint.
- `MISO_LORA_ADAPTER=artifacts/miso-lora/adapters/miso-one-lora-dev` points to the local LoRA adapter metadata/weights path.
- `MISO_REQUIRE_LORA=1` is intentionally fail-closed until a real MisoTTS LoRA loader is implemented. It should be used as the cloned-voice proof gate, not as a base-audio smoke flag.

The endpoint must report proof metadata from generation events, not only from environment variables: `provider: local-miso-one`, `localOnly: true`, Miso model name, `device: cuda`, an H100 `gpuName`, non-empty audio bytes, sample rate/format, fresh generation/cache metadata, and `loraAdapterApplied: true` when clone proof is required. `H100_PROOF_MODE=1` rejects contract-only TTS proof before the worker emits answer/action events.

Smoke the endpoint from another instance shell:

    npm run smoke:tts:miso-one

Passing this smoke proves only that a localhost Miso One/MisoTTS-compatible endpoint streamed base model audio chunks and reported latency/cache metadata. Full cloned-voice proof still requires a consented LoRA adapter artifact, an implemented MisoTTS adapter loader, `MISO_REQUIRE_LORA=1`, and evidence that the adapter was applied during generation.

Legacy VibeVoice remains available as an older compatibility lane:

    ENABLE_TTS_RUNTIME=1 TTS_RUNTIME=vibevoice npm run dev:tts:realtime

## Prepare Miso One LoRA Development

This repo supports a guarded Miso One LoRA development lane for `MisoLabs/MisoTTS`. It is not model proof yet; it is the setup, manifest, and launch contract for developing or evaluating a trainer on the H100.

Run on the Vast instance:

    cd /workspace/inboundnow
    bash scripts/vast-h100/setup-miso-lora-dev.sh

Validate the consent/local-only manifest:

    npm run miso:lora:validate

Launch a selected trainer:

    MISO_LORA_MANIFEST=configs/miso-lora/your-manifest.json \
    MISO_LORA_TRAIN_ENTRYPOINT=experiments/train_miso_lora.py \
    scripts/vast-h100/launch-miso-lora-dev.sh

The launcher refuses to run without an explicit training entrypoint because the public MisoTTS release does not provide a proven LoRA trainer in this repo. See `docs/miso-lora-runbook.md` for the consent manifest, local path rules, runtime adapter fields, and proof boundary.

## Start The Local InboundNow Stack

Run on the instance after bootstrap. Proof mode starts Qwen, Parakeet, Miso One TTS, local Moss, LiveKit, token server, the LiveKit agent, and the website lab:

    H100_PROOF_MODE=1 bash scripts/vast-h100/start-dev-stack.sh

The script starts a tmux session with:

- livekit-server --dev
- bridge-disabled token server
- local Moss artifact runtime after `npm run moss:index`
- optional Qwen 3.6 27B vLLM tmux pane when `ENABLE_LLM_RUNTIME=1` or `H100_PROOF_MODE=1`
- optional Parakeet ASR tmux pane when `ENABLE_ASR_RUNTIME=1`
- optional Miso One/MisoTTS tmux pane when `ENABLE_TTS_RUNTIME=1`; use `TTS_RUNTIME=vibevoice` only for the legacy VibeVoice lane
- LiveKit-mode agent worker configured for `AGENT_PLANNER=local-llm`, fail-closed planner proof mode, local Qwen, local Moss URLs, and `TTS_PROVIDER=local-miso-one` in proof mode
- Remote website lab on port 4199

From your laptop, with the SSH tunnel open, visit:

    http://127.0.0.1:4199/direct

Click Start AI Persona, grant microphone access when prompted, then speak naturally.

Before running the proof suite, verify that every local service is reachable and
still inside the H100/local-only boundary:

    H100_PROOF_MODE=1 npm run h100:preflight

This writes artifacts/smoke/h100-stack-preflight-<timestamp>/result.json.
It checks the H100 GPU, local LiveKit TCP readiness, bridge-disabled token
server health, local Moss artifact runtime health, Qwen /v1/models,
Parakeet /health, Miso One/MisoTTS /health, and the website lab. By default
it allows lazily loaded ASR/TTS models to report loaded=false; add
H100_PREFLIGHT_REQUIRE_LOADED=1 after prewarming if you want startup proof to
require loaded models. If MISO_REQUIRE_LORA=1 is set, preflight fails until the
Miso wrapper reports a real LoRA runtime loader instead of metadata-only clone
configuration.

## Capture Evidence

On the instance:

    npm run check
    ASR_SMOKE_AUDIO_PATH=/path/to/known-transcript.wav BROWSER_MIC_AUDIO_PATH=/path/to/known-transcript.wav ASR_EXPECTED_PATTERN="Remote|payroll|global" npm run smoke:h100:proof-suite

The proof suite runs h100:preflight first so it fails quickly when a tmux pane
is down, a service points off localhost, the token server bridge is enabled, or
Miso LoRA clone proof is requested before the runtime can really apply LoRA.

The proof suite writes `artifacts/smoke/h100-proof-suite-<timestamp>/manifest.json` and fails unless the Remote.com local Moss artifact, local Qwen endpoint, local Parakeet endpoint, local Miso endpoint, model-chain smoke, and browser persona smoke all produce durable `result.json` evidence. The browser persona smoke clicks the visible Start AI Persona control, requires LiveKit plus a published mic, waits for the browser auto-stop lifecycle instead of directly calling the developer stop function, rejects bridge fallback/stubs, asserts worker buffered-audio proof matches the ASR endpoint audio hash, checks primitive browser actions, saves `events.json`, `browser-mic-proof.json`, `worker-audio-proof.json`, `asr-proof.json`, `proof-chain.json`, `result.json`, logs, and a final screenshot. With `BROWSER_MIC_AUDIO_PATH`, it is still automated browser media-fixture proof, not a human manual microphone proof. Use `REQUIRE_MANUAL_MIC=1 HEADLESS=0` when capturing a manual speaking artifact.

Browser proof to capture manually after the automated harness:

- transport chip says LiveKit data connected.
- mic chip says published; blocked/no-audio is a failed H100 browser proof.
- browser events include `browserMicMedia` for `published`, `turn_start`, and `turn_auto_stop`.
- browser events include `browserVoiceTurnAutoStop`; a direct smoke-only `stopVoiceTurn()` is not proof of the product Start AI Persona lifecycle.
- ASR final comes from `local-parakeet` with `source: livekit-audio-turn`, not typed transcript fallback.
- transcript appends prospect and agent turns.
- proof line includes local adapter labels.
- proof line includes `Planner local-llm-json via qwen-openai-local`, `Retrieval local-runtime-client`, and `TTS miso-one-local` without claiming Miso One LoRA clone proof unless an applied LoRA artifact is captured.
- changing voice in-session, for example "switch to a warmer voice", updates the Voice chip and streamed speech metadata.
- booking prompt appears.
- Cal iframe src remains empty before confirmation and is set only after Yes, open Cal.

## Current Boundary

Verified by this runbook today:

- H100 machine selection and preflight.
- Local self-hosted LiveKit control path.
- Local Qwen 3.6 27B OpenAI-compatible endpoint via vLLM when smoke-qwen-endpoint.mjs passes.
- Local Moss artifact runtime wiring through the local-runtime-client boundary.
- Streamed browser speech fallback, local Miso One adapter contract, and legacy VibeVoice adapter contract.
- Dynamic voice switching metadata across browser and agent control messages.
- Local Parakeet adapter contract and H100 launch/smoke scripts.
- Miso One LoRA development setup and manifest validation.

Not yet proven by this runbook:

- Parakeet ASR from real browser audio frames.
- Browser mic-to-Parakeet proof, until a LiveKit browser voice turn captures real microphone audio and `local-parakeet` returns the transcript.
- Browser playback of Miso One audio, until `smoke:tts:miso-one` and a LiveKit browser run with `TTS_PROVIDER=local-miso-one` are captured.
- Miso One LoRA training and cloned-voice audio, until a consented manifest, selected trainer/loader, adapter artifact, and H100-local audio smoke with `MISO_REQUIRE_LORA=1` plus `loraAdapterApplied: true` are captured.
- Browser proof that the H100 Qwen planner, not only the deterministic fallback, produced the accepted plan.
- Hosted or cloud Moss runtime behavior, which remains forbidden for runtime proof.

## Cleanup

When done, stop the tmux sessions and destroy the Vast instance to avoid ongoing GPU or storage charges:

    tmux kill-session -t inboundnow-h100 || true
    vastai destroy instance <instance-id>

Destroying is irreversible and deletes the instance data. Copy artifacts first if you need to preserve them.

## References

- Vast.ai CLI hello world: https://docs.vast.ai/cli/hello-world
- Vast.ai create instance reference: https://docs.vast.ai/cli/reference/create-instance
- Vast.ai SSH and port forwarding guide: https://docs.vast.ai/guides/instances/connect/ssh
- LiveKit local self-hosting guide: https://docs.livekit.io/transport/self-hosting/local/
- Qwen 3.6 27B model card: https://huggingface.co/Qwen/Qwen3.6-27B
- Qwen 3.6 27B FP8 model card: https://huggingface.co/Qwen/Qwen3.6-27B-FP8
- Microsoft VibeVoice repository: https://github.com/microsoft/VibeVoice
- VibeVoice-Realtime model card: https://huggingface.co/microsoft/VibeVoice-Realtime-0.5B
- Parakeet TDT v3 model card: https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3
- MisoTTS Hugging Face model: https://huggingface.co/MisoLabs/MisoTTS
- MisoTTS GitHub repository: https://github.com/MisoLabsAI/MisoTTS
