#!/usr/bin/env node
import { createServer } from "node:http";
import { createHmac, randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.TOKEN_SERVER_PORT || 4301);
const HOST = process.env.TOKEN_SERVER_HOST || "127.0.0.1";
const LIVEKIT_URL = process.env.LIVEKIT_URL || "ws://127.0.0.1:7880";
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || "devkey";
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || "secret";
const DEFAULT_ROOM = process.env.LIVEKIT_ROOM || "inboundnow-local";
const TOKEN_TTL_SECONDS = Number(process.env.LIVEKIT_TOKEN_TTL_SECONDS || 60 * 60);
const ENABLE_SIM_BRIDGE = process.env.ENABLE_SIM_BRIDGE !== "0";
const LIVEKIT_CLIENT_ASSET = "/__ocw-assets/livekit-client.esm.mjs";
const MAX_BRIDGE_MESSAGE_BYTES = Number(process.env.MAX_BRIDGE_MESSAGE_BYTES || 32_000);

const rooms = new Map();

function normalizedHost(hostname) {
  return String(hostname || "").toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
}

function isLoopbackHost(hostname) {
  const host = normalizedHost(hostname);
  return host === "localhost" || host === "::1" || host.endsWith(".localhost") || /^127(?:\.\d{1,3}){0,3}$/.test(host);
}

function assertLoopbackHost(hostname, name) {
  if (!isLoopbackHost(hostname)) {
    throw new Error(name + " must be loopback-only for the local MVP");
  }
}

function assertLocalLiveKitUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("LIVEKIT_URL must be a valid ws:// or wss:// URL");
  }

  if (!["ws:", "wss:"].includes(parsed.protocol)) {
    throw new Error("LIVEKIT_URL must use ws:// or wss://");
  }

  if (/livekit\.cloud$/i.test(parsed.hostname)) {
    throw new Error("LIVEKIT_URL points at LiveKit Cloud; InboundNow local MVP requires self-hosted/local LiveKit.");
  }

  assertLoopbackHost(parsed.hostname, "LIVEKIT_URL");
}

assertLoopbackHost(HOST, "TOKEN_SERVER_HOST");
assertLocalLiveKitUrl(LIVEKIT_URL);

function base64Url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function signJwt(payload) {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signature = createHmac("sha256", LIVEKIT_API_SECRET)
    .update(encodedHeader + "." + encodedPayload)
    .digest("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  return encodedHeader + "." + encodedPayload + "." + signature;
}

function makeToken({ identity, name, room, canPublish = true, canSubscribe = true, role = "browser" }) {
  const now = Math.floor(Date.now() / 1000);
  return signJwt({
    iss: LIVEKIT_API_KEY,
    sub: identity,
    name,
    iat: now,
    nbf: now,
    exp: now + TOKEN_TTL_SECONDS,
    metadata: JSON.stringify({ role, localHarness: true }),
    video: {
      room,
      roomJoin: true,
      canPublish,
      canSubscribe,
      canPublishData: true,
    },
  });
}

function isLocalOrigin(origin) {
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    return ["http:", "https:"].includes(parsed.protocol) && isLoopbackHost(parsed.hostname);
  } catch {
    return false;
  }
}

function corsHeaders(req) {
  const origin = req.headers.origin || "";
  return {
    "access-control-allow-origin": isLocalOrigin(origin) ? origin : "null",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}

function sendJson(req, res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...corsHeaders(req),
  });
  res.end(body);
}

function getRoom(name) {
  const room = name || DEFAULT_ROOM;
  if (!rooms.has(room)) rooms.set(room, { browsers: new Set(), agents: new Set() });
  return rooms.get(room);
}

function safeSend(ws, payload) {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify({ ...payload, ts: new Date().toISOString() }));
}

function broadcast(targets, payload) {
  for (const ws of targets) safeSend(ws, payload);
}

