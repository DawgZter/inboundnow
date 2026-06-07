#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createLocalParakeetAdapter } from "../../apps/agent/adapters/asr/local-parakeet.mjs";

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const artifactDir = join("artifacts", "smoke", "parakeet-h100-" + timestamp);
const audioPath = process.env.ASR_SMOKE_AUDIO_PATH || "";
const expectedPattern = new RegExp(process.env.ASR_EXPECTED_PATTERN || ".+", "i");

if (!audioPath) {
  throw new Error("ASR_SMOKE_AUDIO_PATH is required for H100 Parakeet proof.");
}

await mkdir(artifactDir, { recursive: true });

const adapter = createLocalParakeetAdapter({
  ...process.env,
  ASR_BASE_URL: process.env.ASR_BASE_URL || process.env.PARAKEET_BASE_URL || "http://127.0.0.1:4341",
  ASR_MODEL: process.env.ASR_MODEL || "nvidia/parakeet-tdt-0.6b-v3",
});

const status = adapter.status();
const health = await adapter.health();
assert.equal(status.provider, "local-parakeet");
assert.equal(status.proof, "configured");
assert.equal(health.localOnly, true);

const audioBase64 = (await readFile(audioPath)).toString("base64");
const transcript = await adapter.transcribe({
  requestId: "parakeet_h100_smoke",
  audioBase64,
  mimeType: audioPath.endsWith(".flac") ? "audio/flac" : "audio/wav",
  language: process.env.ASR_LANGUAGE || "en",
});

assert.equal(transcript.simulated, false);
assert.match(transcript.transcript, expectedPattern);

const result = {
  ok: true,
  artifactDir,
  proof: "h100-local-parakeet-endpoint",
  boundary: "Proves the localhost Parakeet-compatible endpoint returned a transcript for the provided audio file; browser mic/LiveKit frame proof is separate.",
  audioPath,
  status,
  health,
  transcript,
};

await writeFile(join(artifactDir, "result.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
