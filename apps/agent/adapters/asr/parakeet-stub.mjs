import { PROOF_LEVELS, status } from "../contracts.mjs";

export function createParakeetStubAdapter(env = process.env) {
  const transcript = env.ASR_STUB_TRANSCRIPT || "How does Remote help with global payroll?";

  return {
    kind: "asr",
    provider: "parakeet-stub",
    status() {
      return status({
        kind: "asr",
        provider: "parakeet-stub",
        label: "simulated-text-input",
        proof: PROOF_LEVELS.stub,
        message: "Stub only: no Parakeet model is loaded and no audio frames are transcribed.",
        detail: {
          targetModel: "nvidia/parakeet-tdt-0.6b-v3",
        },
      });
    },
    async transcribe(input = {}) {
      return {
        transcript: input.transcript || transcript,
        final: true,
        simulated: true,
        provider: "parakeet-stub",
      };
    },
  };
}

