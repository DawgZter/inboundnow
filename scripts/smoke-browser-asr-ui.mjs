#!/usr/bin/env node
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { chromium } from "playwright";

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const artifactDir = join("artifacts", "smoke", "browser-asr-ui-" + timestamp);
const tokenPort = Number(process.env.SMOKE_TOKEN_PORT || 4741);
const labPort = Number(process.env.SMOKE_LAB_PORT || 4742);
const mockRemotePort = Number(process.env.SMOKE_REMOTE_PORT || 4743);
const tokenServerUrl = "http://127.0.0.1:" + tokenPort;
const labUrl = "http://127.0.0.1:" + labPort;
const mockRemoteUrl = "http://127.0.0.1:" + mockRemotePort + "/";
const room = "browser-asr-ui-smoke";
const children = [];
let mockServer;
let fakeTtsServer;
const fakeTtsRequests = [];
let browser;

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

async function waitForJson(url, timeoutMs = 8000) {
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
    await wait(150);
  }
  throw lastError || new Error("Timed out waiting for " + url);
}

async function waitForHttp(url, timeoutMs = 8000) {
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
    await wait(150);
  }
  throw lastError || new Error("Timed out waiting for " + url);
}

function startMockRemote() {
  mockServer = createServer((req, res) => {
    if (req.url === "/favicon.ico") {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html>
<html>
  <head><title>Remote local ASR UI smoke</title></head>
  <body>
    <header>
      <a href="/pricing">Pricing</a>
      <a href="/country-explorer">Country explorer</a>
      <a href="/global-payroll">Global payroll</a>
      <button>Book a demo</button>
    </header>
    <main>
      <h1>Global payroll</h1>
      <p>Remote helps teams run global payroll with local compliance context.</p>
    </main>
  </body>
</html>`);
  });
  return new Promise((resolve) => mockServer.listen(mockRemotePort, "127.0.0.1", resolve));
}

async function readBody(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body ? JSON.parse(body) : {};
}

function writeJson(response, payload) {
  response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(payload));
}

function pcm16Base64(samples = 1200, phase = 0) {
  const buffer = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index += 1) {
    const value = Math.round(Math.sin((index + phase) / 12) * 9000);
    buffer.writeInt16LE(value, index * 2);
  }
  return buffer.toString("base64");
}

const pcmChunkA = pcm16Base64(1200, 0);
const pcmChunkB = pcm16Base64(1200, 6);

function startFakeTtsServer() {
  fakeTtsServer = createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      writeJson(res, { ok: true, provider: "fake-vibevoice-browser-contract", localOnly: true, streaming: true });
      return;
    }
    if (req.method === "POST" && req.url === "/prewarm") {
      const body = await readBody(req);
      fakeTtsRequests.push({ path: req.url, body });
      writeJson(res, { ok: true, warmed: true, cacheHit: false, firstAudioMs: 0 });
      return;
    }
    if (req.method === "POST" && req.url === "/v1/tts/stream") {
      const body = await readBody(req);
      fakeTtsRequests.push({ path: req.url, body });
      res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store" });
      res.write(JSON.stringify({ type: "start", sampleRate: 24000, channels: 1, format: "pcm16", cacheHit: false, proofLevel: "contract" }) + "\n");
      res.write(JSON.stringify({ type: "chunk", sequence: 0, audio: pcmChunkA, firstAudioMs: 19, proofLevel: "contract" }) + "\n");
      res.write(JSON.stringify({ type: "chunk", sequence: 1, audio: pcmChunkB, cacheHit: true, proofLevel: "contract" }) + "\n");
      res.write(JSON.stringify({ type: "end", totalMs: 47, cacheHit: true, proofLevel: "contract" }) + "\n");
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) => {
    fakeTtsServer.listen(0, "127.0.0.1", () => {
      const address = fakeTtsServer.address();
      resolve("http://127.0.0.1:" + address.port);
    });
  });
}

async function closeMockRemote() {
  if (!mockServer) return;
  await new Promise((resolve) => mockServer.close(resolve));
  mockServer = null;
}

async function closeFakeTtsServer() {
  if (!fakeTtsServer) return;
  await new Promise((resolve) => fakeTtsServer.close(resolve));
  fakeTtsServer = null;
}

async function stopAll() {
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  if (browser) await browser.close().catch(() => {});
  await closeMockRemote();
  await closeFakeTtsServer();
}

function proxiedMockPath() {
  const target = new URL(mockRemoteUrl);
  return labUrl + "/__remote/" + target.protocol.slice(0, -1) + "/" + target.host + target.pathname;
}

function sanitizeConsoleText(value) {
  return String(value || "")
    .replace(/access_token=[^&\s]+/g, "access_token=<redacted>")
    .replace(/join_request=[^&\s]+/g, "join_request=<redacted>")
    .slice(0, 500);
}

async function readUiState(page) {
  return page.evaluate(() => {
    const root = document.querySelector("#ocw-root");
    const chipText = (name) => document.querySelector('[data-ocw-chip="' + name + '"]')?.textContent || "";
    const transcript = Array.from(document.querySelectorAll(".ocw-turn")).map((node) => ({
      role: node.getAttribute("data-role") || "",
      text: node.textContent || "",
    }));
    return {
      proofLine: document.querySelector(".ocw-proof-line")?.textContent || "",
      status: document.querySelector(".ocw-status")?.textContent || "",
      agentState: root?.dataset.agentState || "",
      transportChip: chipText("transport"),
      asrChip: chipText("asr"),
      turnChip: chipText("turn"),
      voiceChip: chipText("voice"),
      transcript,
      events: window.OpenClickyWeb.events(),
      debug: window.OpenClickyWeb.debugState(),
    };
  });
}

await mkdir(artifactDir, { recursive: true });

try {
  await startMockRemote();
  const ttsBaseUrl = await startFakeTtsServer();
  spawnLogged("token", "node", ["services/token-server/server.mjs"], {
    TOKEN_SERVER_PORT: String(tokenPort),
    LIVEKIT_ROOM: room,
  });
  spawnLogged("agent", "node", ["apps/agent/worker.mjs"], {
    TOKEN_SERVER_URL: tokenServerUrl,
    LIVEKIT_ROOM: room,
    AGENT_TRANSPORT: "bridge",
    TTS_PROVIDER: "local-vibevoice",
    TTS_BASE_URL: ttsBaseUrl,
    TTS_MODEL: "microsoft/VibeVoice-Realtime-0.5B",
    TTS_VOICE: "Carter",
    TTS_DTYPE: "bfloat16",
    TTS_QUANTIZATION: "llm-int8",
    TTS_CACHE_DIR: "artifacts/cache/tts-browser-contract",
    TTS_VOICE_STYLE: "warm",
    TTS_TEXT_CHUNK_CHARS: "96",
  });
  spawnLogged("lab", "node", ["apps/website-lab/server.mjs"], {
    PORT: String(labPort),
    TOKEN_SERVER_URL: tokenServerUrl,
    LIVEKIT_ROOM: room,
    OPENCLICKY_INJECT_HOSTS: "127.0.0.1,localhost",
  });

  const health = await waitForJson(tokenServerUrl + "/health");
  assert.equal(health.ok, true);
  await waitForHttp(labUrl + "/__ocw-assets/clicky-cursor.svg");

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const browserConsole = [];
  page.on("console", (message) => browserConsole.push({ type: message.type(), text: sanitizeConsoleText(message.text()) }));
  page.on("pageerror", (error) => browserConsole.push({ type: "pageerror", text: sanitizeConsoleText(error.message) }));

  await page.goto(proxiedMockPath(), { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.OpenClickyWeb), null, { timeout: 10_000 });
  const initial = await readUiState(page);
  assert.equal(initial.asrChip, "ASR: text fallback");
  assert.match(initial.proofLine, /ASR turns use local transcript or Parakeet adapter boundaries/);
  assert.doesNotMatch(initial.proofLine, /ASR is not attached/i);

  await page.evaluate(() => window.OpenClickyWeb.setVoiceProfile("warm"));
  await page.waitForFunction(() => document.querySelector('[data-ocw-chip="voice"]')?.textContent.includes("Warm consultative"), null, { timeout: 5000 });

  await page.evaluate(() => window.OpenClickyWeb.startVoiceTurn());
  await page.waitForFunction(() => window.OpenClickyWeb.events().some((event) => event.type === "asrStatusReceived" && event.detail.status === "listening"), null, { timeout: 12_000 });
  const listening = await readUiState(page);
  assert.match(listening.asrChip, /listening/);
  assert.match(listening.turnChip, /listening/);
  assert.match(listening.transcript.map((turn) => turn.text).join("\n"), /Voice turn started/);

  await page.evaluate(() => window.OpenClickyWeb.stopVoiceTurn());
  await page.waitForFunction(() => window.OpenClickyWeb.events().some((event) => event.type === "asrStatusReceived" && event.detail.status === "no_audio"), null, { timeout: 12_000 });
  const noAudio = await readUiState(page);
  assert.match(noAudio.asrChip, /no_audio/);

  await page.evaluate(() => window.OpenClickyWeb.sendFinalTranscript("How does Remote help with global payroll?"));
  await page.waitForFunction(() => window.OpenClickyWeb.events().some((event) => event.type === "asrFinalReceived"), null, { timeout: 12_000 });
  await page.waitForFunction(() => window.OpenClickyWeb.events().some((event) => event.type === "agentAnswerReceived"), null, { timeout: 12_000 });
  await page.waitForFunction(() => window.OpenClickyWeb.events().some((event) => event.type === "speechStreamStarted"), null, { timeout: 12_000 });
  await page.waitForFunction(() => window.OpenClickyWeb.events().some((event) => event.type === "ttsAudioStreamEnded"), null, { timeout: 12_000 });
  const finalTranscript = await readUiState(page);
  const transcriptText = finalTranscript.transcript.map((turn) => turn.text).join("\n");
  assert.match(finalTranscript.asrChip, /transcript fallback/);
  assert.match(finalTranscript.voiceChip, /Warm consultative/);
  assert.match(transcriptText, /Simulated transcript: How does Remote help with global payroll\?/);
  assert.match(transcriptText, /Heard: How does Remote help with global payroll\?/);
  assert.match(transcriptText, /Remote helps with global payroll/i);
  assert.equal(finalTranscript.events.some((event) => event.type === "asrFinalReceived" && event.detail.simulated === true), true);
  assert.equal(finalTranscript.events.some((event) => event.type === "agentAnswerReceived" && event.detail.intent === "global_payroll"), true);
  assert.equal(finalTranscript.events.some((event) => event.type === "speechStreamStarted" && event.detail.modelAudio === true && event.detail.fallback === "text-caption-only"), true);
  assert.equal(finalTranscript.events.some((event) => event.type === "speechChunkDisplayed" && event.detail.reason === "model-audio-active"), true);
  assert.equal(finalTranscript.events.some((event) => event.type === "ttsAudioStreamStarted" && event.detail.provider === "local-vibevoice" && event.detail.proofLevel === "contract"), true);
  assert.equal(finalTranscript.events.some((event) => event.type === "ttsAudioChunkReceived" && event.detail.bytesApprox > 1000 && event.detail.proofLevel === "contract"), true);
  assert.equal(finalTranscript.events.some((event) => event.type === "ttsAudioChunkScheduled" && event.detail.durationMs > 0), true);
  assert.equal(finalTranscript.events.some((event) => event.type === "ttsAudioStreamEnded" && event.detail.chunkCount === 2 && event.detail.proofLevel === "contract"), true);
  assert.ok(fakeTtsRequests.some((request) => request.path === "/prewarm"));
  assert.ok(fakeTtsRequests.some((request) => request.path === "/v1/tts/stream" && request.body.requestId && request.body.cacheKey));

  await page.evaluate(({ audio0, audio1 }) => {
    window.OpenClickyWeb.receiveAgentMessageForSmoke({
      type: "agent.tts.start",
      requestId: "order_smoke",
      provider: "local-vibevoice",
      proofLevel: "contract",
      format: "pcm16",
      sampleRate: 24000,
      channels: 1,
    });
    window.OpenClickyWeb.receiveAgentMessageForSmoke({
      type: "agent.tts.chunk",
      requestId: "order_smoke",
      provider: "local-vibevoice",
      proofLevel: "contract",
      format: "pcm16",
      sampleRate: 24000,
      channels: 1,
      sequence: 1,
      audioBase64: audio1,
    });
    window.OpenClickyWeb.receiveAgentMessageForSmoke({
      type: "agent.tts.chunk",
      requestId: "order_smoke",
      provider: "local-vibevoice",
      proofLevel: "contract",
      format: "pcm16",
      sampleRate: 24000,
      channels: 1,
      sequence: 0,
      audioBase64: audio0,
    });
    window.OpenClickyWeb.receiveAgentMessageForSmoke({
      type: "agent.tts.chunk",
      requestId: "order_smoke",
      provider: "local-vibevoice",
      proofLevel: "contract",
      format: "pcm16",
      sampleRate: 24000,
      channels: 1,
      sequence: 0,
      audioBase64: audio0,
    });
    window.OpenClickyWeb.receiveAgentMessageForSmoke({
      type: "agent.tts.end",
      requestId: "order_smoke",
      provider: "local-vibevoice",
      proofLevel: "contract",
      chunkCount: 2,
      firstAudioMs: 12,
    });
  }, { audio0: pcmChunkA, audio1: pcmChunkB });
  await page.waitForFunction(() => window.OpenClickyWeb.events().some((event) => event.type === "ttsAudioStreamEnded" && event.detail.requestId === "order_smoke"), null, { timeout: 5000 });
  const afterOrderingProbe = await readUiState(page);
  const orderingEvents = afterOrderingProbe.events.filter((event) => event.detail.requestId === "order_smoke");
  assert.deepEqual(
    orderingEvents.filter((event) => event.type === "ttsAudioChunkScheduled").map((event) => event.detail.sequence),
    [0, 1],
  );
  assert.equal(orderingEvents.some((event) => event.type === "ttsAudioChunkBuffered" && event.detail.sequence === 1), true);
  assert.equal(orderingEvents.some((event) => event.type === "ttsAudioChunkIgnored" && event.detail.reason === "duplicate-sequence"), true);

  const answeredRequestId = finalTranscript.events.find((event) => event.type === "speechStreamStarted")?.detail.requestId;
  assert.ok(answeredRequestId);
  await page.evaluate(async ({ requestId, audio }) => {
    await window.OpenClickyWeb.interruptResponse();
    window.OpenClickyWeb.receiveAgentMessageForSmoke({
      type: "agent.tts.start",
      requestId,
      provider: "local-vibevoice",
      proofLevel: "contract",
      format: "pcm16",
      sampleRate: 24000,
      channels: 1,
    });
    window.OpenClickyWeb.receiveAgentMessageForSmoke({
      type: "agent.tts.chunk",
      requestId,
      provider: "local-vibevoice",
      proofLevel: "contract",
      format: "pcm16",
      sampleRate: 24000,
      channels: 1,
      sequence: 99,
      audioBase64: audio,
    });
    window.OpenClickyWeb.receiveAgentMessageForSmoke({
      type: "agent.tts.end",
      requestId,
      provider: "local-vibevoice",
      proofLevel: "contract",
      chunkCount: 1,
    });
  }, { requestId: answeredRequestId, audio: pcmChunkA });
  const afterInterruptProbe = await readUiState(page);
  const staleEvents = afterInterruptProbe.events.filter((event) => event.detail.requestId === answeredRequestId);
  assert.equal(staleEvents.some((event) => event.type === "ttsAudioChunkIgnored" && event.detail.reason === "interrupted"), true);
  assert.equal(staleEvents.some((event) => event.type === "ttsAudioChunkScheduled" && event.detail.sequence === 99), false);

  const summary = {
    ok: true,
    artifactDir,
    labUrl,
    proxiedUrl: proxiedMockPath(),
    checks: {
      initialAsrCopyCurrent: true,
      startVoiceTurnListeningUi: true,
      stopVoiceTurnNoAudioUi: true,
      finalTranscriptUi: true,
      voiceProfilePreserved: true,
      speechStreamStarted: true,
      browserTtsAudioEvents: true,
      browserTtsAudioScheduled: true,
      browserSpeechSuppressedForModelAudio: true,
      modelAudioProofLevelContract: true,
      staleModelAudioIgnored: true,
      modelAudioOrderingAndDedupe: true,
    },
    states: { initial, listening, noAudio, finalTranscript, afterOrderingProbe, afterInterruptProbe },
    fakeTtsRequests,
    browserConsole,
  };

  await writeFile(join(artifactDir, "result.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await stopAll();
}
