import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { createLocalParakeetAdapter } from "../apps/agent/adapters/asr/local-parakeet.mjs";
import { createAdapterRegistry } from "../apps/agent/adapters/registry.mjs";

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

test("local Parakeet adapter rejects non-local endpoints", () => {
  assert.throws(
    () => createLocalParakeetAdapter({ ASR_BASE_URL: "https://asr.example.com" }),
    /must point at localhost/,
  );
  assert.throws(
    () => createLocalParakeetAdapter({
      ASR_BASE_URL: "http://127.0.0.1:4321",
      ASR_TRANSCRIBE_PATH: "https://asr.example.com/v1/asr/transcribe",
    }),
    /ASR_TRANSCRIBE_PATH must be a local absolute path/,
  );
  assert.throws(
    () => createLocalParakeetAdapter({
      ASR_BASE_URL: "http://127.0.0.1:4321",
      ASR_HEALTH_PATH: "//asr.example.com/health",
    }),
    /ASR_HEALTH_PATH must be a local absolute path/,
  );
});

test("local Parakeet adapter posts audio to localhost and normalizes transcript metadata", async () => {
  const seen = [];
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, provider: "fake-parakeet", localOnly: true }));
      return;
    }

    if (request.method === "POST" && request.url === "/v1/asr/transcribe") {
      const body = await readBody(request);
      seen.push(body);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        provider: "fake-parakeet",
        model: body.model,
        transcript: "How does Remote help with global payroll?",
        language: body.language,
        confidence: 0.93,
        final: true,
        simulated: body.requestId === "asr_simulated",
        localOnly: true,
        source: "fresh-model",
        inputAudioSha256: "b".repeat(64),
        audioBytes: 3244,
        durationMs: 1000,
        sampleRate: body.sampleRate,
        channels: 1,
        transcribeMs: 42,
        device: "cuda",
        gpuName: "NVIDIA H100 80GB HBM3",
      }));
      return;
    }

    response.writeHead(404);
    response.end();
  });

  const baseUrl = await listen(server);
  try {
    const registry = createAdapterRegistry({
      ASR_PROVIDER: "local-parakeet",
      ASR_BASE_URL: baseUrl,
      ASR_MODEL: "nvidia/parakeet-tdt-0.6b-v3",
      ASR_LANGUAGE: "en",
      ASR_SAMPLE_RATE: "16000",
    });

    assert.equal(registry.asr.provider, "local-parakeet");
    const status = registry.asr.status();
    assert.equal(status.proof, "configured");
    assert.equal(status.detail.model, "nvidia/parakeet-tdt-0.6b-v3");
    assert.equal(status.detail.sampleRate, 16000);
    assert.deepEqual(await registry.asr.health(), { ok: true, provider: "fake-parakeet", localOnly: true });

    const result = await registry.asr.transcribe({
      requestId: "asr_test",
      audioBase64: Buffer.from("fake wav").toString("base64"),
      mimeType: "audio/wav",
    });

    assert.equal(result.simulated, false);
    assert.equal(result.provider, "fake-parakeet");
    assert.equal(result.model, "nvidia/parakeet-tdt-0.6b-v3");
    assert.match(result.transcript, /global payroll/i);
    assert.equal(result.language, "en");
    assert.equal(result.confidence, 0.93);
    assert.equal(result.localOnly, true);
    assert.equal(result.source, "fresh-model");
    assert.equal(result.inputAudioSha256, "b".repeat(64));
    assert.equal(result.audioBytes, 3244);
    assert.equal(result.durationMs, 1000);
    assert.equal(result.sampleRate, 16000);
    assert.equal(result.channels, 1);
    assert.equal(result.transcribeMs, 42);
    assert.equal(result.device, "cuda");
    assert.equal(result.gpuName, "NVIDIA H100 80GB HBM3");
    assert.equal(seen.length, 1);
    assert.equal(seen[0].requestId, "asr_test");
    assert.equal(seen[0].sampleRate, 16000);
    assert.equal(seen[0].model, "nvidia/parakeet-tdt-0.6b-v3");
    assert.ok(seen[0].audioBase64);

    const simulated = await registry.asr.transcribe({
      requestId: "asr_simulated",
      audioBase64: Buffer.from("fake wav").toString("base64"),
      mimeType: "audio/wav",
    });

    assert.equal(simulated.simulated, true);
    assert.equal(seen.length, 2);
    await assert.rejects(
      () => registry.asr.transcribe({ audioPath: "https://example.com/audio.wav" }),
      /audioPath must be a local filesystem path/,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
