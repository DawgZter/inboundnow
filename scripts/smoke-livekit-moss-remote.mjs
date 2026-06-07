#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { Room, RoomEvent, dispose } from "@livekit/rtc-node";

const CONTROL_TOPIC = "inboundnow.control.v1";
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const artifactDir = join("artifacts", "smoke", "livekit-moss-remote-" + timestamp);
const indexPath = join(artifactDir, "remote-com-local-index.json");
const livekitUrl = process.env.LIVEKIT_URL || "ws://127.0.0.1:7880";
const roomName = process.env.LIVEKIT_ROOM || "inboundnow-livekit-moss-remote-smoke";
const browserIdentity = "smoke-livekit-moss-browser";
const agentIdentity = process.env.AGENT_IDENTITY || "inboundnow-agent";
const query = "How does Remote help with global payroll?";
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

async function waitForJson(url, options = {}, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response.json();
      lastError = new Error(url + " returned HTTP " + response.status);
    } catch (error) {
      lastError = error;
    }
    await wait(150);
  }
  throw lastError || new Error("Timed out waiting for " + url);
}

async function runIndexer() {
  const child = spawnLogged("indexer", process.execPath, ["services/moss-indexer/build-local-index.mjs"], {
    MOSS_SOURCE_TYPE: "remote-com-scrape",
    MOSS_SOURCE_PATH: "data/remote-com/scrape-2026-06-07",
    MOSS_INDEX_PATH: indexPath,
    MOSS_INDEX_BUILT_AT: "2026-06-07T13:35:00.000Z",
  });

  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", resolve);
  });
  if (exitCode !== 0) throw new Error("Remote Moss indexer exited with code " + exitCode);

  return JSON.parse(await readFile(indexPath, "utf8"));
}

function assertRemoteRetrieval(result) {
  assert.equal(result.provider, "local-artifact");
  assert.equal(result.localOnly, true);
  assert.equal(result.simulated, false);
  assert.equal(result.artifact.schema, "inboundnow.local-retrieval.v1");
  assert.ok(result.artifact.documentCount >= 10_800);
  assert.ok(result.snippets.length > 0);
  assert.ok(result.snippets.every((snippet) => snippet.text.length <= 760));
  assert.ok(result.snippets.every((snippet) => snippet.metadata?.source === "remote_com_scrape"));
  assert.ok(result.snippets.every((snippet) => snippet.metadata?.documentChars >= snippet.text.length));
  assert.ok(result.snippets.some((snippet) => (snippet.metadata?.matchedTokens || []).includes("payroll")));
  const joined = result.snippets.map((snippet) => [
    snippet.title,
    snippet.url,
    snippet.text,
  ].join(" ")).join("\n");
  assert.match(joined, /Remote/i);
  assert.match(joined, /global payroll|payroll/i);
}

async function fetchToken(tokenServerUrl, role, identity) {
  const url = new URL("/token", tokenServerUrl);
  url.search = new URLSearchParams({ role, room: roomName, identity }).toString();
  return waitForJson(url.href);
}

async function connectRoomWithRetry(tokenServerUrl, identity, timeoutMs = 20_000) {
  const token = await fetchToken(tokenServerUrl, "browser", identity);
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
    }, 14_000);

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
        clearTimeout(timer);
        resolve({ answer, action, speechStart, speechChunk, speechEnd, seen });
      }
    });
  });
}

await mkdir(artifactDir, { recursive: true });

