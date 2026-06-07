import { PROOF_LEVELS, status } from "../contracts.mjs";

export function createQwenStubAdapter(env = process.env) {
  const model = env.LLM_MODEL || "qwen-local-stub";

  return {
    kind: "llm",
    provider: "qwen-stub",
    status() {
      return status({
        kind: "llm",
        provider: "qwen-stub",
        label: "keyword-router",
        proof: PROOF_LEVELS.stub,
        message: "Stub only: planner still uses deterministic keyword routing, not a local Qwen runtime.",
        detail: { model },
      });
    },
    async complete({ messages = [] } = {}) {
      const latest = messages.map((message) => message.content || "").filter(Boolean).at(-1) || "";
      return {
        provider: "qwen-stub",
        model,
        simulated: true,
        content: latest.toLowerCase().includes("payroll")
          ? "Remote helps centralize global payroll, country-specific compliance, and distributed team payments."
          : "I can help with Remote payroll, hiring, compliance, pricing, and country workflows.",
      };
    },
  };
}

