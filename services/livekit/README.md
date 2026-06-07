# Local LiveKit

InboundNow uses self-hosted/local-first LiveKit for the voice room boundary. Do not use LiveKit Cloud for local MVP proof.

## Install

macOS:

- `brew update`
- `brew install livekit`

The official local-dev path is `livekit-server --dev`.

That starts a local server on `ws://127.0.0.1:7880` with:

- API key: `devkey`
- API secret: `secret`

If you want an explicit config file instead of `--dev`, run `livekit-server --config services/livekit/livekit.dev.yaml`.

## Local Transport Smoke

Run these in separate terminals:

```bash
livekit-server --dev
npm run dev:token
npm run dev:agent:livekit
PORT=4199 TOKEN_SERVER_URL=http://127.0.0.1:4301 npm run dev:lab
```

Open `http://localhost:4199/direct` and click `Connect`, then `Ask agent`.
The browser should prefer LiveKit data-channel messages and fall back to the
WebSocket bridge only if local LiveKit is unavailable.

## Environment

The local token server defaults to the same values:

- `LIVEKIT_URL=ws://127.0.0.1:7880`
- `LIVEKIT_API_KEY=devkey`
- `LIVEKIT_API_SECRET=secret`
- `LIVEKIT_ROOM=inboundnow-local`
- `TOKEN_SERVER_PORT=4301`

## Boundary

This service only proves local transport and room/token wiring. It does not prove ASR, LLM, TTS, or Moss are local until those adapters are running and verified separately.
