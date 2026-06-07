# Non-Scripted Local Voice Persona Goal

Use this document as the full contract for the next long-running slash goal when the goal input box is too small.

## Short Slash Goal

```text
/goal Build the non-scripted all-local InboundNow voice persona MVP described in docs/non-scripted-local-voice-persona-goal.md. Use the current committed repo as the baseline, work in git with frequent clean commits, spawn multiple subagents for implementation/review/debugging/research, and do not call it complete until the real local voice loop works end to end with proof.
```

## Objective

Build the real, non-scripted InboundNow local-first website voice persona.

The target experience is simple: open the local website lab, click to start the AI persona, grant mic access, speak naturally, and the local persona listens, reasons, speaks back, and visibly interacts with the page. The success path must not depend on hardcoded demo macros, scripted payroll assumptions, hosted model calls, hosted Moss runtime behavior, or LiveKit Cloud.

## Operating Rules

- Work in git the entire time.
- Make frequent checkpoint commits and keep the repo clean between milestones.
- Preserve clean commit metadata: no co-author tags and no Codex author metadata.
- Spawn multiple subagents throughout to move faster and improve quality.
- Use subagents for repo exploration, local-model runtime research, H100/Vast.ai setup review, LiveKit media debugging, Parakeet ASR verification, VibeVoice/Miso LoRA TTS integration, Moss retrieval quality, browser UX review, security/boundary review, and end-to-end verification.
- Keep proof boundaries explicit. Do not claim ASR, LLM, TTS, Moss, browser mic, or voice clone proof unless the repo has a fresh local artifact showing it.

## Runtime Requirements

- All runtime services must be local.
- Use local LiveKit, not LiveKit Cloud.
- Use local Moss runtime/artifacts, not hosted Moss runtime behavior.
- Use local Parakeet v3 for ASR.
- Use local Qwen 3.6 27B through a vLLM or SGLang OpenAI-compatible planner endpoint.
- Use local Miso One/MisoTTS streaming TTS with cloned voices represented by consented LoRA finetunes, not in-context voice cloning. Legacy VibeVoice can remain as a compatibility lane only.
- Use H100-class GPU hardware for real local-model proof. The recommended setup path is Vast.ai with the PyTorch CUDA/cuDNN template, following the repo runbooks and scripts.
- Production visitor control must stay browser-native through OpenClicky-Web. No native desktop control for production visitors.

## Product Experience

- The browser UI has a clear Start AI Persona flow.
- Starting the persona connects to local LiveKit, requests mic permission, joins the room, and shows health/status for LiveKit, mic, ASR, planner, retrieval, and TTS.
- The user can speak naturally instead of typing a scripted prompt.
- The persona can handle follow-up turns and interruptions.
- The persona can switch voice during the same session based on user language, including switching to the configured Miso LoRA voice profile when available.
- The persona responds with streamed speech and visible page guidance.
- Cal booking remains gated. Cal must not load until the user explicitly confirms booking intent.

## Implementation Deliverables

- Make local LiveKit the default transport for browser mic, agent control, data messages, and voice session state.
- Wire real browser microphone audio through local LiveKit into the worker.
- Wire local Parakeet v3 ASR end to end from browser mic audio to final transcript.
- Add partial/final transcript handling with honest latency/status display.
- Index the Remote.com scrape/page corpus for local Moss retrieval and query it at runtime with bounded snippets and source metadata.
- Replace the hardcoded deterministic router as the main path with a local planner loop.
- The planner loop must use ASR transcript, page snapshot, local Moss snippets, conversation state, booking state, voice state, and the typed action schema.
- The planner must output validated JSON only: answer plus typed OpenClicky-Web actions.
- Invalid planner output must fall back safely before any action is executed; in H100 proof mode, weak ASR/Moss/planner/TTS proof must fail closed before answer/action instead of falling back into a demo path.
- Demote or remove scripted macros such as `payrollFlow` from the main success path. Prefer primitive typed actions: scroll, highlight, click, caption, prompt, safe navigation, and booking confirmation.
- Wire local Qwen 3.6 27B planner support through vLLM or SGLang with an OpenAI-compatible API.
- Wire local Miso One/MisoTTS streaming TTS into the worker and browser playback path.
- Support a consented Miso LoRA voice development path: manifest validation, local-only data paths, training/inference scripts, runtime profile metadata, cache keys, and clear non-impersonation boundaries.
- Add voice switching that can change voice style/profile mid-session without restarting.
- Add latency optimizations: ASR/LLM/TTS prewarm, local retrieval index caching, TTS cache keys, streaming text/audio, and fair quantization policies that preserve audio quality.
- Add dev scripts and docs for starting the full stack locally and on a Vast.ai H100.

## Hard Constraints

- No LiveKit Cloud.
- No hosted Moss runtime behavior.
- No hosted ASR, LLM, or TTS in the success path.
- No fake claims about real-model proof.
- No production visitor native desktop control.
- No Cal iframe load before explicit confirmation.
- Stagehand may remain a later/offscreen selector-resolution helper only; it must not execute visible UI in this MVP.
- Do not treat text transcript fallback, fake local endpoints, or synthetic media frames as proof of real browser mic plus real model behavior.

## Verification Target

From a clean local run on an H100/Vast.ai setup, prove this path:

- Start local LiveKit, Moss runtime, Parakeet v3 ASR, Qwen 3.6 27B planner, and Miso One/MisoTTS.
- Open the local website lab.
- Click Start AI Persona.
- Grant microphone access.
- Speak: "How does Remote help with global payroll?"
- Browser mic audio reaches local Parakeet v3 and produces a transcript.
- The worker queries local Moss and returns relevant Remote.com snippets.
- The local planner creates an answer and primitive typed browser actions without relying on `payrollFlow`.
- The persona speaks back through local TTS audio.
- The browser visibly scrolls, highlights, captions, clicks, or prompts on the page.
- Booking prompt appears when appropriate.
- Cal opens only after explicit confirmation.
- Sanitized evidence manifests, result summaries, hashes, and docs are committed. Raw microphone audio, token-bearing logs, full browser traces, and bulky local smoke artifacts stay local or are attached privately.

## Completion Standard

Do not mark the goal complete until the non-scripted local voice persona works end to end and the proof matrix clearly separates real local model proof from fallback/stub/contract proof.

Before completion, run independent subagent reviews for:

- Runtime/model stack.
- Browser UX and voice interaction.
- Security and local-only boundaries.
- End-to-end verification artifacts.

Integrate their findings or explicitly document why a finding is deferred.
