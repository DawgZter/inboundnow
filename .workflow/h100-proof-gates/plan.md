# H100 Proof Gates Slice

Goal:
Make the all-local H100 proof path harder to false-green before the real browser persona loop is claimed.

Success criteria:
- H100/proof mode fails closed when Moss retrieval is missing, errored, simulated, non-local, or empty.
- H100/proof mode fails closed when ASR, planner, or TTS evidence is stub/fallback/contract-only.
- TTS proof is based on endpoint-returned evidence rather than only TTS_REAL_MODEL_PROOF.
- Browser/H100 smokes assert the visible Start AI Persona path, LiveKit mic publication, and local model metadata.
- Docs clearly separate current contract proof from real local H100 proof.

Constraints:
- Keep runtime local-only; no hosted Moss or cloud runtime dependency for the MVP proof path.
- Keep git history clean with normal single-author commits.
- Do not claim completion until a real H100 local voice loop is captured end to end.

Work packets:
- Worker proof gates: audit apps/agent/worker.mjs and adapter evidence semantics.
- H100 smoke coverage: audit scripts/vast-h100 for false greens and missing assertions.
- Docs/test drift: audit proof matrix/runbooks and propose exact test/docs updates.

Verification:
- Focused unit tests for worker proof helper logic.
- npm run check before commit.
- H100 smokes remain configured-only unless actually run on the Vast.ai H100.
