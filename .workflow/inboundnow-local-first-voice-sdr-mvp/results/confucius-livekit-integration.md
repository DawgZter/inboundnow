# Confucius: LiveKit Integration Plan

Read-only report received during round 1. No files edited by the subagent.

## Verdict

Make LiveKit data channels the default transport while keeping the existing JSON
action protocol and the current WebSocket bridge as an explicit fallback. Do not
rewrite the widget action bus for the transport swap.

## Accepted Direction

- Add local LiveKit browser SDK assets served from this repo or `node_modules`;
  do not use a CDN.
- Browser flow: fetch local token, connect to local room, request/publish mic on
  the Connect action, publish JSON messages on a browser topic.
- Agent flow: connect as a hidden/local participant, listen for browser JSON
  data, call the existing planner, publish status/answer/action JSON back on an
  agent topic.
- Keep `ws` bridge behind a fallback flag such as `ENABLE_SIM_BRIDGE=1` or
  `AGENT_TRANSPORT=ws`.
- Do not claim ASR until Parakeet consumes actual local audio and produces a
  transcript.

## Specific Risks

- Vanilla Node/no-bundler page cannot import bare LiveKit package imports; serve
  a local browser bundle/ESM asset.
- `@livekit/rtc-node` may have native/platform-sensitive install behavior.
- Cap page snapshots before sending over LiveKit data packets.
- Token server defaults must remain local and should reject LiveKit Cloud URLs.

## Deferred To Transport Slice

- Add `livekit-client` browser dependency.
- Evaluate `@livekit/rtc-node` availability before making it required.
- Replace `connectAgentBridge` and `sendBridge` with transport-neutral
  `connectAgentTransport` and `publishAgentJson` wrappers.
- Rename `handleBridgeMessage` to `handleAgentMessage` and reuse it for
  LiveKit `DataReceived`.
