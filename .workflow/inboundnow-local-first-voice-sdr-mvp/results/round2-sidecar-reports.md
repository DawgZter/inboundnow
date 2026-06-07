# Round 2 Sidecar Reports

## Meitner: LiveKit Proof

Recommendation accepted: add a LiveKit-only smoke with `ENABLE_SIM_BRIDGE=0`, start `livekit-server --dev`, run the agent with `AGENT_TRANSPORT=livekit`, and prove `prospect.question` -> `agent.answer` / `agent.action` over topic `inboundnow.control.v1`.

## Avicenna: Voice UX

Recommended next UX work: relabel proof-sensitive controls, add clearer connect/disconnect/mic/interruption states, append structured transcript turns, and show adapter proof labels from the worker metadata.

## Euclid: Security Tests

Recommended next tests: token-server localhost guards, non-local LiveKit URL rejection, CORS hardening, bridge enable/disable integration tests, payload caps, and prospect-question envelope validation.

## Popper: Docs And Proof Matrix

Accepted: add `docs/proof-matrix.md`, `docs/architecture.md`, `docs/local-runbook.md`, and `docs/troubleshooting.md`; reconcile stale adapter docs; keep final report clearly in progress until completion audit.