function roomSnapshot(roomName) {
  const room = getRoom(roomName);
  return {
    room: roomName,
    browsers: room.browsers.size,
    agents: room.agents.size,
  };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://" + HOST + ":" + PORT);

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(req));
    res.end();
    return;
  }

  if (url.pathname === "/health") {
    sendJson(req, res, 200, {
      ok: true,
      mode: "local-livekit-token-server",
      transport: "livekit",
      simulatedBridgeEnabled: ENABLE_SIM_BRIDGE,
      livekitUrl: LIVEKIT_URL,
      defaultRoom: DEFAULT_ROOM,
      rooms: Array.from(rooms.keys()).map(roomSnapshot),
    });
    return;
  }

  if (url.pathname === "/config") {
    const room = url.searchParams.get("room") || DEFAULT_ROOM;
    sendJson(req, res, 200, {
      livekitUrl: LIVEKIT_URL,
      room,
      tokenEndpoint: "http://" + HOST + ":" + PORT + "/token",
      livekitClientAsset: LIVEKIT_CLIENT_ASSET,
      transport: "livekit",
      bridgeUrl: ENABLE_SIM_BRIDGE
        ? "ws://" + HOST + ":" + PORT + "/agent-bridge?role=browser&room=" + encodeURIComponent(room)
        : null,
      simulatedBridgeEnabled: ENABLE_SIM_BRIDGE,
      note: "LiveKit tokens and local room config are real. WebSocket bridge is only a fallback when explicitly enabled or LiveKit is unavailable.",
    });
    return;
  }

  if (url.pathname === "/token") {
    const room = url.searchParams.get("room") || DEFAULT_ROOM;
    const role = url.searchParams.get("role") || "browser";
    const identity = url.searchParams.get("identity") || role + "-" + randomUUID().slice(0, 8);
    const name = url.searchParams.get("name") || identity;
    sendJson(req, res, 200, {
      token: makeToken({ identity, name, room, role }),
      livekitUrl: LIVEKIT_URL,
      room,
      identity,
      role,
      expiresIn: TOKEN_TTL_SECONDS,
    });
    return;
  }

  sendJson(req, res, 404, { error: "not_found" });
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url || "/", "http://" + HOST + ":" + PORT);
  if (url.pathname !== "/agent-bridge" || !ENABLE_SIM_BRIDGE) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    const role = url.searchParams.get("role") === "agent" ? "agent" : "browser";
    const roomName = url.searchParams.get("room") || DEFAULT_ROOM;
    const identity = url.searchParams.get("identity") || role + "-" + randomUUID().slice(0, 8);
    ws.role = role;
    ws.roomName = roomName;
    ws.identity = identity;

    const room = getRoom(roomName);
    const set = role === "agent" ? room.agents : room.browsers;
    set.add(ws);

    safeSend(ws, {
      type: "bridge.ready",
      identity,
      role,
      room: roomName,
      livekitUrl: LIVEKIT_URL,
      simulated: true,
      peers: roomSnapshot(roomName),
    });
    broadcast(role === "agent" ? room.browsers : room.agents, {
      type: "bridge.peer_joined",
      identity,
      role,
      room: roomName,
      peers: roomSnapshot(roomName),
    });

    ws.on("message", (raw) => {
      let message;
      const rawText = String(raw);
      if (Buffer.byteLength(rawText, "utf8") > MAX_BRIDGE_MESSAGE_BYTES) {
        safeSend(ws, { type: "bridge.error", error: "message_too_large", maxBytes: MAX_BRIDGE_MESSAGE_BYTES });
        return;
      }
      try {
        message = JSON.parse(rawText);
      } catch {
        safeSend(ws, { type: "bridge.error", error: "invalid_json" });
        return;
      }

      const payload = {
        ...message,
        room: roomName,
        from: identity,
        fromRole: role,
      };

      if (role === "browser") {
        if (room.agents.size === 0 && message.type === "prospect.question") {
          safeSend(ws, {
            type: "agent.status",
            status: "waiting_for_agent",
            message: "No local agent worker is connected yet.",
          });
        }
        broadcast(room.agents, payload);
        return;
      }

      broadcast(room.browsers, payload);
    });

    ws.on("close", () => {
      const current = getRoom(roomName);
      current.browsers.delete(ws);
      current.agents.delete(ws);
      broadcast([...current.browsers, ...current.agents], {
        type: "bridge.peer_left",
        identity,
        role,
        room: roomName,
        peers: roomSnapshot(roomName),
      });
    });
  });
});

server.listen(PORT, HOST, () => {
  console.log("InboundNow token server running at http://" + HOST + ":" + PORT);
  console.log("Bridge: ws://" + HOST + ":" + PORT + "/agent-bridge");
  console.log("LiveKit local URL: " + LIVEKIT_URL);
});
