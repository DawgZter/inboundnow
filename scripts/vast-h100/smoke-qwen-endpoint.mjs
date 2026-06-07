#!/usr/bin/env node
const baseUrl = process.env.LLM_BASE_URL || "http://127.0.0.1:4311/v1";
const model = process.env.LLM_MODEL || process.env.LLM_SERVED_MODEL_NAME || "qwen-local";

const endpoint = new URL("chat/completions", baseUrl.endsWith("/") ? baseUrl : baseUrl + "/");

const response = await fetch(endpoint, {
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
  answer: text,
}, null, 2));
