import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeTtsOptimizationOptions,
  QUANTIZATION_POLICIES,
  speechCacheKey,
  splitSpeechText,
} from "../packages/speech-streaming/index.mjs";

test("splitSpeechText creates bounded streaming chunks", () => {
  const chunks = splitSpeechText(
    "Remote helps with global payroll. It keeps compliance, payments, and HR workflows connected for distributed teams.",
    { maxChars: 64 },
  );

  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 64));
  assert.match(chunks[0], /global payroll/i);
});

test("speechCacheKey is stable and varies by voice and quantization", () => {
  const first = speechCacheKey("Hello   payroll", {
    model: "microsoft/VibeVoice-Realtime-0.5B",
    voice: "Carter",
    quantization: "llm-int8",
  });
  const second = speechCacheKey("hello payroll", {
    model: "microsoft/VibeVoice-Realtime-0.5B",
    voice: "Carter",
    quantization: "llm-int8",
  });
  const different = speechCacheKey("hello payroll", {
    model: "microsoft/VibeVoice-Realtime-0.5B",
    voice: "Alice",
    quantization: "llm-int8",
  });

  assert.equal(first, second);
  assert.notEqual(first, different);
});

test("normalizeTtsOptimizationOptions applies fair quantization guardrails", () => {
  const options = normalizeTtsOptimizationOptions({
    TTS_QUANTIZATION: "llm-int8",
    TTS_DTYPE: "bfloat16",
    TTS_TEXT_CHUNK_CHARS: "72",
    TTS_CACHE_DIR: "artifacts/cache/tts-smoke",
  });

  assert.equal(options.streaming, true);
  assert.equal(options.localOnly, true);
  assert.equal(options.dtype, "bfloat16");
  assert.equal(options.textChunkChars, 72);
  assert.equal(options.cacheDir, "artifacts/cache/tts-smoke");
  assert.equal(options.quantization, QUANTIZATION_POLICIES["llm-int8"]);
  assert.equal(options.quantization.target, "llm");
  assert.equal(options.quantization.preserveAudioDecoderPrecision, true);
});

test("normalizeTtsOptimizationOptions rejects unknown quantization policy", () => {
  assert.throws(
    () => normalizeTtsOptimizationOptions({ TTS_QUANTIZATION: "whole-model-int2" }),
    /Unsupported TTS quantization policy/,
  );
});
