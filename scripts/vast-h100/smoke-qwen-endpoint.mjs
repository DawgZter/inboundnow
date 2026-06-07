#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const artifactDir = join("artifacts", "smoke", "qwen-h100-" + timestamp);
const baseUrl = process.env.LLM_BASE_URL || "http://127.0.0.1:4311/v1";
const model = process.env.LLM_MODEL || process.env.LLM_SERVED_MODEL_NAME || "qwen-local";
const nonce = process.env.QWEN_SMOKE_NONCE || randomBytes(6).toString("hex");

function endpoint(pathname) {
  return new URL(pathname, baseUrl.endsWith("/") ? baseUrl : baseUrl + "/");
}

function assertNotStubOpenAIModels(payload) {
  const models = Array.isArray(payload?.data) ? payload.data : [];
  const ids = models.map((item) => String(item.id || ""));
  const owners = models.map((item) => String(item.owned_by || ""));
  if (!models.length) throw new Error("Qwen endpoint /models returned no served models");
  if (!ids.some((id) => id === model || /qwen/i.test(id))) {
    throw new Error("Qwen endpoint did not report the expected model. ids=" + ids.join(","));
  }
  if (ids.some((id) => /stub|fake|fixture/i.test(id)) || owners.some((owner) => /stub|fake|fixture/i.test(owner))) {
    throw new Error("Qwen H100 smoke cannot be satisfied by a stub/fake endpoint. ids=" + ids.join(",") + " owners=" + owners.join(","));
  }
}

function parseJsonFromText(text) {
  const trimmed = String(text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  return JSON.parse(trimmed);
}

await mkdir(artifactDir, { recursive: true });

const modelsResponse = await fetch(endpoint("models"));
if (!modelsResponse.ok) {
  const body = await modelsResponse.text();
  throw new Error(`Qwen endpoint /models returned HTTP ${modelsResponse.status}: ${body.slice(0, 500)}`);
}
const models = await modelsResponse.json();
assertNotStubOpenAIModels(models);

const chatEndpoint = endpoint("chat/completions");

const response = await fetch(chatEndpoint, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    model,
    temperature: 0,
    max_tokens: 160,
    messages: [
      {
        role: "system",
        content: "Return only strict JSON. No markdown.",
      },
      {
        role: "user",
        content: "Return JSON with keys nonce, answer, action. nonce must equal " + nonce + ". answer must explain how Remote helps with global payroll. action must be one primitive website action type such as showCaption, scrollToElement, or highlightElement.",
      },
    ],
  }),
});

if (!response.ok) {
  const body = await response.text();
  throw new Error(`Qwen endpoint returned HTTP ${response.status}: ${body.slice(0, 500)}`);
}

const payload = await response.json();
const text = payload?.choices?.[0]?.message?.content || "";
let parsed;
try {
  parsed = parseJsonFromText(text);
} catch (error) {
  throw new Error("Qwen smoke did not return strict JSON: " + text.slice(0, 500));
}

assert.equal(parsed.nonce, nonce, "Qwen response must echo the random nonce");
assert.match(String(parsed.answer || ""), /payroll|employee|global|compliance|country/i, "Qwen answer must address global payroll");
assert.match(String(parsed.action || ""), /showCaption|scrollToElement|highlightElement|clickElement|showBookingPrompt/i, "Qwen action must be primitive");
assert.ok(payload.id, "Qwen completion response must include an id");
assert.ok(payload.model, "Qwen completion response must include model metadata");
assert.ok(Number(payload.usage?.total_tokens || 0) > 0, "Qwen completion response must include token usage");
if (!String(payload.model || model).toLowerCase().includes("qwen") && payload.model !== model) {
  throw new Error("Qwen response model metadata was unexpected: " + payload.model);
}
if (!/payroll|employee|global|compliance|country/i.test(text)) {
  throw new Error(`Qwen smoke returned an unexpected answer: ${text}`);
}

const result = {
  ok: true,
  artifactDir,
  baseUrl,
  model,
  nonce,
  models,
  completion: {
    id: payload.id,
    model: payload.model || "",
    finishReason: payload.choices?.[0]?.finish_reason || "",
    usage: payload.usage || null,
  },
  parsed,
  answer: text,
};

await writeFile(join(artifactDir, "result.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
