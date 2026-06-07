import { normalizeTtsOptimizationOptions, speechCacheKey } from "../../../../packages/speech-streaming/index.mjs";
import { PROOF_LEVELS, assertLocalHttpUrl, status } from "../contracts.mjs";

const DEFAULT_BASE_URL = "http://127.0.0.1:4331";

function endpoint(base, pathname) {
  return new URL(pathname, base).href;
}

async function* readNdjson(response) {
  const reader = response.body?.getReader?.();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) yield JSON.parse(trimmed);
    }
  }

  const tail = buffer.trim();
  if (tail) yield JSON.parse(tail);
}

export function createLocalVibeVoiceAdapter(env = process.env) {
  const base = assertLocalHttpUrl(env.TTS_BASE_URL || env.VIBEVOICE_BASE_URL || DEFAULT_BASE_URL, "TTS_BASE_URL");
  const options = normalizeTtsOptimizationOptions(env);
  const baseUrl = base.href.replace(/\/$/, "");
  const streamPath = env.TTS_STREAM_PATH || "/v1/tts/stream";
  const prewarmPath = env.TTS_PREWARM_PATH || "/prewarm";
  const healthPath = env.TTS_HEALTH_PATH || "/health";

  function payload(text, extra = {}) {
    return {
      text,
      model: options.model,
      voice: options.voice,
      dtype: options.dtype,
      quantization: options.quantization.name,
      cacheDir: options.cacheDir,
      textChunkChars: options.textChunkChars,
      cacheKey: speechCacheKey(text, {
        model: options.model,
        voice: options.voice,
        quantization: options.quantization.name,
      }),
      ...extra,
    };
  }

  return {
    kind: "tts",
    provider: "local-vibevoice",
    status() {
      return status({
        kind: "tts",
        provider: "local-vibevoice",
        label: "vibevoice-realtime-local",
        proof: PROOF_LEVELS.configured,
        message: "Configured for a localhost VibeVoice-Realtime compatible streaming endpoint; proof requires a real local/H100 stream smoke.",
        detail: {
          baseUrl,
          model: options.model,
          voice: options.voice,
          dtype: options.dtype,
          quantization: options.quantization,
          cacheDir: options.cacheDir,
          textChunkChars: options.textChunkChars,
          prewarm: options.prewarm,
        },
      });
    },
    async health() {
      const response = await fetch(endpoint(base, healthPath));
      if (!response.ok) throw new Error("Local VibeVoice health returned HTTP " + response.status);
      return response.json();
    },
    async prewarm({ signal } = {}) {
      const response = await fetch(endpoint(base, prewarmPath), {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal,
        body: JSON.stringify(payload(options.warmupText, { prewarm: true })),
      });
      if (!response.ok) throw new Error("Local VibeVoice prewarm returned HTTP " + response.status);
      return response.json();
    },
    async *stream({ text = "", requestId = "", signal } = {}) {
      const response = await fetch(endpoint(base, streamPath), {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/x-ndjson, application/json" },
        signal,
        body: JSON.stringify(payload(text, { requestId })),
      });

      if (!response.ok) throw new Error("Local VibeVoice stream returned HTTP " + response.status);

      for await (const event of readNdjson(response)) {
        yield {
          provider: "local-vibevoice",
          simulated: false,
          model: options.model,
          voice: options.voice,
          dtype: options.dtype,
          quantization: options.quantization.name,
          cacheKey: payload(text).cacheKey,
          ...event,
        };
      }
    },
    async synthesize({ text = "", signal } = {}) {
      const events = [];
      for await (const event of this.stream({ text, signal })) events.push(event);
      return {
        provider: "local-vibevoice",
        simulated: false,
        text,
        events,
      };
    },
  };
}
