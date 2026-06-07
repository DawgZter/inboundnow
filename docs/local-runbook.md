# Local Runbook

## Common Checks

```bash
npm run check
npm run smoke:adapters
npm run smoke:local
npm run smoke:livekit
```

`smoke:local` and `smoke:livekit` write logs and `result.json` under `artifacts/smoke/`. The `artifacts/` folder is gitignored.

## Bridge Fallback Mode

```bash
npm run dev:token
npm run dev:agent
PORT=4199 TOKEN_SERVER_URL=http://127.0.0.1:4301 npm run dev:lab
```

Open `http://localhost:4199/direct`, click `Connect local transport`, then `Ask agent`.

## LiveKit Mode

```bash
livekit-server --dev
ENABLE_SIM_BRIDGE=0 npm run dev:token
npm run dev:agent:livekit
PORT=4199 TOKEN_SERVER_URL=http://127.0.0.1:4301 npm run dev:lab
```

Open `http://localhost:4199/direct`, click `Connect local transport`, then `Ask agent`.

Expected proof level in this mode: browser and agent exchange control messages over a local LiveKit room. ASR, local LLM, local TTS, and real Moss runtime remain unproven unless their dedicated smokes are run and captured.

## H100 Local-Model Lane

The real model lane requires an H100-class GPU. Use docs/vast-h100-runbook.md for the Vast.ai PyTorch-template setup, H100 preflight, Qwen vLLM endpoint, port tunnels, and evidence capture.

## Adapter Stubs

```bash
AGENT_MODE=local-stubs npm run dev:agent
npm run dev:qwen-stub
npm run dev:moss-runtime
npm run smoke:adapters
```

These prove wiring and guardrails only.
