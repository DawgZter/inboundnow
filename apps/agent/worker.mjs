#!/usr/bin/env node
import WebSocket from "ws";
import { planForQuestion } from "./router.mjs";

const TOKEN_SERVER_URL = process.env.TOKEN_SERVER_URL || "http://127.0.0.1:4301";
const ROOM = process.env.LIVEKIT_ROOM || "inboundnow-local";
const IDENTITY = process.env.AGENT_IDENTITY || "inboundnow-agent";
const MODE = process.env.AGENT_MODE || "simulated";

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

function handleQuestion(ws, message) {
  const question = message.question || message.text || "";
  const plan = planForQuestion(question);

  send(ws, {
    type: "agent.answer",
    requestId: message.id || "",
    intent: plan.intent,
    answer: plan.answer,
    simulated: MODE === "simulated",
    adapters: {
      asr: "simulated-text-input",
      llm: "keyword-router",
      tts: "browser-speech-fallback",
      moss: "not-connected",
    },
  });

  for (const action of plan.actions) {
    send(ws, {
      type: "agent.action",
      requestId: message.id || "",
      action: {
        id: "act_" + Math.random().toString(36).slice(2, 10),
        ...action,
      },
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
      handleQuestion(ws, message);
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
