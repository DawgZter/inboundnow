import { createHash } from "node:crypto";

const DEFAULT_CHUNK_CHARS = 140;
const MAX_CHUNK_CHARS = 280;
const DEFAULT_CACHE_DIR = "artifacts/cache/tts";
const DEFAULT_MODEL = "microsoft/VibeVoice-Realtime-0.5B";

export const QUANTIZATION_POLICIES = Object.freeze({
  none: {
    name: "none",
    bits: null,
    target: "none",
    preserveAudioDecoderPrecision: true,
    description: "No weight quantization; safest audio-quality baseline.",
  },
  "llm-int8": {
    name: "llm-int8",
    bits: 8,
    target: "llm",
    preserveAudioDecoderPrecision: true,
    description: "Quantize only the language-model trunk; keep acoustic decoder/diffusion pieces full precision.",
  },
  "llm-int4": {
    name: "llm-int4",
    bits: 4,
    target: "llm",
    preserveAudioDecoderPrecision: true,
    description: "More aggressive LLM-trunk quantization; measure quality before using for demos.",
  },
});

export function normalizeSpeechText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function clampChunkChars(value) {
  const number = Number(value || DEFAULT_CHUNK_CHARS);
  if (!Number.isFinite(number)) return DEFAULT_CHUNK_CHARS;
  return Math.max(40, Math.min(MAX_CHUNK_CHARS, Math.floor(number)));
}

function pushWrappedChunk(chunks, text, maxChars) {
  const trimmed = text.trim();
  if (!trimmed) return;
  if (trimmed.length <= maxChars) {
    chunks.push(trimmed);
    return;
  }

  let current = "";
  for (const word of trimmed.split(" ")) {
    const next = current ? current + " " + word : word;
    if (next.length > maxChars && current) {
      chunks.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
}

export function splitSpeechText(text, options = {}) {
  const normalized = normalizeSpeechText(text);
  if (!normalized) return [];

  const maxChars = clampChunkChars(options.maxChars || options.chunkChars || options.textChunkChars);
  const chunks = [];
  const sentenceParts = normalized.match(/[^.!?;:]+[.!?;:]?/g) || [normalized];
  let current = "";

  for (const part of sentenceParts) {
    const piece = part.trim();
    if (!piece) continue;
    const next = current ? current + " " + piece : piece;
    if (next.length <= maxChars) {
      current = next;
      continue;
    }
    pushWrappedChunk(chunks, current, maxChars);
    current = "";
    pushWrappedChunk(chunks, piece, maxChars);
  }

  pushWrappedChunk(chunks, current, maxChars);
  return chunks;
}

export function speechCacheKey(text, options = {}) {
  const normalized = normalizeSpeechText(text).toLowerCase();
  const voice = String(options.voice || "default").trim().toLowerCase();
  const model = String(options.model || DEFAULT_MODEL).trim().toLowerCase();
  const policy = String(options.quantization || "none").trim().toLowerCase();
  return createHash("sha256")
    .update([model, voice, policy, normalized].join("\n"))
    .digest("hex");
}

export function normalizeTtsOptimizationOptions(env = {}) {
  const quantizationName = String(env.TTS_QUANTIZATION || env.VIBEVOICE_QUANTIZATION || "none").trim().toLowerCase();
  const quantization = QUANTIZATION_POLICIES[quantizationName];
  if (!quantization) {
    throw new Error("Unsupported TTS quantization policy: " + quantizationName);
  }

  const textChunkChars = clampChunkChars(env.TTS_TEXT_CHUNK_CHARS || env.VIBEVOICE_TEXT_CHUNK_CHARS);
  const cacheDir = String(env.TTS_CACHE_DIR || env.VIBEVOICE_CACHE_DIR || DEFAULT_CACHE_DIR);
  const model = String(env.TTS_MODEL || env.VIBEVOICE_MODEL || DEFAULT_MODEL);
  const dtype = String(env.TTS_DTYPE || env.VIBEVOICE_DTYPE || "bfloat16");
  const voice = String(env.TTS_VOICE || env.VIBEVOICE_VOICE || "Carter");
  const warmupText = String(env.TTS_WARMUP_TEXT || "Thanks, I can help with that.");
  const prewarm = !["0", "false", "no", "off"].includes(String(env.TTS_PREWARM || "1").toLowerCase());

  return {
    localOnly: true,
    streaming: true,
    model,
    voice,
    dtype,
    quantization,
    cacheDir,
    textChunkChars,
    warmupText,
    prewarm,
  };
}
