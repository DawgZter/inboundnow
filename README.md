# inboundnow

inboundnow is a local conversational website agent: you open a site, click Start AI Persona, talk to it, and the blue cursor drives the page while the agent answers. The target submission experience is simple: a buyer speaks naturally, inboundnow answers with a local voice stack, scrolls, highlights, clicks the real page, and gates scheduling until the buyer confirms.

Default run:

    npm install
    npm start

Open:

    http://localhost:4199/direct

What starts by default:

- website lab on http://localhost:4199/direct
- local token and browser/agent bridge on 127.0.0.1:4301
- local Qwen-compatible planner stub on 127.0.0.1:4311
- if needed, a local build of the ignored Remote.com retrieval index at artifacts/moss/remote-com-local-index.json
- local Moss artifact runtime on 127.0.0.1:4321 with MOSS_RUNTIME_PROVIDER=local-artifact
- inboundnow agent worker using `MOSS_PROVIDER=local-runtime-client`, streamed speech chunks, and the browser action bus

Click Start AI Persona on the default page. If local livekit-server is running, inboundnow uses the local LiveKit mic path, auto-stops after silence, sends the turn through the local agent, and the blue cursor executes the returned actions. If LiveKit is not running, Start AI Persona falls back to browser speech capture over the local bridge. After each answer, inboundnow schedules the next listen automatically, so the default flow is click once, talk naturally, and watch inboundnow keep guiding the page until you stop it. The developer controls keep Ask agent and Send typed transcript available for quick operator input.

## The Default Product Loop

    Prospect talks
    -> local LiveKit mic path or browser speech capture over the local bridge
    -> Parakeet-compatible ASR boundary
    -> local Moss retrieval over the Remote.com scrape
    -> Qwen-class planner through an OpenAI-compatible local endpoint
    -> streamed Miso One / VibeVoice-compatible TTS boundary or browser fallback chunks
    -> inboundnow browser action bus
    -> blue cursor scrolls, highlights, clicks, and opens gated scheduling

The repo default is no longer a documentation-first lab. npm start launches the local inboundnow stack, builds the local Remote.com retrieval index if it is missing, starts the local Moss artifact runtime on 127.0.0.1:4321, wires the agent through MOSS_PROVIDER=local-runtime-client, and points the operator at the talk-and-guide page.

## H100 Lane

Real local-model proof requires an H100-class GPU. The recommended setup is Vast.ai with the PyTorch CUDA/cuDNN template.

Use:

    bash scripts/vast-h100/search-offers.sh
    bash scripts/vast-h100/create-instance.example.sh
    bash scripts/vast-h100/bootstrap-instance.sh
    bash scripts/vast-h100/start-dev-stack.sh
    bash scripts/vast-h100/run-h100-proof.sh

The H100 lane targets:

- nvidia/parakeet-tdt-0.6b-v3 for ASR
- local Qwen-class serving through vLLM/SGLang/OpenAI-compatible APIs
- local Moss runtime after index generation
- Miso One / MisoTTS streaming audio
- consented LoRA finetunes for cloned voices
- fair quantization knobs that avoid wrecking speech quality while improving latency

Details live in docs/vast-h100-runbook.md, docs/miso-lora-runbook.md, and docs/local-adapters.md.

## Voice And Cursor Behavior

The browser widget owns the user-facing interaction. Planners and resolver tools may decide what should happen, but the visible result is always executed by inboundnow in the page:

- moveCursorToElement
- scrollToElement
- highlightElement
- clickElement
- navigate
- showCaption
- showBookingPrompt
- openCal
- snapshotPage

The cursor resolver accepts target keys, CSS selectors, planner labels, intent text, href hints, and element ids. That means planner outputs like "show payroll pricing", "open booking", or "go to employer of record" resolve against the live page before the cursor moves.

## Local Data

The imported Remote.com retrieval corpus is committed at data/remote-com/scrape-2026-06-07.
The generated local Moss index lives at artifacts/moss/remote-com-local-index.json. That artifact is ignored because it is large, so npm start rebuilds it from the committed scrape when needed.

Useful commands:

    npm run moss:index:remote
    npm run moss:docs:remote
    npm run moss:upload:remote

Do not put Moss project keys in client-side code or committed env files.
Hosted Moss is not part of the default local runtime. The hosted upload path remains a CLI upload/index proof lane unless it is enabled separately.

## External OSS References

The active runtime does not import vendored OSS snapshots. Keep these upstream projects as lightweight implementation references instead:

- [Stagehand](https://github.com/browserbase/stagehand) for semantic browser action resolution
- [Voicebox](https://github.com/jamiepine/voicebox) for local-first voice product reference material
- [vLLM](https://github.com/vllm-project/vllm) for H100 local model serving
- [FlashInfer](https://github.com/flashinfer-ai/flashinfer) for CUDA attention/sampling kernels
- [AWQ](https://github.com/mit-han-lab/llm-awq) and [llm-compressor](https://github.com/vllm-project/llm-compressor) for quantization/compression experiments
- [Qwen3](https://github.com/QwenLM/Qwen3) for Qwen-family model reference material

## Useful Scripts

    npm start
    npm run start:lab
    npm run dev:token
    npm run dev:agent
    npm run dev:agent:livekit
    npm run dev:qwen-stub
    npm run dev:moss-runtime
    npm run h100:prove

npm run check still exists for a broad local validation pass, but the fast submission path is npm start plus browser verification of the talk-and-guide loop.
