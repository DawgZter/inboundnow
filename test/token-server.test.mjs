import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";
import WebSocket from "ws";

const SERVER = "services/token-server/server.mjs";

function base64Url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function verifyJwt(token, secret) {
  const [header, payload, signature] = token.split(".");
  const expected = createHmac("sha256", secret)
    .update(header + "." + payload)
    .digest("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  assert.equal(signature, expected);
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

function startServer(env = {}) {
  const child = spawn(process.execPath, [SERVER], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  return { child, get output() { return stdout + stderr; } };
}

async function waitForHealth(port, timeoutMs = 5000) {
  const url = "http://127.0.0.1:" + port + "/health";
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
      lastError = new Error("HTTP " + response.status);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  throw lastError || new Error("Timed out waiting for health");
}

async function withServer(env, fn) {
  const port = env.TOKEN_SERVER_PORT;
  const server = startServer(env);
  try {
    await waitForHealth(port);
    return await fn("http://127.0.0.1:" + port, server);
  } finally {
    server.child.kill("SIGTERM");
    await Promise.race([once(server.child, "exit"), new Promise((resolve) => setTimeout(resolve, 300))]);
  }
}

async function expectStartupFailure(env, pattern) {
  const server = startServer(env);
  const [code] = await once(server.child, "exit");
  assert.notEqual(code, 0);
  assert.match(server.output, pattern);
}

test("token server rejects non-loopback host", async () => {
  await expectStartupFailure(
    { TOKEN_SERVER_PORT: "4811", TOKEN_SERVER_HOST: "0.0.0.0" },
    /TOKEN_SERVER_HOST must be loopback-only/,
  );
});

test("token server rejects non-local LiveKit URL", async () => {
  await expectStartupFailure(
    { TOKEN_SERVER_PORT: "4812", LIVEKIT_URL: "ws://example.com:7880" },
    /LIVEKIT_URL must be loopback-only/,
  );
});

test("token server rejects LiveKit Cloud URLs", async () => {
  await expectStartupFailure(
    { TOKEN_SERVER_PORT: "4813", LIVEKIT_URL: "wss://project.livekit.cloud" },
    /LiveKit Cloud/,
  );
});

test("token endpoint issues signed local room claims", async () => {
  await withServer(
    { TOKEN_SERVER_PORT: "4814", LIVEKIT_API_SECRET: "test-secret", LIVEKIT_TOKEN_TTL_SECONDS: "900" },
    async (baseUrl) => {
      const response = await fetch(baseUrl + "/token?role=browser&room=test-room&identity=test-browser&name=Test%20Browser");
      assert.equal(response.headers.get("access-control-allow-origin"), "null");
      const body = await response.json();
      const payload = verifyJwt(body.token, "test-secret");
      assert.equal(payload.iss, "devkey");
      assert.equal(payload.sub, "test-browser");
      assert.equal(payload.name, "Test Browser");
      assert.equal(payload.exp - payload.iat, 900);
      assert.equal(payload.video.room, "test-room");
      assert.equal(payload.video.roomJoin, true);
      assert.equal(payload.video.canPublish, true);
      assert.equal(payload.video.canSubscribe, true);
      assert.equal(payload.video.canPublishData, true);
      assert.deepEqual(JSON.parse(payload.metadata), { role: "browser", localHarness: true });
    },
  );
});

test("CORS echoes loopback origins but not hostile origins", async () => {
  await withServer({ TOKEN_SERVER_PORT: "4815" }, async (baseUrl) => {
    const local = await fetch(baseUrl + "/config", { headers: { origin: "http://127.0.0.1:4199" } });
    assert.equal(local.headers.get("access-control-allow-origin"), "http://127.0.0.1:4199");

    const hostile = await fetch(baseUrl + "/config", { headers: { origin: "https://evil.example" } });
    assert.equal(hostile.headers.get("access-control-allow-origin"), "null");
  });
});

test("bridge disabled removes bridgeUrl and rejects upgrades", async () => {
  await withServer({ TOKEN_SERVER_PORT: "4816", ENABLE_SIM_BRIDGE: "0" }, async (baseUrl) => {
    const config = await fetch(baseUrl + "/config?room=no-bridge").then((response) => response.json());
    assert.equal(config.simulatedBridgeEnabled, false);
    assert.equal(config.bridgeUrl, null);

    await assert.rejects(async () => {
      const ws = new WebSocket("ws://127.0.0.1:4816/agent-bridge?role=browser&room=no-bridge");
      await once(ws, "open");
    });
  });
});

test("bridge caps oversized messages", async () => {
  await withServer({ TOKEN_SERVER_PORT: "4817", MAX_BRIDGE_MESSAGE_BYTES: "80" }, async () => {
    const ws = new WebSocket("ws://127.0.0.1:4817/agent-bridge?role=browser&room=cap-test");
    await once(ws, "open");
    ws.send(JSON.stringify({ type: "oversized", text: "x".repeat(200) }));
    const [raw] = await once(ws, "message");
    const first = JSON.parse(String(raw));
    const [raw2] = first.type === "bridge.ready" ? await once(ws, "message") : [raw];
    const error = JSON.parse(String(raw2));
    assert.equal(error.type, "bridge.error");
    assert.equal(error.error, "message_too_large");
    ws.close();
  });
});
