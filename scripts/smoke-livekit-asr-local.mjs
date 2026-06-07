#!/usr/bin/env node
import assert from "node:assert/strict";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { join } from "node:path";
import {
  AudioFrame,
  AudioSource,
  LocalAudioTrack,
  Room,
  RoomEvent,
  TrackPublishOptions,
  TrackSource,
  dispose,
} from "@livekit/rtc-node";

const CONTROL_TOPIC = "inboundnow.control.v1";
const SAMPLE_RATE = 16000;
const CHANNELS = 1;
const SAMPLES_PER_FRAME = 160;
const FRAME_COUNT = 80;
const MIN_CAPTURED_PCM_BYTES = SAMPLES_PER_FRAME * CHANNELS * 2 * 4;
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const artifactDir = join("artifacts", "smoke", "livekit-asr-local-" + timestamp);
const tokenPort = Number(process.env.SMOKE_TOKEN_PORT || 4941);
const roomName = process.env.LIVEKIT_ROOM || "inboundnow-livekit-asr-smoke";
const tokenServerUrl = "http://127.0.0.1:" + tokenPort;
const livekitUrl = process.env.LIVEKIT_URL || "ws://127.0.0.1:7880";
const browserIdentity = "smoke-livekit-asr-browser";
const agentIdentity = process.env.AGENT_IDENTITY || "inboundnow-agent";
const requestId = "q_livekit_audio_asr";
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const children = [];
const asrBodies = [];
let fakeAsrServer;
let syntheticTrack;
let syntheticSource;

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

function stopAll() {
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  dispose();
}

async function cleanupMedia() {
  if (syntheticTrack) await syntheticTrack.close().catch(() => {});
  else if (syntheticSource) await syntheticSource.close().catch(() => {});
  syntheticTrack = null;
  syntheticSource = null;
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

async function readBody(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body ? JSON.parse(body) : {};
}

async function startFakeAsrServer() {
  fakeAsrServer = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        ok: true,
        provider: "fake-parakeet-livekit-contract",
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
        provider: "fake-parakeet-livekit-contract",
        model: body.model,
        transcript: "How does Remote help with global payroll?",
        language: body.language || "en",
        confidence: 0.92,
        final: true,
      }));
      return;
    }

    response.writeHead(404);
    response.end();
  });

  return new Promise((resolve, reject) => {
    fakeAsrServer.listen(0, "127.0.0.1", () => {
      const address = fakeAsrServer.address();
      resolve("http://127.0.0.1:" + address.port);
    });
    fakeAsrServer.on("error", reject);
  });
}

async function stopFakeAsrServer() {
  if (!fakeAsrServer) return;
  await new Promise((resolve) => fakeAsrServer.close(resolve));
  fakeAsrServer = null;
}

async function fetchToken(identity) {
  const url = new URL("/token", tokenServerUrl);
  url.search = new URLSearchParams({ role: "browser", room: roomName, identity }).toString();
  return waitForJson(url.href);
}

async function connectBrowserRoom(timeoutMs = 20_000) {
  const token = await fetchToken(browserIdentity);
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

function collectTurn(room) {
  const seen = [];
  room.on(RoomEvent.DataReceived, (payload, participant, kind, topic) => {
    if (topic && topic !== CONTROL_TOPIC) return;
    seen.push(JSON.parse(decoder.decode(payload)));
  });
  return seen;
}

async function waitForMessage(seen, predicate, label, timeoutMs = 12_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const message = seen.find(predicate);
    if (message) return message;
    await wait(100);
  }
  throw new Error("Timed out waiting for " + label);
}

function makeAudioFrame(frameIndex) {
  const frame = AudioFrame.create(SAMPLE_RATE, CHANNELS, SAMPLES_PER_FRAME);
  for (let i = 0; i < frame.data.length; i += 1) {
    const sampleIndex = frameIndex * SAMPLES_PER_FRAME + i;
    frame.data[i] = Math.round(Math.sin((sampleIndex * 2 * Math.PI * 440) / SAMPLE_RATE) * 9000);
  }
  return frame;
}

async function publishSyntheticMicTrack(room) {
  syntheticSource = new AudioSource(SAMPLE_RATE, CHANNELS);
  syntheticTrack = LocalAudioTrack.createAudioTrack("synthetic-mic", syntheticSource);
  const options = new TrackPublishOptions();
  options.source = TrackSource.SOURCE_MICROPHONE;
  await room.localParticipant.publishTrack(syntheticTrack, options);
  await wait(500);
}

async function captureSyntheticSpeech() {
  for (let index = 0; index < FRAME_COUNT; index += 1) {
    await syntheticSource.captureFrame(makeAudioFrame(index));
  }
}

function wavInfo(audioBase64) {
  const wav = Buffer.from(audioBase64 || "", "base64");
  return {
    bytes: wav.length,
    riff: wav.toString("ascii", 0, 4),
    wave: wav.toString("ascii", 8, 12),
    dataBytes: Math.max(0, wav.length - 44),
  };
}

await mkdir(artifactDir, { recursive: true });
const asrBaseUrl = await startFakeAsrServer();
let room;

