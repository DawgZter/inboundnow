#!/usr/bin/env node
import { buildLocalIndex, readJson, writeJson } from "../../packages/local-retrieval/index.mjs";

const SOURCE_PATH = process.env.MOSS_SOURCE_PATH || "fixtures/remote-site/remote-pages.json";
const OUTPUT_PATH = process.env.MOSS_INDEX_PATH || "artifacts/moss/remote-local-index.json";

const documents = await readJson(SOURCE_PATH);
if (!Array.isArray(documents) || documents.length === 0) {
  throw new Error("MOSS_SOURCE_PATH must contain a non-empty JSON array of documents");
}

const index = buildLocalIndex(documents, {
  source: SOURCE_PATH,
  builtAt: process.env.MOSS_INDEX_BUILT_AT || new Date().toISOString(),
});

await writeJson(OUTPUT_PATH, index);

console.log(JSON.stringify({
  ok: true,
  sourcePath: SOURCE_PATH,
  outputPath: OUTPUT_PATH,
  schema: index.schema,
  provider: index.provider,
  localOnly: index.localOnly,
  documentCount: index.documents.length,
}, null, 2));
