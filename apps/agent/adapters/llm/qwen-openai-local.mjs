import { PROOF_LEVELS, assertLocalHttpUrl, status } from "../contracts.mjs";

export function createQwenOpenAILocalAdapter(env = process.env) {
  const baseUrl = env.LLM_BASE_URL || "http://127.0.0.1:4311/v1";
  const model = env.LLM_MODEL || "qwen-local";
  const base = assertLocalHttpUrl(baseUrl, "LLM_BASE_URL");

  return {
    kind: "llm",
    provider: "qwen-openai-local",
    status() {
      return status({
        kind: "llm",
        provider: "qwen-openai-local",
        label: "qwen-openai-local",
        proof: PROOF_LEVELS.configured,
        message: "Configured for a localhost OpenAI-compatible endpoint; proof requires a successful local completion smoke.",
        detail: { baseUrl: base.href.replace(/\/$/, ""), model },
      });
    },
    async complete({ messages = [], temperature = 0.2, maxTokens } = {}) {
      const endpoint = new URL("chat/completions", base.href.endsWith("/") ? base.href : base.href + "/");
      const body = {
        model,
        messages,
        temperature,
      };
      if (Number.isFinite(Number(maxTokens))) body.max_tokens = Number(maxTokens);

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(`Local Qwen endpoint returned HTTP ${response.status}`);
      }

      return response.json();
    },
  };
}
