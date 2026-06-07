#!/usr/bin/env node
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { access, mkdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { createWriteStream } from "node:fs";
import { spawn, execFile } from "node:child_process";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const artifactDir = join("artifacts", "smoke", "browser-h100-persona-" + timestamp);
const tokenServerUrl = process.env.TOKEN_SERVER_URL || "http://127.0.0.1:4301";
const mossRuntimeUrl = process.env.MOSS_RUNTIME_URL || "http://127.0.0.1:4321";
const llmBaseUrl = process.env.LLM_BASE_URL || "http://127.0.0.1:4311/v1";
const llmModel = process.env.LLM_MODEL || process.env.LLM_SERVED_MODEL_NAME || "qwen3.6-27b";
const asrBaseUrl = process.env.ASR_BASE_URL || process.env.PARAKEET_BASE_URL || "http://127.0.0.1:4341";
const ttsBaseUrl = process.env.TTS_BASE_URL || "http://127.0.0.1:4331";
const labPort = Number(process.env.SMOKE_LAB_PORT || 4299);
const targetPort = Number(process.env.SMOKE_TARGET_PORT || 4298);
const labUrl = "http://127.0.0.1:" + labPort;
const room = process.env.LIVEKIT_ROOM || "inboundnow-h100";
const micAudioPath = process.env.BROWSER_MIC_AUDIO_PATH || process.env.ASR_SMOKE_AUDIO_PATH || "";
const expectedTranscriptPattern = new RegExp(process.env.ASR_EXPECTED_PATTERN || "Remote|payroll|global", "i");
const headless = process.env.HEADLESS !== "0";
const allowNonH100 = ["1", "true", "yes", "on"].includes(String(process.env.ALLOW_NON_H100 || "").toLowerCase());
const allowRemoteTarget = ["1", "true", "yes", "on"].includes(String(process.env.ALLOW_REMOTE_TARGET || "").toLowerCase());
const requireManualMic = ["1", "true", "yes", "on"].includes(String(process.env.REQUIRE_MANUAL_MIC || "").toLowerCase());
const children = [];
let browser;
let targetServer;

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

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function execFileText(command, args = []) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 10_000 }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve(String(stdout || ""));
    });
  });
}

function assertLoopbackHttp(raw, label) {
  const parsed = new URL(raw);
  assert.ok(["http:", "https:"].includes(parsed.protocol), label + " must be HTTP(S)");
  assert.ok(
    parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "::1",
    label + " must be loopback for local proof",
  );
  return parsed;
}

function endpoint(baseUrl, pathname) {
  return new URL(pathname, baseUrl.endsWith("/") ? baseUrl : baseUrl + "/").href;
}

function assertNotStubOpenAIModels(payload, expectedModel) {
  const models = Array.isArray(payload?.data) ? payload.data : [];
  const ids = models.map((model) => String(model.id || ""));
  const owners = models.map((model) => String(model.owned_by || ""));
  assert.ok(models.length > 0, "LLM /models must return at least one served model");
  assert.equal(ids.some((id) => id === expectedModel || /qwen/i.test(id)), true, "LLM endpoint must serve the expected Qwen model");
  assert.equal(ids.some((id) => /stub|fake|fixture/i.test(id)), false, "H100 Qwen proof must not use a stub model id");
  assert.equal(owners.some((owner) => /stub|fake|fixture/i.test(owner)), false, "H100 Qwen proof must not use a stub-owned endpoint");
}

async function assertH100() {
  if (allowNonH100) return { skipped: true, reason: "ALLOW_NON_H100" };
  const output = await execFileText("nvidia-smi", ["--query-gpu=name", "--format=csv,noheader"]);
  assert.match(output, /H100/i, "H100 proof smoke must run on an NVIDIA H100; set ALLOW_NON_H100=1 only for harness dry runs.");
  return { skipped: false, gpu: output.trim() };
}

async function waitForJson(url, timeoutMs = 30_000) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
      lastError = new Error(url + " returned HTTP " + response.status);
    } catch (error) {
      lastError = error;
    }
    await wait(250);
  }
  throw lastError || new Error("Timed out waiting for " + url);
}

async function waitForHttp(url, timeoutMs = 30_000) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      lastError = new Error(url + " returned HTTP " + response.status);
    } catch (error) {
      lastError = error;
    }
    await wait(250);
  }
  throw lastError || new Error("Timed out waiting for " + url);
}

