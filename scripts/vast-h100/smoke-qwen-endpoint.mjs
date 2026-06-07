#!/usr/bin/env node
const baseUrl = process.env.LLM_BASE_URL || "http://127.0.0.1:4311/v1";
const model = process.env.LLM_MODEL || process.env.LLM_SERVED_MODEL_NAME || "qwen-local";

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
    max_tokens: 96,
    messages: [
      {
        role: "user",
        content: "In one sentence, explain how Remote helps with global payroll.",
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
if (!/payroll|employee|global|compliance|country/i.test(text)) {
  throw new Error(`Qwen smoke returned an unexpected answer: ${text}`);
}

console.log(JSON.stringify({
  ok: true,
  baseUrl,
  model,
  models,
  answer: text,
}, null, 2));
