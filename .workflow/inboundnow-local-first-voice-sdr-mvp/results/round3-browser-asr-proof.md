# Round 3: browser Cal gate and ASR proof

## Goal

Upgrade the proof surface after the local Parakeet adapter checkpoint.

## Success criteria

- Browser-level smoke proves Cal iframe stays unloaded before explicit
  confirmation and opens only after confirmation.
- LiveKit microphone/audio capture path is exercised by an automated smoke,
  not only the direct prospect.audio data-message shortcut.
- The proof matrix and workflow state distinguish browser transcript fallback,
  fake localhost Parakeet endpoint proof, and real H100 Parakeet proof.
- Fresh subagents review UX gating and LiveKit/ASR evidence while local work
  continues.

## Ownership

- Main agent: implement the smoke(s), integrate findings, run checks, commit.
- Sidecar UX reviewer: inspect browser Cal gating and voice-state UX risks.
- Sidecar runtime reviewer: inspect LiveKit audio/ASR proof boundaries and
  smoke coverage gaps.

## Verification target

- npm run check
- npm run smoke:local
- npm run smoke:livekit
- New browser/ASR smoke command(s) added in this checkpoint.

## Browser Cal gate result

Implemented `scripts/smoke-browser-cal-gate.mjs` with a local mocked Remote-like
page proxied through the real website lab. The smoke verifies:

- Cal iframe `src` stays empty on initial load.
- `confirmBooking` without an existing prompt shows the prompt and does not
  load Cal.
- `openCal` defers when not confirmed and keeps the scheduler hidden.
- A dismissed prompt followed by `yes` re-prompts instead of opening Cal.
- Clicking `Yes, open Cal` loads the configured Cal URL and emits `calOpened`
  after `bookingPromptShown`.

Latest passing artifact:
`artifacts/smoke/browser-cal-gate-2026-06-07T13-03-08-522Z/result.json`.

Fixes found while adding this proof:

- The generic page URL rewriter was rewriting the widget's own Cal `data-src`
  and link after injection; `#ocw-root` is now excluded from that rewriter.
- Regexes inside the injected browser script needed double escaping because
  they live in a server-side template literal; whitespace normalization and
  voice intent word-boundaries now survive into the served browser JS.
- Dismissed booking prompts no longer count as latent consent.

## Sidecar review integration

Archimedes confirmed the browser proof gap: prior Node smokes did not prove DOM
iframe state, and the dismissed-prompt path needed an explicit product
decision. The new browser smoke covers both.

Euler confirmed the LiveKit audio proof gap: current code attaches
`AudioStream(track)` in the worker, but existing smokes still prove data
shortcuts only. The next implementation checkpoint should add a synthetic
LiveKit media smoke that publishes a 16 kHz mono microphone track into the
local room, sends `prospect.asr.start` and `prospect.asr.stop`, and asserts the
fake localhost Parakeet endpoint receives a valid WAV before `agent.asr.final`.
Even after that smoke, real browser microphone audio, real H100 Parakeet
transcription, VAD/partial streaming, and model accuracy remain unproven.
