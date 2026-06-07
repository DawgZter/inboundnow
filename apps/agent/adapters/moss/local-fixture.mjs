import { PROOF_LEVELS, readJsonFile, status } from "../contracts.mjs";

const DEFAULT_FIXTURE = "fixtures/moss/remote-snippets.json";

function words(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2);
}

function scoreSnippet(queryWords, snippet) {
  const haystack = words([snippet.title, snippet.url, snippet.text, ...(snippet.tags || [])].join(" "));
  const haystackSet = new Set(haystack);
  return queryWords.reduce((score, word) => score + (haystackSet.has(word) ? 1 : 0), 0);
}

export function createLocalFixtureMossAdapter(env = process.env) {
  const fixturePath = env.MOSS_FIXTURE_PATH || DEFAULT_FIXTURE;
  let cache;

  async function snippets() {
    if (!cache) cache = await readJsonFile(fixturePath);
    return cache;
  }

  return {
    kind: "moss",
    provider: "local-fixture",
    status() {
      return status({
        kind: "moss",
        provider: "local-fixture",
        label: "local-fixture",
        proof: PROOF_LEVELS.stub,
        message: "Fixture retrieval only: proves local retrieval wiring, not real Moss runtime proof.",
        detail: { fixturePath },
      });
    },
    async query(query, options = {}) {
      const topK = Math.max(1, Math.min(8, Number(options.topK || 3)));
      const queryWords = words(query);
      const ranked = (await snippets())
        .map((snippet) => ({ ...snippet, score: scoreSnippet(queryWords, snippet) }))
        .filter((snippet) => snippet.score > 0)
        .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
        .slice(0, topK);

      return {
        provider: "local-fixture",
        query,
        simulated: true,
        snippets: ranked,
      };
    },
  };
}

