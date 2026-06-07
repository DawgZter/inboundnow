# InboundNow Project Brief

Build a voice-first AI SDR website guide: a prospect lands on a B2B website, talks naturally to an AI persona, and the agent answers in realtime while visually navigating the page with a polished moving cursor, highlights, scrolling, clicks, and scheduling through Cal.com.

This is not a chatbot. It is a conversational website co-pilot that behaves like an inbound SDR: answers questions, pulls site/product context from local Moss, guides the prospect around the actual page, qualifies intent, and books a meeting.

## Core Decision

Use OpenClicky as inspiration/local sidecar, not the production website controller.

Build a browser-native OpenClicky-Web layer:

```text
LiveKit voice loop
-> ASR / LLM / TTS
-> Moss local retrieval
-> planner/tool router
-> browser action bus
-> custom cursor/highlight/scroll/click widget
-> Cal.com scheduling
```

Use Stagehand as semantic resolver, not the visible UI:

```text
"Show me payroll pricing"
-> Stagehand/Playwright observes page
-> returns likely selector/action
-> browser widget executes visibly with cursor + highlight
```

## Hard Constraints

- LiveKit must be self-hosted/local-first, not LiveKit Cloud.
- ASR: `nvidia/parakeet-tdt-0.6b-v3`, English-only.
- LLM: local/open-weight Qwen-class model through vLLM/SGLang/OpenAI-compatible API.
- TTS: VibeVoice-style local/realtime TTS if feasible.
- Real local-model proof requires an H100-class GPU; the recommended cloud path is Vast.ai with the PyTorch CUDA/cuDNN template. See docs/vast-h100-runbook.md.
- Moss must use local runtime after initial index generation.
- Moss runtime must not use `autoRefresh`, SDK cloud polling, `pushIndex()`, session doc upload, or session embeddings upload.
- Cal.com included for scheduling.
- Production visitor experience should be browser-native, not macOS desktop control.
- Native OpenClicky can remain a local testing/demo/operator-assist sidecar.

## Existing Prototype Entry

Use this as the first local lab surface:

`/Users/karimyahia/Documents/Codex/2026-06-06/could-u-create-a-page-locally-2/outputs/remote-live-proxy.mjs`

It currently proxies Remote.com locally, strips CSP/frame headers, rewrites assets, and injects a support/AI persona widget. This is the right starting point for proving the embedded experience before building a cleaner app structure.

## Recommended MVP

1. Keep the existing Remote.com proxy lab running.
2. Replace the current static support widget with an OpenClicky-Web widget.
3. Add a browser-native cursor overlay using the exported Clicky cursor style.
4. Add action bus methods:
   - `moveCursorToElement`
   - `highlightElement`
   - `scrollToElement`
   - `clickElement`
   - `navigate`
   - `showCaption`
   - `openCal`
   - `showBookingPrompt`
5. Add page snapshot/context extraction:
   - headings
   - CTAs
   - nav links
   - visible text
   - element bounds
   - ARIA roles / labels
6. Connect LiveKit local voice room to the widget.
7. Add agent worker:
   - Parakeet ASR
   - local LLM
   - Moss query tool
   - browser action tool
   - Cal.com scheduling tool
8. Add Stagehand later as an offscreen resolver for arbitrary pages.

## Suggested Repo Shape

```text
apps/
  website-lab/          # Remote.com proxy/demo page
  widget/               # OpenClicky-Web browser widget
  agent/                # LiveKit agent worker

services/
  livekit/              # local LiveKit config/scripts
  token-server/         # issues LiveKit tokens
  moss-runtime/         # local-only Moss query wrapper
  moss-indexer/         # cloud/index build only, not runtime
  cal/                  # Cal.com scheduling API/embed helpers
  browser-resolver/     # Stagehand/Playwright selector resolver

packages/
  action-protocol/      # typed browser action schema
  page-snapshot/        # DOM/ARIA snapshot utilities
  cursor-ui/            # cursor, captions, highlights
```

## Key Implementation Rule

The browser widget owns the prospect-facing illusion.

Stagehand/Browser Use/Playwright may discover what to do, but the widget should execute the visible action. The prospect should see a smooth cursor fly to a CTA, a section highlight, a scroll, or a Cal.com modal. They should not see a raw automation harness.

## Recommended Libraries

- Stagehand: semantic browser action resolution.
- Playwright: test harness and locator philosophy.
- Driver.js: highlights/attention overlays, if useful.
- rrweb: local replay/debug mode.
- Cal.com embed first, API second.
- OpenClicky native app: local sidecar only.

