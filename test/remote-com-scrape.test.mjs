import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLocalIndex, queryLocalIndex } from "../packages/local-retrieval/index.mjs";
import { loadRemoteComScrapeDocuments } from "../packages/remote-com-scrape/index.mjs";

const SCRAPE_PATH = "data/remote-com/scrape-2026-06-07";

test("loadRemoteComScrapeDocuments converts imported scrape pages to Moss documents", async () => {
  const documents = await loadRemoteComScrapeDocuments(SCRAPE_PATH, { maxDocuments: 100 });

  assert.equal(documents.length, 100);
  assert.ok(documents.every((document) => document.id.startsWith("remote-com:")));
  assert.ok(documents.every((document) => document.text.length > 0));
  assert.ok(documents.every((document) => document.metadata.source === "remote_com_scrape"));
  assert.ok(documents.some((document) => /Remote MCP/i.test(document.text)));
});

test("Remote scrape documents can be queried through the local retrieval artifact", async () => {
  const documents = await loadRemoteComScrapeDocuments(SCRAPE_PATH, { maxDocuments: 100 });
  const index = buildLocalIndex(documents, {
    source: SCRAPE_PATH,
    builtAt: "2026-06-07T09:19:45.903Z",
  });
  const result = queryLocalIndex(index, "Remote MCP global payroll", { topK: 5 });

  assert.equal(index.documents.length, 100);
  assert.equal(result.provider, "local-artifact");
  assert.equal(result.localOnly, true);
  assert.equal(result.artifact.documentCount, 100);
  assert.ok(result.snippets.length > 0);
  assert.ok(result.snippets.some((snippet) => /Remote MCP|global payroll/i.test(snippet.text)));
});

