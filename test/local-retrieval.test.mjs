import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { buildLocalIndex, queryLocalIndex } from "../packages/local-retrieval/index.mjs";

async function fixtureDocuments() {
  return JSON.parse(await readFile("fixtures/remote-site/remote-pages.json", "utf8"));
}

test("buildLocalIndex creates a local-only artifact with forbidden runtime behaviors", async () => {
  const index = buildLocalIndex(await fixtureDocuments(), {
    source: "fixtures/remote-site/remote-pages.json",
    builtAt: "2026-06-07T00:00:00.000Z",
  });

  assert.equal(index.schema, "inboundnow.local-retrieval.v1");
  assert.equal(index.provider, "local-artifact");
  assert.equal(index.source, "fixtures/remote-site/remote-pages.json");
  assert.equal(index.builtAt, "2026-06-07T00:00:00.000Z");
  assert.equal(index.localOnly, true);
  assert.equal(index.documents.length, 5);
  assert.ok(index.forbiddenRuntimeBehaviors.includes("cloud polling"));
  assert.ok(index.forbiddenRuntimeBehaviors.includes("pushIndex()"));
  assert.ok(index.forbiddenRuntimeBehaviors.includes("session embedding upload"));
  assert.ok(index.documents.every((document) => Array.isArray(document.tokens) && document.tokens.length > 0));
});

test("queryLocalIndex returns payroll snippets from the local artifact", async () => {
  const index = buildLocalIndex(await fixtureDocuments(), {
    source: "fixtures/remote-site/remote-pages.json",
    builtAt: "2026-06-07T00:00:00.000Z",
  });
  const result = queryLocalIndex(index, "How does Remote help with global payroll?", { topK: 3 });

  assert.equal(result.provider, "local-artifact");
  assert.equal(result.localOnly, true);
  assert.equal(result.simulated, false);
  assert.equal(result.artifact.schema, "inboundnow.local-retrieval.v1");
  assert.equal(result.artifact.documentCount, 5);
  assert.ok(result.snippets.length > 0);
  assert.equal(result.snippets[0].id, "remote-global-payroll");
  assert.match(result.snippets[0].text, /country-specific payroll rules/i);
});

test("queryLocalIndex returns bounded excerpts around query terms", () => {
  const before = "Intro filler without the target phrase. ".repeat(40);
  const after = " Extra implementation notes after the relevant part.".repeat(40);
  const index = buildLocalIndex([
    {
      id: "long-payroll-doc",
      title: "Long payroll guide",
      url: "https://remote.com/long-payroll-guide",
      text: before + "Remote global payroll keeps country-specific rules and compliance workflows close to HR." + after,
      tags: ["payroll", "global"],
    },
  ], {
    source: "test",
    builtAt: "2026-06-07T00:00:00.000Z",
  });

  const result = queryLocalIndex(index, "global payroll compliance", { topK: 1, snippetChars: 220 });

  assert.equal(result.snippets.length, 1);
  assert.ok(result.snippets[0].text.length <= 235);
  assert.match(result.snippets[0].text, /global payroll/i);
  assert.match(result.snippets[0].text, /compliance workflows/i);
  assert.equal(result.snippets[0].metadata.excerpted, true);
  assert.equal(result.snippets[0].metadata.snippetChars, 220);
  assert.ok(result.snippets[0].metadata.documentChars > result.snippets[0].text.length);
  assert.deepEqual(result.snippets[0].metadata.matchedTokens, ["global", "payroll", "compliance"]);
});
