#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createConnection } from "node:net";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { assertLocalHttpUrl, assertLocalWebSocketUrl } from "../../apps/agent/adapters/contracts.mjs";

const execFileAsync = promisify(execFile);
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const artifactDir = join("artifacts", "smoke", "h100-stack-preflight-" + timestamp);
const timeoutMs = Number(process.env.H100_PREFLIGHT_TIMEOUT_MS || 10_000);
const dryRun = flag(process.env.H100_STACK_PREFLIGHT_DRY_RUN || process.env.DRY_RUN);
const allowNonH100 = flag(process.env.ALLOW_NON_H100);
const proofMode = !flag(process.env.H100_PREFLIGHT_RELAXED);
const requireLoaded = flag(process.env.H100_PREFLIGHT_REQUIRE_LOADED);
const requireMisoLora = flag(process.env.MISO_REQUIRE_LORA || process.env.TTS_REQUIRE_LORA || process.env.MISO_LORA_PROOF);

const endpoints = {
  livekitUrl: process.env.LIVEKIT_URL || "ws://127.0.0.1:7880",
  tokenServerUrl: process.env.TOKEN_SERVER_URL || "http://127.0.0.1:4301",
  mossRuntimeUrl: process.env.MOSS_RUNTIME_URL || "http://127.0.0.1:4321",
  llmBaseUrl: process.env.LLM_BASE_URL || "http://127.0.0.1:4311/v1",
  asrBaseUrl: process.env.ASR_BASE_URL || "http://127.0.0.1:4341",
  ttsBaseUrl: process.env.TTS_BASE_URL || "http://127.0.0.1:4331",
  labUrl: process.env.LAB_URL || process.env.SMOKE_TARGET_URL || "http://127.0.0.1:4199",
};

function flag(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function redactedEnv() {
  const allowed = [
    "ALLOW_NON_H100",
    "ASR_BASE_URL",
    "ASR_MODEL",
    "H100_PREFLIGHT_RELAXED",
    "H100_PREFLIGHT_REQUIRE_LOADED",
    "H100_PROOF_MODE",
    "LAB_URL",
    "LIVEKIT_URL",
    "LLM_BASE_URL",
    "LLM_MODEL",
    "LLM_SERVED_MODEL_NAME",
    "MISO_LORA_ADAPTER",
    "MISO_REQUIRE_LORA",
    "MOSS_RUNTIME_URL",
    "TOKEN_SERVER_URL",
    "TTS_BASE_URL",
    "TTS_MODEL",
    "TTS_REQUIRE_LORA",
  ];
  return Object.fromEntries(allowed.filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));
}

function ensureLocalHttp(rawUrl, name) {
  const parsed = assertLocalHttpUrl(rawUrl, name);
  if (/moss\.dev|livekit\.cloud/i.test(parsed.hostname)) {
    throw new Error(name + " must not point at hosted Moss or LiveKit Cloud");
  }
  return parsed;
}

function ensureLocalLiveKit(rawUrl) {
  const parsed = assertLocalWebSocketUrl(rawUrl, "LIVEKIT_URL");
  if (/livekit\.cloud$/i.test(parsed.hostname)) {
    throw new Error("LIVEKIT_URL must not point at LiveKit Cloud");
  }
  return parsed;
}

function endpoint(baseUrl, pathname) {
  return new URL(pathname, String(baseUrl).endsWith("/") ? baseUrl : baseUrl + "/");
}

async function fetchJson(url, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(label + " returned HTTP " + response.status + ": " + text.slice(0, 300));
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(label + " did not return JSON: " + text.slice(0, 300));
    }
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "manual" });
    const text = await response.text();
    if ((!response.ok && response.status < 300) || response.status >= 400) {
      throw new Error(label + " returned HTTP " + response.status + ": " + text.slice(0, 300));
    }
    return { status: response.status, text };
  } finally {
    clearTimeout(timer);
  }
}

