#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { createAdapterRegistry } from "../apps/agent/adapters/registry.mjs";

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const artifactDir = join("artifacts", "smoke", "moss-remote-" + timestamp);
const indexPath = join(artifactDir, "remote-com-local-index.json");
const query = "Remote MCP global payroll compliance";
const children = [];

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : 0;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

function logPath(name) {
  return join(artifactDir, name + ".log");
}

function spawnLogged(name, command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const out = createWriteStream(logPath(name));
  child.stdout.pipe(out);
  child.stderr.pipe(out);
  children.push(child);
  return child;
}

function stopAll() {
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
}

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForJson(url, options = {}, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response.json();
      lastError = new Error(url + " returned HTTP " + response.status);
    } catch (error) {
      lastError = error;
    }
    await wait(150);
  }
  throw lastError || new Error("Timed out waiting for " + url);
}

async function runIndexer() {
  const child = spawnLogged("indexer", process.execPath, ["services/moss-indexer/build-local-index.mjs"], {
    MOSS_SOURCE_TYPE: "json-gzip",
    MOSS_SOURCE_PATH: "data/remote-com/remote-com-documents.json.gz",
    MOSS_INDEX_PATH: indexPath,
    MOSS_INDEX_BUILT_AT: "2026-06-07T09:19:45.903Z",
  });

  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", resolve);
  });
  if (exitCode !== 0) {
    throw new Error("Remote Moss indexer exited with code " + exitCode);
  }

  return JSON.parse(await readFile(indexPath, "utf8"));
}

function assertRemoteResult(result, expected) {
  assert.equal(result.provider, expected.provider);
  if (expected.upstreamProvider) {
    assert.equal(result.upstreamProvider, expected.upstreamProvider);
  } else {
    assert.equal(result.upstreamProvider, undefined);
  }
  if (expected.adapterProvider) {
    assert.equal(result.adapterProvider, expected.adapterProvider);
  } else {
    assert.equal(result.adapterProvider, undefined);
  }
  assert.equal(result.localOnly, true);
  assert.equal(result.simulated, false);
  assert.equal(result.artifact.schema, "inboundnow.local-retrieval.v1");
  assert.ok(result.artifact.documentCount >= 10_800);
  assert.ok(result.snippets.length > 0);
  assert.ok(result.snippets.every((snippet) => snippet.text.length <= 760));
  assert.ok(result.snippets.every((snippet) => snippet.metadata?.source === "remote_com_scrape"));
  assert.ok(result.snippets.every((snippet) => snippet.metadata?.documentChars >= snippet.text.length));
  assert.ok(result.snippets.some((snippet) => (snippet.metadata?.matchedTokens || []).includes("payroll")));
  assert.ok(result.snippets.some((snippet) => {
    const matched = snippet.metadata?.matchedTokens || [];
    return matched.includes("compliance") || matched.includes("mcp");
  }));
  const joined = result.snippets.map((snippet) => snippet.title + " " + snippet.url + " " + snippet.text).join("\n");
  assert.match(joined, /Remote/i);
  assert.match(joined, /payroll/i);
}

await mkdir(artifactDir, { recursive: true });

try {
  const index = await runIndexer();
  assert.equal(index.provider, "local-artifact");
  assert.equal(index.localOnly, true);
  assert.ok(index.documents.length >= 10_800);
  assert.ok(index.forbiddenRuntimeBehaviors.includes("cloud polling"));
  assert.ok(index.forbiddenRuntimeBehaviors.includes("session document upload"));

  const port = await freePort();
  const runtimeUrl = "http://127.0.0.1:" + port;
  spawnLogged("runtime", process.execPath, ["services/moss-runtime/server.mjs"], {
    MOSS_RUNTIME_PORT: String(port),
    MOSS_RUNTIME_PROVIDER: "local-artifact",
    MOSS_INDEX_PATH: indexPath,
  });

  const health = await waitForJson(runtimeUrl + "/health");
  assert.equal(health.ok, true);
  assert.equal(health.localOnly, true);
  assert.equal(health.adapter.provider, "local-artifact");

  const directQuery = await waitForJson(runtimeUrl + "/query", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, topK: 5 }),
  });
  assertRemoteResult(directQuery, {
    provider: "local-artifact",
  });

  const registry = createAdapterRegistry({
    ...process.env,
    MOSS_PROVIDER: "local-runtime-client",
    MOSS_RUNTIME_URL: runtimeUrl,
  });
  const registryQuery = await registry.moss.query(query, { topK: 5 });
  assertRemoteResult(registryQuery, {
    provider: "local-runtime-client",
    upstreamProvider: "local-artifact",
    adapterProvider: "local-runtime-client",
  });

  const result = {
    ok: true,
    artifactDir,
    indexPath,
    runtimeUrl,
    query,
    checks: {
      remoteScrapeIndexBuild: true,
      localArtifactRuntimeHealth: true,
      runtimeQuery: true,
      agentRuntimeClientQuery: true,
    },
    index: {
      schema: index.schema,
      provider: index.provider,
      source: index.source,
      builtAt: index.builtAt,
      localOnly: index.localOnly,
      documentCount: index.documents.length,
    },
    health,
    directQuery,
    registryQuery,
  };

  await writeFile(join(artifactDir, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  stopAll();
}
