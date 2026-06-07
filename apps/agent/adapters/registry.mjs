import { createUnavailableAdapter } from "./contracts.mjs";
import { createLocalParakeetAdapter } from "./asr/local-parakeet.mjs";
import { createParakeetStubAdapter } from "./asr/parakeet-stub.mjs";
import { createQwenOpenAILocalAdapter } from "./llm/qwen-openai-local.mjs";
import { createQwenStubAdapter } from "./llm/qwen-stub.mjs";
import { createLocalArtifactMossAdapter } from "./moss/local-artifact.mjs";
import { createLocalFixtureMossAdapter } from "./moss/local-fixture.mjs";
import { createLocalRuntimeMossClient } from "./moss/local-runtime-client.mjs";
import { createLocalMisoOneAdapter } from "./tts/local-miso-one.mjs";
import { createLocalVibeVoiceAdapter } from "./tts/local-vibevoice.mjs";
import { createVibeVoiceStubAdapter } from "./tts/vibevoice-stub.mjs";

function asrAdapter(env) {
  const provider = env.ASR_PROVIDER || "parakeet-stub";
  if (provider === "local-parakeet") return createLocalParakeetAdapter(env);
  if (provider === "parakeet-stub") return createParakeetStubAdapter(env);
  return createUnavailableAdapter("asr", provider, "Unknown ASR provider; use parakeet-stub or local-parakeet.");
}

function llmAdapter(env) {
  const provider = env.LLM_PROVIDER || "qwen-stub";
  if (provider === "qwen-stub") return createQwenStubAdapter(env);
  if (provider === "qwen-openai-local") return createQwenOpenAILocalAdapter(env);
  return createUnavailableAdapter("llm", provider, "Unknown LLM provider; use qwen-stub or qwen-openai-local.");
}

function ttsAdapter(env) {
  const provider = env.TTS_PROVIDER || "vibevoice-stub";
  if (provider === "local-miso-one") return createLocalMisoOneAdapter(env);
  if (provider === "local-vibevoice") return createLocalVibeVoiceAdapter(env);
  if (provider === "vibevoice-stub") return createVibeVoiceStubAdapter(env);
  return createUnavailableAdapter("tts", provider, "Unknown TTS provider; use vibevoice-stub, local-vibevoice, or local-miso-one.");
}

function mossAdapter(env) {
  const provider = env.MOSS_PROVIDER || "local-fixture";
  if (provider === "local-artifact") return createLocalArtifactMossAdapter(env);
  if (provider === "local-fixture") return createLocalFixtureMossAdapter(env);
  if (provider === "local-runtime-client") return createLocalRuntimeMossClient(env);
  if (provider === "none") return createUnavailableAdapter("moss", provider, "Moss retrieval disabled.");
  return createUnavailableAdapter("moss", provider, "Unknown Moss provider; use local-fixture, local-artifact, or local-runtime-client.");
}

export function createAdapterRegistry(env = process.env) {
  return {
    asr: asrAdapter(env),
    llm: llmAdapter(env),
    tts: ttsAdapter(env),
    moss: mossAdapter(env),
  };
}

export function adapterStatusMap(registry) {
  return Object.fromEntries(
    Object.entries(registry).map(([key, adapter]) => [key, adapter.status()]),
  );
}

export function adapterLabels(registry) {
  return Object.fromEntries(
    Object.entries(adapterStatusMap(registry)).map(([key, value]) => [key, value.label]),
  );
}