try {
  const index = await runIndexer();
  assert.equal(index.provider, "local-artifact");
  assert.equal(index.localOnly, true);
  assert.ok(index.documents.length >= 10_800);
  assert.ok(index.forbiddenRuntimeBehaviors.includes("cloud polling"));
  assert.ok(index.forbiddenRuntimeBehaviors.includes("session document upload"));

  const mossPort = await freePort();
  const tokenPort = await freePort();
  const mossRuntimeUrl = "http://127.0.0.1:" + mossPort;
  const tokenServerUrl = "http://127.0.0.1:" + tokenPort;

  spawnLogged("moss-runtime", process.execPath, ["services/moss-runtime/server.mjs"], {
    MOSS_RUNTIME_PORT: String(mossPort),
    MOSS_RUNTIME_PROVIDER: "local-artifact",
    MOSS_INDEX_PATH: indexPath,
  });

  const mossHealth = await waitForJson(mossRuntimeUrl + "/health");
  assert.equal(mossHealth.ok, true);
  assert.equal(mossHealth.localOnly, true);
  assert.equal(mossHealth.adapter.provider, "local-artifact");

  const directRetrieval = await waitForJson(mossRuntimeUrl + "/query", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, topK: 5 }),
  });
  assertRemoteRetrieval(directRetrieval);

  spawnLogged("livekit", "livekit-server", ["--dev"]);
  spawnLogged("token", process.execPath, ["services/token-server/server.mjs"], {
    TOKEN_SERVER_PORT: String(tokenPort),
    LIVEKIT_URL: livekitUrl,
    LIVEKIT_ROOM: roomName,
    ENABLE_SIM_BRIDGE: "0",
  });
  spawnLogged("agent-livekit", process.execPath, ["apps/agent/worker.mjs"], {
    TOKEN_SERVER_URL: tokenServerUrl,
    LIVEKIT_URL: livekitUrl,
    LIVEKIT_ROOM: roomName,
    AGENT_TRANSPORT: "livekit",
    AGENT_IDENTITY: agentIdentity,
    MOSS_PROVIDER: "local-runtime-client",
    MOSS_RUNTIME_URL: mossRuntimeUrl,
  });

  const tokenHealth = await waitForJson(tokenServerUrl + "/health");
  assert.equal(tokenHealth.ok, true);
  assert.equal(tokenHealth.simulatedBridgeEnabled, false);

  const { room, token } = await connectRoomWithRetry(tokenServerUrl, browserIdentity);
  await waitForParticipant(room, agentIdentity);

  const pending = waitForAnswerAndAction(room);
  await publishJson(room, {
    id: "q_livekit_moss_remote_smoke",
    type: "prospect.question",
    question: query,
    simulatedVoice: true,
    transport: "livekit",
    bookingState: "none",
    pageSnapshot: {
      url: "http://127.0.0.1/livekit-moss-remote-smoke",
      title: "Remote LiveKit Moss remote smoke",
      headings: ["Global payroll"],
      ctas: ["Book a demo"],
      navLinks: ["Pricing", "Country explorer"],
    },
  });

  const result = await pending;
  assert.equal(result.answer.intent, "global_payroll");
  assert.equal(result.answer.transport, "livekit");
  assert.equal(result.action.transport, "livekit");
  assert.equal(result.action.action?.type, "payrollFlow");
  assert.equal(result.answer.adapters?.moss, "local-runtime-client");
  assertRemoteRetrieval(result.answer.retrieval);

  const answerJoined = [
    result.answer.answer,
    ...(result.answer.retrieval?.snippets || []).map((snippet) => snippet.title + " " + snippet.text),
  ].join("\n");
  assert.match(answerJoined, /Remote/i);
  assert.match(answerJoined, /payroll/i);

  const summary = {
    ok: true,
    artifactDir,
    indexPath,
    livekitUrl,
    mossRuntimeUrl,
    room: roomName,
    browserIdentity: token.identity,
    agentIdentity,
    query,
    checks: {
      remoteScrapeIndexBuild: true,
      mossRuntimeHealth: true,
      directRemoteRetrieval: true,
      bridgeDisabled: tokenHealth.simulatedBridgeEnabled === false,
      browserParticipantJoined: true,
      agentParticipantJoined: true,
      dataChannelAnswer: true,
      dataChannelSpeechStream: true,
      dataChannelAction: true,
      agentUsedRemoteMossRuntimeClient: true,
    },
    index: {
      schema: index.schema,
      provider: index.provider,
      source: index.source,
      builtAt: index.builtAt,
      localOnly: index.localOnly,
      documentCount: index.documents.length,
    },
    moss: {
      health: mossHealth,
      directRetrieval,
    },
    answer: {
      intent: result.answer.intent,
      transport: result.answer.transport,
      simulated: result.answer.simulated,
      adapterLabels: result.answer.adapters,
      retrieval: result.answer.retrieval,
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
