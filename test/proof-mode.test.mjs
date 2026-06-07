import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ProofModeError,
  assertH100ProofModeStartup,
  assertProofModeAsr,
  assertProofModePlanner,
  assertProofModeRetrieval,
  assertProofModeTtsEvent,
  localTtsModelProvenByEvent,
  normalizeRetrievalForMessage,
  ttsProofLevelForEvent,
} from "../apps/agent/proof-mode.mjs";

const proofEnv = {
  H100_PROOF_MODE: "1",
  AGENT_MODE: "verified",
  AGENT_TRANSPORT: "livekit",
  TTS_REAL_MODEL_PROOF: "1",
};

function assertProofError(fn, pattern) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof ProofModeError);
    assert.match(error.message, pattern);
    return true;
  });
}

test("normalizes retrieval without defaulting unknown localOnly to true", () => {
  const normalized = normalizeRetrievalForMessage({
    provider: "local-artifact",
    snippets: [{ id: "one", text: "Remote payroll" }],
  });

  assert.equal(normalized.localOnly, false);
  assert.equal(normalized.count, 1);
});

test("H100 startup proof mode rejects non-local default adapters", () => {
  assertProofError(
    () => assertH100ProofModeStartup({
      env: { H100_PROOF_MODE: "1" },
      adapterStatus: {
        asr: { provider: "parakeet-stub" },
        llm: { provider: "qwen-stub" },
        moss: { provider: "local-fixture" },
        tts: { provider: "vibevoice-stub" },
      },
    }),
    /AGENT_TRANSPORT=livekit/,
  );
});

test("H100 startup proof mode accepts the local stack contract", () => {
  assert.doesNotThrow(() => assertH100ProofModeStartup({
    env: proofEnv,
    adapterStatus: {
      asr: { provider: "local-parakeet" },
      llm: { provider: "qwen-openai-local" },
      moss: { provider: "local-runtime-client" },
      tts: { provider: "local-miso-one" },
    },
  }));
});

test("proof mode rejects missing, simulated, and empty retrieval", () => {
  assertProofError(() => assertProofModeRetrieval(null, { env: proofEnv }), /requires local Moss retrieval/);
  assertProofError(
    () => assertProofModeRetrieval({
      provider: "local-fixture",
      localOnly: true,
      simulated: true,
      snippets: [{ id: "fixture" }],
    }, { env: proofEnv }),
    /must not be simulated/,
  );
  assertProofError(
    () => assertProofModeRetrieval({
      provider: "local-runtime-client",
      localOnly: true,
      simulated: false,
      snippets: [],
    }, { env: proofEnv }),
    /at least one snippet/,
  );
});

test("proof mode accepts local runtime retrieval with local artifact upstream", () => {
  assert.doesNotThrow(() => assertProofModeRetrieval({
    provider: "local-runtime-client",
    upstreamProvider: "local-artifact",
    adapterProvider: "local-runtime-client",
    localOnly: true,
    simulated: false,
    snippets: [{ id: "remote-global-payroll", text: "Remote payroll" }],
  }, {
    env: proofEnv,
    adapterStatus: { moss: { provider: "local-runtime-client" } },
  }));
});

test("proof mode rejects transcript fallback ASR before planning", () => {
  assertProofError(
    () => assertProofModeAsr({
      provider: "browser-transcript",
      simulated: true,
      proof: "transcript-message",
      source: "typed-fallback",
    }, { env: proofEnv }),
    /provider=local-parakeet/,
  );
});

test("proof mode rejects simulated Parakeet ASR and missing audio source", () => {
  assertProofError(
    () => assertProofModeAsr({
      provider: "local-parakeet",
      simulated: true,
      proof: "configured",
      model: "nvidia/parakeet-tdt-0.6b-v3",
    }, { env: proofEnv }),
    /must not be simulated/,
  );
  assertProofError(
    () => assertProofModeAsr({
      provider: "local-parakeet",
      simulated: false,
      proof: "configured",
      model: "nvidia/parakeet-tdt-0.6b-v3",
    }, { env: proofEnv }),
    /requires livekit-audio-turn/,
  );
});

test("proof mode accepts local Parakeet audio-turn ASR metadata", () => {
  assert.doesNotThrow(() => assertProofModeAsr({
    provider: "local-parakeet",
    simulated: false,
    proof: "configured",
    source: "livekit-audio-turn",
    model: "nvidia/parakeet-tdt-0.6b-v3",
  }, { env: proofEnv }));
});

test("proof mode rejects planner fallback", () => {
  assertProofError(
    () => assertProofModePlanner({
      source: "deterministic-router",
      provider: "",
      fallback: true,
      error: "local planner failed",
    }, { env: proofEnv }),
    /source=local-llm-json/,
  );
});

test("proof mode accepts Qwen local planner metadata", () => {
  assert.doesNotThrow(() => assertProofModePlanner({
    source: "local-llm-json",
    provider: "qwen-openai-local",
    fallback: false,
    error: "",
  }, { env: proofEnv }));
});

test("TTS proof stays contract when env flag has no endpoint evidence", () => {
  const event = {
    provider: "local-miso-one",
    audioBase64: Buffer.from([1, 2, 3, 4]).toString("base64"),
  };

  assert.equal(ttsProofLevelForEvent(event, { env: proofEnv, provider: "local-miso-one", requireAudio: true }), "contract");
  assert.equal(localTtsModelProvenByEvent(event, { env: proofEnv, provider: "local-miso-one" }), false);
});

test("TTS proof requires local Miso H100 audio evidence", () => {
  const event = {
    provider: "local-miso-one",
    localOnly: true,
    model: "MisoLabs/MisoTTS",
    device: "cuda",
    gpuName: "NVIDIA H100 80GB HBM3",
    audioBase64: Buffer.from([1, 2, 3, 4]).toString("base64"),
  };

  assert.equal(ttsProofLevelForEvent(event, { env: proofEnv, provider: "local-miso-one", requireAudio: true }), "verified");
  assert.equal(localTtsModelProvenByEvent(event, { env: proofEnv, provider: "local-miso-one" }), true);
});

test("TTS clone proof requires applied LoRA evidence when requested", () => {
  const cloneEnv = { ...proofEnv, MISO_REQUIRE_LORA: "1" };
  const event = {
    provider: "local-miso-one",
    localOnly: true,
    model: "MisoLabs/MisoTTS",
    device: "cuda",
    gpuName: "NVIDIA H100",
    audioBase64: Buffer.from([1, 2, 3, 4]).toString("base64"),
  };

  assertProofError(
    () => assertProofModeTtsEvent(event, { env: cloneEnv, provider: "local-miso-one", requireAudio: true }),
    /loraAdapterApplied=true/,
  );
  assert.doesNotThrow(() => assertProofModeTtsEvent({
    ...event,
    loraAdapterApplied: true,
  }, { env: cloneEnv, provider: "local-miso-one", requireAudio: true }));
});
