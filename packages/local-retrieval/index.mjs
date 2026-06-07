import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const DEFAULT_MIN_TOKEN_LENGTH = 3;
const DEFAULT_SNIPPET_CHARS = 720;
const STOP_TOKENS = new Set([
  "and",
  "are",
  "does",
  "for",
  "from",
  "help",
  "how",
  "remote",
  "the",
  "this",
  "with",
]);

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
    metadata: document.metadata && typeof document.metadata === "object" ? document.metadata : {},
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

function matchedTokens(queryTokens, document) {
  const tokenSet = new Set(document.tokens || tokenize([document.title, document.url, document.text, ...(document.tags || [])].join(" ")));
  return Array.from(new Set(queryTokens.filter((token) => tokenSet.has(token))));
}

function preferredSnippetTokens(queryTokens) {
  const preferred = queryTokens.filter((token) => !STOP_TOKENS.has(token));
  return preferred.length ? preferred : queryTokens;
}

function firstMatchOffset(text, queryTokens) {
  const haystack = String(text || "").toLowerCase();
  for (const token of preferredSnippetTokens(queryTokens)) {
    const index = haystack.indexOf(token);
    if (index !== -1) return index;
  }
  return 0;
}

function wordBoundaryStart(text, offset) {
  let cursor = Math.max(0, offset);
  while (cursor > 0 && /\S/.test(text[cursor - 1])) cursor -= 1;
  return cursor;
}

function wordBoundaryEnd(text, offset) {
  let cursor = Math.min(text.length, offset);
  while (cursor < text.length && /\S/.test(text[cursor])) cursor += 1;
  return cursor;
}

function excerptText(text, queryTokens, maxChars = DEFAULT_SNIPPET_CHARS) {
  const source = String(text || "").replace(/\s+/g, " ").trim();
  const limit = Math.max(160, Math.min(1600, Number(maxChars || DEFAULT_SNIPPET_CHARS)));
  if (source.length <= limit) return source;

  const matchOffset = firstMatchOffset(source, queryTokens);
  const start = wordBoundaryStart(source, Math.max(0, matchOffset - Math.floor(limit * 0.35)));
  const end = wordBoundaryEnd(source, Math.min(source.length, start + limit));
  const prefix = start > 0 ? "... " : "";
  const suffix = end < source.length ? " ..." : "";
  return prefix + source.slice(start, end).trim() + suffix;
}

export function queryLocalIndex(index, query, options = {}) {
  const topK = Math.max(1, Math.min(12, Number(options.topK || 3)));
  const snippetChars = Number(options.snippetChars || DEFAULT_SNIPPET_CHARS);
  const queryTokens = tokenize(query);
  const documents = Array.isArray(index.documents) ? index.documents : [];
  const snippets = documents
    .map((document) => {
      const score = scoreDocument(queryTokens, document);
      const matched = matchedTokens(queryTokens, document);
      return {
        id: document.id,
        title: document.title,
        url: document.url,
        text: excerptText(document.text, queryTokens, snippetChars),
        tags: document.tags || [],
        metadata: {
          ...(document.metadata || {}),
          documentChars: String(document.text || "").length,
          snippetChars,
          matchedTokens: matched,
          excerpted: String(document.text || "").length > snippetChars,
        },
        score,
      };
    })
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
