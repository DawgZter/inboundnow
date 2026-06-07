import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  assertLocalPath,
  normalizeMisoLoraManifest,
  summarizeMisoLoraManifest,
} from "../packages/miso-lora/index.mjs";

const example = JSON.parse(await readFile("configs/miso-lora/manifest.example.json", "utf8"));

test("Miso LoRA manifest example validates as a local-only dev contract", () => {
  const manifest = normalizeMisoLoraManifest(example);
  assert.equal(manifest.localOnly, true);
  assert.equal(manifest.adapterId, "miso-one-lora-dev");
  assert.equal(manifest.baseModel, "MisoLabs/MisoTTS");
  assert.equal(manifest.consent.subjectConsent, true);
  assert.equal(manifest.consent.syntheticImpersonationAllowed, false);
  assert.equal(manifest.dataset.samples.length, 1);
  assert.equal(manifest.runtime.loraAdapter, "artifacts/miso-lora/adapters/miso-one-lora-dev");
});

test("Miso LoRA summary exposes runtime adapter metadata", () => {
  const summary = summarizeMisoLoraManifest(example);
  assert.equal(summary.ok, true);
  assert.equal(summary.runtime.ttsVoice, "miso-one-lora-dev");
  assert.equal(summary.runtime.ttsModel, "MisoLabs/MisoTTS");
  assert.equal(summary.proof, "configured");
});

test("Miso LoRA manifest rejects missing consent and remote paths", () => {
  assert.throws(
    () => normalizeMisoLoraManifest({ ...example, consent: { ...example.consent, subjectConsent: false } }),
    /consent\.subjectConsent must be true/,
  );
  assert.throws(
    () => assertLocalPath("s3://bucket/audio.wav", "audioPath"),
    /not a URL or cloud URI/,
  );
  assert.throws(
    () => normalizeMisoLoraManifest({
      ...example,
      dataset: {
        ...example.dataset,
        samples: [{ ...example.dataset.samples[0], audioPath: "https://example.com/audio.wav" }],
      },
    }),
    /dataset\.samples\[0\]\.audioPath/,
  );
});
