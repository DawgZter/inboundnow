import { PROOF_LEVELS, assertLocalHttpUrl, status } from "../contracts.mjs";

export function createLocalRuntimeMossClient(env = process.env) {
  const baseUrl = env.MOSS_RUNTIME_URL || "http://127.0.0.1:4321";
  const base = assertLocalHttpUrl(baseUrl, "MOSS_RUNTIME_URL");

  return {
    kind: "moss",
    provider: "local-runtime-client",
    status() {
      return status({
        kind: "moss",
        provider: "local-runtime-client",
        label: "local-runtime-client",
        proof: PROOF_LEVELS.configured,
        message: "Configured for localhost Moss runtime; proof requires a successful local query against prebuilt artifacts.",
        detail: { baseUrl: base.href.replace(/\/$/, "") },
      });
    },
    async query(query, options = {}) {
      const endpoint = new URL("/query", base);
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, topK: options.topK || 3 }),
      });

      if (!response.ok) {
        throw new Error(`Local Moss runtime returned HTTP ${response.status}`);
      }

      const payload = await response.json();
      return {
        ...payload,
        provider: "local-runtime-client",
        upstreamProvider: payload.provider || "",
        adapterProvider: "local-runtime-client",
      };
    },
  };
}