## Non-Goals For MVP

- Do not build a full Slack/Hermes gateway.
- Do not hardcode every Remote.com path.
- Do not make native OpenClicky drive real prospects' machines.
- Do not make Cal.com booking happen through coordinate clicks.
- Do not depend on hosted Moss runtime behavior.

## First Codex Task

Start by turning the current proxy prototype into a proper local app with an injected OpenClicky-Web action bus and visible cursor. Prove this flow first:

```text
User asks: "How does Remote help with global payroll?"
Agent answers aloud.
Widget scrolls to/payroll-related section or nav item.
Cursor moves there.
Relevant text/CTA is highlighted.
Agent offers to book a meeting.
Cal.com opens in-page/modal after confirmation.
```

That is the spine. Once that feels good, wire LiveKit + Moss + local models around it.

## Local MVP Lab

The current repo implements the first proof as a lean local Node app:

```bash
npm run check
PORT=4199 CAL_URL=https://cal.com/remote npm run dev
```

Open:

- Wrapper page: `http://localhost:4199/`
- Direct proxied Remote page: `http://localhost:4199/direct`

The injected widget exposes `window.OpenClickyWeb` / `window.OpenClickyWebMVP` with the first action-bus methods:

- `moveCursorToElement`
- `highlightElement`
- `scrollToElement`
- `clickElement`
- `navigate`
- `showCaption`
- `openCal`
- `showBookingPrompt`
- `snapshotPage`

The local proof flow is the `Ask payroll question` button or the command `How does Remote help with global payroll?`. It answers in the widget, speaks through browser speech synthesis when available, captures a page snapshot, scrolls to a payroll-related target, moves the visible cursor, highlights the target, asks for booking confirmation, then opens the configured Cal.com URL in an in-page modal.

This proxy is a local lab surface only. It strips and rewrites security headers so Remote.com can be embedded and inspected locally; do not treat that proxy behavior as a production deployment pattern.

## Local Voice-Agent Harness

The next layer adds a local token server, simulated agent worker, and browser bridge around the existing website lab.

Run the local pieces in separate terminals:

```bash
# Optional transport proof: self-hosted LiveKit, not LiveKit Cloud.
livekit-server --dev

# Local LiveKit token issuer plus WebSocket fallback bridge.
npm run dev:token

# Local SDR worker over WebSocket fallback.
npm run dev:agent

# Or, with livekit-server --dev running, local SDR worker over LiveKit data.
AGENT_TRANSPORT=livekit npm run dev:agent
# Equivalent helper:
npm run dev:agent:livekit

# Remote.com website lab with browser-native OpenClicky-Web widget.
PORT=4199 TOKEN_SERVER_URL=http://127.0.0.1:4301 npm run dev:lab
```

Open `http://localhost:4199/direct`, then use:

- `Ask payroll question` for deterministic local fallback.
- `Connect local transport` to prefer the local LiveKit room, then fall back to the WebSocket bridge if LiveKit is unavailable.
- `Ask agent` to send the current text question to `apps/agent`.
- `Send simulated transcript` to send the same text as typed transcript input.
- `Disconnect` and `Interrupt` to stop local transport/audio playback without implying ASR is proven.

Current proof level:

- LiveKit tokens are real local-dev JWTs for `ws://127.0.0.1:7880`.
- LiveKit data-channel control is verified locally with `npm run smoke:livekit`, with the WebSocket fallback disabled.
- The browser LiveKit path is verified locally: browser joins the local room, sends the payroll question, receives `agent.action`, guides the page, and keeps Cal gated until confirmation.
- The WebSocket bridge remains as an honest fallback when LiveKit is unavailable.
- Mic publication is requested from the browser `Connect local transport` action, but ASR is still not attached to the audio track.
- ASR, LLM, TTS, and Moss have local-first adapter contracts and deterministic local stubs; these prove wiring and guardrails only, not local model/runtime proof.
- Cal.com is not loaded until the user confirms the booking prompt.

For the real local-model GPU lane, use docs/vast-h100-runbook.md and the scripts under scripts/vast-h100/.

More detailed status lives in `docs/proof-matrix.md`.

Useful local adapter checks:

```bash
npm run smoke:adapters
npm run smoke:local
npm run smoke:livekit
npm run dev:qwen-stub
npm run dev:moss-runtime
```
