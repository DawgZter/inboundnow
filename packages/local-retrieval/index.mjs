import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const DEFAULT_MIN_TOKEN_LENGTH = 3;

export function tokenize(value) {
  return String(value || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= DEFAULT_MIN_TOKEN_LENGTH);
}

function uniqueTokens(values) {
  return Array.from(new Set(tokenize(values.join(" "))));
}

function normalizeDocument(document) {
  return {
    id: String(document.id || document.url || document.title || "").trim(),
    title: String(document.title || "").trim(),
    url: String(document.url || "").trim(),
    text: String(document.text || "").replace(/\s+/g, " ").trim(),
    tags: Array.isArray(document.tags) ? document.tags.map(String) : [],
  };
}

export function buildLocalIndex(documents, options = {}) {
  const normalized = documents.map(normalizeDocument).filter((document) => document.id && document.text);
  const builtAt = options.builtAt || "";
  return {
    schema: "inboundnow.local-retrieval.v1",
    provider: "local-artifact",
    source: options.source || "local-json",
    builtAt,
    localOnly: true,
    forbiddenRuntimeBehaviors: [
      "autoRefresh",
      "cloud polling",
      "pushIndex()",
      "runtime document upload",
      "session document upload",
      "session embedding upload"
    ],
    documents: normalized.map((document) => ({
      ...document,
      tokens: uniqueTokens([document.title, document.url, document.text, ...(document.tags || [])]),
    })),
  };
}

function scoreDocument(queryTokens, document) {
  const tokenSet = new Set(document.tokens || tokenize([document.title, document.url, document.text, ...(document.tags || [])].join(" ")));
  let score = 0;
  for (const token of queryTokens) {
    if (tokenSet.has(token)) score += 2;
    if (String(document.title || "").toLowerCase().includes(token)) score += 1;
    if ((document.tags || []).some((tag) => String(tag).toLowerCase().includes(token))) score += 1;
  }
  return score;
}

export function queryLocalIndex(index, query, options = {}) {
  const topK = Math.max(1, Math.min(12, Number(options.topK || 3)));
  const queryTokens = tokenize(query);
  const documents = Array.isArray(index.documents) ? index.documents : [];
  const snippets = documents
    .map((document) => ({
      id: document.id,
      title: document.title,
      url: document.url,
      text: document.text,
      tags: document.tags || [],
      score: scoreDocument(queryTokens, document),
    }))
    .filter((snippet) => snippet.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, topK);

  return {
    provider: index.provider || "local-artifact",
    query,
    localOnly: index.localOnly !== false,
    simulated: false,
    artifact: {
      schema: index.schema || "unknown",
      source: index.source || "unknown",
      builtAt: index.builtAt || "",
      documentCount: documents.length,
    },
    snippets,
  };
}

export async function readJson(pathname) {
  return JSON.parse(await readFile(resolve(process.cwd(), pathname), "utf8"));
}

export async function writeJson(pathname, value) {
  const absolute = resolve(process.cwd(), pathname);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, JSON.stringify(value, null, 2) + "\n");
  return absolute;
}
