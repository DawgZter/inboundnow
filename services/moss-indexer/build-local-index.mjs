#!/usr/bin/env node
import { buildLocalIndex, readJson, writeJson } from "../../packages/local-retrieval/index.mjs";
import { loadRemoteComScrapeDocuments } from "../../packages/remote-com-scrape/index.mjs";

const SOURCE_PATH = process.env.MOSS_SOURCE_PATH || "fixtures/remote-site/remote-pages.json";
const OUTPUT_PATH = process.env.MOSS_INDEX_PATH || "artifacts/moss/remote-com-local-index.json";
const SOURCE_TYPE = process.env.MOSS_SOURCE_TYPE || "json";

const documents = SOURCE_TYPE === "remote-com-scrape"
  ? await loadRemoteComScrapeDocuments(SOURCE_PATH)
  : await readJson(SOURCE_PATH);

if (!Array.isArray(documents) || documents.length === 0) {
  throw new Error("MOSS_SOURCE_PATH must resolve to a non-empty document array");
}

const index = buildLocalIndex(documents, {
  source: SOURCE_PATH,
  builtAt: process.env.MOSS_INDEX_BUILT_AT || new Date().toISOString(),
});

await writeJson(OUTPUT_PATH, index);

console.log(JSON.stringify({
  ok: true,
  sourceType: SOURCE_TYPE,
  sourcePath: SOURCE_PATH,
  outputPath: OUTPUT_PATH,
  schema: index.schema,
  provider: index.provider,
  localOnly: index.localOnly,
  documentCount: index.documents.length,
}, null, 2));
