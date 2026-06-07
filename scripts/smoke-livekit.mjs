#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { Room, RoomEvent, dispose } from "@livekit/rtc-node";

const CONTROL_TOPIC = "inboundnow.control.v1";
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const artifactDir = join("artifacts", "smoke", "livekit-" + timestamp);
const tokenPort = Number(process.env.SMOKE_TOKEN_PORT || 4641);
const roomName = process.env.LIVEKIT_ROOM || "inboundnow-livekit-smoke";
const tokenServerUrl = "http://127.0.0.1:" + tokenPort;
const livekitUrl = process.env.LIVEKIT_URL || "ws://127.0.0.1:7880";
const browserIdentity = "smoke-livekit-browser";
const agentIdentity = process.env.AGENT_IDENTITY || "inboundnow-agent";
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const children = [];

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
  dispose();
}

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForJson(url, timeoutMs = 10_000) {
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

async function fetchToken(role, identity) {
  const url = new URL("/token", tokenServerUrl);
  url.search = new URLSearchParams({ role, room: roomName, identity }).toString();
  return waitForJson(url.href);
}

async function connectRoomWithRetry(identity, timeoutMs = 20_000) {
  const token = await fetchToken("browser", identity);
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeoutMs) {
    const room = new Room();
    try {
      await room.connect(token.livekitUrl, token.token, { autoSubscribe: true, dynacast: false });
      return { room, token };
    } catch (error) {
      lastError = error;
      await wait(350);
    }
  }
  throw lastError || new Error("Timed out connecting to LiveKit");
}

async function waitForParticipant(room, identity, timeoutMs = 12_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (room.remoteParticipants.has(identity)) return room.remoteParticipants.get(identity);
    await wait(150);
  }
  throw new Error("Timed out waiting for LiveKit participant " + identity);
}

function publishJson(room, payload) {
  return room.localParticipant.publishData(
    encoder.encode(JSON.stringify({ ...payload, from: browserIdentity })),
    { reliable: true, topic: CONTROL_TOPIC },
  );
}

async function waitForAnswerAndAction(room) {
  const seen = [];
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Timed out waiting for LiveKit answer/speech/action"));
    }, 12_000);

    room.on(RoomEvent.DataReceived, (payload, participant, kind, topic) => {
      if (topic && topic !== CONTROL_TOPIC) return;
      const message = JSON.parse(decoder.decode(payload));
      seen.push(message);
      const answer = seen.find((item) => item.type === "agent.answer");
      const speechStart = seen.find((item) => item.type === "agent.speech.start");
      const speechChunk = seen.find((item) => item.type === "agent.speech.chunk");
      const speechEnd = seen.find((item) => item.type === "agent.speech.end");
      const action = seen.find((item) => item.type === "agent.action");
      if (answer && speechStart && speechChunk && speechEnd && action) {
        const answerIndex = seen.indexOf(answer);
        const speechStartIndex = seen.indexOf(speechStart);
        const speechChunkIndex = seen.indexOf(speechChunk);
        const speechEndIndex = seen.indexOf(speechEnd);
        const actionIndex = seen.indexOf(action);
        if (!(answerIndex < speechStartIndex && speechStartIndex < speechChunkIndex && speechChunkIndex < speechEndIndex && speechEndIndex < actionIndex)) {
          clearTimeout(timer);
          reject(new Error("Expected answer -> speech stream -> action ordering"));
          return;
        }
        clearTimeout(timer);
        resolve({ answer, action, speechStart, speechChunk, speechEnd, seen });
      }
    });
  });
}

await mkdir(artifactDir, { recursive: true });

try {
  spawnLogged("livekit", "livekit-server", ["--dev"]);
  spawnLogged("token", "node", ["services/token-server/server.mjs"], {
    TOKEN_SERVER_PORT: String(tokenPort),
    LIVEKIT_URL: livekitUrl,
    LIVEKIT_ROOM: roomName,
    ENABLE_SIM_BRIDGE: "0",
  });
  spawnLogged("agent-livekit", "node", ["apps/agent/worker.mjs"], {
    TOKEN_SERVER_URL: tokenServerUrl,
    LIVEKIT_URL: livekitUrl,
    LIVEKIT_ROOM: roomName,
    AGENT_TRANSPORT: "livekit",
    AGENT_IDENTITY: agentIdentity,
  });

  const health = await waitForJson(tokenServerUrl + "/health");
  if (!health.ok) throw new Error("Token server health was not ok");
  if (health.livekitUrl !== livekitUrl) throw new Error("Token server LiveKit URL mismatch");
  if (health.simulatedBridgeEnabled !== false) throw new Error("LiveKit smoke must run with simulated bridge disabled");

  const { room, token } = await connectRoomWithRetry(browserIdentity);
  await waitForParticipant(room, agentIdentity);

  const pending = waitForAnswerAndAction(room);
  await publishJson(room, {
    id: "q_livekit_smoke",
    type: "prospect.question",
    question: "How does Remote help with global payroll?",
    simulatedVoice: true,
    transport: "livekit",
    bookingState: "none",
    pageSnapshot: {
      url: "http://127.0.0.1/livekit-smoke",
      title: "Remote LiveKit smoke",
      headings: ["Global payroll"],
      ctas: ["Book a demo"],
      navLinks: ["Pricing", "Country explorer"],
    },
  });

  const result = await pending;
  if (result.answer.intent !== "global_payroll") throw new Error("Expected global_payroll intent");
  if (result.answer.transport !== "livekit") throw new Error("Expected livekit answer transport");
  if (result.action.transport !== "livekit") throw new Error("Expected livekit action transport");
  if (result.action.action?.type !== "showCaption") throw new Error("Expected primitive showCaption action");

  const summary = {
    ok: true,
    artifactDir,
    livekitUrl,
    room: roomName,
    browserIdentity: token.identity,
    agentIdentity,
    checks: {
      livekitServerStarted: true,
      tokenServerHealth: true,
      bridgeDisabled: health.simulatedBridgeEnabled === false,
      browserParticipantJoined: true,
      agentParticipantJoined: true,
      dataChannelAnswer: true,
      dataChannelSpeechStream: true,
      dataChannelAction: true,
    },
    answer: {
      intent: result.answer.intent,
      transport: result.answer.transport,
      simulated: result.answer.simulated,
      adapterLabels: result.answer.adapters,
      retrievalCount: result.answer.retrieval?.count || 0,
    },
    speech: {
      provider: result.speechStart.provider,
      proof: result.speechStart.proof,
      chunkCount: result.speechEnd.chunkCount,
      firstChunk: result.speechChunk.text,
    },
    action: {
      type: result.action.action.type,
      transport: result.action.transport,
    },
  };

  await writeFile(join(artifactDir, "result.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  await room.disconnect();
} finally {
  stopAll();
}
