import { readdir, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { sanitizeDocumentMetadata } from "../local-retrieval/index.mjs";

const FRONTMATTER_PATTERN = /^---\n([\s\S]*?)\n---\n?/;

async function pathExists(pathname) {
  try {
    await stat(pathname);
    return true;
  } catch (error) {
    if (error && error.code === "ENOENT") return false;
    throw error;
  }
}

async function listMarkdownFiles(root) {
  const pagesDir = join(root, "pages");
  const files = [];

  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(fullPath);
      }
    }
  }

  await walk(pagesDir);
  return files.sort((a, b) => a.localeCompare(b));
}

function parseFrontmatter(markdown) {
  const match = markdown.match(FRONTMATTER_PATTERN);
  if (!match) return { frontmatter: {}, body: markdown };

  const frontmatter = {};
  for (const line of match[1].split("\n")) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    frontmatter[key] = rawValue.replace(/^"(.*)"$/, "$1");
  }

  return {
    frontmatter,
    body: markdown.slice(match[0].length),
  };
}

function firstHeading(markdown) {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : "";
}

function compactText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanMetadata(metadata) {
  return sanitizeDocumentMetadata(Object.fromEntries(
    Object.entries(metadata || {}).filter(([, value]) => value !== undefined && value !== null && value !== "")
  ));
}

function mossCliMetadata(metadata) {
  return Object.fromEntries(
    Object.entries(metadata || {}).map(([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value)])
  );
}

function mossCliDocument(document) {
  return {
    ...document,
    metadata: mossCliMetadata(document.metadata),
  };
}

function stableId(root, markdownPath) {
  return "remote-com:" + relative(join(root, "pages"), markdownPath)
    .replace(/\\/g, "/")
    .replace(/\.md$/, "");
}

async function loadJsonIfPresent(pathname) {
  if (!(await pathExists(pathname))) return {};
  return JSON.parse(await readFile(pathname, "utf8"));
}

export async function loadRemoteComScrapeDocuments(sourcePath, options = {}) {
  const root = resolve(process.cwd(), sourcePath);
  const manifest = await loadJsonIfPresent(join(root, "manifest.json"));
  const importedAt = options.importedAt || process.env.REMOTE_COM_SCRAPE_IMPORTED_AT || manifest.stoppedAt || "";
  const markdownFiles = await listMarkdownFiles(root);
  const maxDocuments = Number(options.maxDocuments || process.env.REMOTE_COM_SCRAPE_MAX_DOCS || 0);
  const selectedFiles = maxDocuments > 0 ? markdownFiles.slice(0, maxDocuments) : markdownFiles;
  const documents = [];

  for (const markdownPath of selectedFiles) {
    const rawMarkdown = await readFile(markdownPath, "utf8");
    const { frontmatter, body } = parseFrontmatter(rawMarkdown);
    const metadataPath = markdownPath.replace(/\.md$/, ".metadata.json");
    const pageMetadata = await loadJsonIfPresent(metadataPath);
    const metadata = cleanMetadata({
      source: "remote_com_scrape",
      importedAt,
      category: pageMetadata.category || frontmatter.category,
      scrapeMethod: pageMetadata.scrapeMethod || frontmatter.scrapeMethod,
      requestedURL: pageMetadata.requestedURL || frontmatter.requestedURL,
      sourceURL: pageMetadata.sourceURL || frontmatter.sourceURL,
      finalURL: pageMetadata.finalURL || frontmatter.finalURL,
      lastmod: pageMetadata.lastmod || frontmatter.lastmod,
      scrapedAt: pageMetadata.scrapedAt || frontmatter.lastScrapedAt,
      statusCode: pageMetadata.statusCode,
      contentType: pageMetadata.contentType,
      bytes: pageMetadata.bytes,
      markdownChars: pageMetadata.markdownChars,
      linksCount: pageMetadata.linksCount,
      markdownPath: relative(root, markdownPath).replace(/\\/g, "/"),
      metadataPath: relative(root, metadataPath).replace(/\\/g, "/"),
    });

    const title = pageMetadata.title || frontmatter.title || firstHeading(body);
    const url = pageMetadata.sourceURL || pageMetadata.finalURL || pageMetadata.requestedURL ||
      frontmatter.sourceURL || frontmatter.finalURL || frontmatter.requestedURL || "";
    const text = compactText(body);

    if (!text) continue;

    documents.push({
      id: stableId(root, markdownPath),
      title,
      url,
      text,
      tags: ["remote.com", metadata.category, metadata.scrapeMethod].filter(Boolean),
      metadata,
    });
  }

  return documents;
}

export async function writeRemoteComScrapeDocuments(sourcePath, outputPath, options = {}) {
  const documents = await loadRemoteComScrapeDocuments(sourcePath, options);
  const mossDocuments = documents.map(mossCliDocument);
  const absoluteOutput = resolve(process.cwd(), outputPath);
  await mkdir(dirname(absoluteOutput), { recursive: true });
  await writeFile(absoluteOutput, JSON.stringify(mossDocuments, null, 2) + "\n");
  return {
    outputPath: absoluteOutput,
    documentCount: mossDocuments.length,
    bytes: Buffer.byteLength(JSON.stringify(mossDocuments)),
  };
}
