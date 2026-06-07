#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { createAdapterRegistry } from "../apps/agent/adapters/registry.mjs";
import { planQuestion } from "../apps/agent/llm-planner.mjs";

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

async function waitForModels(baseUrl) {
  const deadline = Date.now() + 8_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(new URL("/v1/models", baseUrl));
      if (response.ok) return;
      lastError = new Error("HTTP " + response.status);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw lastError || new Error("Qwen stub did not become ready");
}

const port = await freePort();
const baseUrl = "http://127.0.0.1:" + port;
const child = spawn(process.execPath, ["services/model-stubs/qwen-openai-compatible.mjs"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    QWEN_STUB_PORT: String(port),
    QWEN_STUB_MODE: "planner-json",
    LLM_MODEL: "qwen-local-planner-stub",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let stderr = "";
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

try {
  await waitForModels(baseUrl);
  const registry = createAdapterRegistry({
    ...process.env,
    LLM_PROVIDER: "qwen-openai-local",
    LLM_BASE_URL: baseUrl + "/v1",
    LLM_MODEL: "qwen-local-planner-stub",
    ASR_PROVIDER: "parakeet-stub",
    TTS_PROVIDER: "vibevoice-stub",
    MOSS_PROVIDER: "local-fixture",
  });

  const result = await planQuestion({
    question: "How does Remote help with global payroll?",
    retrieval: await registry.moss.query("global payroll", { topK: 3 }),
    bookingState: "none",
    adapters: registry,
    env: { AGENT_PLANNER: "local-llm" },
    generateId: () => "act_smoke",
  });

  assert.equal(result.planner.source, "local-llm-json");
  assert.equal(result.planner.fallback, false);
  assert.equal(result.plan.intent, "global_payroll");
  assert.deepEqual(result.preparedActions.map((action) => action.type), [
    "showCaption",
    "scrollToElement",
    "highlightElement",
    "showBookingPrompt",
  ]);

  console.log(JSON.stringify({
    ok: true,
    baseUrl: baseUrl + "/v1",
    planner: result.planner,
    intent: result.plan.intent,
    actionTypes: result.preparedActions.map((action) => action.type),
  }, null, 2));
} finally {
  child.kill("SIGTERM");
  if (stderr.trim()) process.stderr.write(stderr);
}
