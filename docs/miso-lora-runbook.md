# Miso One LoRA Development Runbook

This is the development lane for a Miso One voice adapter on top of `MisoLabs/MisoTTS`.

Current status: configured only. The public MisoTTS model/repo supports local inference and prompted audio context, but this repo has not yet proven a real LoRA finetune. Do not claim trained Miso One audio until a consented dataset, a selected/implemented trainer, and an H100 smoke artifact exist.

## Hardware

Use a Vast.ai H100 instance with the PyTorch CUDA/cuDNN template, matching `docs/vast-h100-runbook.md`.

Minimum recommendation:

- One H100 with about 80 GB VRAM.
- At least 220 GB disk for MisoTTS model files, dataset staging, checkpoints, and adapter artifacts.
- Direct SSH and port forwarding enabled.
- Hugging Face credentials available on the instance if model download requires auth.

## Consent Manifest

The LoRA lane is manifest-gated. Start from:

    configs/miso-lora/manifest.example.json

The manifest must keep:

- `localOnly: true`
- `consent.subjectConsent: true`
- `consent.syntheticImpersonationAllowed: false`
- local filesystem paths only for dataset samples and output adapters

Validate it locally or on the H100:

    npm run miso:lora:validate

or:

    MISO_LORA_MANIFEST=configs/miso-lora/your-manifest.json npm run miso:lora:validate

Validation writes a proof artifact under `artifacts/miso-lora/validation/`.

## Vast.ai Setup

On the H100 instance:

    cd /workspace/inboundnow
    bash scripts/vast-h100/bootstrap-instance.sh
    bash scripts/vast-h100/setup-miso-lora-dev.sh

The setup script:

- verifies an H100 unless `ALLOW_NON_H100=1` is set for dry-run setup
- creates `.venv-miso-lora` with Python >=3.10,<3.13
- installs the upstream MisoTTS package from the cloned repo, then adds LoRA-development extras such as Accelerate, PEFT, bitsandbytes, datasets, Hugging Face Hub, and safetensors
- clones `MisoLabsAI/MisoTTS` into `artifacts/vendor/MisoTTS`
- downloads `MisoLabs/MisoTTS` into `artifacts/models/MisoLabs-MisoTTS`
- validates the manifest

## Launch Contract

There is no upstream LoRA trainer committed in this repo yet. Point the launcher at the trainer you are developing or evaluating:

    MISO_LORA_MANIFEST=configs/miso-lora/your-manifest.json \
    MISO_LORA_TRAIN_ENTRYPOINT=experiments/train_miso_lora.py \
    scripts/vast-h100/launch-miso-lora-dev.sh

The launcher revalidates the manifest and then runs:

    accelerate launch <entrypoint> --manifest <manifest>

The trainer should write adapters to the manifest `training.outputDir`, which defaults to:

    artifacts/miso-lora/adapters/miso-one-lora-dev

## Runtime Wiring

The session voice profile `miso_lora_dev` passes these fields through the TTS boundary:

- `ttsVoice: miso-one-lora-dev`
- `ttsModel: MisoLabs/MisoTTS`
- `style: expressive`
- `loraAdapter: artifacts/miso-lora/adapters/miso-one-lora-dev`

The local Miso One TTS adapter includes `style` and `loraAdapter` in both the request body and the cache key. That prevents warmed/cache audio for one voice or adapter from being reused for another. The legacy VibeVoice adapter uses the same cache-key discipline.

`MISO_REQUIRE_LORA=1` is currently a fail-closed clone-proof gate. The public MisoTTS inference API used by this repo does not expose a proven LoRA adapter loader yet, so base MisoTTS audio can be smoked with `MISO_REQUIRE_LORA=0`, but cloned-voice proof requires a future loader and `loraAdapterApplied: true` evidence.

## Proof Boundary

Configured today:

- manifest validation
- H100 dependency setup wrapper
- launch wrapper for an explicitly selected trainer
- runtime voice profile and cache-key metadata
- browser/agent voice switching metadata
- fail-closed runtime guard for clone-proof claims

Not proven today:

- a MisoTTS LoRA trainer
- a MisoTTS LoRA runtime loader
- real Miso One adapter weights
- generated Miso One audio
- `loraAdapterApplied: true` evidence
- browser playback of a MisoTTS LoRA adapter

## References

- MisoTTS Hugging Face model: https://huggingface.co/MisoLabs/MisoTTS
- MisoTTS GitHub repository: https://github.com/MisoLabsAI/MisoTTS
- Vast.ai H100 runbook in this repo: docs/vast-h100-runbook.md
