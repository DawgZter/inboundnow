#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { createLocalParakeetAdapter } from "../../apps/agent/adapters/asr/local-parakeet.mjs";

const execFileAsync = promisify(execFile);
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const artifactDir = join("artifacts", "smoke", "parakeet-h100-" + timestamp);
const audioPath = process.env.ASR_SMOKE_AUDIO_PATH || "";
const expectedPattern = new RegExp(process.env.ASR_EXPECTED_PATTERN || ".+", "i");
const allowNonH100 = ["1", "true", "yes", "on"].includes(String(process.env.ALLOW_NON_H100 || "").trim().toLowerCase());

async function gpuPreflight() {
  if (allowNonH100) return { required: "H100", skipped: true, reason: "ALLOW_NON_H100" };
  const { stdout } = await execFileAsync("nvidia-smi", ["--query-gpu=name,memory.total", "--format=csv,noheader"]);
  const detected = stdout.trim().split(/\r?\n/).filter(Boolean);
  assert.ok(detected.some((line) => /H100/i.test(line)), "H100 GPU is required; detected: " + detected.join("; "));
  return { required: "H100", skipped: false, detected };
}

if (!audioPath) {
  throw new Error("ASR_SMOKE_AUDIO_PATH is required for H100 Parakeet proof.");
}

await mkdir(artifactDir, { recursive: true });
const gpu = await gpuPreflight();

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
assert.equal(health.provider, "local-parakeet");
if (!allowNonH100) {
  assert.match(String(health.device || ""), /cuda/i);
  assert.match(String(health.gpuName || ""), /h100/i);
}

const audioBytes = await readFile(audioPath);
const audioSha256 = createHash("sha256").update(audioBytes).digest("hex");
const audioBase64 = audioBytes.toString("base64");
const transcript = await adapter.transcribe({
  requestId: "parakeet_h100_smoke",
  audioBase64,
  mimeType: audioPath.endsWith(".flac") ? "audio/flac" : "audio/wav",
  language: process.env.ASR_LANGUAGE || "en",
});

assert.equal(transcript.simulated, false);
assert.equal(transcript.localOnly, true);
assert.match(transcript.transcript, expectedPattern);
assert.equal(transcript.inputAudioSha256, audioSha256);
assert.equal(transcript.audioBytes, audioBytes.length);
assert.ok(Number(transcript.durationMs || 0) > 0, "expected endpoint durationMs");
assert.ok(Number(transcript.transcribeMs || 0) > 0, "expected endpoint transcribeMs");
if (!allowNonH100) {
  assert.match(String(transcript.device || ""), /cuda/i);
  assert.match(String(transcript.gpuName || ""), /h100/i);
}

const result = {
  ok: true,
  artifactDir,
  proof: "h100-local-parakeet-endpoint",
  boundary: "Proves the localhost Parakeet-compatible endpoint returned a transcript for the provided audio file; browser mic/LiveKit frame proof is separate.",
  gpu,
  audioPath,
  audioSha256,
  audioBytes: audioBytes.length,
  status,
  health,
  transcript,
};

await writeFile(join(artifactDir, "result.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
