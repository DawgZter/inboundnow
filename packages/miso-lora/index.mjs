const DEFAULT_BASE_MODEL = "MisoLabs/MisoTTS";
const LOCAL_PATH_HINT = "must be a local filesystem path, not a URL or cloud URI";

function fail(message) {
  throw new Error("Invalid Miso LoRA manifest: " + message);
}

function asObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(name + " must be an object");
  return value;
}

function requiredString(value, name) {
  if (typeof value !== "string" || !value.trim()) fail(name + " must be a non-empty string");
  return value.trim();
}

function optionalString(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string") return String(value);
  return value.trim();
}

export function isRemotePath(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  return /^[a-z][a-z0-9+.-]*:/i.test(text) || text.startsWith("//");
}

export function assertLocalPath(value, name) {
  const text = requiredString(value, name);
  if (isRemotePath(text)) fail(name + " " + LOCAL_PATH_HINT);
  return text;
}

function normalizeConsent(raw) {
  const consent = asObject(raw, "consent");
  if (consent.subjectConsent !== true) fail("consent.subjectConsent must be true");
  if (consent.syntheticImpersonationAllowed !== false) {
    fail("consent.syntheticImpersonationAllowed must be false for this MVP lane");
  }
  return {
    subjectConsent: true,
    rightsOwner: requiredString(consent.rightsOwner, "consent.rightsOwner"),
    allowedUse: requiredString(consent.allowedUse, "consent.allowedUse"),
    retentionPolicy: requiredString(consent.retentionPolicy, "consent.retentionPolicy"),
    syntheticImpersonationAllowed: false,
    recordedAt: optionalString(consent.recordedAt),
  };
}

function normalizeDataset(raw) {
  const dataset = asObject(raw, "dataset");
  const samples = dataset.samples;
  if (!Array.isArray(samples) || !samples.length) fail("dataset.samples must contain at least one sample");
  return {
    root: assertLocalPath(dataset.root || "data/miso-lora/raw", "dataset.root"),
    language: optionalString(dataset.language, "en"),
    sampleRate: Number(dataset.sampleRate || 24000),
    samples: samples.map((sample, index) => {
      const item = asObject(sample, "dataset.samples[" + index + "]");
      return {
        id: requiredString(item.id || "sample-" + String(index + 1).padStart(3, "0"), "dataset.samples[" + index + "].id"),
        audioPath: assertLocalPath(item.audioPath, "dataset.samples[" + index + "].audioPath"),
        transcriptPath: assertLocalPath(item.transcriptPath, "dataset.samples[" + index + "].transcriptPath"),
        speakerId: optionalString(item.speakerId, "miso-one"),
        durationSeconds: Number(item.durationSeconds || 0),
      };
    }),
  };
}

function normalizeTraining(raw) {
  const training = asObject(raw, "training");
  const rank = Number(training.rank || 16);
  const alpha = Number(training.alpha || rank * 2);
  const epochs = Number(training.epochs || 2);
  const learningRate = Number(training.learningRate || 0.0001);
  if (!Number.isFinite(rank) || rank < 1 || rank > 256) fail("training.rank must be between 1 and 256");
  if (!Number.isFinite(alpha) || alpha < 1) fail("training.alpha must be positive");
  if (!Number.isFinite(epochs) || epochs < 1) fail("training.epochs must be positive");
  if (!Number.isFinite(learningRate) || learningRate <= 0) fail("training.learningRate must be positive");
  return {
    rank,
    alpha,
    epochs,
    learningRate,
    targetModules: Array.isArray(training.targetModules) && training.targetModules.length
      ? training.targetModules.map((item, index) => requiredString(item, "training.targetModules[" + index + "]"))
      : ["backbone", "audio_decoder"],
    outputDir: assertLocalPath(training.outputDir || "artifacts/miso-lora/adapters/miso-one-lora-dev", "training.outputDir"),
    cacheDir: assertLocalPath(training.cacheDir || "artifacts/cache/miso-lora", "training.cacheDir"),
  };
}

export function normalizeMisoLoraManifest(raw) {
  const manifest = asObject(raw, "manifest");
  if (manifest.localOnly !== true) fail("localOnly must be true");
  const adapterId = requiredString(manifest.adapterId, "adapterId");
  if (!/^[a-z0-9][a-z0-9._-]{2,80}$/i.test(adapterId)) {
    fail("adapterId must be 3-81 chars and contain only letters, numbers, dots, underscores, or dashes");
  }

  return {
    schemaVersion: optionalString(manifest.schemaVersion, "inboundnow.miso-lora.v1"),
    adapterId,
    baseModel: optionalString(manifest.baseModel, DEFAULT_BASE_MODEL),
    localOnly: true,
    proof: optionalString(manifest.proof, "configured"),
    consent: normalizeConsent(manifest.consent),
    dataset: normalizeDataset(manifest.dataset),
    training: normalizeTraining(manifest.training),
    runtime: {
      ttsVoice: optionalString(manifest.runtime?.ttsVoice, adapterId),
      ttsModel: optionalString(manifest.runtime?.ttsModel, DEFAULT_BASE_MODEL),
      loraAdapter: assertLocalPath(manifest.runtime?.loraAdapter || manifest.training?.outputDir || "artifacts/miso-lora/adapters/" + adapterId, "runtime.loraAdapter"),
      style: optionalString(manifest.runtime?.style, "miso-lora-dev"),
    },
  };
}

export function summarizeMisoLoraManifest(raw) {
  const manifest = normalizeMisoLoraManifest(raw);
  return {
    ok: true,
    adapterId: manifest.adapterId,
    baseModel: manifest.baseModel,
    sampleCount: manifest.dataset.samples.length,
    language: manifest.dataset.language,
    localOnly: manifest.localOnly,
    outputDir: manifest.training.outputDir,
    runtime: manifest.runtime,
    proof: manifest.proof,
  };
}
