export function resolveInboundNowStartConfig(env = process.env) {
  const port = env.PORT || "4199";
  const tokenPort = env.TOKEN_SERVER_PORT || "4301";
  const qwenPort = env.QWEN_STUB_PORT || "4311";
  const mossPort = env.MOSS_RUNTIME_PORT || "4321";
  const tokenUrl = env.TOKEN_SERVER_URL || "http://127.0.0.1:" + tokenPort;
  const qwenBaseUrl = env.LLM_BASE_URL || "http://127.0.0.1:" + qwenPort + "/v1";
  const mossRuntimeUrl = env.MOSS_RUNTIME_URL || "http://127.0.0.1:" + mossPort;
  const mossIndexPath = env.MOSS_INDEX_PATH || "artifacts/moss/remote-com-local-index.json";
  const mossSourcePath = env.MOSS_SOURCE_PATH || "data/remote-com/remote-com-documents.json.gz";
  const mossSourceType = env.MOSS_SOURCE_TYPE || "json-gzip";
  const mossRuntimeProvider = env.MOSS_RUNTIME_PROVIDER || "local-artifact";
  const mossAgentProvider = env.MOSS_AGENT_PROVIDER || env.AGENT_MOSS_PROVIDER || env.MOSS_PROVIDER || "local-runtime-client";

  return {
    port,
    tokenPort,
    qwenPort,
    mossPort,
    tokenUrl,
    qwenBaseUrl,
    mossRuntimeUrl,
    mossIndexPath,
    mossSourcePath,
    mossSourceType,
    mossRuntimeProvider,
    mossAgentProvider,
    processes: [
      {
        name: "token",
        args: ["services/token-server/server.mjs"],
        env: {
          TOKEN_SERVER_PORT: tokenPort,
          ENABLE_SIM_BRIDGE: env.ENABLE_SIM_BRIDGE || "1",
          LIVEKIT_ROOM: env.LIVEKIT_ROOM || "inboundnow-local",
        },
      },
      {
        name: "qwen",
        args: ["services/model-stubs/qwen-openai-compatible.mjs"],
        env: {
          QWEN_STUB_PORT: qwenPort,
          QWEN_STUB_MODE: env.QWEN_STUB_MODE || "planner-json",
          LLM_MODEL: env.LLM_MODEL || "qwen3-local-planner",
        },
      },
      {
        name: "moss",
        args: ["services/moss-runtime/server.mjs"],
        env: {
          MOSS_RUNTIME_PORT: mossPort,
          MOSS_RUNTIME_PROVIDER: mossRuntimeProvider,
          MOSS_INDEX_PATH: mossIndexPath,
        },
      },
      {
        name: "agent",
        args: ["apps/agent/worker.mjs"],
        env: {
          TOKEN_SERVER_URL: tokenUrl,
          AGENT_TRANSPORT: env.AGENT_TRANSPORT || "bridge",
          AGENT_PLANNER: env.AGENT_PLANNER || "local-llm",
          LLM_PROVIDER: env.LLM_PROVIDER || "qwen-openai-local",
          LLM_BASE_URL: qwenBaseUrl,
          LLM_MODEL: env.LLM_MODEL || "qwen3-local-planner",
          MOSS_PROVIDER: mossAgentProvider,
          MOSS_RUNTIME_URL: mossRuntimeUrl,
          TTS_STREAMING: env.TTS_STREAMING || "1",
          TTS_MODEL_AUDIO: env.TTS_MODEL_AUDIO || "0",
        },
      },
      {
        name: "web",
        args: ["apps/website-lab/server.mjs"],
        env: {
          PORT: port,
          TOKEN_SERVER_URL: tokenUrl,
          LIVEKIT_ROOM: env.LIVEKIT_ROOM || "inboundnow-local",
          REQUIRE_LIVEKIT: env.REQUIRE_LIVEKIT || "0",
        },
      },
    ],
  };
}
