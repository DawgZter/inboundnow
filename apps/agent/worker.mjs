#!/usr/bin/env node
import WebSocket from "ws";
import { ActionProtocolError, prepareActionsForDispatch } from "../../packages/action-protocol/index.mjs";
import { createAdapterRegistry, adapterLabels, adapterStatusMap } from "./adapters/registry.mjs";
import { planForQuestion } from "./router.mjs";

const TOKEN_SERVER_URL = process.env.TOKEN_SERVER_URL || "http://127.0.0.1:4301";
const ROOM = process.env.LIVEKIT_ROOM || "inboundnow-local";
const IDENTITY = process.env.AGENT_IDENTITY || "inboundnow-agent";
const MODE = process.env.AGENT_MODE || "simulated";
const adapters = createAdapterRegistry(process.env);

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

function send(ws, payload) {
  ws.send(JSON.stringify({ ...payload, from: IDENTITY }));
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

async function handleQuestion(ws, message) {
  const question = message.question || message.text || "";
  const retrieval = await safeRetrieval(question);
  const plan = planForQuestion(question, { retrieval });
  const requestId = message.id || "";
  const adapterStatus = adapterStatusMap(adapters);

  send(ws, {
    type: "agent.answer",
    requestId,
    intent: plan.intent,
    answer: plan.answer,
    simulated: MODE === "simulated",
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
    send(ws, {
      type: "agent.error",
      requestId,
      code: error instanceof ActionProtocolError ? "invalid_action_plan" : "planner_error",
      message: error.message,
      details: error.details || {},
    });
    return;
  }

  for (const action of actions) {
    send(ws, {
      type: "agent.action",
      requestId,
      action,
    });
  }
}

function connect() {
  const ws = new WebSocket(bridgeUrl());

  ws.on("open", () => {
    send(ws, {
      type: "agent.status",
      status: "online",
      mode: MODE,
      message: "Local simulated agent worker connected.",
    });
  });

  ws.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (message.type === "prospect.question") {
      handleQuestion(ws, message).catch((error) => {
        send(ws, {
          type: "agent.error",
          requestId: message.id || "",
          code: "question_handler_error",
          message: error.message,
        });
      });
      return;
    }

    if (message.type === "booking.confirmed") {
      send(ws, {
        type: "agent.status",
        status: "booking_confirmed",
        message: "Browser confirmed booking; Cal can open in-page.",
      });
      return;
    }

    if (message.type === "browser.event" && message.event) {
      const actionId = message.event.detail?.id || message.event.detail?.target || "";
      console.log("browser.event", message.event.type, actionId);
    }
  });

  ws.on("close", () => {
    console.log("Agent bridge disconnected. Reconnecting in 1500ms...");
    setTimeout(connect, 1500);
  });

  ws.on("error", (error) => {
    console.error("Agent bridge error:", error.message);
  });
}

console.log("InboundNow agent worker starting");
console.log("Mode:", MODE);
console.log("Bridge:", bridgeUrl());
connect();
