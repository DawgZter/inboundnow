#!/usr/bin/env node
import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { mkdir, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import WebSocket from "ws";

const children = [];
const requestBodies = [];
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const artifactDir = join("artifacts", "smoke", "agent-tts-local-" + timestamp);
const room = "inboundnow-agent-tts-local-smoke";
const identity = "agent-tts-local-browser";

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

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : 0;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
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

async function createFakeTtsServer() {
  const server = createHttpServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      writeJson(response, { ok: true, provider: "fake-vibevoice-agent-contract", localOnly: true, streaming: true });
      return;
    }

    if (request.method === "POST" && request.url === "/prewarm") {
      const body = await readBody(request);
      requestBodies.push({ path: request.url, body });
      writeJson(response, { ok: true, warmed: true, cacheHit: false, firstAudioMs: 0 });
      return;
    }

    if (request.method === "POST" && request.url === "/v1/tts/stream") {
      const body = await readBody(request);
      requestBodies.push({ path: request.url, body });
      response.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store" });
      response.write(JSON.stringify({ type: "start", sampleRate: 24000, channels: 1, format: "pcm16", cacheHit: false, proofLevel: "contract" }) + "\n");
      response.write(JSON.stringify({ type: "chunk", sequence: 0, audio: pcmChunkA, firstAudioMs: 21, proofLevel: "contract" }) + "\n");
      setTimeout(() => {
        response.write(JSON.stringify({ type: "chunk", sequence: 1, audio: pcmChunkB, cacheHit: true, proofLevel: "contract" }) + "\n");
        response.write(JSON.stringify({ type: "end", totalMs: 160, cacheHit: true, proofLevel: "contract" }) + "\n");
        response.end();
      }, 120);
      return;
    }

    response.writeHead(404);
    response.end();
  });

  const baseUrl = await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve("http://127.0.0.1:" + address.port);
    });
    server.on("error", reject);
  });
  return { server, baseUrl };
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

function bridgeUrl(tokenServerUrl) {
  const url = new URL(tokenServerUrl);
  url.protocol = "ws:";
  url.pathname = "/agent-bridge";
  url.search = new URLSearchParams({ role: "browser", room, identity }).toString();
  return url.href;
}

async function connectBrowser(tokenServerUrl) {
  const ws = new WebSocket(bridgeUrl(tokenServerUrl));
  const seen = [];
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for bridge agent")), 8000);
    function cleanup() {
      clearTimeout(timer);
      ws.off("message", onMessage);
      ws.off("error", onError);
    }
    function onError(error) {
      cleanup();
      reject(error);
    }
    function onMessage(raw) {
      const message = JSON.parse(String(raw));
      seen.push(message);
      if (
        (message.type === "bridge.ready" && message.peers?.agents > 0) ||
        (message.type === "bridge.peer_joined" && message.role === "agent")
      ) {
        cleanup();
        resolve();
      }
    }
    ws.on("message", onMessage);
    ws.on("error", onError);
  });
  return { ws, seen };
}

function sendQuestion(ws) {
  ws.send(JSON.stringify({
    id: "tts_agent_smoke",
    type: "prospect.question",
    sessionId: "tts-agent-local-session",
    question: "How does Remote help with global payroll?",
    voiceProfile: "warm",
    simulatedVoice: true,
    transport: "bridge",
    bookingState: "none",
    pageSnapshot: {
      url: "http://127.0.0.1/agent-tts-local-smoke",
      title: "Remote agent TTS smoke",
      headings: ["Global payroll"],
      ctas: ["Book a demo"],
      navLinks: ["Pricing", "Country explorer"],
    },
  }));
}

async function waitForTurn(ws, seen, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for agent TTS turn"));
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      ws.off("message", onMessage);
    }
    function maybeResolve() {
      const turn = seen.filter((item) => item.requestId === "tts_agent_smoke");
      const answer = turn.find((item) => item.type === "agent.answer");
      const speechStart = turn.find((item) => item.type === "agent.speech.start");
      const speechChunk = turn.find((item) => item.type === "agent.speech.chunk");
      const speechEnd = turn.find((item) => item.type === "agent.speech.end");
      const ttsStart = turn.find((item) => item.type === "agent.tts.start");
      const ttsChunk = turn.find((item) => item.type === "agent.tts.chunk");
      const ttsEnd = turn.find((item) => item.type === "agent.tts.end");
      const action = turn.find((item) => item.type === "agent.action");
      if (answer && speechStart && speechChunk && speechEnd && ttsStart && ttsChunk && ttsEnd && action) {
        cleanup();
        resolve({ turn, answer, speechStart, speechChunk, speechEnd, ttsStart, ttsChunk, ttsEnd, action });
      }
    }
    function onMessage(raw) {
      seen.push(JSON.parse(String(raw)));
      maybeResolve();
    }
    ws.on("message", onMessage);
    maybeResolve();
  });
}

await mkdir(artifactDir, { recursive: true });
const tokenPort = await freePort();
const tokenServerUrl = "http://127.0.0.1:" + tokenPort;
const { server: ttsServer, baseUrl: ttsBaseUrl } = await createFakeTtsServer();

