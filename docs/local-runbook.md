# Local Runbook

## Common Checks

```bash
npm run check
npm run smoke:adapters
npm run smoke:planner
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

## Local LLM Planner Mode

Run a local OpenAI-compatible endpoint first:

```bash
QWEN_STUB_MODE=planner-json npm run dev:qwen-stub
```

Then run the agent with the opt-in planner switch:

```bash
AGENT_PLANNER=local-llm LLM_PROVIDER=qwen-openai-local LLM_BASE_URL=http://127.0.0.1:4311/v1 npm run dev:agent
```

`npm run smoke:planner` starts the Qwen-compatible stub itself and proves strict planner JSON parsing, protocol validation, and fallback boundaries. This is still stub proof, not real Qwen model proof.

## Adapter Stubs

```bash
AGENT_MODE=local-stubs npm run dev:agent
npm run dev:qwen-stub
npm run dev:moss-runtime
npm run smoke:adapters
```

These prove wiring and guardrails only.
