# LiveKit Transport Checkpoint

## Implemented

- Installed `livekit-client` and `@livekit/rtc-node`.
- Added local browser SDK asset route:
  `/__ocw-assets/livekit-client.esm.mjs`.
- Token server now reports `transport: "livekit"`, exposes the SDK asset path,
  and rejects LiveKit Cloud URLs for the local MVP.
- Browser `Connect` now prefers a local LiveKit room, requests microphone
  publication after a user gesture, publishes JSON data packets when connected,
  and falls back to the existing WebSocket bridge when LiveKit is unavailable.
- Agent worker now supports `AGENT_TRANSPORT=livekit|bridge`; both transports
  reuse the same planner, adapter registry, and action protocol validation.

## Verified This Checkpoint

Local token/config/asset smoke on alternate ports:

- `/config?room=inboundnow-check` returned `transport: "livekit"`.
- `/__ocw-assets/livekit-client.esm.mjs` served from the lab with a valid SDK
  bundle.
- `/token?role=browser&room=inboundnow-check&identity=browser-check` decoded to
  the requested room and `canPublishData: true`.

Browser smoke on `http://127.0.0.1:4192/direct` with no local LiveKit server:

- `Connect` attempted LiveKit and fell back to the WebSocket bridge.
- Agent reached `online` / `Local agent ready`.
- `Ask agent` answered the payroll question, scrolled/highlighted the page, and
  opened the booking prompt.
- Cal iframe `src` stayed empty before confirmation.
- After `Yes, open Cal`, scheduler opened with
  `src="/__remote/https/cal.com/remote"`.
- Nested widget in the Cal iframe was false.

Repeatable local smoke:

- `npm run smoke:local` passed.
- Artifact summary was written to
  `artifacts/smoke/2026-06-07T08-24-28-096Z/result.json`.
- Checks covered token health, LiveKit config, token `canPublishData`, local
  LiveKit browser asset serving, and bridge agent answer/action loop.

Bridge-disabled LiveKit smoke:

- `npm run smoke:livekit` passed after installing `livekit-server` locally via Homebrew.
- Artifact summary was written to
  `artifacts/smoke/livekit-2026-06-07T08-24-28-928Z/result.json`.
- Checks covered local `livekit-server --dev`, token health, `ENABLE_SIM_BRIDGE=0`, browser participant join, agent participant join, `agent.answer`, and `agent.action` over LiveKit data channels.

Browser LiveKit smoke:

- Browser smoke passed on `http://127.0.0.1:4193/direct` with `ENABLE_SIM_BRIDGE=0`.
- `Connect` joined the local LiveKit room with the browser JS client.
- Agent log showed `LiveKit agent connected` and receipt of browser event data.
- `Ask agent` produced `LiveKit agent action received`, page scroll/highlight, booking prompt, and empty Cal iframe `src` before confirmation.
- `Yes, open Cal` opened the scheduler and set `src="/__remote/https/cal.com/remote"` with no nested widget.

## Not Yet Proven

- Browser mic publication as an asserted media-track proof. The browser requests mic publication, but ASR is not attached and permission behavior can vary.
- Real Parakeet ASR from browser audio.
- Real local Qwen/vLLM or SGLang planning.
- Real VibeVoice local TTS.
- Real Moss runtime over prebuilt local artifacts.