try {
  spawnLogged("token", process.execPath, ["services/token-server/server.mjs"], {
    TOKEN_SERVER_PORT: String(tokenPort),
    LIVEKIT_ROOM: room,
  });
  spawnLogged("agent", process.execPath, ["apps/agent/worker.mjs"], {
    TOKEN_SERVER_URL: tokenServerUrl,
    LIVEKIT_ROOM: room,
    AGENT_TRANSPORT: "bridge",
    TTS_PROVIDER: "local-vibevoice",
    TTS_BASE_URL: ttsBaseUrl,
    TTS_MODEL: "microsoft/VibeVoice-Realtime-0.5B",
    TTS_VOICE: "Carter",
    TTS_DTYPE: "bfloat16",
    TTS_QUANTIZATION: "llm-int8",
    TTS_CACHE_DIR: "artifacts/cache/tts-agent-contract",
    TTS_VOICE_STYLE: "warm",
    TTS_TEXT_CHUNK_CHARS: "96",
    TTS_LORA_ADAPTER: "artifacts/miso-lora/adapters/miso-one-lora-dev",
  });

  const health = await waitForJson(tokenServerUrl + "/health");
  assert.equal(health.ok, true);

  const { ws, seen } = await connectBrowser(tokenServerUrl);
  sendQuestion(ws);
  const turn = await waitForTurn(ws, seen);
  ws.close();

  assert.equal(turn.answer.adapters.tts, "vibevoice-realtime-local");
  assert.equal(turn.speechStart.modelAudio, true);
  assert.equal(turn.speechStart.fallback, "text-caption-only");
  assert.equal(turn.ttsStart.provider, "local-vibevoice");
  assert.equal(turn.ttsStart.proofLevel, "contract");
  assert.equal(turn.ttsStart.localVibeVoiceProven, false);
  assert.equal(turn.ttsChunk.provider, "local-vibevoice");
  assert.equal(turn.ttsChunk.proofLevel, "contract");
  assert.equal(turn.ttsChunk.simulated, false);
  assert.equal(turn.ttsChunk.quantization, "llm-int8");
  assert.equal(turn.ttsChunk.format, "pcm16");
  assert.ok(turn.ttsChunk.audio);
  assert.equal(turn.ttsChunk.audioBase64, turn.ttsChunk.audio);
  assert.equal(turn.ttsChunk.chunkEncoding, "base64");
  assert.ok(turn.ttsChunk.byteLength > 1000);
  assert.equal(turn.ttsChunk.localVibeVoiceProven, false);
  assert.equal(turn.ttsEnd.chunkCount, 2);
  assert.equal(turn.ttsEnd.proofLevel, "contract");
  assert.equal(turn.ttsEnd.localVibeVoiceProven, false);
  assert.equal(turn.ttsStart.sessionId, "tts-agent-local-session");
  assert.equal(turn.action.action.type, "showCaption");

  const speechEndIndex = seen.indexOf(turn.speechEnd);
  const ttsEndIndex = seen.indexOf(turn.ttsEnd);
  const actionIndex = seen.indexOf(turn.action);
  assert.ok(speechEndIndex !== -1 && ttsEndIndex !== -1 && actionIndex !== -1);
  assert.ok(actionIndex > speechEndIndex);
  assert.ok(actionIndex < ttsEndIndex);

  const streamBody = requestBodies.find((item) => item.path === "/v1/tts/stream")?.body;
  assert.ok(streamBody?.cacheKey);
  assert.equal(streamBody.requestId, "tts_agent_smoke");
  assert.equal(streamBody.text, turn.answer.answer);
  assert.equal(streamBody.style, "warm");
  assert.equal(streamBody.quantization, "llm-int8");
  assert.equal(streamBody.loraAdapter, "artifacts/miso-lora/adapters/miso-one-lora-dev");
  assert.ok(requestBodies.some((item) => item.path === "/prewarm"));

  const result = {
    ok: true,
    artifactDir,
    ttsBaseUrl,
    checks: {
      fakeLocalVibeVoiceEndpoint: true,
      agentCalledPrewarm: true,
      agentCalledStream: true,
      modelAudioEvents: true,
      contractProofLevel: true,
      textCaptionsOnlyFallback: true,
      actionAfterTextCaptions: true,
      actionBeforeTtsEnd: true,
      actionsOverlapModelAudio: true,
    },
    tts: {
      provider: turn.ttsStart.provider,
      proofLevel: turn.ttsStart.proofLevel,
      localVibeVoiceProven: turn.ttsEnd.localVibeVoiceProven,
      chunkCount: turn.ttsEnd.chunkCount,
      firstAudioMs: turn.ttsEnd.firstAudioMs,
      format: turn.ttsChunk.format,
      quantization: turn.ttsChunk.quantization,
      cacheKey: turn.ttsChunk.cacheKey,
    },
    speech: {
      provider: turn.speechStart.provider,
      fallback: turn.speechStart.fallback,
      modelAudio: turn.speechStart.modelAudio,
      chunkCount: turn.speechEnd.chunkCount,
    },
    requestBodies,
  };

  await writeFile(join(artifactDir, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  stopAll();
  await new Promise((resolve) => ttsServer.close(resolve));
}
