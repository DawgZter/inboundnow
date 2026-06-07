import assert from "node:assert/strict";
import { test } from "node:test";
import {
  detectVoiceSwitchIntent,
  isVoiceSwitchOnly,
  resolveVoiceProfile,
} from "../packages/voice-session/index.mjs";

test("resolveVoiceProfile supports browser and Miso One LoRA aliases", () => {
  assert.equal(resolveVoiceProfile("warmer").id, "warm");
  assert.equal(resolveVoiceProfile("miso one").id, "miso_lora_dev");
  assert.equal(resolveVoiceProfile("Miso-One").id, "miso_lora_dev");
  assert.equal(resolveVoiceProfile("miso one").ttsModel, "MisoLabs/MisoTTS");
  assert.equal(resolveVoiceProfile("miso one").loraAdapter, "artifacts/miso-lora/adapters/miso-one-lora-dev");
});

test("detectVoiceSwitchIntent finds in-session voice commands", () => {
  const warm = detectVoiceSwitchIntent("Can you switch to a warmer voice?", resolveVoiceProfile("default"));
  assert.equal(warm.changed, true);
  assert.equal(warm.profile.id, "warm");
  assert.match(warm.acknowledgement, /Warm consultative/);
  assert.equal(isVoiceSwitchOnly("Can you switch to a warmer voice?"), true);

  const unchanged = detectVoiceSwitchIntent("How does Remote help with payroll?", warm.profile);
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.profile.id, "warm");
});
