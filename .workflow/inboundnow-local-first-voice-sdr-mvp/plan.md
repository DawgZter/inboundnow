# InboundNow local-first voice SDR MVP

## Goal

Build InboundNow into a real local-first voice SDR MVP. The source contract is
`README.md`; the current committed harness is the baseline. The final product
must let a prospect speak to the Remote.com lab page, get a locally grounded
answer, see OpenClicky-Web visibly navigate the page, and only open Cal after
explicit confirmation.

## Success Criteria

- Browser and agent participate in a local LiveKit room, with token flow, mic
  capture, and action/data messages.
- Simulated text mode stays available as a deterministic fallback, but it is
  labeled as simulated.
- Browser actions flow through a typed protocol with validation, event logging,
  and regression fixtures.
- Local adapter boundaries exist for Parakeet ASR, Qwen-class local LLM via
  vLLM/SGLang, VibeVoice-style TTS, and Moss local retrieval. Anything not
  locally verified is documented as unproven.
- The payroll fallback remains the spine: answer, scroll/highlight/cursor,
  booking prompt, Cal only after confirmation.
- A one-command local smoke captures evidence from token server, agent worker,
  browser widget, Cal gate, logs, and screenshot.
- Git history has frequent checkpoint commits with no co-author tags and no
  Codex author metadata.

## Current Context

- Root README already contains the project brief and MVP contract.
- Local Remote.com proxy lab lives in `apps/website-lab/server.mjs`.
- Token server and simulated WebSocket bridge live in
  `services/token-server/server.mjs`.
- Simulated SDR agent lives in `apps/agent/worker.mjs` and
  `apps/agent/router.mjs`.
- Local LiveKit dev docs/config live under `services/livekit`.
- Adapter proof boundaries live in `docs/local-adapters.md`.

## Constraints

- No LiveKit Cloud.
- No hosted Moss runtime behavior.
- No production native desktop control.
- No fake claims about ASR, LLM, TTS, or Moss proof.
- Stagehand remains later/offscreen resolver only.
- Existing deterministic payroll flow must keep working.
- Commits must not include co-author tags or Codex author metadata.

## Risks

- LiveKit browser SDK in a vanilla Node-served page needs either a local bundle
  served from `node_modules` or a minimal bundling step.
- Real local ASR/LLM/TTS may require large downloads, hardware support, or
  separate runtimes; setup scripts and strict proof language are acceptable until
  verified locally.
- Moss runtime must be local-only after index generation; runtime code must not
  drift into cloud polling/uploads.
- Browser action failures currently need structured ack/nack semantics before
  the agent can trust action execution.
- Cal must never load or open before explicit confirmation.

## Approval Required

Ask before destructive git operations, force pushes, deployment, publishing,
credential changes, large model downloads, paid external API use, or production
data access. Local non-destructive code edits, tests, npm installs for normal
project dependencies, and localhost smoke tests are approved by the active goal.

## Work Packets

- LiveKit integration: room connection, token use, mic state, data-channel
  action messages, fallback behavior.
- Protocol/tests: action schemas, validation, fixtures, router/browser migration,
  Cal gating regressions.
- Local adapters: ASR, LLM, TTS, Moss local retrieval boundaries, setup scripts,
  proof matrix.
- Browser UX: voice tray, transcript/status, smoother cursor/highlight timing,
  confirmation state machine.
- E2E verification: one-command smoke, logs, screenshot, browser assertions.
- Review: UX/product review, security/boundary review, runtime/debug review,
  E2E evidence review.

## Integration Policy

Keep immediate blocking implementation local. Delegate bounded sidecar work to
subagents and integrate their reports explicitly. For code edits, keep write
sets disjoint where possible and commit after each stable checkpoint.

## Verification

- `npm run check`
- Protocol unit tests for valid/invalid actions and Cal gating.
- Token-server health and JWT/token behavior smoke.
- Agent-router tests for payroll, pricing, country, fallback, and malformed
  action rejection.
- Browser smoke on `http://localhost:4199/direct`: connect, ask payroll,
  visible movement/highlight, prompt, no Cal iframe `src` before confirmation,
  Cal iframe `src` after confirmation.
- Metadata scan:
  `git log --format='%H%n%an <%ae>%n%cn <%ce>%n%B%n---END---' --max-count=20 | rg -i 'codex|co-authored-by|coauthor|co-author' || true`

## Reusable Artifacts

- `.workflow/inboundnow-local-first-voice-sdr-mvp/final-report.md`
- `docs/architecture.md`
- `docs/proof-matrix.md`
- local smoke scripts under `scripts/`
