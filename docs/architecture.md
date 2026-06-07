# Architecture

InboundNow is a local-first voice SDR website guide. The target architecture is:

```text
Browser mic + typed fallback
-> local LiveKit room
-> ASR / LLM / TTS adapters
-> Moss local retrieval
-> planner + action protocol
-> inboundnow browser layer browser widget
-> visible cursor, highlight, scroll, click, and Cal confirmation
```

## Current Committed Harness

```text
Remote.com local proxy lab
-> embedded inboundnow browser layer widget
-> local token server
-> LiveKit data-channel transport or WebSocket fallback
-> agent worker
-> adapter registry
-> deterministic keyword router
-> typed browser actions
-> visible page guidance and Cal confirmation gate
```

## Responsibility Boundaries

The browser widget owns the prospect-facing illusion. It is the only layer that moves the cursor, scrolls, highlights, clicks, speaks through browser fallback, or opens Cal.

The agent worker owns the turn loop: receive a prospect question, query adapters, choose an intent, answer, and emit typed inboundnow browser layer actions.

The action protocol owns validation and gating. It rejects unsafe action types, unsafe navigation, overlong output, malformed targets, and `openCal` before booking confirmation.

Adapters own proof-specific local boundaries. Stub adapters prove wiring; real proof requires local ASR, local LLM, local TTS, or real local Moss runtime calls.

## Transport Modes

LiveKit mode is the target local transport. It uses `livekit-server --dev`, local token issuance, `livekit-client` in the browser, and `@livekit/rtc-node` in the agent worker.

Bridge mode is a local fallback over WebSocket. It remains useful for deterministic debug and CI-ish smoke checks, but it is not the final transport.

