# Token Server And Agent Bridge

This service issues local LiveKit-compatible JWTs and runs the simulated browser-agent WebSocket bridge.

It is intentionally local-first:

- Default LiveKit URL: `ws://127.0.0.1:7880`
- Default API key: `devkey`
- Default API secret: `secret`
- Default room: `inboundnow-local`

Run it:

```bash
npm run dev:token
```

Useful endpoints:

- `GET /health`
- `GET /config?room=inboundnow-local`
- `GET /token?room=inboundnow-local&identity=visitor-local&role=browser`
- `WS /agent-bridge?role=browser|agent&room=inboundnow-local`

The JWT token is for a self-hosted LiveKit dev server. The WebSocket bridge is a simulated local action bus until real LiveKit data-channel, ASR, LLM, TTS, and Moss adapters are connected.

The API secret belongs only in this service and local agent processes. Do not put it in browser code.
