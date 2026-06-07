# Local Agent Worker

`apps/agent` is the first local simulated SDR worker for InboundNow.

Run it after the token server:

```bash
npm run dev:agent
```

Current mode is `AGENT_MODE=simulated` by default. In this mode:

- ASR is simulated by browser text input or the `Send simulated transcript` button.
- LLM planning is the local keyword router in `router.mjs` by default.
- `AGENT_PLANNER=local-llm` plus `LLM_PROVIDER=qwen-openai-local` enables the strict JSON planner against a localhost OpenAI-compatible endpoint.
- TTS streams `agent.speech.start/chunk/end` text chunks to the browser `speechSynthesis` fallback when available.
- `TTS_PROVIDER=local-vibevoice` configures a localhost-only VibeVoice-compatible boundary; real model audio is not proven until the H100 smoke passes.
- Moss uses local fixture retrieval by default, with local artifact/runtime-client modes documented in `docs/local-adapters.md`.

The worker connects to:

```bash
TOKEN_SERVER_URL=http://127.0.0.1:4301
LIVEKIT_ROOM=inboundnow-local
```

It listens for `prospect.question`, plans an answer plus typed browser actions, and sends `agent.answer`, `agent.speech.*`, and `agent.action` messages back to the browser bridge or LiveKit data channel.

The LLM planner validates the full parsed plan before sending the answer. Malformed JSON, unsafe actions, or unavailable local endpoints fall back to the deterministic router.

For the payroll MVP, the worker emits a `payrollFlow` action with an agent-owned answer. The browser widget still owns all visible cursor, scroll, highlight, caption, and booking UI.
