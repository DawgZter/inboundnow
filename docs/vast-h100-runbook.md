# Vast.ai H100 Runbook

This is the GPU lane for proving the real local-model pieces of InboundNow.

The laptop path can prove LiveKit data/control messages, widget actions, protocol validation, and Cal gating. The real ASR/LLM/TTS lane requires an H100-class GPU. Use Vast.ai for this until we have owned hardware.

## Requirement

Use a single H100 with roughly 80 GB VRAM:

- Recommended GPU names on Vast: H100_SXM, H100_PCIE, or H100_NVL.
- Recommended template: Vast.ai PyTorch / PyTorch (cuDNN Devel) template.
- Recommended disk: at least 180 GB; use more if downloading multiple model variants.
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
      -L 4321:127.0.0.1:4321

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
    LLM_MODEL=Qwen/Qwen2.5-7B-Instruct scripts/vast-h100/start-qwen-vllm.sh

The default endpoint is:

    http://127.0.0.1:4311/v1

Smoke it from another instance shell:

    node scripts/vast-h100/smoke-qwen-endpoint.mjs

Passing this smoke proves the H100-hosted OpenAI-compatible Qwen endpoint is responding locally. It does not by itself prove the browser agent is using Qwen for planning until the worker is run with AGENT_PLANNER=local-llm and the browser/agent flow captures planner metadata.

## Start The Local InboundNow Stack

Run on the instance after Qwen is serving:

    bash scripts/vast-h100/start-dev-stack.sh

The script starts a tmux session with:

- livekit-server --dev
- bridge-disabled token server
- local Moss fixture runtime
- LiveKit-mode agent worker configured for AGENT_PLANNER=local-llm, local Qwen, and local Moss URLs
- Remote website lab on port 4199

From your laptop, with the SSH tunnel open, visit:

    http://127.0.0.1:4199/direct

Click Connect local transport, then Ask agent.

## Capture Evidence

On the instance:

    npm run check
    npm run smoke:planner
    npm run smoke:livekit
    mkdir -p artifacts/smoke
    node scripts/vast-h100/smoke-qwen-endpoint.mjs | tee artifacts/smoke/qwen-h100.json

Browser proof to capture manually:

- transport chip says LiveKit data connected.
- mic chip is either published - no ASR yet or honestly blocked.
- transcript appends prospect and agent turns.
- proof line includes local adapter labels.
- booking prompt appears.
- Cal iframe src remains empty before confirmation and is set only after Yes, open Cal.

## Current Boundary

Verified by this runbook today:

- H100 machine selection and preflight.
- Local self-hosted LiveKit control path.
- Local Qwen OpenAI-compatible endpoint via vLLM when smoke-qwen-endpoint.mjs passes.
- Local Moss fixture runtime wiring.

Not yet proven by this runbook:

- Parakeet ASR from real browser audio frames.
- VibeVoice local audio synthesis.
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
