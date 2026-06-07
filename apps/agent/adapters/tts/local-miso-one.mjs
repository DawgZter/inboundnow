import { createLocalVibeVoiceAdapter } from "./local-vibevoice.mjs";

export function createLocalMisoOneAdapter(env = process.env) {
  return createLocalVibeVoiceAdapter({
    ...env,
    TTS_BASE_URL: env.TTS_BASE_URL || env.MISO_TTS_BASE_URL || "http://127.0.0.1:4331",
    TTS_MODEL: env.TTS_MODEL || env.MISO_TTS_MODEL || "MisoLabs/MisoTTS",
    TTS_VOICE: env.TTS_VOICE || env.MISO_TTS_VOICE || "miso-one-lora-dev",
    TTS_VOICE_STYLE: env.TTS_VOICE_STYLE || env.MISO_TTS_STYLE || "expressive",
    TTS_LORA_ADAPTER: env.TTS_LORA_ADAPTER || env.MISO_LORA_ADAPTER || "artifacts/miso-lora/adapters/miso-one-lora-dev",
  }, {
    provider: "local-miso-one",
    label: "miso-one-local",
    message: "Configured for a localhost Miso One/MisoTTS streaming endpoint; proof requires an H100-local LoRA adapter smoke.",
  });
}
