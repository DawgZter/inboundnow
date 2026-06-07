import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { createLocalVibeVoiceAdapter } from "../apps/agent/adapters/tts/local-vibevoice.mjs";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve("http://127.0.0.1:" + address.port);
    });
    server.on("error", reject);
  });
}

async function readBody(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body ? JSON.parse(body) : {};
}

test("local VibeVoice adapter rejects non-local endpoints", () => {
  assert.throws(
    () => createLocalVibeVoiceAdapter({ TTS_BASE_URL: "https://tts.example.com" }),
    /must point at localhost/,
  );
  assert.throws(
    () => createLocalVibeVoiceAdapter({
      TTS_BASE_URL: "http://127.0.0.1:4331",
      TTS_STREAM_PATH: "https://tts.example.com/v1/tts/stream",
    }),
    /TTS_STREAM_PATH must be a local absolute path/,
  );
  assert.throws(
    () => createLocalVibeVoiceAdapter({
      TTS_BASE_URL: "http://127.0.0.1:4331",
      TTS_HEALTH_PATH: "//tts.example.com/health",
    }),
    /TTS_HEALTH_PATH must be a local absolute path/,
  );
});

test("local VibeVoice adapter streams localhost NDJSON and preserves optimization metadata", async () => {
  const seen = [];
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, provider: "fake-vibevoice", cacheReady: true }));
      return;
    }

    if (request.method === "POST" && request.url === "/prewarm") {
      const body = await readBody(request);
      seen.push({ path: request.url, body });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, cacheHit: false, firstAudioMs: 0 }));
      return;
    }

    if (request.method === "POST" && request.url === "/v1/tts/stream") {
      const body = await readBody(request);
      seen.push({ path: request.url, body });
      response.writeHead(200, { "content-type": "application/x-ndjson" });
      response.write(JSON.stringify({ type: "start", sampleRate: 24000, cacheHit: false }) + "\n");
      response.write(JSON.stringify({ type: "chunk", sequence: 0, audio: "AAAA", firstAudioMs: 12 }) + "\n");
      response.write(JSON.stringify({ type: "end", totalMs: 24, cacheHit: true }) + "\n");
      response.end();
      return;
    }

    response.writeHead(404);
    response.end();
  });

  const baseUrl = await listen(server);
  try {
    const adapter = createLocalVibeVoiceAdapter({
      TTS_BASE_URL: baseUrl,
      TTS_MODEL: "microsoft/VibeVoice-Realtime-0.5B",
      TTS_VOICE: "Carter",
      TTS_DTYPE: "bfloat16",
      TTS_QUANTIZATION: "llm-int8",
      TTS_CACHE_DIR: "artifacts/cache/tts-test",
      TTS_TEXT_CHUNK_CHARS: "80",
    });

    const status = adapter.status();
    assert.equal(status.proof, "configured");
    assert.equal(status.detail.quantization.name, "llm-int8");
    assert.equal(status.detail.quantization.target, "llm");
    assert.equal(status.detail.quantization.preserveAudioDecoderPrecision, true);
    assert.equal(status.detail.cacheDir, "artifacts/cache/tts-test");

    assert.deepEqual(await adapter.health(), { ok: true, provider: "fake-vibevoice", cacheReady: true });
    const prewarm = await adapter.prewarm();
    assert.equal(prewarm.ok, true);

    const events = [];
    for await (const event of adapter.stream({ text: "Remote helps with global payroll.", requestId: "tts_test" })) {
      events.push(event);
    }

    assert.equal(events.length, 3);
    assert.equal(events[0].provider, "local-vibevoice");
    assert.equal(events[1].type, "chunk");
    assert.equal(events[1].sequence, 0);
    assert.equal(events[1].quantization, "llm-int8");
    assert.equal(events[1].dtype, "bfloat16");
    assert.equal(events[2].cacheHit, true);

    const loraEvents = [];
    for await (const event of adapter.stream({
      text: "Remote helps with global payroll.",
      requestId: "tts_lora_test",
      voiceProfile: {
        id: "miso_lora_dev",
        ttsVoice: "miso-one-lora-dev",
        ttsModel: "MisoLabs/MisoTTS",
        style: "expressive",
        loraAdapter: "artifacts/miso-lora/adapters/miso-one-lora-dev",
      },
    })) {
      loraEvents.push(event);
    }

    assert.equal(loraEvents[0].model, "MisoLabs/MisoTTS");
    assert.equal(loraEvents[0].voice, "miso-one-lora-dev");
    assert.equal(loraEvents[0].style, "expressive");
    assert.equal(loraEvents[0].loraAdapter, "artifacts/miso-lora/adapters/miso-one-lora-dev");
    assert.ok(seen.some((item) => item.path === "/prewarm" && item.body.quantization === "llm-int8"));
    const streamBodies = seen.filter((item) => item.path === "/v1/tts/stream").map((item) => item.body);
    assert.equal(streamBodies.length, 2);
    assert.ok(streamBodies[0].cacheKey);
    assert.ok(streamBodies[1].cacheKey);
    assert.notEqual(streamBodies[0].cacheKey, streamBodies[1].cacheKey);
    assert.equal(streamBodies[1].voice, "miso-one-lora-dev");
    assert.equal(streamBodies[1].style, "expressive");
    assert.equal(streamBodies[1].loraAdapter, "artifacts/miso-lora/adapters/miso-one-lora-dev");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
