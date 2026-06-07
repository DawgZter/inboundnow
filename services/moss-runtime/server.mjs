#!/usr/bin/env node
import { createServer } from "node:http";
import { createLocalFixtureMossAdapter } from "../../apps/agent/adapters/moss/local-fixture.mjs";

const PORT = Number(process.env.MOSS_RUNTIME_PORT || 4321);
const adapter = createLocalFixtureMossAdapter(process.env);

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 64_000) {
        reject(new Error("Request body too large"));
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function send(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload, null, 2));
}

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    send(response, 200, {
      ok: true,
      localOnly: true,
      forbiddenRuntimeBehaviors: [
        "autoRefresh",
        "cloud polling",
        "pushIndex()",
        "runtime document upload",
        "session embedding upload",
      ],
      adapter: adapter.status(),
    });
    return;
  }

  if (request.method === "POST" && request.url === "/query") {
    try {
      const body = JSON.parse(await readBody(request) || "{}");
      const result = await adapter.query(body.query || "", { topK: body.topK || 3 });
      send(response, 200, result);
    } catch (error) {
      send(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  send(response, 404, { ok: false, error: "not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Local Moss fixture runtime listening on http://127.0.0.1:${PORT}`);
});

