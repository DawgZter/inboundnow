# Local Agent Worker

`apps/agent` is the first local simulated SDR worker for InboundNow.

Run it after the token server:

```bash
npm run dev:agent
```

Current mode is `AGENT_MODE=simulated` by default. In this mode:

- ASR is simulated by browser text input or the `Sim voice` button.
- LLM planning is a local keyword router in `router.mjs`.
- TTS is browser `speechSynthesis` in the website lab when available.
- Moss is not connected yet.

The worker connects to:

```bash
TOKEN_SERVER_URL=http://127.0.0.1:4301
LIVEKIT_ROOM=inboundnow-local
```

It listens for `prospect.question`, plans an answer plus typed browser actions, and sends `agent.answer` / `agent.action` messages back to the browser bridge.

For the payroll MVP, the worker emits a `payrollFlow` action with an agent-owned answer. The browser widget still owns all visible cursor, scroll, highlight, caption, and booking UI.
