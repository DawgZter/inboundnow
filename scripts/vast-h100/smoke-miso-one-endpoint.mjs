#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createLocalMisoOneAdapter } from "../../apps/agent/adapters/tts/local-miso-one.mjs";

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const artifactDir = join("artifacts", "smoke", "miso-one-h100-" + timestamp);
const text = process.env.TTS_SMOKE_TEXT || "Remote helps teams run global payroll while keeping local compliance context in the conversation.";

async function collectStream(adapter, label) {
  const startedAt = Date.now();
  let firstChunkAt = 0;
  const events = [];
  for await (const event of adapter.stream({ text, requestId: "miso_one_" + label, voiceProfile: "miso_lora_dev" })) {
    if (event.type === "chunk" && !firstChunkAt) firstChunkAt = Date.now();
    events.push(event);
  }

  return {
    label,
    eventCount: events.length,
    chunkCount: events.filter((event) => event.type === "chunk").length,
    firstChunkMs: firstChunkAt ? firstChunkAt - startedAt : null,
    totalMs: Date.now() - startedAt,
    cacheHit: events.some((event) => event.cacheHit === true),
    sampleRate: events.find((event) => event.sampleRate)?.sampleRate || events.find((event) => event.type === "chunk")?.sampleRate || null,
    format: events.find((event) => event.format)?.format || events.find((event) => event.type === "chunk")?.format || null,
    firstEvent: events[0] || null,
    lastEvent: events.at(-1) || null,
  };
}

await mkdir(artifactDir, { recursive: true });

const adapter = createLocalMisoOneAdapter({
  ...process.env,
  TTS_BASE_URL: process.env.TTS_BASE_URL || "http://127.0.0.1:4331",
  TTS_MODEL: process.env.TTS_MODEL || "MisoLabs/MisoTTS",
  TTS_VOICE: process.env.TTS_VOICE || "miso-one-lora-dev",
  TTS_DTYPE: process.env.TTS_DTYPE || "bfloat16",
  TTS_QUANTIZATION: process.env.TTS_QUANTIZATION || "llm-int8",
  TTS_CACHE_DIR: process.env.TTS_CACHE_DIR || "artifacts/cache/miso-one-tts",
  TTS_LORA_ADAPTER: process.env.TTS_LORA_ADAPTER || process.env.MISO_LORA_ADAPTER || "artifacts/miso-lora/adapters/miso-one-lora-dev",
});

const status = adapter.status();
const health = await adapter.health();
assert.equal(status.provider, "local-miso-one");
assert.equal(health.ok, true);
assert.equal(health.localOnly, true);

const prewarm = await adapter.prewarm();
const cold = await collectStream(adapter, "cold");
assert.ok(cold.chunkCount > 0, "expected at least one streamed audio chunk");
assert.ok(cold.firstChunkMs !== null, "expected first audio chunk latency");

const warm = await collectStream(adapter, "warm");
assert.ok(warm.chunkCount > 0, "expected warm request to stream audio chunks");

const result = {
  ok: true,
  artifactDir,
  proof: "h100-local-miso-one-endpoint",
  boundary: "Real Miso One LoRA voice proof only if this ran against an H100-local MisoTTS endpoint with an applied consented LoRA adapter artifact. Endpoint metadata alone is not clone proof.",
  baseUrl: status.detail.baseUrl,
  model: status.detail.model,
  voice: status.detail.voice,
  dtype: status.detail.dtype,
  quantization: status.detail.quantization,
  loraAdapter: status.detail.loraAdapter,
  cacheDir: status.detail.cacheDir,
  health,
  prewarm,
  cold,
  warm,
};

await writeFile(join(artifactDir, "result.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
