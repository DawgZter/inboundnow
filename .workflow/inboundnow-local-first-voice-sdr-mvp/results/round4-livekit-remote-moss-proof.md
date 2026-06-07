# Round 4: LiveKit agent with Remote.com Moss proof

## Goal

Turn the Remote.com scrape import from a standalone retrieval artifact proof into an agent-turn proof over the target local LiveKit transport.

## Sidecar findings

Turing reviewed the Moss/retrieval lane and recommended improving retrieval quality proof before spending more effort on hosted Moss upload. The key gap was that existing remote-corpus smokes proved indexing and runtime queries, but not bounded query-centered snippets or an agent turn grounded on the local runtime client.

Banach reviewed the H100/local-model lane and flagged that real VibeVoice browser audio and Qwen planner model proof remain future work. This checkpoint intentionally stays on the local Moss proof path and does not claim real ASR, real Qwen, or real TTS audio.

## Implementation result

- `queryLocalIndex` still scores over full local documents, but now returns bounded query-centered excerpts with source metadata, original document length, matched tokens, and excerpt status.
- `agent.answer.retrieval` now preserves `localOnly`, `artifact`, `error`, and bounded snippets so browser/LiveKit evidence can verify the retrieval boundary.
- `scripts/smoke-moss-remote.mjs` now requires Remote scrape metadata, bounded snippets, and useful payroll/compliance or MCP terms.
- Added `scripts/smoke-livekit-moss-remote.mjs` as `npm run smoke:livekit:moss-remote`.

## Latest passing artifacts

- `artifacts/smoke/moss-remote-2026-06-07T13-29-46-759Z/result.json`
- `artifacts/smoke/livekit-moss-remote-2026-06-07T13-29-04-783Z/result.json`

## Boundary retained

This proves local JSON artifact retrieval through a local Moss runtime client during a local LiveKit agent turn. It does not prove hosted Moss runtime behavior, Moss SDK runtime behavior, embeddings, semantic ranking, a real Qwen planner, real ASR, or real TTS model audio.

## Verification

Passed:

- `node --check packages/local-retrieval/index.mjs`
- `node --check apps/agent/worker.mjs`
- `node --check scripts/smoke-moss-remote.mjs`
- `node --check scripts/smoke-livekit-moss-remote.mjs`
- `node --test test/local-retrieval.test.mjs test/remote-com-scrape.test.mjs`
- `npm run smoke:moss:remote`
- `npm run smoke:livekit:moss-remote`
