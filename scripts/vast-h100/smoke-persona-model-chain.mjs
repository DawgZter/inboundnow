#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { adapterStatusMap, createAdapterRegistry } from "../../apps/agent/adapters/registry.mjs";
import { planQuestion } from "../../apps/agent/llm-planner.mjs";
import { isDeprecatedMacroActionType } from "../../packages/action-protocol/index.mjs";

const execFileAsync = promisify(execFile);
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const artifactDir = join("artifacts", "smoke", "persona-h100-chain-" + timestamp);
const query = process.env.PERSONA_SMOKE_QUERY || "How does Remote help with global payroll?";
const audioPath = process.env.ASR_SMOKE_AUDIO_PATH || "";
const expectedPattern = new RegExp(process.env.ASR_EXPECTED_PATTERN || "global payroll|Remote|payroll", "i");
const mossRuntimeUrl = process.env.MOSS_RUNTIME_URL || "http://127.0.0.1:4321";

function flag(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

async function gpuPreflight() {
  if (flag(process.env.ALLOW_NON_H100)) {
    return { required: "H100", allowedOverride: true, detected: "not checked" };
  }

  const { stdout } = await execFileAsync("nvidia-smi", [
    "--query-gpu=name,memory.total",
    "--format=csv,noheader",
  ]);
  const detected = stdout.trim().split(/\r?\n/).filter(Boolean);
  assert.ok(detected.some((line) => /H100/i.test(line)), "H100 GPU is required; detected: " + detected.join("; "));
  return { required: "H100", allowedOverride: false, detected };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }
  if (!response.ok) {
    throw new Error(url + " returned HTTP " + response.status + ": " + text.slice(0, 500));
  }
  return payload;
}

async function collectTtsStream(adapter, text) {
  const startedAt = Date.now();
  let firstChunkAt = 0;
  const events = [];
  for await (const event of adapter.stream({ text, requestId: "persona_h100_chain" })) {
    if ((event.audio || event.audioBase64) && !firstChunkAt) firstChunkAt = Date.now();
    events.push(event);
  }
  const chunks = events.filter((event) => event.type === "chunk");
  return {
    eventCount: events.length,
    chunkCount: chunks.length,
    firstAudioMs: firstChunkAt ? firstChunkAt - startedAt : null,
    totalMs: Date.now() - startedAt,
    cacheHit: events.some((event) => event.cacheHit === true),
    sampleRate: events.find((event) => event.sampleRate)?.sampleRate || chunks[0]?.sampleRate || null,
    format: events.find((event) => event.format)?.format || chunks[0]?.format || null,
    firstEvent: events[0] || null,
    lastEvent: events.at(-1) || null,
  };
}

if (!audioPath) {
  throw new Error("ASR_SMOKE_AUDIO_PATH is required for the H100 persona model-chain smoke.");
}

await mkdir(artifactDir, { recursive: true });

const gpu = await gpuPreflight();
const adapters = createAdapterRegistry({
  ...process.env,
  ASR_PROVIDER: "local-parakeet",
  ASR_BASE_URL: process.env.ASR_BASE_URL || process.env.PARAKEET_BASE_URL || "http://127.0.0.1:4341",
  LLM_PROVIDER: "qwen-openai-local",
  LLM_BASE_URL: process.env.LLM_BASE_URL || "http://127.0.0.1:4311/v1",
  MOSS_PROVIDER: "local-runtime-client",
  MOSS_RUNTIME_URL: mossRuntimeUrl,
  TTS_PROVIDER: process.env.TTS_PROVIDER || "local-miso-one",
  TTS_BASE_URL: process.env.TTS_BASE_URL || "http://127.0.0.1:4331",
  TTS_MODEL: process.env.TTS_MODEL || "MisoLabs/MisoTTS",
  TTS_DTYPE: process.env.TTS_DTYPE || "bfloat16",
  TTS_QUANTIZATION: process.env.TTS_QUANTIZATION || "llm-int8",
});
const statuses = adapterStatusMap(adapters);

