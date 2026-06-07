#!/usr/bin/env node
import { Room, RoomEvent, dispose } from "@livekit/rtc-node";
import WebSocket from "ws";
import { ActionProtocolError, prepareActionsForDispatch } from "../../packages/action-protocol/index.mjs";
import { splitSpeechText } from "../../packages/speech-streaming/index.mjs";
import { detectVoiceSwitchIntent, isVoiceSwitchOnly, resolveVoiceProfile } from "../../packages/voice-session/index.mjs";
import { createAdapterRegistry, adapterLabels, adapterStatusMap } from "./adapters/registry.mjs";
import { planQuestion } from "./llm-planner.mjs";

const TOKEN_SERVER_URL = process.env.TOKEN_SERVER_URL || "http://127.0.0.1:4301";
const ROOM = process.env.LIVEKIT_ROOM || "inboundnow-local";
const IDENTITY = process.env.AGENT_IDENTITY || "inboundnow-agent";
const MODE = process.env.AGENT_MODE || "simulated";
const AGENT_TRANSPORT = process.env.AGENT_TRANSPORT || "bridge";
const CONTROL_TOPIC = process.env.LIVEKIT_CONTROL_TOPIC || "inboundnow.control.v1";
const SIMULATED_AGENT = !["verified", "real"].includes(MODE);
const adapters = createAdapterRegistry(process.env);
const encoder = new TextEncoder();
const decoder = new TextDecoder();
let speechGeneration = 0;
const defaultVoiceProfile = resolveVoiceProfile(process.env.TTS_VOICE_PROFILE || "default");
const sessionVoiceProfiles = new Map();

function voiceSessionKey(message = {}, context = {}) {
  return message.sessionId || message.from || context.senderIdentity || "default";
}

function bridgeUrl() {
  const base = new URL(TOKEN_SERVER_URL);
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  base.pathname = "/agent-bridge";
  base.search = new URLSearchParams({
    role: "agent",
    room: ROOM,
    identity: IDENTITY,
  }).toString();
  return base.href;
}

function tokenUrl() {
  const url = new URL("/token", TOKEN_SERVER_URL);
  url.search = new URLSearchParams({
    role: "agent",
    room: ROOM,
    identity: IDENTITY,
    name: "InboundNow Local Agent",
  }).toString();
  return url.href;
}

async function fetchAgentToken() {
  const response = await fetch(tokenUrl());
  if (!response.ok) throw new Error("Token server returned HTTP " + response.status);
  return response.json();
}

function withAgentIdentity(payload) {
  return { ...payload, from: IDENTITY };
}

function sendBridge(ws, payload) {
  ws.send(JSON.stringify(withAgentIdentity(payload)));
}

async function safeRetrieval(question) {
  if (!adapters.moss || typeof adapters.moss.query !== "function") return null;
  try {
    return await adapters.moss.query(question, { topK: 3 });
  } catch (error) {
    return {
      provider: adapters.moss.provider || "moss",
      error: error.message,
      snippets: [],
    };
  }
}

function speechStreamingEnabled() {
  return !["0", "false", "no", "off"].includes(String(process.env.TTS_STREAMING || "1").trim().toLowerCase());
}

async function sendSpeechStream(sendReply, { requestId, transport, answer, adapterStatus, voiceProfile, voiceSwitch }) {
  if (!speechStreamingEnabled() || !answer) return;

  const generation = ++speechGeneration;
  const chunks = splitSpeechText(answer, {
    textChunkChars: process.env.TTS_TEXT_CHUNK_CHARS || process.env.VIBEVOICE_TEXT_CHUNK_CHARS,
  });
  if (!chunks.length) return;

  const ttsStatus = adapterStatus.tts || {};
  await sendReply({
    type: "agent.speech.start",
    requestId,
    transport,
    provider: adapters.tts?.provider || "tts",
    label: ttsStatus.label || "",
    proof: ttsStatus.proof || "",
    streaming: true,
    mode: "text-chunks",
    fallback: "browser-speech-synthesis",
    localVibeVoiceProven: false,
    chunkCount: chunks.length,
    voiceProfile,
    voiceSwitch: voiceSwitch || null,
  });

  for (let index = 0; index < chunks.length; index += 1) {
    if (generation !== speechGeneration) break;
    await sendReply({
      type: "agent.speech.chunk",
      requestId,
      transport,
      provider: adapters.tts?.provider || "tts",
      sequence: index,
      text: chunks[index],
      voiceProfile,
    });
  }

  if (generation === speechGeneration) {
    await sendReply({
      type: "agent.speech.end",
      requestId,
      transport,
      provider: adapters.tts?.provider || "tts",
      chunkCount: chunks.length,
      voiceProfile,
    });
  }
}

