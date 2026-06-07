#!/usr/bin/env node
import { createServer } from "node:http";

const PORT = Number(process.env.QWEN_STUB_PORT || 4311);
const MODEL = process.env.LLM_MODEL || "qwen-local-stub";

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 128_000) {
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
  if (request.method === "GET" && request.url === "/v1/models") {
    send(response, 200, {
      object: "list",
      data: [{ id: MODEL, object: "model", owned_by: "local-stub" }],
    });
    return;
  }

  if (request.method === "POST" && request.url === "/v1/chat/completions") {
    try {
      const body = JSON.parse(await readBody(request) || "{}");
      const latest = (body.messages || []).map((message) => message.content || "").filter(Boolean).at(-1) || "";
      const content = latest.toLowerCase().includes("payroll")
        ? "Remote helps centralize global payroll, country-specific compliance, and distributed team payments."
        : "I can help with Remote payroll, hiring, compliance, pricing, and country workflows.";

      send(response, 200, {
        id: "chatcmpl_local_stub",
        object: "chat.completion",
        model: body.model || MODEL,
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content },
          },
        ],
      });
    } catch (error) {
      send(response, 400, { error: { message: error.message } });
    }
    return;
  }

  send(response, 404, { error: { message: "not found" } });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Qwen OpenAI-compatible stub listening on http://127.0.0.1:${PORT}/v1`);
});

