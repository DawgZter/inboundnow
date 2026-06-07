import { PROOF_LEVELS, assertLocalHttpUrl, status } from "../contracts.mjs";

const DEFAULT_BASE_URL = "http://127.0.0.1:4341";
const DEFAULT_MODEL = "nvidia/parakeet-tdt-0.6b-v3";

function endpoint(base, pathname, label) {
  const value = String(pathname || "");
  if (!value.startsWith("/") || value.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(value)) {
    throw new Error(label + " must be a local absolute path");
  }
  return assertLocalHttpUrl(new URL(value, base).href, label).href;
}

function localAudioPath(value) {
  const text = String(value || "");
  if (text && (text.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(text))) {
    throw new Error("audioPath must be a local filesystem path");
  }
  return text;
}

function normalizeTranscription(payload = {}, fallbackProvider = "local-parakeet") {
  const text = String(payload.transcript || payload.text || payload.output || "").trim();
  return {
    transcript: text,
    final: payload.final !== false,
    simulated: false,
    provider: payload.provider || fallbackProvider,
    model: payload.model || DEFAULT_MODEL,
    language: payload.language || payload.lang || "en",
    confidence: Number.isFinite(Number(payload.confidence)) ? Number(payload.confidence) : null,
    timestamps: payload.timestamps || null,
    durationMs: Number.isFinite(Number(payload.durationMs)) ? Number(payload.durationMs) : null,
  };
}

export function createLocalParakeetAdapter(env = process.env) {
  const base = assertLocalHttpUrl(env.ASR_BASE_URL || env.PARAKEET_BASE_URL || DEFAULT_BASE_URL, "ASR_BASE_URL");
  const baseUrl = base.href.replace(/\/$/, "");
  const model = String(env.ASR_MODEL || env.PARAKEET_MODEL || DEFAULT_MODEL);
  const language = String(env.ASR_LANGUAGE || env.PARAKEET_LANGUAGE || "en");
  const sampleRate = Number(env.ASR_SAMPLE_RATE || env.PARAKEET_SAMPLE_RATE || 16000);
  const healthPath = env.ASR_HEALTH_PATH || "/health";
  const transcribePath = env.ASR_TRANSCRIBE_PATH || "/v1/asr/transcribe";
  const healthUrl = endpoint(base, healthPath, "ASR_HEALTH_PATH");
  const transcribeUrl = endpoint(base, transcribePath, "ASR_TRANSCRIBE_PATH");

  return {
    kind: "asr",
    provider: "local-parakeet",
    status() {
      return status({
        kind: "asr",
        provider: "local-parakeet",
        label: "parakeet-localhost",
        proof: PROOF_LEVELS.configured,
        message: "Configured for a localhost Parakeet ASR endpoint; proof requires a real local/H100 audio transcription smoke.",
        detail: {
          baseUrl,
          model,
          language,
          sampleRate,
          inputFormat: "mono 16kHz wav/flac preferred",
        },
      });
    },
    async health() {
      const response = await fetch(healthUrl);
      if (!response.ok) throw new Error("Local Parakeet health returned HTTP " + response.status);
      return response.json();
    },
    async transcribe(input = {}) {
      const response = await fetch(transcribeUrl, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        signal: input.signal,
        body: JSON.stringify({
          requestId: input.requestId || "",
          audioBase64: input.audioBase64 || "",
          audioPath: localAudioPath(input.audioPath),
          mimeType: input.mimeType || "audio/wav",
          sampleRate: Number(input.sampleRate || sampleRate),
          language: input.language || language,
          model,
          timestamps: input.timestamps !== false,
        }),
      });
      if (!response.ok) throw new Error("Local Parakeet transcribe returned HTTP " + response.status);
      return normalizeTranscription(await response.json(), "local-parakeet");
    },
  };
}