function tcpOpen(parsed, label) {
  const port = Number(parsed.port || (parsed.protocol === "wss:" ? 443 : 80));
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: parsed.hostname, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(label + " did not accept TCP within " + timeoutMs + "ms"));
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.end();
      resolve({ host: parsed.hostname, port });
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(new Error(label + " TCP connection failed: " + error.message));
    });
  });
}

async function gpuPreflight() {
  if (dryRun) return { required: "H100", skipped: true, reason: "dry-run" };
  if (allowNonH100) return { required: "H100", skipped: true, reason: "ALLOW_NON_H100" };
  const { stdout } = await execFileAsync(
    "nvidia-smi",
    ["--query-gpu=name,memory.total,driver_version", "--format=csv,noheader"],
    { timeout: timeoutMs },
  );
  const detected = stdout.trim().split(/\r?\n/).filter(Boolean);
  assert.ok(detected.some((line) => /H100/i.test(line)), "H100 GPU is required; detected: " + detected.join("; "));
  return { required: "H100", skipped: false, detected };
}

function assertH100Runtime(payload, label) {
  if (allowNonH100 || dryRun) return;
  assert.match(String(payload.device || payload.deviceType || ""), /cuda/i, label + " must report CUDA device metadata");
  assert.match(String(payload.gpuName || payload.gpu || ""), /h100/i, label + " must report H100 gpu metadata");
}

await mkdir(artifactDir, { recursive: true });
const result = {
  ok: false,
  proof: dryRun ? "h100-stack-preflight-dry-run" : "h100-stack-preflight",
  boundary: dryRun
    ? "Dry run only; endpoints, GPU, and service health were not contacted."
    : "Validates localhost service readiness before the real H100 proof suite; it does not prove ASR transcript, planner output, or TTS audio generation.",
  dryRun,
  proofMode,
  requireLoaded,
  requireMisoLora,
  artifactDir,
  createdAt: new Date().toISOString(),
  env: redactedEnv(),
  endpoints,
  checks: [],
};

async function check(id, fn) {
  const started = Date.now();
  const record = { id, ok: false };
  result.checks.push(record);
  try {
    record.detail = dryRun ? { skipped: true, reason: "dry-run" } : await fn();
    record.ok = true;
  } catch (error) {
    record.error = error.message || String(error);
  } finally {
    record.durationMs = Date.now() - started;
  }
}

await check("local-endpoints", async () => ({
  livekit: ensureLocalLiveKit(endpoints.livekitUrl).href,
  token: ensureLocalHttp(endpoints.tokenServerUrl, "TOKEN_SERVER_URL").href,
  moss: ensureLocalHttp(endpoints.mossRuntimeUrl, "MOSS_RUNTIME_URL").href,
  llm: ensureLocalHttp(endpoints.llmBaseUrl, "LLM_BASE_URL").href,
  asr: ensureLocalHttp(endpoints.asrBaseUrl, "ASR_BASE_URL").href,
  tts: ensureLocalHttp(endpoints.ttsBaseUrl, "TTS_BASE_URL").href,
  lab: ensureLocalHttp(endpoints.labUrl, "LAB_URL").href,
}));

await check("gpu", gpuPreflight);

await check("livekit-tcp", async () => tcpOpen(ensureLocalLiveKit(endpoints.livekitUrl), "LiveKit"));

await check("token-server", async () => {
  const payload = await fetchJson(endpoint(endpoints.tokenServerUrl, "health"), "token server health");
  assert.equal(payload.ok, true);
  assert.equal(payload.transport, "livekit");
  assert.equal(payload.livekitUrl, endpoints.livekitUrl);
  if (proofMode) assert.equal(payload.simulatedBridgeEnabled, false, "proof-mode token server must disable simulated bridge");
  return {
    mode: payload.mode,
    transport: payload.transport,
    simulatedBridgeEnabled: payload.simulatedBridgeEnabled,
    livekitUrl: payload.livekitUrl,
    defaultRoom: payload.defaultRoom,
  };
});

