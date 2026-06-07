import assert from "node:assert/strict";
import { test } from "node:test";
import { createLocalMisoOneAdapter } from "../apps/agent/adapters/tts/local-miso-one.mjs";

test("local Miso One adapter enforces localhost endpoints", () => {
  assert.throws(
    () => createLocalMisoOneAdapter({ TTS_BASE_URL: "https://tts.example.com" }),
    /localhost/,
  );
});

test("local Miso One adapter defaults to MisoTTS and LoRA metadata", () => {
  const adapter = createLocalMisoOneAdapter({
    TTS_BASE_URL: "http://127.0.0.1:4331",
    TTS_QUANTIZATION: "llm-int8",
  });
  const status = adapter.status();

  assert.equal(adapter.provider, "local-miso-one");
  assert.equal(status.label, "miso-one-local");
  assert.equal(status.detail.model, "MisoLabs/MisoTTS");
  assert.equal(status.detail.voice, "miso-one-lora-dev");
  assert.equal(status.detail.style, "expressive");
  assert.equal(status.detail.loraAdapter, "artifacts/miso-lora/adapters/miso-one-lora-dev");
  assert.equal(status.detail.quantization.name, "llm-int8");
});