function startTargetServer() {
  targetServer = createServer((req, res) => {
    if (req.url === "/favicon.ico") {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(`<!doctype html>
<html>
  <head>
    <title>Remote local H100 persona smoke</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
  </head>
  <body>
    <header>
      <nav>
        <a href="/pricing">Pricing</a>
        <a href="/country-explorer">Country explorer</a>
        <a href="/global-payroll">Global payroll</a>
      </nav>
      <a href="/book-demo">Book a demo</a>
    </header>
    <main>
      <h1>Global payroll</h1>
      <p>Remote helps companies run global payroll with local compliance context, payroll operations, HR data, and payments for distributed teams.</p>
      <button>Book a demo</button>
    </main>
  </body>
</html>`);
  });
  return new Promise((resolve) => targetServer.listen(targetPort, "127.0.0.1", resolve));
}

async function closeTargetServer() {
  if (!targetServer) return;
  await new Promise((resolve) => targetServer.close(resolve));
  targetServer = null;
}

async function stopAll() {
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  if (browser) await browser.close().catch(() => {});
  await closeTargetServer();
}

function sanitizeConsoleText(value) {
  return String(value || "")
    .replace(/access_token=[^&\s]+/g, "access_token=<redacted>")
    .replace(/join_request=[^&\s]+/g, "join_request=<redacted>")
    .slice(0, 800);
}

function targetUrl() {
  if (process.env.SMOKE_TARGET_URL) {
    const parsed = new URL(process.env.SMOKE_TARGET_URL);
    if (!allowRemoteTarget) assertLoopbackHttp(parsed.href, "SMOKE_TARGET_URL");
    return parsed.href;
  }
  return "http://127.0.0.1:" + targetPort + "/";
}

function proxiedTargetUrl() {
  const target = new URL(targetUrl());
  return labUrl + "/__remote/" + target.protocol.slice(0, -1) + "/" + target.host + target.pathname;
}

async function readState(page) {
  return page.evaluate(() => {
    const chipText = (name) => document.querySelector('[data-ocw-chip="' + name + '"]')?.textContent || "";
    const frame = document.querySelector(".ocw-cal-frame");
    const prompt = document.querySelector(".ocw-booking-prompt");
    const scheduler = document.querySelector(".ocw-scheduler");
    const transcript = Array.from(document.querySelectorAll(".ocw-turn")).map((node) => ({
      role: node.getAttribute("data-role") || "",
      text: node.textContent || "",
    }));
    return {
      proofLine: document.querySelector(".ocw-proof-line")?.textContent || "",
      status: document.querySelector(".ocw-status")?.textContent || "",
      transportChip: chipText("transport"),
      micChip: chipText("mic"),
      agentChip: chipText("agent"),
      asrChip: chipText("asr"),
      turnChip: chipText("turn"),
      voiceChip: chipText("voice"),
      transcript,
      events: window.OpenClickyWeb.events(),
      debug: window.OpenClickyWeb.debugState(),
      cal: {
        frameSrc: frame?.getAttribute("src") || "",
        frameDataSrc: frame?.getAttribute("data-src") || "",
        promptOpen: prompt?.classList.contains("is-open") || false,
        schedulerOpen: scheduler?.classList.contains("is-open") || false,
      },
    };
  });
}

function eventOf(state, type, predicate = () => true) {
  return state.events.find((event) => event.type === type && predicate(event.detail || {}));
}

function hasEvent(state, type, predicate = () => true) {
  return Boolean(eventOf(state, type, predicate));
}

function assertNoStubProof(state) {
  const answer = eventOf(state, "agentAnswerReceived");
  assert.ok(answer, "agent answer event is required");
  assert.equal(answer.detail.simulated, false, "H100 answer must not be simulated");
  assert.equal(answer.detail.planner?.source, "local-llm-json", "planner must be local LLM JSON");
  assert.equal(answer.detail.planner?.provider, "qwen-openai-local", "planner must use qwen-openai-local");
  assert.equal(answer.detail.planner?.fallback, false, "planner fallback must be false in H100 proof");
  assert.equal(answer.detail.adapters?.asr, "parakeet-localhost", "ASR adapter label must be local Parakeet");
  assert.equal(answer.detail.adapters?.llm, "qwen-openai-local", "LLM adapter label must be local Qwen");
  assert.equal(answer.detail.adapters?.tts, "miso-one-local", "TTS adapter label must be local Miso One");
  assert.equal(answer.detail.adapters?.moss, "local-runtime-client", "retrieval adapter label must be local Moss runtime client");
  assert.equal(answer.detail.retrieval?.provider, "local-runtime-client", "retrieval provider must be local runtime client");
  assert.equal(answer.detail.retrieval?.simulated, false, "retrieval must not be fixture-simulated");
  assert.ok(Number(answer.detail.retrieval?.count || 0) > 0, "retrieval must include snippets");
}

await mkdir(artifactDir, { recursive: true });

try {
  const gpu = await assertH100();
  assertLoopbackHttp(tokenServerUrl, "TOKEN_SERVER_URL");
  assertLoopbackHttp(mossRuntimeUrl, "MOSS_RUNTIME_URL");
  assertLoopbackHttp(llmBaseUrl, "LLM_BASE_URL");
  assertLoopbackHttp(asrBaseUrl, "ASR_BASE_URL");
  assertLoopbackHttp(ttsBaseUrl, "TTS_BASE_URL");

  if (!requireManualMic) {
    assert.ok(micAudioPath, "BROWSER_MIC_AUDIO_PATH or ASR_SMOKE_AUDIO_PATH is required for automated browser media proof.");
    await access(resolve(micAudioPath), constants.R_OK);
  }

  if (!process.env.SMOKE_TARGET_URL) await startTargetServer();

  const tokenHealth = await waitForJson(new URL("/health", tokenServerUrl).href);
  assert.equal(tokenHealth.ok, true);
  assert.equal(tokenHealth.simulatedBridgeEnabled, false, "H100 proof requires ENABLE_SIM_BRIDGE=0");
  assert.doesNotMatch(tokenHealth.livekitUrl || "", /livekit\.cloud/i, "LiveKit Cloud is forbidden");

  const mossHealth = await waitForJson(new URL("/health", mossRuntimeUrl).href);
  assert.equal(mossHealth.ok, true);
  assert.equal(mossHealth.localOnly, true);
  assert.equal(mossHealth.adapter?.provider, "local-artifact", "Moss runtime must serve a local artifact");

  const llmModels = await waitForJson(endpoint(llmBaseUrl, "models"));
  assertNotStubOpenAIModels(llmModels, llmModel);

  const asrHealth = await waitForJson(new URL("/health", asrBaseUrl).href);
  assert.equal(asrHealth.ok, true);
  assert.equal(asrHealth.localOnly, true);
  assert.equal(asrHealth.provider, "local-parakeet");

  const ttsHealth = await waitForJson(new URL("/health", ttsBaseUrl).href);
  assert.equal(ttsHealth.ok, true);
  assert.equal(ttsHealth.localOnly, true);
  assert.equal(ttsHealth.provider, "local-miso-one");

  spawnLogged("lab", "node", ["apps/website-lab/server.mjs"], {
    PORT: String(labPort),
    TOKEN_SERVER_URL: tokenServerUrl,
    LIVEKIT_ROOM: room,
    REQUIRE_LIVEKIT: "1",
    H100_PROOF_MODE: "1",
    REMOTE_TARGET_URL: targetUrl(),
    OPENCLICKY_INJECT_HOSTS: new URL(targetUrl()).hostname,
  });
  await waitForHttp(labUrl + "/__ocw-assets/clicky-cursor.svg");

  const launchArgs = ["--autoplay-policy=no-user-gesture-required"];
  if (!requireManualMic) {
    launchArgs.push("--use-fake-ui-for-media-stream");
    launchArgs.push("--use-fake-device-for-media-stream");
    launchArgs.push("--use-file-for-fake-audio-capture=" + resolve(micAudioPath));
  }

  browser = await chromium.launch({ headless, args: launchArgs });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.grantPermissions(["microphone"], { origin: labUrl });
  const page = await context.newPage();
  const browserConsole = [];
  page.on("console", (message) => browserConsole.push({ type: message.type(), text: sanitizeConsoleText(message.text()) }));
  page.on("pageerror", (error) => browserConsole.push({ type: "pageerror", text: sanitizeConsoleText(error.message) }));

  await page.goto(proxiedTargetUrl(), { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.OpenClickyWeb), null, { timeout: 30_000 });
  await page.waitForTimeout(500);
  const initial = await readState(page);
  assert.equal(initial.cal.frameSrc, "", "Cal iframe must be unloaded at page start");

  await page.evaluate(() => window.OpenClickyWeb.setVoiceProfile("miso_lora_dev"));
  await page.waitForFunction(() => document.querySelector('[data-ocw-chip="voice"]')?.textContent.includes("Miso One"), null, { timeout: 10_000 });

  await page.click('[data-ocw-action="startpersona"]');
  await page.waitForFunction(() => window.OpenClickyWeb.events().some((event) => event.type === "personaStarted" && event.detail.transport === "livekit"), null, { timeout: 30_000 });
  await page.waitForFunction(() => window.OpenClickyWeb.events().some((event) => event.type === "liveKitConnected"), null, { timeout: 30_000 });
  await page.waitForFunction(() => window.OpenClickyWeb.debugState().transportMode === "livekit", null, { timeout: 30_000 });
  if (!requireManualMic) {
    await page.waitForFunction(() => window.OpenClickyWeb.events().some((event) => event.type === "liveKitMicPublished"), null, { timeout: 30_000 });
  }
  const connected = await readState(page);
  assert.equal(connected.debug.transportMode, "livekit");
  assert.equal(hasEvent(connected, "liveKitConnectFailed"), false, "LiveKit must not fall back to the bridge");
  assert.equal(hasEvent(connected, "bridgeConnected"), false, "Bridge fallback must not be used");
  assert.equal(hasEvent(connected, "liveKitMicPublishFailed"), false, "Mic publication must not fail");
  assert.match(connected.transportChip, /LiveKit data connected/);

  await page.waitForFunction(() => window.OpenClickyWeb.events().some((event) => event.type === "asrStatusReceived" && event.detail.status === "listening"), null, { timeout: 30_000 });
  await page.waitForTimeout(Number(process.env.BROWSER_MIC_CAPTURE_MS || 3500));
  await page.evaluate(() => window.OpenClickyWeb.stopVoiceTurn());

  await page.waitForFunction(() => window.OpenClickyWeb.events().some((event) => event.type === "asrFinalReceived"), null, { timeout: Number(process.env.ASR_FINAL_TIMEOUT_MS || 120_000) });
  await page.waitForFunction(() => window.OpenClickyWeb.events().some((event) => event.type === "agentAnswerReceived"), null, { timeout: Number(process.env.AGENT_ANSWER_TIMEOUT_MS || 120_000) });
  await page.waitForFunction(() => window.OpenClickyWeb.events().some((event) => event.type === "ttsAudioStreamEnded"), null, { timeout: Number(process.env.TTS_END_TIMEOUT_MS || 180_000) });
  await page.waitForFunction(() => window.OpenClickyWeb.events().some((event) => event.type === "queued"), null, { timeout: 30_000 });

  const answered = await readState(page);
  const transcriptText = answered.transcript.map((turn) => turn.text).join("\n");
  assert.match(transcriptText, expectedTranscriptPattern, "transcript should include expected utterance content");
  assert.equal(hasEvent(answered, "asrStatusReceived", (detail) => ["no_audio", "empty_transcript"].includes(detail.status)), false, "H100 browser proof must not use no-audio or empty transcript fallback");
  assert.equal(hasEvent(answered, "asrFinalReceived", (detail) => (
    detail.provider === "local-parakeet" &&
    detail.simulated === false &&
    detail.source === "livekit-audio-turn" &&
    /parakeet/i.test(detail.model || "") &&
    expectedTranscriptPattern.test(detail.transcript || "")
  )), true, "ASR final must come from browser LiveKit audio through real local Parakeet");
  assertNoStubProof(answered);
  assert.equal(hasEvent(answered, "speechStreamStarted", (detail) => detail.provider === "local-miso-one" && detail.modelAudio === true), true, "speech stream must be model-audio mode");
  assert.equal(hasEvent(answered, "speechStreamStarted", (detail) => detail.provider === "browser-speech-fallback"), false, "browser speech fallback cannot satisfy H100 proof");
  assert.equal(hasEvent(answered, "ttsAudioStreamStarted", (detail) => detail.provider === "local-miso-one" && detail.proofLevel === "verified"), true, "TTS stream must be verified local Miso One");
  assert.equal(hasEvent(answered, "ttsAudioChunkReceived", (detail) => detail.provider === "local-miso-one" && detail.proofLevel === "verified" && detail.bytesApprox > 0), true, "TTS chunks must be verified local Miso audio");
  assert.equal(hasEvent(answered, "ttsAudioChunkScheduled", (detail) => detail.provider === "local-miso-one" && detail.durationMs > 0), true, "verified Miso PCM chunks must be scheduled for playback");
  assert.equal(hasEvent(answered, "ttsAudioStreamEnded", (detail) => detail.provider === "local-miso-one" && detail.proofLevel === "verified" && detail.localMisoOneProven === true), true, "TTS end must mark local Miso One proven");
  assert.equal(hasEvent(answered, "ttsAudioStreamFailed"), false, "TTS stream must not fail");
  assert.equal(hasEvent(answered, "agentAnswerReceived", (detail) => detail.adapters?.tts === "vibevoice-realtime-local"), false, "legacy VibeVoice must not satisfy primary H100 proof");
  const queuedActionTypes = answered.events.filter((event) => event.type === "queued").map((event) => event.detail.type);
  assert.ok(queuedActionTypes.length > 0, "expected at least one browser action");
  assert.equal(queuedActionTypes.includes("payrollFlow"), false, "deprecated payrollFlow macro must not be used");
  assert.ok(queuedActionTypes.some((type) => ["showCaption", "scrollToElement", "highlightElement", "showBookingPrompt", "clickElement"].includes(type)), "expected primitive browser actions");
  assert.equal(answered.cal.frameSrc, "", "Cal must remain unloaded before explicit confirmation");

  await page.evaluate(() => window.OpenClickyWeb.openCal());
  await page.waitForFunction(() => window.OpenClickyWeb.events().some((event) => event.type === "openCalDeferred"), null, { timeout: 10_000 });
  const calDeferred = await readState(page);
  assert.equal(calDeferred.cal.frameSrc, "", "openCal must defer before explicit confirmation");
  assert.equal(calDeferred.cal.promptOpen, true, "booking prompt should be visible after deferred openCal");
  await page.click('[data-ocw-action="confirmBooking"]');
  await page.waitForFunction(() => {
    const frame = document.querySelector(".ocw-cal-frame");
    return window.OpenClickyWeb.events().some((event) => event.type === "calOpened") && Boolean(frame?.getAttribute("src"));
  }, null, { timeout: 10_000 });
  const calConfirmed = await readState(page);
  assert.ok(calConfirmed.cal.frameSrc, "Cal iframe should load only after explicit confirmation");
  const screenshotPath = join(artifactDir, "final.png");
  await page.screenshot({ path: screenshotPath, fullPage: true });

  const summary = {
    ok: true,
    artifactDir,
    proof: "h100-browser-persona-local-stack",
    boundary: requireManualMic
      ? "Manual browser microphone mode: proves the live browser path only if a human spoke during the capture window."
      : "Automated browser media-fixture mode: proves browser media publication through local LiveKit plus real local model endpoints, but not a human manually speaking into the microphone.",
    gpu,
    room,
    labUrl,
    proxiedUrl: proxiedTargetUrl(),
    micAudioPath: requireManualMic ? "manual" : resolve(micAudioPath),
    screenshotPath,
    services: {
      token: tokenHealth,
      moss: mossHealth,
      llm: { baseUrl: llmBaseUrl, expectedModel: llmModel, models: llmModels },
      asr: asrHealth,
      tts: ttsHealth,
    },
    checks: {
      h100Preflight: true,
      bridgeDisabled: true,
      liveKitConnected: true,
      micPublished: requireManualMic ? "manual" : true,
      asrFinalLocalParakeet: true,
      qwenPlannerNoFallback: true,
      localMossRuntimeRetrieval: true,
      localMisoOneVerifiedAudio: true,
      primitiveActionsOnly: true,
      calGatedBeforeConfirmation: true,
      calLoadsAfterExplicitConfirmation: true,
    },
    states: { initial, connected, answered, calDeferred, calConfirmed },
    browserConsole,
  };

  await writeFile(join(artifactDir, "result.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await stopAll();
}
