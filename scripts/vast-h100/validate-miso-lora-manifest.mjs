#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { summarizeMisoLoraManifest } from "../../packages/miso-lora/index.mjs";

const manifestPath = process.argv[2] || process.env.MISO_LORA_MANIFEST || "configs/miso-lora/manifest.example.json";
const artifactDir = process.env.MISO_LORA_ARTIFACT_DIR || join("artifacts", "miso-lora", "validation");
const raw = JSON.parse(await readFile(manifestPath, "utf8"));
const summary = summarizeMisoLoraManifest(raw);
const outputPath = join(artifactDir, summary.adapterId + ".validation.json");

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify({
  ...summary,
  manifestPath,
  validatedAt: new Date().toISOString(),
}, null, 2));

console.log(JSON.stringify({
  ...summary,
  manifestPath,
  artifact: outputPath,
}, null, 2));