try {
  spawnLogged("livekit", "livekit-server", ["--dev"]);
  spawnLogged("token", "node", ["services/token-server/server.mjs"], {
    TOKEN_SERVER_PORT: String(tokenPort),
    LIVEKIT_URL: livekitUrl,
    LIVEKIT_ROOM: roomName,
    ENABLE_SIM_BRIDGE: "0",
  });
  spawnLogged("agent-livekit-asr", "node", ["apps/agent/worker.mjs"], {
    TOKEN_SERVER_URL: tokenServerUrl,
    LIVEKIT_URL: livekitUrl,
    LIVEKIT_ROOM: roomName,
    AGENT_TRANSPORT: "livekit",
    AGENT_IDENTITY: agentIdentity,
    ASR_PROVIDER: "local-parakeet",
    ASR_BASE_URL: asrBaseUrl,
  });

  const health = await waitForJson(tokenServerUrl + "/health");
  assert.equal(health.ok, true);
  assert.equal(health.simulatedBridgeEnabled, false);

  const connection = await connectBrowserRoom();
  room = connection.room;
  const seen = collectTurn(room);
  await waitForParticipant(room, agentIdentity);
  await publishSyntheticMicTrack(room);

  await publishJson(room, {
    id: requestId,
    type: "prospect.asr.start",
    sessionId: browserIdentity,
    transport: "livekit",
    bookingState: "none",
  });
  const listening = await waitForMessage(
    seen,
    (item) => item.type === "agent.asr.status" && item.requestId === requestId && item.status === "listening",
    "ASR listening status",
  );
  assert.equal(listening.sessionId, browserIdentity);

  await captureSyntheticSpeech();
  await publishJson(room, {
    id: requestId,
    type: "prospect.asr.stop",
    sessionId: browserIdentity,
    transport: "livekit",
    bookingState: "none",
    pageSnapshot: {
      url: "http://127.0.0.1/livekit-asr-smoke",
      title: "Remote LiveKit ASR smoke",
      headings: ["Global payroll"],
      ctas: ["Book a demo"],
      navLinks: ["Pricing", "Country explorer"],
    },
  });

  const asrFinal = await waitForMessage(
    seen,
    (item) => item.type === "agent.asr.final" && item.requestId === requestId,
    "ASR final transcript",
    15_000,
  );
  const answer = await waitForMessage(
    seen,
    (item) => item.type === "agent.answer" && item.requestId === requestId,
    "agent answer",
  );
  const action = await waitForMessage(
    seen,
    (item) => item.type === "agent.action" && item.requestId === requestId,
    "agent action",
  );

  assert.equal(asrFinal.source, "livekit-audio-turn");
  assert.equal(asrFinal.provider, "fake-parakeet-livekit-contract");
  assert.equal(asrFinal.simulated, false);
  assert.match(asrFinal.transcript, /global payroll/i);
  assert.equal(answer.intent, "global_payroll");
  assert.equal(answer.transport, "livekit");
  assert.equal(action.transport, "livekit");
  assert.equal(action.action?.type, "showCaption");
  assert.equal(asrBodies.length, 1);
  assert.equal(asrBodies[0].requestId, requestId);
  assert.equal(asrBodies[0].sampleRate, SAMPLE_RATE);
  assert.equal(asrBodies[0].model, "nvidia/parakeet-tdt-0.6b-v3");
  assert.ok(asrBodies[0].audioBase64);
  const wav = wavInfo(asrBodies[0].audioBase64);
  assert.equal(wav.riff, "RIFF");
  assert.equal(wav.wave, "WAVE");
  assert.ok(wav.dataBytes >= MIN_CAPTURED_PCM_BYTES);

  const summary = {
    ok: true,
    artifactDir,
    livekitUrl,
    room: roomName,
    browserIdentity: connection.token.identity,
    agentIdentity,
    proof: "synthetic-livekit-audio-to-local-parakeet-contract",
    boundary: "Synthetic LiveKit microphone frames reached the localhost Parakeet adapter contract. This is not real browser microphone or real H100 Parakeet model proof.",
    checks: {
      livekitServerStarted: true,
      bridgeDisabled: health.simulatedBridgeEnabled === false,
      browserParticipantJoined: true,
      agentParticipantJoined: true,
      syntheticMicTrackPublished: true,
      asrListeningStatus: true,
      fakeParakeetReceivedWav: true,
      capturedNonEmptyPcm: true,
      asrFinalTranscript: true,
      agentAnswerFromAsr: true,
      typedActionFromAsr: true,
    },
    asr: {
      provider: asrFinal.provider,
      source: asrFinal.source,
      simulated: asrFinal.simulated,
      transcript: asrFinal.transcript,
      model: asrFinal.model,
      request: {
        sampleRate: asrBodies[0].sampleRate,
        language: asrBodies[0].language,
        model: asrBodies[0].model,
       wav,
        generatedFrameCount: FRAME_COUNT,
        minCapturedPcmBytes: MIN_CAPTURED_PCM_BYTES,
      },
    },
    answer: {
      intent: answer.intent,
      transport: answer.transport,
      adapterLabels: answer.adapters,
      retrievalCount: answer.retrieval?.count || 0,
    },
    action: {
      type: action.action.type,
      transport: action.transport,
    },
  };

  await writeFile(join(artifactDir, "result.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  await room.disconnect();
} finally {
  await cleanupMedia();
  if (room) await room.disconnect().catch(() => {});
  await stopFakeAsrServer();
  stopAll();
}
