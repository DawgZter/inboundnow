#!/usr/bin/env node
import { Room, RoomEvent, dispose } from "@livekit/rtc-node";
import WebSocket from "ws";
import { ActionProtocolError, prepareActionsForDispatch } from "../../packages/action-protocol/index.mjs";
import { createAdapterRegistry, adapterLabels, adapterStatusMap } from "./adapters/registry.mjs";
import { planForQuestion } from "./router.mjs";

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

async function handleQuestion(sendReply, message) {
  const question = message.question || message.text || "";
  const retrieval = await safeRetrieval(question);
  const plan = planForQuestion(question, { retrieval });
  const requestId = message.id || "";
  const responseTransport = message.transport || AGENT_TRANSPORT;
  const adapterStatus = adapterStatusMap(adapters);

  await sendReply({
    type: "agent.answer",
    requestId,
    transport: responseTransport,
    intent: plan.intent,
    answer: plan.answer,
    simulated: SIMULATED_AGENT,
    adapters: adapterLabels(adapters),
    adapterStatus,
    retrieval: retrieval
      ? {
          provider: retrieval.provider || "",
          simulated: !!retrieval.simulated,
          count: Array.isArray(retrieval.snippets) ? retrieval.snippets.length : 0,
          snippets: Array.isArray(retrieval.snippets) ? retrieval.snippets.slice(0, 3) : [],
        }
      : null,
  });

  let actions;
  try {
    actions = prepareActionsForDispatch(plan.actions, {
      bookingState: message.bookingState || "none",
      generateId: () => "act_" + Math.random().toString(36).slice(2, 10),
    });
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

  for (const action of actions) {
    await sendReply({
      type: "agent.action",
      requestId,
      transport: responseTransport,
      action,
    });
  }
}

function handleControlMessage(sendReply, raw) {
  let message;
  try {
    message = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return;
  }

  if (message.type === "prospect.question") {
    console.log("agent.question", message.transport || AGENT_TRANSPORT, message.id || "", CONTROL_TOPIC);
    handleQuestion(sendReply, message).catch((error) => {
      sendReply({
        type: "agent.error",
        requestId: message.id || "",
        code: "question_handler_error",
        message: error.message,
      }).catch(() => {});
    });
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
    handleControlMessage(async (payload) => sendBridge(ws, payload), String(raw));
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
    handleControlMessage((reply) => publish(reply, participant), decoded);
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
