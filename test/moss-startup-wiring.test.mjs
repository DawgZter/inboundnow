import assert from "node:assert/strict";
import { test } from "node:test";
import { createAdapterRegistry } from "../apps/agent/adapters/registry.mjs";
import { resolveInboundNowStartConfig } from "../scripts/start-config.mjs";

function service(config, name) {
  return config.processes.find((entry) => entry.name === name);
}

test("startup defaults wire Moss runtime and agent providers locally", () => {
  const config = resolveInboundNowStartConfig({});
  const moss = service(config, "moss");
  const agent = service(config, "agent");

  assert.equal(config.mossRuntimeProvider, "local-artifact");
  assert.equal(config.mossAgentProvider, "local-runtime-client");
  assert.equal(config.mossRuntimeUrl, "http://127.0.0.1:4321");
  assert.equal(config.mossIndexPath, "artifacts/moss/remote-com-local-index.json");
  assert.equal(config.mossSourcePath, "data/remote-com/remote-com-documents.json.gz");
  assert.equal(config.mossSourceType, "json-gzip");

  assert.equal(moss.env.MOSS_RUNTIME_PROVIDER, "local-artifact");
  assert.equal(moss.env.MOSS_INDEX_PATH, "artifacts/moss/remote-com-local-index.json");
  assert.equal(agent.env.MOSS_PROVIDER, "local-runtime-client");
  assert.equal(agent.env.MOSS_RUNTIME_URL, "http://127.0.0.1:4321");
});

test("adapter registry accepts local-runtime-client as configured", () => {
  const registry = createAdapterRegistry({
    MOSS_PROVIDER: "local-runtime-client",
    MOSS_RUNTIME_URL: "http://127.0.0.1:4321",
  });

  const mossStatus = registry.moss.status();
  assert.equal(registry.moss.provider, "local-runtime-client");
  assert.equal(mossStatus.provider, "local-runtime-client");
  assert.equal(mossStatus.proof, "configured");
  assert.equal(mossStatus.healthy, true);
});
