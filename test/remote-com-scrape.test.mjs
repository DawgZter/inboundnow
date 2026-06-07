import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildLocalIndex, queryLocalIndex } from "../packages/local-retrieval/index.mjs";
import { loadRemoteComScrapeDocuments, writeRemoteComScrapeDocuments } from "../packages/remote-com-scrape/index.mjs";

const SCRAPE_PATH = "fixtures/remote-com-scrape-mini";

test("loadRemoteComScrapeDocuments converts imported scrape pages to Moss documents", async () => {
  const documents = await loadRemoteComScrapeDocuments(SCRAPE_PATH, { maxDocuments: 100 });

  assert.equal(documents.length, 2);
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

  assert.equal(index.documents.length, 2);
  assert.equal(result.provider, "local-artifact");
  assert.equal(result.localOnly, true);
  assert.equal(result.artifact.documentCount, 2);
  assert.ok(result.snippets.length > 0);
  assert.ok(result.snippets.every((snippet) => snippet.text.length <= 760));
  assert.ok(result.snippets.every((snippet) => snippet.metadata.source === "remote_com_scrape"));
  assert.ok(result.snippets.every((snippet) => snippet.metadata.documentChars >= snippet.text.length));
  assert.ok(result.snippets.some((snippet) => /Remote MCP|global payroll/i.test(snippet.title + " " + snippet.text)));
});

test("writeRemoteComScrapeDocuments stringifies metadata for the Moss CLI", async () => {
  const dir = await mkdtemp(join(tmpdir(), "remote-com-moss-docs-"));
  try {
    const outputPath = join(dir, "docs.json");
    await writeRemoteComScrapeDocuments(SCRAPE_PATH, outputPath, { maxDocuments: 10 });
    const documents = JSON.parse(await readFile(outputPath, "utf8"));

    assert.equal(documents.length, 2);
    for (const document of documents) {
      for (const value of Object.values(document.metadata || {})) {
        assert.equal(typeof value, "string");
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
