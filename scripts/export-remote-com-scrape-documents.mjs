#!/usr/bin/env node
import { writeRemoteComScrapeDocuments } from "../packages/remote-com-scrape/index.mjs";

const SOURCE_PATH = process.env.REMOTE_COM_SCRAPE_PATH || "data/remote-com/scrape-2026-06-07";
const OUTPUT_PATH = process.env.REMOTE_COM_MOSS_DOCS_PATH || "artifacts/moss/remote-com-documents.json";

const result = await writeRemoteComScrapeDocuments(SOURCE_PATH, OUTPUT_PATH);

console.log(JSON.stringify({
  ok: true,
  sourcePath: SOURCE_PATH,
  outputPath: result.outputPath,
  documentCount: result.documentCount,
  bytes: result.bytes,
  mossCli: "moss index create remote-com-2026-06-07 -f " + OUTPUT_PATH + " --model moss-minilm --wait",
}, null, 2));

