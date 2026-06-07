import { PROOF_LEVELS, readJsonFile, status } from "../contracts.mjs";
import { queryLocalIndex } from "../../../../packages/local-retrieval/index.mjs";

const DEFAULT_INDEX = "artifacts/moss/remote-com-local-index.json";

export function createLocalArtifactMossAdapter(env = process.env) {
  const indexPath = env.MOSS_INDEX_PATH || DEFAULT_INDEX;
  let cache;

  async function index() {
    if (!cache) cache = await readJsonFile(indexPath);
    return cache;
  }

  return {
    kind: "moss",
    provider: "local-artifact",
    status() {
      return status({
        kind: "moss",
        provider: "local-artifact",
        label: "local-artifact",
        proof: PROOF_LEVELS.configured,
        message: "Configured for a prebuilt local retrieval artifact; proof requires a dedicated smoke against MOSS_INDEX_PATH.",
        detail: { indexPath },
      });
    },
    async query(query, options = {}) {
      return queryLocalIndex(await index(), query, options);
    },
  };
}