async function handleQuestion(sendReply, message, context = {}) {
  const question = message.question || message.text || "";
  const retrieval = await safeRetrieval(question);
  const requestId = message.id || "";
  const responseTransport = message.transport || AGENT_TRANSPORT;
  const sessionId = voiceSessionKey(message, context);
  const adapterStatus = adapterStatusMap(adapters);
  const generateId = () => "act_" + Math.random().toString(36).slice(2, 10);
  const currentVoiceProfile = sessionVoiceProfiles.get(sessionId) || defaultVoiceProfile;
  const incomingVoiceProfile = message.voiceProfile ? resolveVoiceProfile(message.voiceProfile, currentVoiceProfile) : currentVoiceProfile;
  const voiceSwitch = detectVoiceSwitchIntent(question, incomingVoiceProfile);
  const activeVoiceProfile = voiceSwitch.changed ? voiceSwitch.profile : incomingVoiceProfile;
  sessionVoiceProfiles.set(sessionId, activeVoiceProfile);
  const voiceSwitchMetadata = voiceSwitch.reason
    ? {
        changed: voiceSwitch.changed,
        reason: voiceSwitch.reason,
        acknowledgement: voiceSwitch.acknowledgement,
      }
    : null;
  const planResult = isVoiceSwitchOnly(question) && voiceSwitch.reason
    ? {
        planner: { source: "voice-session-router", provider: "local-rule", fallback: false },
        plan: {
          intent: "voice_switch",
          answer: voiceSwitch.acknowledgement,
          actions: [
            {
              type: "showCaption",
              text: voiceSwitch.acknowledgement,
            },
          ],
        },
        preparedActions: null,
      }
    : await planQuestion({
    question,
    retrieval,
    pageSnapshot: message.pageSnapshot,
    bookingState: message.bookingState || "none",
    adapters,
    env: process.env,
    generateId,
  });
  const plan = planResult.plan;
  if (voiceSwitch.changed && plan.intent !== "voice_switch") {
    plan.answer = voiceSwitch.acknowledgement + " " + plan.answer;
  }
  let actions = planResult.preparedActions;

  try {
    if (!Array.isArray(actions) || !actions.length) {
      actions = prepareActionsForDispatch(plan.actions, {
        bookingState: message.bookingState || "none",
        generateId,
      });
    }
  } catch (error) {
    await sendReply({
      type: "agent.error",
      requestId,
      code: error instanceof ActionProtocolError ? "invalid_action_plan" : "planner_error",
      message: error.message,
      details: error.details || {},
    });
    return;
  }

  await sendReply({
    type: "agent.answer",
    requestId,
    sessionId,
    transport: responseTransport,
    intent: plan.intent,
    answer: plan.answer,
    simulated: SIMULATED_AGENT,
    adapters: adapterLabels(adapters),
    adapterStatus,
    planner: planResult.planner,
    voiceProfile: activeVoiceProfile,
    voiceSwitch: voiceSwitchMetadata,
    retrieval: retrieval
      ? {
          provider: retrieval.provider || "",
          simulated: !!retrieval.simulated,
          count: Array.isArray(retrieval.snippets) ? retrieval.snippets.length : 0,
          snippets: Array.isArray(retrieval.snippets) ? retrieval.snippets.slice(0, 3) : [],
        }
      : null,
  });

  await sendSpeechStream(sendReply, {
    requestId,
    transport: responseTransport,
    answer: plan.answer,
    adapterStatus,
    voiceProfile: activeVoiceProfile,
    voiceSwitch: voiceSwitchMetadata,
  });

  for (const action of actions) {
    await sendReply({
    type: "agent.action",
      requestId,
      sessionId,
      transport: responseTransport,
      action,
    });
  }
}

