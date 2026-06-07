# Local Runbook

## Common Checks

```bash
npm run check
npm run smoke:adapters
npm run smoke:planner
npm run smoke:moss:local
npm run smoke:tts:local
npm run smoke:browser:cal-gate
npm run smoke:local
npm run smoke:livekit
```

`smoke:browser:cal-gate` uses Playwright Chromium. If Chromium is not installed in the local Playwright cache yet, run `npx playwright install chromium` once.

`smoke:local`, `smoke:browser:cal-gate`, and `smoke:livekit` write logs and `result.json` under `artifacts/smoke/`. The `artifacts/` folder is gitignored.

## Bridge Fallback Mode

```bash
npm run dev:token
npm run dev:agent
PORT=4199 TOKEN_SERVER_URL=http://127.0.0.1:4301 npm run dev:lab
```

Open `http://localhost:4199/direct`, click `Connect local transport`, then `Ask agent`.

## LiveKit Mode

```bash
livekit-server --dev
ENABLE_SIM_BRIDGE=0 npm run dev:token
npm run dev:agent:livekit
PORT=4199 TOKEN_SERVER_URL=http://127.0.0.1:4301 npm run dev:lab
```

Open `http://localhost:4199/direct`, click `Connect local transport`, then `Ask agent`.

Expected proof level in this mode: browser and agent exchange control messages over a local LiveKit room. ASR, local LLM, local TTS, and real Moss runtime remain unproven unless their dedicated smokes are run and captured.

## H100 Local-Model Lane

The real model lane requires an H100-class GPU. Use docs/vast-h100-runbook.md for the Vast.ai PyTorch-template setup, H100 preflight, Qwen vLLM endpoint, port tunnels, and evidence capture.

## Local Retrieval Artifact

```bash
npm run moss:index
npm run smoke:moss:local
```

`npm run moss:index` builds `artifacts/moss/remote-local-index.json` from the checked-in Remote fixture pages. `npm run smoke:moss:local` builds a deterministic smoke artifact, starts `services/moss-runtime` with `MOSS_RUNTIME_PROVIDER=local-artifact`, queries `/health` and `/query`, then queries the same runtime through the agent `local-runtime-client`.

Manual runtime mode:

```bash
npm run moss:index
MOSS_RUNTIME_PROVIDER=local-artifact npm run dev:moss-runtime
MOSS_PROVIDER=local-runtime-client MOSS_RUNTIME_URL=http://127.0.0.1:4321 npm run dev:agent
```

This proves local artifact retrieval only. It is not hosted Moss, not Moss SDK proof, and it must not use `autoRefresh`, cloud polling, `pushIndex()`, runtime document upload, session document upload, or session embedding upload.

## Remote.com Scrape Corpus

The imported scrape lives at `data/remote-com/scrape-2026-06-07`. It is partial: the source manifest reports 10,842 completed pages and 31,343 selected URLs still remaining when the run was stopped by user request.

Build a local JSON retrieval artifact from the imported corpus:

```bash
npm run moss:index:remote
```

Export the same corpus in the Moss CLI document format:

```bash
npm run moss:docs:remote
```

That writes `artifacts/moss/remote-com-documents.json` with 10,842 documents. The latest local run produced a 62,531,653-byte Moss document file and a 102 MB local retrieval artifact. Both generated files stay under gitignored `artifacts/`.

Run the full local scrape-corpus proof when you want the slower end-to-end check:

```bash
npm run smoke:moss:remote
```

Hosted Moss index creation uses the official Moss CLI path. Install and authenticate once, then upload:

```bash
pip install moss-cli
moss init
npm run moss:upload:remote
```

Equivalent direct command after `npm run moss:docs:remote`:

```bash
moss index create remote-com-2026-06-07 -f artifacts/moss/remote-com-documents.json --model moss-minilm --wait
```

Cost estimate as of 2026-06-07, using Moss's published pricing at `https://docs.moss.dev/docs/pricing`: Moss lists 500 MB storage and 50 MB/month ingest on Developer, plus pay-as-you-go rates of $0.03/MB ingest and $1.50/GB-month storage. For the 62.5 MB exported document file, full PAYG ingest is about $1.88 and storage is about $0.10/month. If the Developer included 50 MB ingest applies first, the ingest overage is about $0.38. Plan floors still matter: Hobbyist is $30/month and Startup is $200/month if those features are needed.

## Streamed Speech

```bash
npm run smoke:tts:local
npm run smoke:local
npm run smoke:livekit
```

`smoke:tts:local` proves the local VibeVoice-compatible adapter contract against a fake localhost endpoint, including prewarm, stable cache keys, and LLM-only quantization metadata. It is not VibeVoice model proof.

`smoke:local` and `smoke:livekit` assert that the worker sends `agent.answer`, then `agent.speech.start/chunk/end`, then browser actions. The website lab queues those chunks through browser `speechSynthesis` so speech can begin before page guidance completes. Browser speech remains a fallback until an H100-local VibeVoice endpoint is smoked.

## Local LLM Planner Mode

Run a local OpenAI-compatible endpoint first:

```bash
QWEN_STUB_MODE=planner-json npm run dev:qwen-stub
```

Then run the agent with the opt-in planner switch:

```bash
AGENT_PLANNER=local-llm LLM_PROVIDER=qwen-openai-local LLM_BASE_URL=http://127.0.0.1:4311/v1 npm run dev:agent
```

`npm run smoke:planner` starts the Qwen-compatible stub itself and proves strict planner JSON parsing, protocol validation, and fallback boundaries. This is still stub proof, not real Qwen model proof.

## Adapter Stubs

```bash
AGENT_MODE=local-stubs npm run dev:agent
npm run dev:qwen-stub
npm run dev:moss-runtime
npm run smoke:adapters
```

These prove wiring and guardrails only.
