#!/usr/bin/env node
import assert from "node:assert/strict";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { join } from "node:path";
import WebSocket from "ws";
import { encodePcm16WavBase64 } from "../packages/voice-input/index.mjs";

const children = [];
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const artifactDir = join("artifacts", "smoke", "asr-local-" + timestamp);
const tokenPort = Number(process.env.SMOKE_TOKEN_PORT || 4841);
const room = process.env.LIVEKIT_ROOM || "inboundnow-asr-local-smoke";
const tokenServerUrl = "http://127.0.0.1:" + tokenPort;
const transcriptSessionId = "asr-transcript-smoke-session";
const audioSessionId = "asr-audio-smoke-session";
const asrBodies = [];

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

async function readBody(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body ? JSON.parse(body) : {};
}

function createFakeAsrServer() {
  return createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        ok: true,
        provider: "fake-parakeet-contract",
        model: "nvidia/parakeet-tdt-0.6b-v3",
        localOnly: true,
      }));
      return;
    }

    if (request.method === "POST" && request.url === "/v1/asr/transcribe") {
      const body = await readBody(request);
      asrBodies.push(body);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        provider: "fake-parakeet-contract",
        model: body.model,
        transcript: "How does Remote help with global payroll?",
        language: body.language || "en",
        confidence: 0.91,
        final: true,
      }));
      return;
    }

    response.writeHead(404);
    response.end();
  });
}

function bridgeUrl() {
  const url = new URL(tokenServerUrl);
  url.protocol = "ws:";
  url.pathname = "/agent-bridge";
  url.search = new URLSearchParams({
    role: "browser",
    room,
    identity: "asr-smoke-browser",
  }).toString();
  return url.href;
}

async function connectBrowser() {
  const ws = new WebSocket(bridgeUrl());
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

function waitForTurn(ws, requestId, seen, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      ws.off("message", onMessage);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for turn " + requestId));
    }, timeoutMs);
    function maybeResolve() {
      const turn = seen.filter((item) => item.requestId === requestId);
      const asrFinal = turn.find((item) => item.type === "agent.asr.final");
      const answer = turn.find((item) => item.type === "agent.answer");
      const speechStart = turn.find((item) => item.type === "agent.speech.start");
      const speechChunk = turn.find((item) => item.type === "agent.speech.chunk");
      const speechEnd = turn.find((item) => item.type === "agent.speech.end");
      const action = turn.find((item) => item.type === "agent.action");
      if (asrFinal && answer && speechStart && speechChunk && speechEnd && action) {
        cleanup();
        resolve({ asrFinal, answer, speechStart, speechChunk, speechEnd, action, turn });
      }
    }
    function onMessage(raw) {
      const message = JSON.parse(String(raw));
      seen.push(message);
      if (message.type === "bridge.error") {
        cleanup();
        reject(new Error("Bridge error: " + (message.error || "unknown")));
        return;
      }
      maybeResolve();
    }
    ws.on("message", onMessage);
    maybeResolve();
  });
}

await mkdir(artifactDir, { recursive: true });
const asrServer = createFakeAsrServer();
const asrBaseUrl = await new Promise((resolve, reject) => {
  asrServer.listen(0, "127.0.0.1", () => {
    const address = asrServer.address();
    resolve("http://127.0.0.1:" + address.port);
  });
  asrServer.on("error", reject);
});

