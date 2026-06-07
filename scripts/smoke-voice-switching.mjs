#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import WebSocket from "ws";

const children = [];
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const artifactDir = join("artifacts", "smoke", "voice-switching-" + timestamp);
const tokenPort = Number(process.env.SMOKE_TOKEN_PORT || 4741);
const room = process.env.LIVEKIT_ROOM || "inboundnow-voice-switch-smoke";
const tokenServerUrl = "http://127.0.0.1:" + tokenPort;
const sessionId = "voice-switch-smoke-session";

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

function bridgeUrl() {
  const url = new URL(tokenServerUrl);
  url.protocol = "ws:";
  url.pathname = "/agent-bridge";
  url.search = new URLSearchParams({
    role: "browser",
    room,
    identity: "voice-switch-smoke-browser",
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

function sendQuestion(ws, id, question) {
  ws.send(JSON.stringify({
    id,
    type: "prospect.question",
    sessionId,
    question,
    simulatedVoice: true,
    transport: "bridge",
    bookingState: "none",
    pageSnapshot: {
      url: "http://127.0.0.1/voice-switch-smoke",
      title: "Remote voice switch smoke",
      headings: ["Global payroll"],
      ctas: ["Book a demo"],
      navLinks: ["Pricing", "Country explorer"],
    },
  }));
}

async function waitForTurn(ws, requestId, seen, timeoutMs = 8000) {
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
      const answer = turn.find((item) => item.type === "agent.answer");
      const speechStart = turn.find((item) => item.type === "agent.speech.start");
      const speechChunk = turn.find((item) => item.type === "agent.speech.chunk");
      const speechEnd = turn.find((item) => item.type === "agent.speech.end");
      const action = turn.find((item) => item.type === "agent.action");
      if (answer && speechStart && speechChunk && speechEnd && action) {
        cleanup();
        resolve({ answer, speechStart, speechChunk, speechEnd, action });
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

try {
  spawnLogged("token", "node", ["services/token-server/server.mjs"], {
    TOKEN_SERVER_PORT: String(tokenPort),
    LIVEKIT_ROOM: room,
  });
  spawnLogged("agent", "node", ["apps/agent/worker.mjs"], {
    TOKEN_SERVER_URL: tokenServerUrl,
    LIVEKIT_ROOM: room,
    AGENT_TRANSPORT: "bridge",
  });

  const health = await waitForJson(tokenServerUrl + "/health");
  if (!health.ok) throw new Error("Token health was not ok");

  const { ws, seen } = await connectBrowser();
  sendQuestion(ws, "q_voice_switch", "Can you switch to a warmer voice?");
  const switched = await waitForTurn(ws, "q_voice_switch", seen);
  if (switched.answer.intent !== "voice_switch") throw new Error("Expected voice_switch intent");
  if (switched.answer.voiceProfile?.id !== "warm") throw new Error("Expected warm answer voice profile");
  if (switched.speechStart.voiceProfile?.id !== "warm") throw new Error("Expected warm speech voice profile");
  if (switched.speechStart.voiceSwitch?.changed !== true) throw new Error("Expected voiceSwitch metadata on switch turn");
  if (switched.action.action?.type !== "showCaption") throw new Error("Expected showCaption voice-switch action");

  sendQuestion(ws, "q_voice_followup", "How does Remote help with global payroll?");
  const followup = await waitForTurn(ws, "q_voice_followup", seen);
  if (followup.answer.intent !== "global_payroll") throw new Error("Expected global_payroll follow-up intent");
  if (followup.answer.voiceProfile?.id !== "warm") throw new Error("Expected warm session voice to persist");
  if (followup.speechStart.voiceProfile?.id !== "warm") throw new Error("Expected warm speech voice to persist");
  if (followup.speechStart.voiceSwitch !== null) throw new Error("Follow-up should not report a new voice switch");

  ws.close();
  const result = {
    ok: true,
    artifactDir,
    sessionId,
    checks: {
      bridgeAgentLoop: true,
      voiceSwitchTurn: true,
      voiceProfilePersisted: true,
      streamedSpeechVoiceMetadata: true,
    },
    switched: {
      intent: switched.answer.intent,
      voiceProfile: switched.answer.voiceProfile,
      actionType: switched.action.action.type,
      speechChunkCount: switched.speechEnd.chunkCount,
    },
    followup: {
      intent: followup.answer.intent,
      voiceProfile: followup.answer.voiceProfile,
      speechChunkCount: followup.speechEnd.chunkCount,
      firstChunk: followup.speechChunk.text,
    },
  };

  await writeFile(join(artifactDir, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  stopAll();
}
