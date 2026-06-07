#!/usr/bin/env node
import assert from "node:assert/strict";
import { createAdapterRegistry, adapterLabels, adapterStatusMap } from "../adapters/registry.mjs";

const registry = createAdapterRegistry({
  ...process.env,
  ASR_PROVIDER: process.env.ASR_PROVIDER || "parakeet-stub",
  LLM_PROVIDER: process.env.LLM_PROVIDER || "qwen-stub",
  TTS_PROVIDER: process.env.TTS_PROVIDER || "vibevoice-stub",
  MOSS_PROVIDER: process.env.MOSS_PROVIDER || "local-fixture",
});

const statuses = adapterStatusMap(registry);
const labels = adapterLabels(registry);

assert.equal(labels.asr, "simulated-text-input");
assert.equal(labels.tts, "browser-speech-fallback");
assert.equal(statuses.asr.proof, "stub");
assert.equal(statuses.tts.proof, "stub");

const transcript = await registry.asr.transcribe({});
assert.match(transcript.transcript, /payroll/i);
assert.equal(transcript.simulated, true);

const retrieval = await registry.moss.query(transcript.transcript, { topK: 3 });
assert.ok(Array.isArray(retrieval.snippets));
assert.ok(retrieval.snippets.some((snippet) => /payroll/i.test(snippet.title + " " + snippet.text)));

const completion = await registry.llm.complete({
  messages: [{ role: "user", content: transcript.transcript }],
});
assert.ok(completion.content || completion.choices);

const speech = await registry.tts.synthesize({ text: completion.content || "fallback" });
assert.equal(speech.simulated, true);

console.log(JSON.stringify({
  ok: true,
  labels,
  proof: Object.fromEntries(Object.entries(statuses).map(([key, value]) => [key, value.proof])),
  retrievalCount: retrieval.snippets.length,
}, null, 2));