assert.equal(statuses.asr.provider, "local-parakeet");
assert.equal(statuses.llm.provider, "qwen-openai-local");
assert.equal(statuses.moss.provider, "local-runtime-client");
assert.ok(["local-miso-one", "local-vibevoice"].includes(statuses.tts.provider));

const [asrHealth, mossHealth, ttsHealth] = await Promise.all([
  adapters.asr.health(),
  fetchJson(new URL("/health", mossRuntimeUrl).href),
  adapters.tts.health(),
]);
assert.equal(asrHealth.localOnly, true);
assert.equal(mossHealth.localOnly, true);
assert.equal(ttsHealth.ok, true);

const audioBase64 = (await readFile(audioPath)).toString("base64");
const asr = await adapters.asr.transcribe({
  requestId: "persona_h100_chain_asr",
  audioBase64,
  mimeType: audioPath.endsWith(".flac") ? "audio/flac" : "audio/wav",
  language: process.env.ASR_LANGUAGE || "en",
});
assert.equal(asr.simulated, false);
assert.match(asr.transcript, expectedPattern);

const retrieval = await adapters.moss.query(asr.transcript || query, { topK: 5 });
assert.equal(retrieval.localOnly, true);
assert.equal(retrieval.simulated, false);
assert.ok((retrieval.snippets || []).length > 0, "expected local Moss snippets");

const planResult = await planQuestion({
  question: asr.transcript || query,
  retrieval,
  pageSnapshot: {
    url: "http://127.0.0.1:4199/direct",
    title: "InboundNow H100 persona model-chain smoke",
    headings: ["Global payroll", "Book a demo"],
    ctas: ["Book a demo"],
    navLinks: ["Pricing", "Country explorer"],
  },
  bookingState: "none",
  adapters,
  env: {
    ...process.env,
    AGENT_PLANNER: "local-llm",
    AGENT_PLANNER_FAIL_CLOSED: "1",
    H100_PROOF_MODE: "1",
  },
  generateId: () => "act_h100_chain",
});

assert.equal(planResult.planner.source, "local-llm-json");
assert.equal(planResult.planner.fallback, false);
assert.ok(planResult.preparedActions.length > 0, "expected at least one primitive action");
assert.ok(planResult.preparedActions.every((action) => !isDeprecatedMacroActionType(action.type)));

const ttsPrewarm = await adapters.tts.prewarm();
const tts = await collectTtsStream(adapters.tts, planResult.plan.answer);
assert.ok(tts.chunkCount > 0, "expected streamed local TTS audio chunks");
assert.ok(tts.firstAudioMs !== null, "expected first audio latency");

const result = {
  ok: true,
  artifactDir,
  proof: "h100-known-audio-local-model-chain",
  boundary: [
    "Proves a known local audio file passed through H100-local Parakeet ASR, local Moss runtime retrieval, fail-closed Qwen JSON planning, and a localhost model-audio TTS stream.",
    "Does not prove browser microphone capture, LiveKit browser audio publication, or visible browser action execution; those require the browser persona smoke after this model-chain proof passes.",
  ].join(" "),
  gpu,
  query,
  audioPath,
  statuses,
  health: {
    asr: asrHealth,
    moss: mossHealth,
    tts: ttsHealth,
  },
  asr,
  retrieval: {
    provider: retrieval.provider,
    localOnly: retrieval.localOnly,
    simulated: retrieval.simulated,
    count: retrieval.snippets?.length || 0,
    snippets: (retrieval.snippets || []).slice(0, 3),
  },
  planner: planResult.planner,
  answer: planResult.plan.answer,
  actionTypes: planResult.preparedActions.map((action) => action.type),
  actions: planResult.preparedActions,
  tts: {
    prewarm: ttsPrewarm,
    stream: tts,
    proofFlagForWorker: flag(process.env.TTS_REAL_MODEL_PROOF || process.env.VIBEVOICE_REAL_MODEL_PROOF),
  },
};

await writeFile(join(artifactDir, "result.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
