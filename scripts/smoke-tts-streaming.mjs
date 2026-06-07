#!/usr/bin/env node
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createAdapterRegistry } from "../apps/agent/adapters/registry.mjs";

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const artifactDir = join("artifacts", "smoke", "tts-streaming-" + timestamp);
const requestBodies = [];

async function readBody(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body ? JSON.parse(body) : {};
}

function writeJson(response, payload) {
  response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(payload));
}

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    writeJson(response, {
      ok: true,
      provider: "fake-vibevoice-contract",
      model: "microsoft/VibeVoice-Realtime-0.5B",
      localOnly: true,
      streaming: true,
      cacheReady: true,
    });
    return;
  }

  if (request.method === "POST" && request.url === "/prewarm") {
    const body = await readBody(request);
    requestBodies.push({ path: request.url, body });
    writeJson(response, { ok: true, warmed: true, cacheHit: false, firstAudioMs: 0 });
    return;
  }

  if (request.method === "POST" && request.url === "/v1/tts/stream") {
    const body = await readBody(request);
    requestBodies.push({ path: request.url, body });
    response.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store" });
    response.write(JSON.stringify({ type: "start", sampleRate: 24000, format: "pcm16", cacheHit: false }) + "\n");
    response.write(JSON.stringify({ type: "chunk", sequence: 0, audio: "AAAA", firstAudioMs: 18 }) + "\n");
    response.write(JSON.stringify({ type: "chunk", sequence: 1, audio: "BBBB", cacheHit: true }) + "\n");
    response.write(JSON.stringify({ type: "end", totalMs: 41, cacheHit: true }) + "\n");
    response.end();
    return;
  }

  response.writeHead(404);
  response.end();
});

await mkdir(artifactDir, { recursive: true });

const baseUrl = await new Promise((resolve, reject) => {
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    resolve("http://127.0.0.1:" + address.port);
  });
  server.on("error", reject);
});

try {
  const registry = createAdapterRegistry({
    ...process.env,
    TTS_PROVIDER: "local-vibevoice",
    TTS_BASE_URL: baseUrl,
    TTS_MODEL: "microsoft/VibeVoice-Realtime-0.5B",
    TTS_VOICE: "Carter",
    TTS_DTYPE: "bfloat16",
    TTS_QUANTIZATION: "llm-int8",
    TTS_CACHE_DIR: "artifacts/cache/tts-contract",
    TTS_TEXT_CHUNK_CHARS: "96",
  });
  const status = registry.tts.status();
  assert.equal(status.provider, "local-vibevoice");
  assert.equal(status.proof, "configured");
  assert.equal(status.detail.quantization.name, "llm-int8");
  assert.equal(status.detail.quantization.preserveAudioDecoderPrecision, true);

  const health = await registry.tts.health();
  assert.equal(health.ok, true);
  assert.equal(health.localOnly, true);

  const prewarm = await registry.tts.prewarm();
  assert.equal(prewarm.warmed, true);

  const events = [];
  for await (const event of registry.tts.stream({
    requestId: "tts_contract_smoke",
    text: "Remote helps teams run global payroll with local compliance context.",
  })) {
    events.push(event);
  }

  assert.equal(events[0].type, "start");
  assert.equal(events.filter((event) => event.type === "chunk").length, 2);
  assert.equal(events.at(-1).type, "end");
  assert.equal(events[1].provider, "local-vibevoice");
  assert.equal(events[1].quantization, "llm-int8");
  assert.ok(requestBodies.some((item) => item.path === "/v1/tts/stream" && item.body.cacheKey));

  const result = {
    ok: true,
    artifactDir,
    proof: "contract-fake-local-endpoint",
    boundary: "No VibeVoice model audio proof; validates localhost streaming adapter, prewarm, cache key, and quantization metadata only.",
    status,
    health,
    prewarm,
    eventCount: events.length,
    chunkCount: events.filter((event) => event.type === "chunk").length,
    firstChunkMs: events.find((event) => event.type === "chunk")?.firstAudioMs || null,
    requestBodies,
  };

  await writeFile(join(artifactDir, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await new Promise((resolve) => server.close(resolve));
}
