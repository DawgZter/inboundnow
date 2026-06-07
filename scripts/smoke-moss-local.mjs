#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { createAdapterRegistry } from "../apps/agent/adapters/registry.mjs";

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const artifactDir = join("artifacts", "smoke", "moss-local-" + timestamp);
const indexPath = join(artifactDir, "remote-local-index.json");
const query = "How does Remote help with global payroll?";
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

async function waitForJson(url, options = {}, timeoutMs = 8_000) {
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
    MOSS_INDEX_PATH: indexPath,
    MOSS_INDEX_BUILT_AT: "2026-06-07T00:00:00.000Z",
  });

  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", resolve);
  });
  if (exitCode !== 0) {
    throw new Error("Moss indexer exited with code " + exitCode);
  }

  return JSON.parse(await readFile(indexPath, "utf8"));
}

function assertArtifactResult(result, options = {}) {
  if (options.runtimeClient) {
    assert.equal(result.provider, "local-runtime-client");
    assert.equal(result.upstreamProvider, "local-artifact");
    assert.equal(result.adapterProvider, "local-runtime-client");
  } else {
    assert.equal(result.provider, "local-artifact");
  }
  assert.equal(result.localOnly, true);
  assert.equal(result.simulated, false);
  assert.equal(result.artifact.schema, "inboundnow.local-retrieval.v1");
  assert.equal(result.artifact.documentCount, 5);
  assert.ok(result.snippets.length > 0);
  assert.equal(result.snippets[0].id, "remote-global-payroll");
}

async function assertRuntimeHasNoNetworkFetch() {
  const files = [
    "services/moss-runtime/server.mjs",
    "apps/agent/adapters/moss/local-artifact.mjs",
    "packages/local-retrieval/index.mjs",
  ];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const remoteUrls = source.match(/https?:\/\/(?!127\.0\.0\.1|localhost)[^\s\"'`]+/g) || [];
    assert.equal(source.includes("fetch("), false, file + " must not fetch in local artifact mode");
    assert.deepEqual(remoteUrls, [], file + " must not include remote URLs in local artifact mode");
  }
}

await mkdir(artifactDir, { recursive: true });

try {
  const index = await runIndexer();
  assert.equal(index.provider, "local-artifact");
  assert.equal(index.localOnly, true);
  assert.equal(index.documents.length, 5);
  assert.ok(index.forbiddenRuntimeBehaviors.includes("autoRefresh"));
  assert.ok(index.forbiddenRuntimeBehaviors.includes("cloud polling"));
  assert.ok(index.forbiddenRuntimeBehaviors.includes("pushIndex()"));
  assert.ok(index.forbiddenRuntimeBehaviors.includes("runtime document upload"));
  assert.ok(index.forbiddenRuntimeBehaviors.includes("session document upload"));
  assert.ok(index.forbiddenRuntimeBehaviors.includes("session embedding upload"));

  await assertRuntimeHasNoNetworkFetch();

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
  assert.equal(health.adapter.detail.indexPath, indexPath);
  assert.ok(health.forbiddenRuntimeBehaviors.includes("cloud polling"));
  assert.ok(health.forbiddenRuntimeBehaviors.includes("session document upload"));

  const directQuery = await waitForJson(runtimeUrl + "/query", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, topK: 3 }),
  });
  assertArtifactResult(directQuery);

  const registry = createAdapterRegistry({
    ...process.env,
    MOSS_PROVIDER: "local-runtime-client",
    MOSS_RUNTIME_URL: runtimeUrl,
  });
  const registryQuery = await registry.moss.query(query, { topK: 3 });
  assertArtifactResult(registryQuery, { runtimeClient: true });

  const result = {
    ok: true,
    artifactDir,
    indexPath,
    runtimeUrl,
    query,
    checks: {
      deterministicIndexBuild: true,
      forbiddenRuntimeBehaviorsDeclared: true,
      localArtifactRuntimeHealth: true,
      runtimeQuery: true,
      agentRuntimeClientQuery: true,
      staticNoNetworkFetchInArtifactPath: true,
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
