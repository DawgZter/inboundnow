#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const artifactDir = join("artifacts", "smoke", "h100-proof-suite-" + timestamp);
const manifestPath = join(artifactDir, "manifest.json");
const dryRun = flag(process.env.H100_PROOF_SUITE_DRY_RUN || process.env.DRY_RUN);
const allowNonH100 = flag(process.env.ALLOW_NON_H100);
const skipBrowserPersona = flag(process.env.SKIP_BROWSER_PERSONA);
const requireManualMic = flag(process.env.REQUIRE_MANUAL_MIC);
const asrAudioPath = process.env.ASR_SMOKE_AUDIO_PATH || "";
const browserAudioPath = process.env.BROWSER_MIC_AUDIO_PATH || asrAudioPath;

function flag(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function redactEnv(env = process.env) {
  const allow = [
    "ALLOW_NON_H100",
    "ASR_BASE_URL",
    "ASR_EXPECTED_PATTERN",
    "ASR_MODEL",
    "ASR_SMOKE_AUDIO_PATH",
    "BROWSER_MIC_AUDIO_PATH",
    "HEADLESS",
    "H100_PROOF_MODE",
    "LLM_BASE_URL",
    "LLM_MODEL",
    "LLM_SERVED_MODEL_NAME",
    "MISO_LORA_ADAPTER",
    "MISO_REQUIRE_LORA",
    "MOSS_INDEX_PATH",
    "MOSS_RUNTIME_URL",
    "REQUIRE_MANUAL_MIC",
    "SKIP_BROWSER_PERSONA",
    "SMOKE_TARGET_URL",
    "TOKEN_SERVER_URL",
    "TTS_BASE_URL",
    "TTS_MODEL",
    "TTS_REAL_MODEL_PROOF",
  ];
  const redacted = {};
  for (const key of allow) {
    if (env[key] === undefined) continue;
    redacted[key] = /KEY|TOKEN|SECRET|PASSWORD/i.test(key) ? "[redacted]" : env[key];
  }
  return redacted;
}

async function commandText(command, args = []) {
  const { stdout } = await execFileAsync(command, args, { timeout: 15_000 });
  return String(stdout || "").trim();
}

async function gitInfo() {
  const [head, status] = await Promise.all([
    commandText("git", ["rev-parse", "HEAD"]).catch((error) => "unknown:" + error.message),
    commandText("git", ["status", "--short"]).catch((error) => "unknown:" + error.message),
  ]);
  return { head, status };
}

async function hashFile(pathname) {
  if (!pathname) return null;
  const data = await readFile(pathname);
  return {
    path: resolve(pathname),
    bytes: data.length,
    sha256: createHash("sha256").update(data).digest("hex"),
  };
}

async function gpuPreflight() {
  if (dryRun) return { required: "H100", skipped: true, reason: "dry-run" };
  if (allowNonH100) return { required: "H100", skipped: true, reason: "ALLOW_NON_H100" };
  const stdout = await commandText("nvidia-smi", ["--query-gpu=name,memory.total,driver_version", "--format=csv,noheader"]);
  const detected = stdout.split(/\r?\n/).filter(Boolean);
  assert.ok(detected.some((line) => /H100/i.test(line)), "H100 GPU is required; detected: " + detected.join("; "));
  return { required: "H100", skipped: false, detected };
}

function parseLastJson(text) {
  const source = String(text || "").trim();
  for (let index = source.lastIndexOf("{"); index >= 0; index = source.lastIndexOf("{", index - 1)) {
    try {
      return JSON.parse(source.slice(index));
    } catch {}
  }
  throw new Error("No JSON object found in command output");
}

async function runStep(step, manifest) {
  const logPath = join(artifactDir, step.id + ".log");
  const out = createWriteStream(logPath);
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const env = {
    ...process.env,
    H100_PROOF_MODE: "1",
    TTS_REAL_MODEL_PROOF: process.env.TTS_REAL_MODEL_PROOF || "1",
    ASR_SMOKE_AUDIO_PATH: asrAudioPath,
    BROWSER_MIC_AUDIO_PATH: browserAudioPath,
    MOSS_INDEX_PATH: process.env.MOSS_INDEX_PATH || "artifacts/moss/remote-com-local-index.json",
  };

  const record = {
    id: step.id,
    command: step.command,
    args: step.args,
    logPath,
    startedAt,
    ok: false,
  };
  manifest.steps.push(record);

  const child = spawn(step.command, step.args, {
    cwd: process.cwd(),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
    out.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
    out.write(chunk);
  });

  const exitCode = await new Promise((resolve) => {
    child.on("close", resolve);
    child.on("error", (error) => {
      output += "\n" + error.stack + "\n";
      resolve(1);
    });
  });
  out.end();

  record.exitCode = exitCode;
  record.durationMs = Date.now() - started;
  if (exitCode !== 0) {
    record.error = "Command exited with code " + exitCode;
    throw new Error(step.id + " failed; see " + logPath);
  }

  const parsed = parseLastJson(output);
  record.childArtifactDir = parsed.artifactDir || "";
  record.childResultPath = parsed.artifactDir ? join(parsed.artifactDir, "result.json") : "";
  record.summary = step.summary(parsed);
  step.validate(parsed);
  record.ok = true;
  return parsed;
}

function requireOk(payload, label) {
  assert.equal(payload?.ok, true, label + " must report ok=true");
}

function stepDefinitions() {
  const steps = [
    {
      id: "moss-remote",
      command: "npm",
      args: ["run", "smoke:moss:remote"],
      validate(payload) {
        requireOk(payload, "Moss remote smoke");
        assert.ok(Number(payload.index?.documentCount || payload.index?.document_count || 0) >= 1000, "Moss proof must use the Remote.com scrape-sized artifact");
        assert.equal(payload.directQuery?.localOnly, true);
        assert.equal(payload.registryQuery?.provider, "local-runtime-client");
      },
      summary(payload) {
        return { artifactDir: payload.artifactDir, documentCount: payload.index?.documentCount || null };
      },
    },
    {
      id: "qwen-endpoint",
      command: "npm",
      args: ["run", "smoke:qwen:h100"],
      validate(payload) {
        requireOk(payload, "Qwen endpoint smoke");
        assert.ok(payload.nonce && payload.parsed?.nonce === payload.nonce, "Qwen proof must echo the nonce");
        assert.ok(Number(payload.completion?.usage?.total_tokens || 0) > 0, "Qwen proof must include token usage");
      },
      summary(payload) {
        return { artifactDir: payload.artifactDir, model: payload.completion?.model || payload.model, totalTokens: payload.completion?.usage?.total_tokens || null };
      },
    },
    {
      id: "parakeet-endpoint",
      command: "npm",
      args: ["run", "smoke:asr:h100"],
      validate(payload) {
        requireOk(payload, "Parakeet endpoint smoke");
        assert.match(String(payload.transcript?.model || payload.health?.model || ""), /parakeet/i);
        assert.equal(payload.transcript?.inputAudioSha256, payload.audioSha256);
        assert.ok(Number(payload.transcript?.audioBytes || 0) === Number(payload.audioBytes || 0), "ASR endpoint must echo audio byte count");
      },
      summary(payload) {
        return { artifactDir: payload.artifactDir, transcript: payload.transcript?.transcript || "", audioSha256: payload.audioSha256 || "" };
      },
    },
    {
      id: "miso-endpoint",
      command: "npm",
      args: ["run", "smoke:tts:miso-one"],
      validate(payload) {
        requireOk(payload, "Miso endpoint smoke");
        assert.equal(payload.health?.provider, "local-miso-one");
        assert.ok(Number(payload.cold?.chunkCount || 0) > 0, "Miso proof must stream cold chunks");
        assert.ok(payload.cold?.lastAudioEvent?.audioSha256, "Miso proof must include audio hash metadata");
      },
      summary(payload) {
        return { artifactDir: payload.artifactDir, model: payload.model, coldChunks: payload.cold?.chunkCount || 0 };
      },
    },
    {
      id: "model-chain",
      command: "npm",
      args: ["run", "smoke:h100:persona"],
      validate(payload) {
        requireOk(payload, "H100 model-chain smoke");
        assert.equal(payload.statuses?.asr?.provider, "local-parakeet");
        assert.equal(payload.statuses?.llm?.provider, "qwen-openai-local");
        assert.equal(payload.statuses?.moss?.provider, "local-runtime-client");
        assert.equal(payload.statuses?.tts?.provider, "local-miso-one");
        assert.ok(Number(payload.tts?.stream?.chunkCount || 0) > 0, "model-chain proof must include TTS chunks");
      },
      summary(payload) {
        return { artifactDir: payload.artifactDir, actionTypes: payload.actionTypes || [], ttsChunks: payload.tts?.stream?.chunkCount || 0 };
      },
    },
  ];

  if (!skipBrowserPersona) {
    steps.push({
      id: "browser-persona",
      command: "npm",
      args: ["run", "smoke:h100:browser-persona"],
      validate(payload) {
        requireOk(payload, "H100 browser persona smoke");
        assert.equal(payload.checks?.liveKitConnected, true);
        assert.equal(payload.checks?.startPersonaAutoStoppedTurn, true);
        assert.equal(payload.checks?.browserMicProof, true);
        assert.equal(payload.checks?.workerBufferedAudioProof, true);
        assert.equal(payload.checks?.asrEndpointMatchedWorkerAudioHash, true);
        assert.equal(payload.checks?.asrFinalLocalParakeet, true);
        assert.equal(payload.checks?.qwenPlannerNoFallback, true);
        assert.equal(payload.checks?.primitiveActionsOnly, true);
        assert.equal(payload.checks?.localMisoOneVerifiedAudio, true);
        assert.equal(payload.checks?.calGatedBeforeConfirmation, true);
        assert.equal(payload.checks?.calLoadsAfterExplicitConfirmation, true);
        assert.ok(payload.browserMicProofPath, "browser proof must save browser mic stats");
        assert.ok(payload.proofChainPath, "browser proof must save a browser-worker-ASR proof chain");
        assert.match(String(payload.boundary || ""), /media-fixture|Manual browser microphone/i, "browser proof boundary must identify manual vs media-fixture mode");
      },
      summary(payload) {
        return { artifactDir: payload.artifactDir, screenshotPath: payload.screenshotPath, boundary: payload.boundary };
      },
    });
  }

  return steps;
}

async function assertInputs() {
  if (dryRun) return;
  assert.ok(asrAudioPath, "ASR_SMOKE_AUDIO_PATH is required for the H100 proof suite.");
  await access(resolve(asrAudioPath), constants.R_OK);
  if (!skipBrowserPersona && !requireManualMic) {
    assert.ok(browserAudioPath, "BROWSER_MIC_AUDIO_PATH or ASR_SMOKE_AUDIO_PATH is required for automated browser proof.");
    await access(resolve(browserAudioPath), constants.R_OK);
  }
}

await mkdir(artifactDir, { recursive: true });

const manifest = {
  ok: false,
  proof: dryRun ? "h100-proof-suite-dry-run" : "h100-proof-suite-local-stack",
  boundary: dryRun
    ? "Dry run only; no H100 runtime proof was executed."
    : "Aggregates local H100 endpoint, model-chain, and browser persona proof artifacts. Automated browser audio remains media-fixture proof unless REQUIRE_MANUAL_MIC=1.",
  artifactDir,
  manifestPath,
  createdAt: new Date().toISOString(),
  dryRun,
  env: redactEnv(),
  git: await gitInfo(),
  inputs: {},
  gpu: null,
  steps: [],
};

try {
  await assertInputs();
  manifest.inputs.asrAudio = await hashFile(asrAudioPath);
  manifest.inputs.browserAudio = requireManualMic ? { path: "manual", mode: "manual" } : await hashFile(browserAudioPath);
  manifest.gpu = await gpuPreflight();
  const steps = stepDefinitions();
  manifest.plannedSteps = steps.map((step) => step.id);

  if (dryRun) {
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(JSON.stringify(manifest, null, 2));
    process.exit(0);
  }

  for (const step of steps) await runStep(step, manifest);
  manifest.ok = true;
  manifest.completedAt = new Date().toISOString();
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify(manifest, null, 2));
} catch (error) {
  manifest.ok = false;
  manifest.error = {
    message: error.message || String(error),
    stack: error.stack || "",
  };
  manifest.completedAt = new Date().toISOString();
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  console.error(JSON.stringify(manifest, null, 2));
  process.exitCode = 1;
}