await check("moss-runtime", async () => {
  const payload = await fetchJson(endpoint(endpoints.mossRuntimeUrl, "health"), "Moss runtime health");
  assert.equal(payload.ok, true);
  assert.equal(payload.localOnly, true);
  const provider = payload.adapter?.provider || "";
  if (proofMode) assert.equal(provider, "local-artifact", "proof-mode Moss runtime must use local-artifact");
  assert.ok(Array.isArray(payload.forbiddenRuntimeBehaviors), "Moss health must list forbidden runtime behaviors");
  assert.ok(payload.forbiddenRuntimeBehaviors.includes("cloud polling"));
  assert.ok(payload.forbiddenRuntimeBehaviors.includes("pushIndex()"));
  return {
    provider,
    localOnly: payload.localOnly,
    proof: payload.adapter?.proof || "",
    indexPath: payload.adapter?.detail?.indexPath || "",
    forbiddenRuntimeBehaviors: payload.forbiddenRuntimeBehaviors,
  };
});

await check("qwen-endpoint", async () => {
  const payload = await fetchJson(endpoint(endpoints.llmBaseUrl, "models"), "Qwen /models");
  const models = Array.isArray(payload.data) ? payload.data : [];
  const ids = models.map((item) => String(item.id || ""));
  const owners = models.map((item) => String(item.owned_by || ""));
  assert.ok(models.length > 0, "Qwen endpoint must return at least one served model");
  assert.ok(ids.some((id) => /qwen/i.test(id) || id === process.env.LLM_MODEL || id === process.env.LLM_SERVED_MODEL_NAME), "Qwen endpoint must expose a Qwen served model");
  assert.ok(!ids.concat(owners).some((value) => /stub|fake|fixture/i.test(value)), "Qwen endpoint must not be a stub/fake/fixture");
  return { ids, owners };
});

await check("parakeet-asr", async () => {
  const payload = await fetchJson(endpoint(endpoints.asrBaseUrl, "health"), "Parakeet ASR health");
  assert.equal(payload.ok, true);
  assert.equal(payload.provider, "local-parakeet");
  assert.equal(payload.localOnly, true);
  assert.match(String(payload.model || ""), /parakeet/i);
  if (requireLoaded) assert.equal(payload.loaded, true, "Parakeet model must be loaded when H100_PREFLIGHT_REQUIRE_LOADED=1");
  assertH100Runtime(payload, "Parakeet ASR");
  return {
    provider: payload.provider,
    model: payload.model,
    localOnly: payload.localOnly,
    loaded: payload.loaded,
    device: payload.device,
    gpuName: payload.gpuName,
  };
});

await check("miso-one-tts", async () => {
  const payload = await fetchJson(endpoint(endpoints.ttsBaseUrl, "health"), "Miso One TTS health");
  assert.equal(payload.ok, true);
  assert.equal(payload.provider, "local-miso-one");
  assert.equal(payload.localOnly, true);
  assert.match(String(payload.model || ""), /miso/i);
  if (requireLoaded) assert.equal(payload.loaded, true, "Miso model must be loaded when H100_PREFLIGHT_REQUIRE_LOADED=1");
  if (requireMisoLora) assert.equal(payload.loraRuntimeSupported, true, "MISO_REQUIRE_LORA=1 requires a real Miso LoRA runtime loader");
  assertH100Runtime(payload, "Miso One TTS");
  return {
    provider: payload.provider,
    model: payload.model,
    localOnly: payload.localOnly,
    loaded: payload.loaded,
    device: payload.device,
    gpuName: payload.gpuName,
    loraMode: payload.loraMode,
    loraRuntimeSupported: payload.loraRuntimeSupported,
    quantization: payload.quantization,
    quantizationApplied: payload.quantizationApplied,
  };
});

await check("website-lab", async () => {
  const payload = await fetchText(endpoints.labUrl, "website lab");
  assert.ok(payload.status === 200 || payload.status === 302);
  return { status: payload.status, bytes: payload.text.length };
});

const failures = result.checks.filter((item) => !item.ok);
result.ok = !dryRun && failures.length === 0;
result.completedAt = new Date().toISOString();
if (failures.length) {
  result.error = failures.map((item) => item.id + ": " + item.error).join("; ");
}

await writeFile(join(artifactDir, "result.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (failures.length) process.exitCode = 1;
