# Hilbert: E2E Verification Plan

Read-only report received during round 1. No files edited by the subagent.

## Current Topology

- Browser opens `http://127.0.0.1:4199/direct`.
- Website lab runs with
  `PORT=4199 TOKEN_SERVER_URL=http://127.0.0.1:4301 npm run dev:lab`.
- Token/bridge server exposes `/health`, `/config`, `/token`, and
  `/agent-bridge`.
- Agent worker runs `npm run dev:agent` and currently uses simulated WebSocket
  transport plus the keyword router.
- Optional LiveKit transport boundary is `livekit-server --dev` at
  `ws://127.0.0.1:7880`; current browser-agent action path is not yet LiveKit
  data-channel proof.

## One-Command Smoke Target

```bash
PORT=4199 TOKEN_SERVER_PORT=4301 LIVEKIT_ROOM=inboundnow-smoke CAL_URL=https://cal.com/remote npm run smoke:e2e
```

The script should spawn token server, agent worker, and website lab; run checks;
open `/direct` with Playwright; listen to `openClickyWeb:event`; save logs and
screenshots under `artifacts/smoke/<timestamp>/`; and cleanly terminate child
processes.

## Assertions

- `/health.ok === true`, local mode is explicit, and
  `livekitUrl === "ws://127.0.0.1:7880"`.
- `/token` JWT decodes to a local dev issuer, requested room,
  `roomJoin: true`, and `canPublishData: true`.
- Browser has `window.OpenClickyWeb`, `window.OpenClickyWebMVP`, and a nonempty
  `snapshotPage()`.
- Ask-agent flow returns `intent: "global_payroll"`, `simulated: true`, and
  honest adapter labels.
- Browser events include `snapshotTaken`, `targetResolved`, `scrollStarted`,
  `cursorMoved`, `highlightShown`, and `bookingPromptShown` with no
  `failed`.
- Cal iframe has no `src` before confirmation; after confirmation, scheduler is
  visible and iframe `src` is the configured Cal URL/proxy path.

## Evidence

- `token.log`, `agent.log`, `lab.log`.
- Browser console errors and `window.OpenClickyWeb.events()` dump.
- Screenshots for initial page, connected agent state, payroll highlight/cursor,
  booking prompt before Cal, and Cal modal after confirmation.

## Failure Modes

- Remote.com markup drift can make `findTarget("payroll")` miss.
- Browser speech synthesis may be absent; it is only fallback proof.
- LiveKit JWTs are real local-dev-shaped tokens, but current action bridge is
  not yet LiveKit data-channel proof.
- Moss, Parakeet, local LLM, and real TTS remain unproven.
- Port or room mismatches make the UI wait for the local agent worker.
- Cal.com may block iframe behavior; capture modal state and outbound link.
