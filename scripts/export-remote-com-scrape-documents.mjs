#!/usr/bin/env node
import { readJson, readJsonGzip, writeJson } from "../packages/local-retrieval/index.mjs";
import { writeRemoteComScrapeDocuments } from "../packages/remote-com-scrape/index.mjs";

const SOURCE_PATH = process.env.REMOTE_COM_MOSS_DOCS_SOURCE ||
  process.env.REMOTE_COM_DOCUMENTS_BUNDLE ||
  process.env.REMOTE_COM_SCRAPE_PATH ||
  "data/remote-com/remote-com-documents.json.gz";
const OUTPUT_PATH = process.env.REMOTE_COM_MOSS_DOCS_PATH || "artifacts/moss/remote-com-documents.json";

async function exportDocuments(sourcePath, outputPath) {
  if (process.env.REMOTE_COM_SCRAPE_PATH || process.env.REMOTE_COM_SOURCE_TYPE === "remote-com-scrape") {
    return writeRemoteComScrapeDocuments(sourcePath, outputPath);
  }

  const documents = sourcePath.endsWith(".gz")
    ? await readJsonGzip(sourcePath)
    : await readJson(sourcePath);

  const outputPathResolved = await writeJson(outputPath, documents);
  return {
    outputPath: outputPathResolved,
    documentCount: documents.length,
    bytes: Buffer.byteLength(JSON.stringify(documents, null, 2) + "\n"),
  };
}

const result = await exportDocuments(SOURCE_PATH, OUTPUT_PATH);

console.log(JSON.stringify({
  ok: true,
  sourcePath: SOURCE_PATH,
  outputPath: result.outputPath,
  documentCount: result.documentCount,
  bytes: result.bytes,
  mossCli: "moss index create remote-com-2026-06-07 -f " + OUTPUT_PATH + " --model moss-minilm --wait",
}, null, 2));