function handleControlMessage(sendReply, raw, context = {}) {
  let message;
  try {
    message = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return;
  }

  if (message.type === "prospect.question") {
    console.log("agent.question", message.transport || AGENT_TRANSPORT, message.id || "", CONTROL_TOPIC);
    handleQuestion(sendReply, message, context).catch((error) => {
      sendReply({
        type: "agent.error",
        requestId: message.id || "",
        code: "question_handler_error",
        message: error.message,
      }).catch(() => {});
    });
    return;
  }

  if (message.type === "session.voice_profile.updated") {
    const sessionId = voiceSessionKey(message, context);
    const voiceProfile = resolveVoiceProfile(message.voiceProfile, sessionVoiceProfiles.get(sessionId) || defaultVoiceProfile);
    sessionVoiceProfiles.set(sessionId, voiceProfile);
    sendReply({
      type: "agent.status",
      status: "voice_profile_updated",
      sessionId,
      voiceProfile,
      message: "Voice profile updated to " + voiceProfile.label + ".",
    }).catch(() => {});
    return;
  }

  if (message.type === "booking.confirmed") {
    sendReply({
      type: "agent.status",
      status: "booking_confirmed",
      message: "Browser confirmed booking; Cal can open in-page.",
    }).catch(() => {});
    return;
  }

  if (message.type === "prospect.interrupt") {
    speechGeneration += 1;
    sendReply({
      type: "agent.status",
      status: "interrupted",
      message: "Prospect interrupted; pending streamed speech chunks were cancelled.",
    }).catch(() => {});
    return;
  }

  if (message.type === "browser.event" && message.event) {
    const actionId = message.event.detail?.id || message.event.detail?.target || "";
    console.log("browser.event", message.event.type, actionId);
  }
}

function connectBridge() {
  const ws = new WebSocket(bridgeUrl());

  ws.on("open", () => {
    sendBridge(ws, {
      type: "agent.status",
      status: "online",
      mode: MODE,
      transport: "bridge",
      message: "Local simulated agent worker connected.",
    });
  });

  ws.on("message", (raw) => {
    handleControlMessage(async (payload) => sendBridge(ws, payload), String(raw), { transport: "bridge" });
  });

  ws.on("close", () => {
    console.log("Agent bridge disconnected. Reconnecting in 1500ms...");
    setTimeout(connectBridge, 1500);
  });

  ws.on("error", (error) => {
    console.error("Agent bridge error:", error.message);
  });
}

async function connectLiveKit() {
  const tokenPayload = await fetchAgentToken();
  const room = new Room();

  async function publish(payload, participant) {
    const options = {
      reliable: true,
      topic: CONTROL_TOPIC,
    };
    if (participant?.identity) options.destination_identities = [participant.identity];
    await room.localParticipant.publishData(
      encoder.encode(JSON.stringify(withAgentIdentity(payload))),
      options,
    );
  }

  room.on(RoomEvent.DataReceived, (payload, participant, kind, topic) => {
    if (topic && topic !== CONTROL_TOPIC) return;
    const decoded = decoder.decode(payload);
    handleControlMessage((reply) => publish(reply, participant), decoded, {
      transport: "livekit",
      senderIdentity: participant?.identity || "",
    });
  });

  room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
    console.log("livekit.trackSubscribed", participant?.identity || "", publication?.source || track?.kind || "");
  });

  room.on(RoomEvent.Disconnected, () => {
    console.log("LiveKit agent room disconnected. Reconnecting in 1500ms...");
    setTimeout(() => {
      connectLiveKit().catch((error) => console.error("LiveKit reconnect failed:", error.message));
    }, 1500);
  });

  await room.connect(tokenPayload.livekitUrl, tokenPayload.token, {
    autoSubscribe: true,
    dynacast: false,
  });

  await publish({
    type: "agent.status",
    status: "online",
    mode: MODE,
    transport: "livekit",
    message: "Local LiveKit agent worker connected. Voice ASR is not attached yet.",
  });

  console.log("LiveKit agent connected:", tokenPayload.livekitUrl, ROOM, IDENTITY);
}

console.log("InboundNow agent worker starting");
console.log("Mode:", MODE);
console.log("Transport:", AGENT_TRANSPORT);
console.log("Room:", ROOM);

if (AGENT_TRANSPORT === "livekit") {
  connectLiveKit().catch((error) => {
    console.error("LiveKit agent connection failed:", error.message);
    setTimeout(() => {
      connectLiveKit().catch((retryError) => console.error("LiveKit retry failed:", retryError.message));
    }, 1500);
  });
} else {
  console.log("Bridge:", bridgeUrl());
  connectBridge();
}

process.on("SIGINT", () => {
  try {
    dispose();
  } finally {
    process.exit(0);
  }
});
