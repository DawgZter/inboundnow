const DEFAULT_PROFILE_ID = "default";

export const VOICE_PROFILES = Object.freeze({
  default: {
    id: "default",
    label: "Default SDR",
    ttsVoice: "Carter",
    style: "clear",
    browserRate: 1.06,
    browserPitch: 1.0,
    browserLang: "en-US",
    browserVoiceHints: ["en-US", "en"],
  },
  warm: {
    id: "warm",
    label: "Warm consultative",
    ttsVoice: "Carter",
    style: "warm",
    browserRate: 0.98,
    browserPitch: 0.92,
    browserLang: "en-US",
    browserVoiceHints: ["en-US", "en"],
  },
  calm: {
    id: "calm",
    label: "Calm slower",
    ttsVoice: "Carter",
    style: "calm",
    browserRate: 0.9,
    browserPitch: 0.88,
    browserLang: "en-US",
    browserVoiceHints: ["en-US", "en"],
  },
  bright: {
    id: "bright",
    label: "Bright upbeat",
    ttsVoice: "Carter",
    style: "bright",
    browserRate: 1.12,
    browserPitch: 1.08,
    browserLang: "en-US",
    browserVoiceHints: ["en-US", "en"],
  },
  miso_lora_dev: {
    id: "miso_lora_dev",
    label: "Miso One LoRA dev",
    ttsVoice: "miso-one-lora-dev",
    ttsModel: "MisoLabs/MisoTTS",
    style: "expressive",
    browserRate: 1.0,
    browserPitch: 1.0,
    browserLang: "en-US",
    browserVoiceHints: ["en-US", "en"],
    loraAdapter: "artifacts/miso-lora/adapters/miso-one-lora-dev",
    proof: "configured",
  },
});

const PROFILE_ALIASES = Object.freeze({
  default: "default",
  normal: "default",
  reset: "default",
  carter: "default",
  warm: "warm",
  warmer: "warm",
  friendly: "warm",
  softer: "warm",
  calm: "calm",
  calmer: "calm",
  slow: "calm",
  slower: "calm",
  deep: "calm",
  deeper: "calm",
  bright: "bright",
  brighter: "bright",
  upbeat: "bright",
  energetic: "bright",
  excited: "bright",
  miso: "miso_lora_dev",
  "miso one": "miso_lora_dev",
  misotts: "miso_lora_dev",
  lora: "miso_lora_dev",
  "lora dev": "miso_lora_dev",
});

function normalizeId(value) {
  return String(value || "").trim().toLowerCase().replace(/[-\s]+/g, "_");
}

function publicProfile(profile) {
  return {
    id: profile.id,
    label: profile.label,
    ttsVoice: profile.ttsVoice,
    ttsModel: profile.ttsModel || "",
    style: profile.style,
    browserRate: profile.browserRate,
    browserPitch: profile.browserPitch,
    browserLang: profile.browserLang,
    browserVoiceHints: profile.browserVoiceHints || [],
    loraAdapter: profile.loraAdapter || "",
    proof: profile.proof || "",
  };
}

export function resolveVoiceProfile(value, fallback = VOICE_PROFILES[DEFAULT_PROFILE_ID]) {
  if (value && typeof value === "object") {
    return publicProfile({
      ...fallback,
      ...value,
      id: VOICE_PROFILES[normalizeId(value.id)] ? normalizeId(value.id) : value.id || fallback.id,
    });
  }

  const normalized = normalizeId(value);
  const alias = PROFILE_ALIASES[normalized] || PROFILE_ALIASES[normalized.replace(/_/g, " ")] || normalized;
  return publicProfile(VOICE_PROFILES[alias] || fallback || VOICE_PROFILES[DEFAULT_PROFILE_ID]);
}

function includesAny(text, values) {
  return values.some((value) => text.includes(value));
}

export function detectVoiceSwitchIntent(text, currentProfile = VOICE_PROFILES[DEFAULT_PROFILE_ID]) {
  const value = String(text || "").toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();
  if (!value) {
    return { changed: false, profile: resolveVoiceProfile(currentProfile), reason: "" };
  }

  const voiceMentioned = includesAny(value, ["voice", "sound", "tone", "speak", "speaker", "miso", "lora"]);
  const switchMentioned = includesAny(value, ["switch", "change", "use", "make", "sound", "speak", "talk", "set", "be"]);
  if (!voiceMentioned || !switchMentioned) {
    return { changed: false, profile: resolveVoiceProfile(currentProfile), reason: "" };
  }

  for (const [alias, id] of Object.entries(PROFILE_ALIASES)) {
    if (value.includes(alias)) {
      const profile = resolveVoiceProfile(id);
      return {
        changed: profile.id !== resolveVoiceProfile(currentProfile).id,
        profile,
        reason: alias,
        acknowledgement: "Sure, I will use the " + profile.label + " voice for this session.",
      };
    }
  }

  return { changed: false, profile: resolveVoiceProfile(currentProfile), reason: "" };
}

export function isVoiceSwitchOnly(text) {
  const value = String(text || "").toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();
  if (!value) return false;
  const withoutVoiceWords = value
    .replace(/\b(please|can you|could you|would you|switch|change|use|make|set|speak|talk|sound|voice|tone|speaker|to|the|a|an|more|mode|for|this|session)\b/g, " ")
    .replace(/\b(default|normal|carter|warm|warmer|friendly|softer|calm|calmer|slow|slower|deep|deeper|bright|brighter|upbeat|energetic|excited|miso|one|misotts|lora|dev)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return withoutVoiceWords.length <= 2;
}
