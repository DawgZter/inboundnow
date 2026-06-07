export class ProofModeError extends Error {
  constructor(code, errors, details = {}) {
    super(errors.join("; "));
    this.name = "ProofModeError";
    this.code = code;
    this.errors = errors;
    this.details = { ...details, errors };
  }
}

export function envFlag(value, defaultValue = false) {
  if (value === undefined || value === null || value === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

export function h100ProofModeEnabled(env = process.env) {
  return envFlag(env.H100_PROOF_MODE);
}

export function proofModeFailClosedEnabled(env = process.env) {
  return h100ProofModeEnabled(env) ||
    envFlag(env.AGENT_PROOF_MODE) ||
    envFlag(env.AGENT_PLANNER_FAIL_CLOSED) ||
    envFlag(env.LLM_PLANNER_FAIL_CLOSED);
}

function throwIfErrors(code, errors, details = {}) {
  if (errors.length) throw new ProofModeError(code, errors, details);
}

function statusFor(adapters = {}, key) {
  const adapter = adapters[key];
  if (!adapter) return {};
  if (typeof adapter.status === "function") return adapter.status();
  return adapter;
}

export function normalizeRetrievalForMessage(retrieval) {
  if (!retrieval) return null;
  const snippets = Array.isArray(retrieval.snippets) ? retrieval.snippets.slice(0, 3) : [];
  return {
    provider: retrieval.provider || "",
    upstreamProvider: retrieval.upstreamProvider || "",
    adapterProvider: retrieval.adapterProvider || "",
    localOnly: retrieval.localOnly === true,
    simulated: !!retrieval.simulated,
    artifact: retrieval.artifact || null,
    error: retrieval.error || "",
    count: snippets.length,
    snippets,
  };
}

export function assertH100ProofModeStartup({ env = process.env, adapters = {}, adapterStatus = null } = {}) {
  if (!h100ProofModeEnabled(env)) return;
  const statuses = adapterStatus || {
    asr: statusFor(adapters, "asr"),
    llm: statusFor(adapters, "llm"),
    moss: statusFor(adapters, "moss"),
    tts: statusFor(adapters, "tts"),
  };
  const errors = [];

  if ((env.AGENT_TRANSPORT || "bridge") !== "livekit") errors.push("H100_PROOF_MODE requires AGENT_TRANSPORT=livekit");
  if (!["verified", "real"].includes(env.AGENT_MODE || "simulated")) errors.push("H100_PROOF_MODE requires AGENT_MODE=verified or real");
  if (statuses.asr?.provider !== "local-parakeet") errors.push("H100_PROOF_MODE requires ASR_PROVIDER=local-parakeet");
  if (statuses.llm?.provider !== "qwen-openai-local") errors.push("H100_PROOF_MODE requires LLM_PROVIDER=qwen-openai-local");
  if (statuses.moss?.provider !== "local-runtime-client") errors.push("H100_PROOF_MODE requires MOSS_PROVIDER=local-runtime-client");
  if (statuses.tts?.provider !== "local-miso-one") errors.push("H100_PROOF_MODE requires TTS_PROVIDER=local-miso-one");
  if (!envFlag(env.TTS_REAL_MODEL_PROOF || env.MISO_REAL_MODEL_PROOF)) errors.push("H100_PROOF_MODE requires TTS_REAL_MODEL_PROOF=1 plus endpoint evidence");

  throwIfErrors("proof_mode_startup_invalid", errors, { statuses });
}

export function assertProofModeAsr(asr, { env = process.env } = {}) {
  if (!proofModeFailClosedEnabled(env)) return;
  const errors = [];
  if (!asr || typeof asr !== "object") {
    errors.push("proof mode requires an ASR result before planning");
  } else {
    if (asr.provider !== "local-parakeet") errors.push("proof mode ASR requires provider=local-parakeet");
    if (asr.simulated !== false) errors.push("proof mode ASR must not be simulated");
    if (!/parakeet/i.test(asr.model || "")) errors.push("proof mode ASR requires Parakeet model metadata");
    if (!["livekit-audio-turn", "local-audio-turn"].includes(asr.source || "")) {
      errors.push("proof mode ASR requires livekit-audio-turn or local-audio-turn source");
    }
    if (["stub", "transcript-message"].includes(asr.proof || "")) errors.push("proof mode ASR cannot use stub/transcript proof");
  }
  throwIfErrors("proof_mode_asr_invalid", errors, { asr });
}

export function assertProofModeRetrieval(retrieval, { env = process.env, adapterStatus = {} } = {}) {
  if (!proofModeFailClosedEnabled(env)) return;
  const normalized = normalizeRetrievalForMessage(retrieval);
  const errors = [];
  if (!normalized) {
    errors.push("proof mode requires local Moss retrieval");
  } else {
    const provider = normalized.provider || normalized.adapterProvider || "";
    const upstream = normalized.upstreamProvider || "";
    if (normalized.error) errors.push("proof mode retrieval must not contain an error");
    if (normalized.localOnly !== true) errors.push("proof mode retrieval requires localOnly=true");
    if (normalized.simulated) errors.push("proof mode retrieval must not be simulated");
    if (normalized.count <= 0) errors.push("proof mode retrieval requires at least one snippet");
    if (provider !== "local-runtime-client" && provider !== "local-artifact") {
      errors.push("proof mode retrieval requires local-runtime-client or local-artifact provider");
    }
    if (/fixture|stub|fake|remote|hosted/i.test([provider, upstream].join(" "))) errors.push("proof mode retrieval cannot use fixture/stub/remote providers");
    if (adapterStatus.moss?.provider && adapterStatus.moss.provider !== "local-runtime-client") {
      errors.push("proof mode worker must use MOSS_PROVIDER=local-runtime-client");
    }
  }
  throwIfErrors("proof_mode_retrieval_invalid", errors, { retrieval: normalized, adapterStatus });
}

export function assertProofModePlanner(planner, { env = process.env } = {}) {
  if (!proofModeFailClosedEnabled(env)) return;
  const errors = [];
  if (!planner || typeof planner !== "object") {
    errors.push("proof mode requires planner metadata");
  } else {
    if (planner.source !== "local-llm-json") errors.push("proof mode planner requires source=local-llm-json");
    if (planner.provider !== "qwen-openai-local") errors.push("proof mode planner requires provider=qwen-openai-local");
    if (planner.fallback !== false) errors.push("proof mode planner fallback must be false");
    if (planner.error) errors.push("proof mode planner must not contain an error");
  }
  throwIfErrors("proof_mode_planner_invalid", errors, { planner });
}

function nonEmptyAudioBytes(event = {}) {
  const audio = String(event.audioBase64 || event.audio || "");
  if (!audio) return 0;
  try {
    return Buffer.from(audio, "base64").length;
  } catch {
    return 0;
  }
}

export function ttsEndpointProofErrors(event = {}, { env = process.env, provider = "", requireAudio = false } = {}) {
  const effectiveProvider = event.provider || provider;
  const errors = [];
  if (effectiveProvider !== "local-miso-one") errors.push("verified TTS proof requires provider=local-miso-one");
  if (event.simulated === true) errors.push("verified TTS proof must not be simulated");
  if (event.localOnly !== true) errors.push("verified TTS proof requires endpoint localOnly=true");
  if (!/miso/i.test(event.model || "")) errors.push("verified TTS proof requires Miso model metadata");
  if (!/cuda/i.test(String(event.device || event.deviceType || event.runtime || ""))) errors.push("verified TTS proof requires CUDA device metadata");
  if (!/h100/i.test(String(event.gpuName || event.gpu || ""))) errors.push("verified TTS proof requires H100 gpuName metadata");
  if (envFlag(env.MISO_REQUIRE_LORA || env.TTS_REQUIRE_LORA || env.MISO_LORA_PROOF)) {
    if (event.loraAdapterApplied !== true) errors.push("verified cloned-voice proof requires loraAdapterApplied=true");
  }
  if (requireAudio && nonEmptyAudioBytes(event) <= 0) errors.push("verified TTS proof requires non-empty audio bytes");
  return errors;
}

export function ttsProofLevelForEvent(event = {}, options = {}) {
  const env = options.env || process.env;
  const proofRequested = envFlag(env.TTS_REAL_MODEL_PROOF || env.MISO_REAL_MODEL_PROOF || env.VIBEVOICE_REAL_MODEL_PROOF);
  if (!proofRequested) return "contract";
  return ttsEndpointProofErrors(event, options).length ? "contract" : "verified";
}

export function localTtsModelProvenByEvent(event = {}, options = {}) {
  const env = options.env || process.env;
  if (!envFlag(env.TTS_REAL_MODEL_PROOF || env.MISO_REAL_MODEL_PROOF || env.VIBEVOICE_REAL_MODEL_PROOF)) return false;
  return ttsEndpointProofErrors(event, { ...options, requireAudio: true }).length === 0;
}

export function assertProofModeTtsEvent(event = {}, options = {}) {
  const env = options.env || process.env;
  if (!h100ProofModeEnabled(env)) return;
  throwIfErrors("proof_mode_tts_invalid", ttsEndpointProofErrors(event, options), { event });
}
