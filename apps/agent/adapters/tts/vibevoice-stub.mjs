import { PROOF_LEVELS, status } from "../contracts.mjs";

export function createVibeVoiceStubAdapter(env = process.env) {
  const mode = env.TTS_STUB_MODE || "manifest";

  return {
    kind: "tts",
    provider: "vibevoice-stub",
    status() {
      return status({
        kind: "tts",
        provider: "vibevoice-stub",
        label: "browser-speech-fallback",
        proof: PROOF_LEVELS.stub,
        message: "Stub only: browser speech synthesis remains the audible fallback, not local VibeVoice proof.",
        detail: { mode },
      });
    },
    async synthesize({ text = "" } = {}) {
      return {
        provider: "vibevoice-stub",
        simulated: true,
        mode,
        text,
        audio: null,
      };
    },
  };
}

