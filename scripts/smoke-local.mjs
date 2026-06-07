#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import WebSocket from "ws";

const started = [];
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const artifactDir = join("artifacts", "smoke", timestamp);
const tokenPort = Number(process.env.SMOKE_TOKEN_PORT || 4541);
const labPort = Number(process.env.SMOKE_LAB_PORT || 4591);
const room = process.env.LIVEKIT_ROOM || "inboundnow-local-smoke";
const tokenServerUrl = `http://127.0.0.1:${tokenPort}`;
const labUrl = `http://127.0.0.1:${labPort}`;

function logPath(name) {
  return join(artifactDir, name + ".log");
}

function spawnLogged(name, command, args, env) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const out = createWriteStream(logPath(name));
  child.stdout.pipe(out);
  child.stderr.pipe(out);
  started.push(child);
  return child;
}

function stopAll() {
  for (const child of started) {
    if (!child.killed) child.kill("SIGTERM");
  }
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
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw lastError || new Error("Timed out waiting for " + url);
}

async function waitForText(url, timeoutMs = 8000) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.text();
      lastError = new Error(url + " returned HTTP " + response.status);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw lastError || new Error("Timed out waiting for " + url);
}

function decodeJwtPayload(token) {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
}

function waitForBridgeMessages() {
  return new Promise((resolve, reject) => {
    const wsUrl = new URL(tokenServerUrl);
    wsUrl.protocol = "ws:";
    wsUrl.pathname = "/agent-bridge";
    wsUrl.search = new URLSearchParams({
      role: "browser",
      room,
      identity: "smoke-browser",
    }).toString();

    const ws = new WebSocket(wsUrl);
    const seen = [];
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("Timed out waiting for agent answer/speech/action"));
    }, 8000);

    function sendQuestion() {
      ws.send(JSON.stringify({
        id: "q_smoke",
        type: "prospect.question",
        question: "How does Remote help with global payroll?",
        simulatedVoice: true,
        transport: "bridge",
        bookingState: "none",
        pageSnapshot: {
          url: labUrl + "/direct",
          title: "Remote local smoke",
          headings: ["Global payroll"],
          ctas: ["Book a demo"],
          navLinks: ["Pricing", "Country explorer"],
        },
      }));
    }

    ws.on("message", (raw) => {
      const message = JSON.parse(String(raw));
      seen.push(message);
      if (
        !seen.some((item) => item.type === "prospect.question.sent") &&
        (
          (message.type === "bridge.ready" && message.peers?.agents > 0) ||
          (message.type === "bridge.peer_joined" && message.role === "agent")
        )
      ) {
        seen.push({ type: "prospect.question.sent" });
        sendQuestion();
        return;
      }
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
          ws.close();
          reject(new Error("Expected answer -> speech stream -> action ordering"));
          return;
        }
        clearTimeout(timer);
        ws.close();
        resolve({ answer, action, speechStart, speechChunk, speechEnd, seenCount: seen.length });
      }
    });

    ws.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
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
  spawnLogged("lab", "node", ["apps/website-lab/server.mjs"], {
    PORT: String(labPort),
    TOKEN_SERVER_URL: tokenServerUrl,
    LIVEKIT_ROOM: room,
  });

  const health = await waitForJson(tokenServerUrl + "/health");
  if (!health.ok) throw new Error("Token health was not ok");
  if (health.transport !== "livekit") throw new Error("Token server transport should report livekit");

  const config = await waitForJson(tokenServerUrl + "/config?room=" + encodeURIComponent(room));
  if (config.livekitClientAsset !== "/__ocw-assets/livekit-client.esm.mjs") {
    throw new Error("Config missing LiveKit browser asset");
  }

  const tokenPayload = await waitForJson(tokenServerUrl + "/token?role=browser&room=" + encodeURIComponent(room) + "&identity=smoke-browser");
  const decoded = decodeJwtPayload(tokenPayload.token);
  if (decoded.video.room !== room) throw new Error("Token room mismatch");
  if (!decoded.video.canPublishData) throw new Error("Token cannot publish data");

  const assetText = await waitForText(labUrl + "/__ocw-assets/livekit-client.esm.mjs");
  if (!assetText.includes("RoomEvent")) throw new Error("LiveKit browser asset did not look valid");

  const bridge = await waitForBridgeMessages();
  if (bridge.answer.intent !== "global_payroll") throw new Error("Expected global_payroll intent");
  if (bridge.action.action?.type !== "payrollFlow") throw new Error("Expected payrollFlow action");

  const result = {
    ok: true,
    artifactDir,
    room,
    checks: {
      tokenHealth: true,
      liveKitConfig: true,
      tokenCanPublishData: true,
      liveKitAsset: true,
      bridgeAgentLoop: true,
      streamedSpeechEvents: true,
    },
    bridge: {
      answerIntent: bridge.answer.intent,
      actionType: bridge.action.action.type,
      speechProvider: bridge.speechStart.provider,
      speechChunkCount: bridge.speechEnd.chunkCount,
      firstSpeechChunk: bridge.speechChunk.text,
      adapterLabels: bridge.answer.adapters,
      retrievalCount: bridge.answer.retrieval?.count || 0,
    },
  };

  await writeFile(join(artifactDir, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  stopAll();
}
