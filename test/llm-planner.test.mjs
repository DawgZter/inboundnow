import assert from "node:assert/strict";
import { test } from "node:test";
import { planQuestion } from "../apps/agent/llm-planner.mjs";

const validPayrollPlan = {
  intent: "global_payroll",
  answer: "Remote centralizes payroll, compliance, and payments for distributed teams.",
  actions: [
    {
      type: "showCaption",
      text: "Remote centralizes payroll, compliance, and distributed team payments.",
    },
    {
      type: "scrollToElement",
      target: { key: "payroll" },
      caption: "Bringing payroll into view.",
    },
    {
      type: "highlightElement",
      target: { key: "payroll" },
    },
    {
      type: "showBookingPrompt",
      reason: "payroll_next_step",
    },
  ],
};

function qwenAdapter(content) {
  return {
    llm: {
      provider: "qwen-openai-local",
      async complete() {
        return { choices: [{ message: { content } }] };
      },
    },
  };
}

test("disabled LLM planner uses deterministic router", async () => {
  const result = await planQuestion({
    question: "How does Remote help with global payroll?",
    adapters: qwenAdapter(JSON.stringify(validPayrollPlan)),
    env: {},
  });

  assert.equal(result.planner.source, "deterministic-router");
  assert.equal(result.planner.enabled, false);
  assert.equal(result.plan.intent, "global_payroll");
});

test("local LLM planner returns prepared actions for valid JSON", async () => {
  const result = await planQuestion({
    question: "How does Remote help with global payroll?",
    adapters: qwenAdapter(JSON.stringify(validPayrollPlan)),
    env: { AGENT_PLANNER: "local-llm" },
    generateId: () => "act_llm",
  });

  assert.equal(result.planner.source, "local-llm-json");
  assert.equal(result.planner.fallback, false);
  assert.equal(result.plan.intent, "global_payroll");
  assert.equal(result.preparedActions[0].id, "act_llm");
  assert.equal(result.preparedActions[0].type, "showCaption");
  assert.ok(result.preparedActions.every((action) => action.type !== "payrollFlow"));
});

test("malformed LLM JSON falls back to deterministic plan", async () => {
  const result = await planQuestion({
    question: "How does Remote help with global payroll?",
    adapters: qwenAdapter("{not json"),
    env: { AGENT_PLANNER: "local-llm" },
  });

  assert.equal(result.planner.source, "deterministic-router");
  assert.equal(result.planner.fallback, true);
  assert.match(result.planner.error, /strict JSON|JSON/);
  assert.equal(result.plan.intent, "global_payroll");
});

test("fail-closed local LLM planner throws instead of using deterministic fallback", async () => {
  await assert.rejects(
    planQuestion({
      question: "How does Remote help with global payroll?",
      adapters: qwenAdapter("{not json"),
      env: { AGENT_PLANNER: "local-llm", AGENT_PLANNER_FAIL_CLOSED: "1" },
    }),
    /strict JSON|JSON/,
  );
});

test("local LLM planner rejects deprecated demo macros", async () => {
  const macro = {
    intent: "global_payroll",
    answer: "Macro plan.",
    actions: [{ type: "payrollFlow", answer: "Macro plan." }],
  };
  const result = await planQuestion({
    question: "How does Remote help with global payroll?",
    adapters: qwenAdapter(JSON.stringify(macro)),
    env: { AGENT_PLANNER: "local-llm" },
  });

  assert.equal(result.planner.source, "deterministic-router");
  assert.equal(result.planner.fallback, true);
  assert.match(result.planner.error, /deprecated demo macro/);
  assert.ok(result.plan.actions.every((action) => action.type !== "payrollFlow"));
});

test("invalid LLM action falls back before accepting LLM answer", async () => {
  const unsafe = {
    intent: "unsafe",
    answer: "I will drive the desktop.",
    actions: [{ type: "driveNativeDesktop" }],
  };
  const result = await planQuestion({
    question: "How does Remote help with global payroll?",
    adapters: qwenAdapter(JSON.stringify(unsafe)),
    env: { AGENT_PLANNER: "local-llm" },
  });

  assert.equal(result.planner.source, "deterministic-router");
  assert.equal(result.planner.fallback, true);
  assert.notEqual(result.plan.answer, unsafe.answer);
  assert.equal(result.plan.intent, "global_payroll");
});

test("qwen-stub provider cannot satisfy local LLM planner mode", async () => {
  const result = await planQuestion({
    question: "How does Remote help with global payroll?",
    adapters: { llm: { provider: "qwen-stub", async complete() {} } },
    env: { AGENT_PLANNER: "local-llm" },
  });

  assert.equal(result.planner.source, "deterministic-router");
  assert.equal(result.planner.fallback, true);
  assert.match(result.planner.error, /qwen-openai-local/);
});