try {
  spawnLogged("token", "node", ["services/token-server/server.mjs"], {
    TOKEN_SERVER_PORT: String(tokenPort),
    LIVEKIT_ROOM: room,
  });
  spawnLogged("agent", "node", ["apps/agent/worker.mjs"], {
    TOKEN_SERVER_URL: tokenServerUrl,
    LIVEKIT_ROOM: room,
    AGENT_TRANSPORT: "bridge",
    ASR_PROVIDER: "local-parakeet",
    ASR_BASE_URL: asrBaseUrl,
  });

  const health = await waitForJson(tokenServerUrl + "/health");
  assert.equal(health.ok, true);

  const { ws, seen } = await connectBrowser();
  ws.send(JSON.stringify({
    id: "q_transcript_final",
    type: "prospect.transcript.final",
    sessionId: transcriptSessionId,
    transcript: "How does Remote help with global payroll?",
    simulated: true,
    source: "typed-fallback",
    transport: "bridge",
    bookingState: "none",
    pageSnapshot: {
      url: "http://127.0.0.1/asr-transcript-smoke",
      title: "Remote ASR transcript smoke",
      headings: ["Global payroll"],
      ctas: ["Book a demo"],
      navLinks: ["Pricing", "Country explorer"],
    },
  }));
  const transcriptTurn = await waitForTurn(ws, "q_transcript_final", seen);
  assert.equal(transcriptTurn.asrFinal.provider, "browser-transcript");
  assert.equal(transcriptTurn.asrFinal.simulated, true);
  assert.equal(transcriptTurn.answer.intent, "global_payroll");
  assert.equal(transcriptTurn.action.action?.type, "payrollFlow");

  const silence = Buffer.alloc(1600 * 2);
  const audioBase64 = encodePcm16WavBase64([silence], { sampleRate: 16000, channels: 1 });
  ws.send(JSON.stringify({
    id: "q_audio_asr",
    type: "prospect.audio",
    sessionId: audioSessionId,
    audioBase64,
    mimeType: "audio/wav",
    sampleRate: 16000,
    language: "en",
    transport: "bridge",
    bookingState: "none",
    pageSnapshot: {
      url: "http://127.0.0.1/asr-audio-smoke",
      title: "Remote ASR audio smoke",
      headings: ["Global payroll"],
      ctas: ["Book a demo"],
      navLinks: ["Pricing", "Country explorer"],
    },
  }));
  const audioTurn = await waitForTurn(ws, "q_audio_asr", seen);
  assert.equal(audioTurn.asrFinal.provider, "fake-parakeet-contract");
  assert.equal(audioTurn.asrFinal.simulated, false);
  assert.match(audioTurn.asrFinal.transcript, /global payroll/i);
  assert.equal(audioTurn.answer.intent, "global_payroll");
  assert.equal(audioTurn.action.action?.type, "payrollFlow");
  assert.equal(asrBodies.length, 1);
  assert.equal(asrBodies[0].requestId, "q_audio_asr");
  assert.equal(asrBodies[0].sampleRate, 16000);
  assert.equal(asrBodies[0].model, "nvidia/parakeet-tdt-0.6b-v3");
  assert.ok(asrBodies[0].audioBase64);

  ws.close();
  const result = {
    ok: true,
    artifactDir,
    proof: "contract-fake-local-parakeet-endpoint",
    boundary: "Transcript final messages and localhost ASR adapter contract only; no real Parakeet model audio proof.",
    checks: {
      transcriptFinalTurn: true,
      fakeLocalParakeetTranscribe: true,
      agentAnswerFromTranscript: true,
      typedActionFromTranscript: true,
      streamedSpeechAfterTranscript: true,
    },
    transcriptTurn: {
      provider: transcriptTurn.asrFinal.provider,
      simulated: transcriptTurn.asrFinal.simulated,
      intent: transcriptTurn.answer.intent,
      actionType: transcriptTurn.action.action.type,
    },
    audioTurn: {
      provider: audioTurn.asrFinal.provider,
      simulated: audioTurn.asrFinal.simulated,
      intent: audioTurn.answer.intent,
      actionType: audioTurn.action.action.type,
      transcript: audioTurn.asrFinal.transcript,
    },
    asrRequest: {
      model: asrBodies[0].model,
      sampleRate: asrBodies[0].sampleRate,
      language: asrBodies[0].language,
      audioBytesApprox: Math.round(Buffer.byteLength(asrBodies[0].audioBase64, "base64")),
    },
  };

  await writeFile(join(artifactDir, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  stopAll();
  await new Promise((resolve) => asrServer.close(resolve));
}
