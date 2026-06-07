import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const PROOF_LEVELS = Object.freeze({
  stub: "stub",
  configured: "configured",
  verified: "verified",
  unavailable: "unavailable",
});

export function status({
  kind,
  provider,
  label,
  proof = PROOF_LEVELS.stub,
  healthy = true,
  message = "",
  detail = {},
}) {
  return {
    kind,
    provider,
    label,
    proof,
    healthy,
    message,
    detail,
  };
}

export function repoPath(pathname) {
  return resolve(process.cwd(), pathname);
}

export function envFlag(value, defaultValue = false) {
  if (value === undefined || value === null || value === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

export async function readJsonFile(pathname) {
  const raw = await readFile(repoPath(pathname), "utf8");
  return JSON.parse(raw);
}

export function assertLocalHttpUrl(rawUrl, name = "url") {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`${name} must use http or https`);
  }

  const host = parsed.hostname.toLowerCase();
  const isLocal =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".localhost");

  if (!isLocal) {
    throw new Error(`${name} must point at localhost for local-first adapter mode`);
  }

  return parsed;
}

export function createUnavailableAdapter(kind, provider, message) {
  return {
    kind,
    provider,
    status() {
      return status({
        kind,
        provider,
        label: "unavailable",
        proof: PROOF_LEVELS.unavailable,
        healthy: false,
        message,
      });
    },
  };
}

