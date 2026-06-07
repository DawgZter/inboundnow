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

## Not Yet Proven

- A real local LiveKit room join/data-channel round trip, because
  `livekit-server` is not installed or running in this environment.
- Real Parakeet ASR from browser audio.
- Real local Qwen/vLLM or SGLang planning.
- Real VibeVoice local TTS.
- Real Moss runtime over prebuilt local artifacts.
