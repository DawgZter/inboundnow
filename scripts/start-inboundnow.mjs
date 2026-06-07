#!/usr/bin/env node
import { spawn } from "node:child_process";

const root = new URL("..", import.meta.url);
const node = process.execPath;
const env = process.env;
const port = env.PORT || "4199";
const tokenPort = env.TOKEN_SERVER_PORT || "4301";
const qwenPort = env.QWEN_STUB_PORT || "4311";
const mossPort = env.MOSS_RUNTIME_PORT || "4321";
const tokenUrl = env.TOKEN_SERVER_URL || "http://127.0.0.1:" + tokenPort;
const qwenBaseUrl = env.LLM_BASE_URL || "http://127.0.0.1:" + qwenPort + "/v1";
const mossRuntimeUrl = env.MOSS_RUNTIME_URL || "http://127.0.0.1:" + mossPort;
const mossIndexPath = env.MOSS_INDEX_PATH || "artifacts/moss/remote-com-local-index.json";

const processes = [
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
      MOSS_PROVIDER: env.MOSS_PROVIDER || "local-artifact",
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
      MOSS_PROVIDER: env.MOSS_PROVIDER || "local-runtime",
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
];

const children = [];
let shuttingDown = false;

function prefix(name, chunk) {
  String(chunk)
    .split(/\r?\n/)
    .filter(Boolean)
    .forEach((line) => process.stdout.write("[" + name + "] " + line + "\n"));
}

function start(service) {
  const child = spawn(node, service.args, {
    cwd: root,
    env: { ...env, ...service.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  child.stdout.on("data", (chunk) => prefix(service.name, chunk));
  child.stderr.on("data", (chunk) => prefix(service.name, chunk));
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    prefix("inboundnow", service.name + " exited (" + (signal || code) + ")");
    shutdown(code || 1);
  });
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), 250).unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

process.stdout.write("\n");
process.stdout.write("inboundnow starting local talk-and-guide stack\n");
process.stdout.write("Open http://localhost:" + port + "/direct\n");
process.stdout.write("Click Start AI Persona for LiveKit mic mode when local livekit-server is running.\n");
process.stdout.write("Without LiveKit, Start AI Persona uses browser speech capture; Ask agent and Send typed transcript use the same action bus.\n\n");

for (const service of processes) start(service);
