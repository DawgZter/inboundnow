#!/usr/bin/env node
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const PORT = Number(process.env.PORT || 4188);
const PREFIX = "/__remote";
const DEFAULT_TARGET = "https://remote.com/";
const CAL_EMBED_URL = process.env.CAL_URL || "https://cal.com/remote";
const TOKEN_SERVER_URL = process.env.TOKEN_SERVER_URL || "http://127.0.0.1:4301";
const LIVEKIT_ROOM = process.env.LIVEKIT_ROOM || "inboundnow-local";

const CLICKY_CURSOR_PATH = "/__ocw-assets/clicky-cursor.svg";
const CLICKY_CURSOR_IMAGE = new URL("./assets/clicky-cursor.svg", import.meta.url);
const LIVEKIT_CLIENT_PATH = "/__ocw-assets/livekit-client.esm.mjs";
const LIVEKIT_CLIENT_BUNDLE = new URL("../../node_modules/livekit-client/dist/livekit-client.esm.mjs", import.meta.url);

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const DROP_RESPONSE_HEADERS = new Set([
  ...HOP_BY_HOP_HEADERS,
  "content-length",
  "content-encoding",
  "content-security-policy",
  "content-security-policy-report-only",
  "cross-origin-embedder-policy",
  "cross-origin-opener-policy",
  "cross-origin-resource-policy",
  "permissions-policy",
  "x-frame-options",
]);

function proxyPathFor(target) {
  const url = target instanceof URL ? target : new URL(target);
  return PREFIX + "/" + url.protocol.slice(0, -1) + "/" + url.host + url.pathname + url.search + url.hash;
}

function parseProxyPath(requestUrl) {
  const local = new URL(requestUrl, "http://localhost:" + PORT);
  const match = local.pathname.match(/^\/__remote\/(https?)\/([^/]+)(\/.*)?$/);

  if (!match) {
    return null;
  }

  const scheme = match[1];
  const encodedHost = match[2];
  const path = match[3] || "/";
  return new URL(scheme + "://" + decodeURIComponent(encodedHost) + path + local.search);
}

function shouldSkipUrl(raw) {
  const value = raw.trim();
  return (
    !value ||
    value.startsWith("#") ||
    value.startsWith("{") ||
    /^(?:about|blob|data|javascript|mailto|sms|tel):/i.test(value) ||
    value.startsWith(PREFIX) ||
    value.startsWith("http://localhost:" + PORT) ||
    value.startsWith("http://127.0.0.1:" + PORT)
  );
}

function looksUrlish(raw) {
  return /^(?:https?:|\/\/|\/|\.\/|\.\.\/)/i.test(raw.trim());
}

function rewriteUrl(raw, baseUrl) {
  const value = raw.trim();

  if (shouldSkipUrl(value)) {
    return raw;
  }

  try {
    const absolute = value.startsWith("//")
      ? new URL(baseUrl.protocol + value)
      : new URL(value, baseUrl);

    if (!/^https?:$/.test(absolute.protocol)) {
      return raw;
    }

    return proxyPathFor(absolute);
  } catch {
    return raw;
  }
}

function escapeAttr(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function rewriteSrcset(value, baseUrl) {
  return value
    .split(",")
    .map((part) => {
      const trimmed = part.trim();
      if (!trimmed) {
        return trimmed;
      }

      const bits = trimmed.split(/\s+/);
      bits[0] = rewriteUrl(bits[0], baseUrl);
      return bits.join(" ");
    })
    .join(", ");
}

function rewriteCss(css, baseUrl) {
  return css
    .replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (_match, quote, rawUrl) => {
      return "url(" + quote + rewriteUrl(rawUrl, baseUrl) + quote + ")";
    })
    .replace(/@import\s+(?:url\()?(['"])(.*?)\1\)?/gi, (_match, quote, rawUrl) => {
      return "@import " + quote + rewriteUrl(rawUrl, baseUrl) + quote;
    });
}

function injectedHelper(baseUrl) {
  return [
    "<script>",
    "(() => {",
    "  const proxyPrefix = " + JSON.stringify(PREFIX) + ";",
    "  const baseUrl = " + JSON.stringify(baseUrl.href) + ";",
    "  const localOrigin = location.origin;",
    "  const skipPattern = /^(?:#|about:|blob:|data:|javascript:|mailto:|sms:|tel:)/i;",
    "  function toProxy(raw) {",
    "    if (!raw || skipPattern.test(raw) || raw.startsWith(proxyPrefix)) return raw;",
    "    try {",
    "      const url = raw.startsWith('//') ? new URL(location.protocol + raw) : new URL(raw, baseUrl);",
    "      if (!/^https?:$/.test(url.protocol)) return raw;",
    "      if (url.origin === localOrigin) return raw;",
    "      return proxyPrefix + '/' + url.protocol.slice(0, -1) + '/' + url.host + url.pathname + url.search + url.hash;",
    "    } catch {",
    "      return raw;",
    "    }",
    "  }",
    "  function rewriteNode(node) {",
    "    if (!node || node.nodeType !== 1) return;",
    "    const attrs = ['href', 'src', 'action', 'poster', 'data-src', 'data-href', 'data-media-src', 'data-lottie'];",
    "    for (const attr of attrs) {",
    "      if (node.hasAttribute(attr)) node.setAttribute(attr, toProxy(node.getAttribute(attr)));",
    "    }",
    "    if (node.hasAttribute('srcset')) {",
    "      node.setAttribute('srcset', node.getAttribute('srcset').split(',').map((part) => {",
    "        const bits = part.trim().split(/\\s+/);",
    "        if (!bits[0]) return '';",
    "        bits[0] = toProxy(bits[0]);",
    "        return bits.join(' ');",
    "      }).join(', '));",
    "    }",
    "    if (node.tagName === 'A' && node.getAttribute('target') === '_blank') node.setAttribute('target', '_self');",
    "    if (node.tagName === 'A' && node.getAttribute('href') && node.getAttribute('href').startsWith(proxyPrefix + '/http') && !node.dataset.remoteProxyBound) {",
    "      node.dataset.remoteProxyBound = 'true';",
    "      node.addEventListener('click', (event) => {",
    "        const normalClick = event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;",
    "        if (!normalClick) return;",
    "        event.preventDefault();",
    "        event.stopImmediatePropagation();",
    "        document.documentElement.dataset.remoteProxyLastClick = node.getAttribute('href');",
    "        location.href = node.getAttribute('href');",
    "      }, true);",
    "    }",
    "  }",
    "  function rewriteTree(root) {",
    "    rewriteNode(root);",
    "    if (root.querySelectorAll) root.querySelectorAll('[href], [src], [action], [poster], [srcset], [data-src], [data-href], [data-media-src], [data-lottie]').forEach(rewriteNode);",
    "  }",
    "  document.addEventListener('click', (event) => {",
    "    const anchor = event.target.closest && event.target.closest('a[href]');",
    "    if (!anchor) return;",
    "    const next = toProxy(anchor.getAttribute('href'));",
    "    if (next && next !== anchor.getAttribute('href')) {",
    "      anchor.setAttribute('href', next);",
    "      if (anchor.target === '_blank') anchor.target = '_self';",
    "    }",
    "    const normalClick = event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;",
    "    if (normalClick && next && next.startsWith(proxyPrefix + '/http')) {",
    "      event.preventDefault();",
    "      event.stopImmediatePropagation();",
    "      location.href = next;",
    "    }",
    "  }, true);",
    "  document.addEventListener('submit', (event) => {",
    "    if (event.target && event.target.matches('form[action]')) event.target.setAttribute('action', toProxy(event.target.getAttribute('action')));",
    "  }, true);",
    "  rewriteTree(document.documentElement);",
    "  document.documentElement.dataset.remoteProxyHelper = 'loaded';",
    "  new MutationObserver((mutations) => {",
    "    for (const mutation of mutations) for (const node of mutation.addedNodes) rewriteTree(node);",
    "  }).observe(document.documentElement, { childList: true, subtree: true });",
    "})();",
    "</script>",
  ].join("\n");
}

function injectedOpenClickyWeb() {
  const cursorUrl = "http://localhost:" + PORT + CLICKY_CURSOR_PATH;
  const calUrl = escapeAttr(CAL_EMBED_URL);
  const tokenServerUrl = escapeAttr(TOKEN_SERVER_URL);
  const liveKitRoom = escapeAttr(LIVEKIT_ROOM);
  return `
<div id="ocw-root" aria-live="polite">
  <style>
    #ocw-root, #ocw-root *, #ocw-root *::before, #ocw-root *::after { box-sizing: border-box; }
    #ocw-root {
      position: fixed; inset: 0; z-index: 2147483646; pointer-events: none;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      -webkit-font-smoothing: antialiased; color: #111827; line-height: 1.35;
    }
    #ocw-root button, #ocw-root input { font: inherit; }

    .ocw-panel {
      position: fixed; right: 18px; top: 18px; width: 326px; max-width: calc(100vw - 36px);
      pointer-events: auto; background: rgba(255, 255, 255, 0.94);
      border: 1px solid rgba(17, 24, 39, 0.12); border-radius: 8px;
      box-shadow: 0 20px 50px rgba(15, 23, 42, 0.18), 0 2px 10px rgba(15, 23, 42, 0.08);
      backdrop-filter: blur(14px); overflow: hidden; max-height: calc(100vh - 36px);
    }
    .ocw-head {
      display: flex; align-items: center; gap: 10px; padding: 13px 14px 11px;
      border-bottom: 1px solid rgba(17, 24, 39, 0.09); background: rgba(249, 250, 251, 0.82);
    }
    .ocw-mark {
      width: 24px; height: 31px; flex: 0 0 auto; object-fit: contain;
      filter: drop-shadow(0 3px 7px rgba(5, 100, 255, 0.28));
    }
    .ocw-title { min-width: 0; }
    .ocw-title strong { display: block; font-size: 13px; font-weight: 760; color: #111827; }
    .ocw-title span { display: block; margin-top: 1px; font-size: 11px; color: #6b7280; }
    .ocw-body { padding: 12px 12px 13px; max-height: calc(100vh - 96px); overflow-y: auto; }
    .ocw-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .ocw-action {
      min-height: 38px; border: 1px solid rgba(17, 24, 39, 0.12); border-radius: 8px;
      background: #fff; color: #111827; cursor: pointer; font-size: 12px; font-weight: 650;
      transition: transform 0.14s ease, border-color 0.14s ease, box-shadow 0.14s ease, background 0.14s ease;
    }
    .ocw-action:hover { transform: translateY(-1px); border-color: rgba(5, 100, 255, 0.45); box-shadow: 0 7px 18px rgba(15, 23, 42, 0.1); }
    .ocw-action:active { transform: translateY(0); }
    .ocw-action.primary { grid-column: span 2; background: #0564ff; color: #fff; border-color: #0564ff; box-shadow: 0 10px 22px rgba(5, 100, 255, 0.26); }
    .ocw-command { display: grid; grid-template-columns: 1fr auto; gap: 8px; margin-top: 10px; }
    .ocw-input {
      width: 100%; min-width: 0; height: 38px; border-radius: 8px; border: 1px solid rgba(17, 24, 39, 0.14);
      padding: 0 10px; color: #111827; background: #fff; font-size: 12px; outline: none;
    }
    .ocw-input:focus { border-color: rgba(5, 100, 255, 0.65); box-shadow: 0 0 0 3px rgba(5, 100, 255, 0.14); }
    .ocw-run {
      height: 38px; padding: 0 12px; border-radius: 8px; border: 0; background: #111827; color: #fff;
      cursor: pointer; font-size: 12px; font-weight: 720;
    }
    .ocw-bridge {
      margin-top: 10px; padding: 10px; border-radius: 8px;
      border: 1px solid rgba(17, 24, 39, 0.10); background: rgba(239, 246, 255, 0.68);
    }
    .ocw-agent-state {
      display: flex; align-items: center; gap: 7px; margin-bottom: 8px;
      color: #334155; font-size: 11px; font-weight: 680;
    }
    .ocw-agent-dot {
      width: 8px; height: 8px; border-radius: 999px; background: #94a3b8;
      box-shadow: 0 0 0 3px rgba(148, 163, 184, 0.18);
    }
    #ocw-root[data-agent-state="online"] .ocw-agent-dot {
      background: #16a34a; box-shadow: 0 0 0 3px rgba(22, 163, 74, 0.18);
    }
    #ocw-root[data-agent-state="waiting"] .ocw-agent-dot {
      background: #f59e0b; box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.18);
    }
    .ocw-bridge-actions { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 7px; }
    .ocw-bridge-actions button {
      min-height: 34px; border: 1px solid rgba(17, 24, 39, 0.12); border-radius: 8px;
      background: #fff; color: #111827; cursor: pointer; font-size: 11px; font-weight: 730;
    }
    .ocw-bridge-actions button:hover { border-color: rgba(5, 100, 255, 0.45); }
    .ocw-size {
      margin-top: 10px; padding: 9px 10px 10px; border-radius: 8px;
      border: 1px solid rgba(17, 24, 39, 0.10); background: rgba(249, 250, 251, 0.82);
    }
    .ocw-size-row {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      margin-bottom: 6px; font-size: 11px; color: #6b7280;
    }
    .ocw-size-row strong { color: #374151; font-size: 11px; font-weight: 720; }
    .ocw-size-value {
      min-width: 42px; text-align: right; color: #111827; font-size: 11px; font-weight: 760;
      font-variant-numeric: tabular-nums;
    }
    .ocw-size-slider {
      display: block; width: 100%; height: 18px; margin: 0; accent-color: #0564ff; cursor: pointer;
    }
    .ocw-status {
      margin-top: 10px; min-height: 18px; font-size: 11px; color: #4b5563;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .ocw-transcript {
      margin: 0 0 10px; min-height: 54px; padding: 10px 11px; border-radius: 8px;
      border: 1px solid rgba(17, 24, 39, 0.10); background: rgba(249, 250, 251, 0.88);
      color: #253041; font-size: 12px; line-height: 1.45;
    }

    .ocw-cursor {
      --ocw-cursor-scale: 1;
      --ocw-cursor-width: calc(24px * var(--ocw-cursor-scale));
      --ocw-cursor-height: calc(31px * var(--ocw-cursor-scale));
      position: fixed; left: 0; top: 0;
      width: var(--ocw-cursor-width); height: var(--ocw-cursor-height); pointer-events: none;
      transform: translate3d(calc(100vw - 90px), calc(100vh - 92px), 0);
      transition: transform 720ms cubic-bezier(0.2, 0.9, 0.18, 1), filter 180ms ease;
      will-change: transform; filter: drop-shadow(0 7px 14px rgba(5, 100, 255, 0.28));
    }
    .ocw-cursor img,
    .ocw-cursor .replaced-svg,
    .ocw-cursor svg {
      display: block; width: 100%; height: 100%; object-fit: contain;
      pointer-events: none; user-select: none; overflow: visible;
    }
    .ocw-cursor.is-pressing { filter: drop-shadow(0 4px 8px rgba(5, 100, 255, 0.22)); transition-duration: 90ms; }
    .ocw-cursor.is-pressing img,
    .ocw-cursor.is-pressing .replaced-svg,
    .ocw-cursor.is-pressing svg { transform: scale(0.92); transform-origin: 50% 50%; }

    .ocw-caption {
      position: fixed; left: 0; top: 0; max-width: min(310px, calc(100vw - 28px));
      pointer-events: none; padding: 8px 11px; border-radius: 8px;
      background: rgba(17, 24, 39, 0.92); color: #fff; font-size: 12px; font-weight: 650;
      box-shadow: 0 12px 24px rgba(15, 23, 42, 0.2); opacity: 0;
      transform: translate3d(-999px, -999px, 0) translateY(5px);
      transition: opacity 150ms ease, transform 720ms cubic-bezier(0.2, 0.9, 0.18, 1);
    }
    .ocw-caption.is-visible { opacity: 1; transform: var(--ocw-caption-transform); }

    .ocw-highlight {
      position: fixed; left: 0; top: 0; pointer-events: none; opacity: 0;
      border: 2px solid #0564ff; border-radius: 10px; background: rgba(5, 100, 255, 0.08);
      box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.08), 0 0 0 7px rgba(5, 100, 255, 0.16);
      transition: opacity 160ms ease, transform 360ms ease, width 360ms ease, height 360ms ease;
    }
    .ocw-highlight.is-visible { opacity: 1; }

    .ocw-scheduler {
      position: fixed; right: 18px; bottom: 18px; width: 520px; max-width: calc(100vw - 36px);
      pointer-events: auto; background: #fff; border: 1px solid rgba(17, 24, 39, 0.12); border-radius: 8px;
      box-shadow: 0 22px 56px rgba(15, 23, 42, 0.22); opacity: 0; transform: translateY(12px) scale(0.98);
      visibility: hidden; transition: opacity 180ms ease, transform 180ms ease, visibility 180ms;
      overflow: hidden;
    }
    .ocw-scheduler.is-open { opacity: 1; transform: translateY(0) scale(1); visibility: visible; }
    .ocw-scheduler-head {
      display: flex; align-items: center; justify-content: space-between; gap: 10px;
      padding: 13px 14px; border-bottom: 1px solid rgba(17, 24, 39, 0.09);
    }
    .ocw-scheduler-head strong { font-size: 13px; color: #111827; }
    .ocw-close {
      width: 30px; height: 30px; display: inline-flex; align-items: center; justify-content: center;
      border: 1px solid rgba(17, 24, 39, 0.1); border-radius: 8px; background: #fff; cursor: pointer;
      color: #374151;
    }
    .ocw-scheduler-body { padding: 14px; }
    .ocw-cal-frame {
      display: block; width: 100%; height: min(640px, calc(100vh - 180px)); min-height: 420px;
      border: 1px solid rgba(17, 24, 39, 0.10); border-radius: 8px; background: #fff;
    }
    .ocw-scheduler-body p { margin: 0; font-size: 12px; color: #4b5563; }
    .ocw-cal-link {
      display: inline-flex; margin-top: 8px; color: #0564ff; font-size: 12px; font-weight: 700;
      text-decoration: none;
    }

    .ocw-booking-prompt {
      position: fixed; right: 18px; bottom: 18px; width: 360px; max-width: calc(100vw - 36px);
      pointer-events: auto; padding: 14px; background: #fff; border: 1px solid rgba(17, 24, 39, 0.12);
      border-radius: 8px; box-shadow: 0 20px 46px rgba(15, 23, 42, 0.18);
      opacity: 0; transform: translateY(10px) scale(0.98); visibility: hidden;
      transition: opacity 160ms ease, transform 160ms ease, visibility 160ms;
    }
    .ocw-booking-prompt.is-open { opacity: 1; transform: translateY(0) scale(1); visibility: visible; }
    .ocw-booking-prompt strong { display: block; margin-bottom: 6px; font-size: 13px; color: #111827; }
    .ocw-booking-prompt p { margin: 0 0 12px; color: #4b5563; font-size: 12px; line-height: 1.4; }
    .ocw-prompt-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .ocw-prompt-actions button {
      min-height: 38px; border-radius: 8px; border: 1px solid rgba(17, 24, 39, 0.12);
      background: #fff; color: #111827; cursor: pointer; font-size: 12px; font-weight: 720;
    }
    .ocw-prompt-actions .primary { background: #0564ff; border-color: #0564ff; color: #fff; }

    @media (max-width: 700px) {
      .ocw-panel { left: 12px; right: 12px; top: 12px; width: auto; }
      .ocw-scheduler { left: 12px; right: 12px; bottom: 12px; width: auto; }
      .ocw-booking-prompt { left: 12px; right: 12px; bottom: 12px; width: auto; }
    }
  </style>

  <div class="ocw-cursor" aria-hidden="true">
    <img src="${cursorUrl}" alt="" />
  </div>
  <div class="ocw-caption" role="status"></div>
  <div class="ocw-highlight" aria-hidden="true"></div>

  <section class="ocw-panel" aria-label="OpenClicky Web MVP controls">
    <div class="ocw-head">
      <img class="ocw-mark" src="${cursorUrl}" alt="" aria-hidden="true" />
      <div class="ocw-title">
        <strong>Remote AI guide</strong>
        <span>Voice-ready website co-pilot</span>
      </div>
    </div>
    <div class="ocw-body">
      <p class="ocw-transcript">Ask how Remote helps with global payroll and I will guide the page while answering.</p>
      <div class="ocw-bridge" data-token-server="${tokenServerUrl}" data-livekit-room="${liveKitRoom}">
        <div class="ocw-agent-state"><span class="ocw-agent-dot"></span><span class="ocw-agent-copy">Simulated agent bridge offline</span></div>
        <div class="ocw-bridge-actions">
          <button data-ocw-action="connectagent" type="button">Connect</button>
          <button data-ocw-action="askagent" type="button">Ask agent</button>
          <button data-ocw-action="simulatevoice" type="button">Sim voice</button>
        </div>
      </div>
      <form class="ocw-command">
        <input class="ocw-input" value="How does Remote help with global payroll?" autocomplete="off" aria-label="Voice guide command" />
        <button class="ocw-run" type="submit">Run</button>
      </form>
      <div class="ocw-grid">
        <button class="ocw-action primary" data-ocw-action="payrollflow" type="button">Deterministic fallback</button>
        <button class="ocw-action" data-ocw-action="showbookingprompt" type="button">Book meeting</button>
        <button class="ocw-action" data-ocw-action="payroll" type="button">Show payroll</button>
        <button class="ocw-action" data-ocw-action="snapshot" type="button">Snapshot</button>
      </div>
      <div class="ocw-size">
        <div class="ocw-size-row">
          <strong>Cursor size</strong>
          <output class="ocw-size-value" for="ocw-size-slider">100%</output>
        </div>
        <input id="ocw-size-slider" class="ocw-size-slider" type="range" min="65" max="185" step="1" value="100" aria-label="Cursor size" />
      </div>
      <div class="ocw-status">Ready.</div>
    </div>
  </section>

  <section class="ocw-scheduler" aria-label="Scheduling preview">
    <div class="ocw-scheduler-head">
      <strong>Schedule a Remote walkthrough</strong>
      <button class="ocw-close" data-ocw-action="closeSchedule" type="button" aria-label="Close scheduler">x</button>
    </div>
    <div class="ocw-scheduler-body">
      <iframe class="ocw-cal-frame" data-src="${calUrl}" title="Cal.com scheduling"></iframe>
      <a class="ocw-cal-link" href="${calUrl}" target="_blank" rel="noreferrer">Open scheduler in a new tab</a>
    </div>
  </section>

  <section class="ocw-booking-prompt" aria-label="Booking confirmation">
    <strong>Want to book a walkthrough?</strong>
    <p>I can open the scheduler in this page so you can choose a time with a Remote specialist.</p>
    <div class="ocw-prompt-actions">
      <button class="primary" data-ocw-action="confirmBooking" type="button">Yes, open Cal</button>
      <button data-ocw-action="dismissBookingPrompt" type="button">Not now</button>
    </div>
  </section>

  <script>
  (function(){
    if (window.__ocwInit) return; window.__ocwInit = true;

    var root = document.getElementById('ocw-root');
    if (!root) return;

    var cursor = root.querySelector('.ocw-cursor');
    var caption = root.querySelector('.ocw-caption');
    var highlight = root.querySelector('.ocw-highlight');
    var status = root.querySelector('.ocw-status');
    var transcript = root.querySelector('.ocw-transcript');
    var scheduler = root.querySelector('.ocw-scheduler');
    var bookingPrompt = root.querySelector('.ocw-booking-prompt');
    var bridgePanel = root.querySelector('.ocw-bridge');
    var agentCopy = root.querySelector('.ocw-agent-copy');
    var commandInput = root.querySelector('.ocw-input');
    var sizeSlider = root.querySelector('.ocw-size-slider');
    var sizeValue = root.querySelector('.ocw-size-value');
    var current = { x: Math.max(24, window.innerWidth - 92), y: Math.max(24, window.innerHeight - 92) };
    var actionLock = Promise.resolve();
    var sizeStorageKey = 'openClickyWebMvp.cursorSizePercent';
    var events = [];
    var remoteBasePath = '/__remote/https/remote.com';
    var tokenServerUrl = (bridgePanel && bridgePanel.dataset.tokenServer) || 'http://127.0.0.1:4301';
    var liveKitRoom = (bridgePanel && bridgePanel.dataset.livekitRoom) || 'inboundnow-local';
    var bridgeSocket = null;
    var bridgeReady = false;
    var liveKitClientModulePromise = null;
    var liveKitRoomInstance = null;
    var liveKitReady = false;
    var transportMode = 'idle';
    var controlTopic = 'inboundnow.control.v1';
    var browserIdentity = 'browser-' + Math.random().toString(36).slice(2, 10);
    var textEncoder = new TextEncoder();
    var textDecoder = new TextDecoder();
    var bookingState = 'none';

    var specs = {
      demo: [
        { selector: 'a[href],button,[role="button"]', text: ['book a demo', 'request demo', 'get a demo'], href: ['demo', 'request'] }
      ],
      payroll: [
        { selector: 'a[href],button,[role="button"]', text: ['global payroll', 'run payroll', 'payroll'], href: ['payroll'] },
        { selector: 'h1,h2,h3,h4,section,p,span,div', text: ['global payroll', 'run payroll', 'payroll'], href: ['payroll'] }
      ],
      country: [
        { selector: 'a[href],button,[role="button"]', text: ['country explorer', 'country', 'explorer'], href: ['country'] },
        { selector: 'h1,h2,h3,h4,section,p,span,div', text: ['country explorer', 'country', 'explorer'], href: ['country'] }
      ],
      pricing: [
        { selector: 'a[href],button,[role="button"]', text: ['pricing', 'price'], href: ['pricing'] },
        { selector: 'h1,h2,h3,h4,section,p,span,div', text: ['pricing', 'price'], href: ['pricing'] }
      ],
      eor: [
        { selector: 'a[href],button,[role="button"]', text: ['employer of record', 'eor'], href: ['employer-of-record', 'eor'] },
        { selector: 'h1,h2,h3,h4,section,p,span,div', text: ['employer of record', 'eor'], href: ['employer-of-record', 'eor'] }
      ]
    };

    function sleep(ms) {
      return new Promise(function(resolve){ window.setTimeout(resolve, ms); });
    }

    function setStatus(text) {
      if (status) status.textContent = text;
    }

    function emit(type, detail) {
      var event = {
        type: type,
        detail: detail || {},
        ts: new Date().toISOString()
      };
      events.push(event);
      if (events.length > 80) events.shift();
      try { window.dispatchEvent(new CustomEvent('openClickyWeb:event', { detail: event })); } catch (e) {}
      try {
        sendAgentMessage({ type: 'browser.event', event: event, bookingState: bookingState });
      } catch (e) {}
      return event;
    }

    function updateTranscript(text) {
      if (transcript) transcript.textContent = text;
    }

    function speak(text) {
      updateTranscript(text);
      window.__ocwLastSpeech = text;
      showCaption(text, current.x, current.y);
      try {
        if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
        window.speechSynthesis.cancel();
        var utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'en-US';
        utterance.rate = 1.03;
        window.speechSynthesis.speak(utterance);
      } catch (e) {}
    }

    function setAgentState(state, text) {
      root.dataset.agentState = state;
      if (agentCopy) agentCopy.textContent = text;
    }

    function bridgeWsUrl() {
      var url = new URL(tokenServerUrl);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      url.pathname = '/agent-bridge';
      url.search = new URLSearchParams({
        role: 'browser',
        room: liveKitRoom,
        identity: browserIdentity
      }).toString();
      return url.href;
    }

    async function fetchLocalToken() {
      var url = new URL('/token', tokenServerUrl);
      url.search = new URLSearchParams({
        role: 'browser',
        room: liveKitRoom,
        identity: browserIdentity
      }).toString();
      var response = await fetch(url.href);
      if (!response.ok) throw new Error('Token server returned ' + response.status);
      var payload = await response.json();
      window.__ocwLiveKitToken = payload;
      return payload;
    }

    function loadLiveKitClient() {
      if (!liveKitClientModulePromise) {
        liveKitClientModulePromise = import('/__ocw-assets/livekit-client.esm.mjs');
      }
      return liveKitClientModulePromise;
    }

    async function connectLiveKitRoom() {
      if (liveKitReady && liveKitRoomInstance) return liveKitRoomInstance;

      setAgentState('waiting', 'Connecting local LiveKit room...');
      var tokenPayload = await fetchLocalToken();
      var livekit = await loadLiveKitClient();
      var Room = livekit.Room;
      var RoomEvent = livekit.RoomEvent;
      var room = new Room({ adaptiveStream: false, dynacast: false });
      liveKitRoomInstance = room;

      room.on(RoomEvent.DataReceived, function(payload, participant, kind, topic){
        if (topic && topic !== controlTopic) return;
        try {
          handleAgentMessage(textDecoder.decode(payload));
        } catch (e) {
          emit('liveKitMessageFailed', { message: e.message || String(e) });
        }
      });

      room.on(RoomEvent.Disconnected, function(){
        liveKitReady = false;
        if (transportMode === 'livekit') setAgentState('offline', 'LiveKit room disconnected');
      });

      await room.connect(tokenPayload.livekitUrl, tokenPayload.token);

      try {
        await room.startAudio();
      } catch (e) {
        emit('liveKitAudioStartSkipped', { message: e.message || String(e) });
      }

      try {
        await room.localParticipant.setMicrophoneEnabled(true, {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        });
        emit('liveKitMicPublished', { room: liveKitRoom, identity: browserIdentity });
      } catch (e) {
        emit('liveKitMicPublishFailed', { message: e.message || String(e) });
      }

      liveKitReady = true;
      transportMode = 'livekit';
      bridgeReady = true;
      setAgentState('waiting', 'LiveKit connected; waiting for local agent worker.');
      emit('liveKitConnected', { room: liveKitRoom, livekitUrl: tokenPayload.livekitUrl, identity: browserIdentity });
      return room;
    }

    function connectAgentBridge() {
      if (bridgeSocket && (bridgeSocket.readyState === WebSocket.OPEN || bridgeSocket.readyState === WebSocket.CONNECTING)) {
        return Promise.resolve(bridgeSocket);
      }

      setAgentState('waiting', 'Connecting local simulated agent bridge...');
      return fetchLocalToken().then(function(tokenPayload){
        return new Promise(function(resolve, reject){
          var socket = new WebSocket(bridgeWsUrl());
          bridgeSocket = socket;
          socket.addEventListener('open', function(){
            bridgeReady = true;
            transportMode = 'bridge';
            setAgentState('waiting', 'Bridge connected; waiting for local agent worker.');
            emit('bridgeConnected', { room: liveKitRoom, livekitUrl: tokenPayload.livekitUrl });
            resolve(socket);
          });
          socket.addEventListener('message', function(event){
            handleAgentMessage(event.data);
          });
          socket.addEventListener('close', function(){
            bridgeReady = false;
            setAgentState('offline', 'Simulated agent bridge offline');
          });
          socket.addEventListener('error', function(){
            bridgeReady = false;
            setAgentState('offline', 'Could not reach token server bridge');
            reject(new Error('Bridge connection failed'));
          });
        });
      }).catch(function(error){
        setAgentState('offline', error.message || 'Token server unavailable');
        throw error;
      });
    }

    async function connectAgentTransport() {
      if (liveKitReady && liveKitRoomInstance) return liveKitRoomInstance;
      if (bridgeSocket && bridgeSocket.readyState === WebSocket.OPEN) return bridgeSocket;

      try {
        return await connectLiveKitRoom();
      } catch (liveKitError) {
        liveKitReady = false;
        liveKitRoomInstance = null;
        emit('liveKitConnectFailed', { message: liveKitError.message || String(liveKitError) });
        setStatus('LiveKit unavailable; falling back to simulated bridge.');
        return connectAgentBridge();
      }
    }

    function sendBridge(payload) {
      if (!bridgeSocket || bridgeSocket.readyState !== WebSocket.OPEN) {
        throw new Error('Agent bridge is not connected');
      }
      bridgeSocket.send(JSON.stringify(payload));
    }

    function sendLiveKitMessage(payload) {
      if (!liveKitReady || !liveKitRoomInstance) {
        throw new Error('LiveKit room is not connected');
      }
      return liveKitRoomInstance.localParticipant.publishData(textEncoder.encode(JSON.stringify(payload)), {
        reliable: true,
        topic: controlTopic
      });
    }

    function sendAgentMessage(payload) {
      if (liveKitReady && liveKitRoomInstance) {
        return sendLiveKitMessage(payload);
      }
      return sendBridge(payload);
    }

    function handleAgentMessage(raw) {
      var message;
      try {
        message = JSON.parse(raw);
      } catch (e) {
        return;
      }

      if (message.type === 'bridge.ready') {
        setAgentState(message.peers && message.peers.agents ? 'online' : 'waiting', message.peers && message.peers.agents ? 'Local agent ready' : 'Bridge connected; waiting for local agent worker.');
        return;
      }

      if (message.type === 'bridge.peer_joined' && message.role === 'agent') {
        setAgentState('online', 'Local agent worker connected');
        return;
      }

      if (message.type === 'bridge.peer_left' && message.role === 'agent') {
        setAgentState('waiting', 'Agent disconnected; bridge still online');
        return;
      }

      if (message.type === 'agent.status') {
        setAgentState(message.status === 'online' ? 'online' : 'waiting', message.message || message.status || 'Agent status updated');
        return;
      }

      if (message.type === 'agent.answer') {
        setAgentState('online', message.transport === 'livekit' ? 'LiveKit agent answered' : 'Local agent ready');
        updateTranscript(message.answer || '');
        setStatus(message.simulated ? 'Agent answered in simulated mode.' : 'Agent answered.');
        emit('agentAnswerReceived', { intent: message.intent || '', simulated: !!message.simulated });
        return;
      }

      if (message.type === 'agent.action' && message.action) {
        setAgentState('online', message.transport === 'livekit' ? 'LiveKit agent action received' : 'Local agent ready');
        enqueue(message.action);
      }
    }

    function handleBridgeMessage(raw) {
      return handleAgentMessage(raw);
    }

    async function askLocalAgent(simulatedVoice) {
      var question = commandInput.value || 'How does Remote help with global payroll?';
      await connectAgentTransport();
      var snapshot = snapshotPage();
      updateTranscript((simulatedVoice ? 'Simulated voice transcript: ' : 'You asked: ') + question);
      setStatus('Sent question to local agent over ' + (liveKitReady ? 'LiveKit data channel.' : 'simulated bridge.'));
      await sendAgentMessage({
        id: 'q_' + Math.random().toString(36).slice(2, 10),
        type: 'prospect.question',
        question: question,
        simulatedVoice: !!simulatedVoice,
        transport: liveKitReady ? 'livekit' : 'bridge',
        pageSnapshot: {
          url: snapshot.url,
          title: snapshot.title,
          headings: snapshot.headings.slice(0, 12),
          ctas: snapshot.ctas.slice(0, 20),
          navLinks: snapshot.navLinks.slice(0, 12),
        },
        bookingState: bookingState,
      });
    }

    function clampSizePercent(value) {
      var numeric = Number(value);
      if (!Number.isFinite(numeric)) numeric = 100;
      return Math.min(185, Math.max(65, Math.round(numeric)));
    }

    function setCursorSizePercent(value, persist) {
      var percent = clampSizePercent(value);
      var scale = percent / 100;
      cursor.style.setProperty('--ocw-cursor-scale', String(scale));
      if (sizeSlider) sizeSlider.value = String(percent);
      if (sizeValue) sizeValue.textContent = percent + '%';
      if (persist) {
        try { window.localStorage.setItem(sizeStorageKey, String(percent)); } catch (e) {}
      }
      return percent;
    }

    setCursorSizePercent((function(){
      try { return window.localStorage.getItem(sizeStorageKey) || 100; } catch (e) { return 100; }
    })(), false);

    if (sizeSlider) {
      sizeSlider.addEventListener('input', function(event){
        var percent = setCursorSizePercent(event.target.value, true);
        setStatus('Cursor size set to ' + percent + '%.');
        moveCursor(current.x, current.y, caption.textContent, 80);
      });
    }

    function normalized(value) {
      return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    function compactText(value, maxLength) {
      var text = String(value || '').replace(/\s+/g, ' ').trim();
      var max = maxLength || 180;
      return text.length > max ? text.slice(0, max - 1) + '...' : text;
    }

    function isOurUi(element) {
      return !!(element && element.closest && element.closest('#ocw-root'));
    }

    function isVisible(element) {
      if (!element || isOurUi(element)) return false;
      var style = window.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
      var rect = element.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return false;
      if (rect.bottom < -100 || rect.top > window.innerHeight + 100 || rect.right < -100 || rect.left > window.innerWidth + 100) {
        return !!element.textContent;
      }
      return true;
    }

    function elementText(element) {
      var direct = normalized(element.innerText || element.textContent || '');
      if (direct.length > 180) direct = direct.slice(0, 180);
      return direct;
    }

    function scoreElement(element, rule) {
      if (!isVisible(element)) return -1;
      var text = elementText(element);
      var href = normalized(element.getAttribute && (element.getAttribute('href') || element.getAttribute('data-href') || ''));
      var aria = normalized(element.getAttribute && (element.getAttribute('aria-label') || element.getAttribute('title') || ''));
      var combined = text + ' ' + aria + ' ' + href;
      var score = 0;

      (rule.text || []).forEach(function(term, index){
        var value = normalized(term);
        if (!value) return;
        if (text === value || aria === value) score += 180 - index * 8;
        else if (text.indexOf(value) >= 0 || aria.indexOf(value) >= 0) score += 110 - index * 6;
        else if (combined.indexOf(value) >= 0) score += 38;
      });
      (rule.href || []).forEach(function(term){
        if (href.indexOf(normalized(term)) >= 0) score += 70;
      });

      if (element.matches && element.matches('a[href],button,[role="button"]')) score += 24;
      if (element.matches && element.matches('h1,h2,h3,h4')) score += 10;

      var rect = element.getBoundingClientRect();
      if (rect.top >= 0 && rect.top <= window.innerHeight) score += 16;
      if (rect.width > 20 && rect.height > 12) score += 4;

      return score;
    }

    function findTarget(key) {
      var rules = specs[key] || [];
      var best = null;

      rules.forEach(function(rule){
        var candidates = Array.prototype.slice.call(document.querySelectorAll(rule.selector || 'a,button,[role="button"]'));
        candidates.forEach(function(element){
          var score = scoreElement(element, rule);
          if (score <= 0) return;
          var rect = element.getBoundingClientRect();
          var rank = score - Math.max(0, rect.top) / 5000;
          if (!best || rank > best.rank) best = { element: element, rank: rank, score: score };
        });
      });

      return best && best.element;
    }

    function targetLabel(element, fallback) {
      var text = elementText(element);
      if (text) return text.length > 48 ? text.slice(0, 45) + '...' : text;
      return fallback;
    }

    function viewportPointFor(element) {
      var rect = element.getBoundingClientRect();
      var x = rect.left + Math.min(Math.max(rect.width * 0.5, 14), Math.max(14, rect.width - 12));
      var y = rect.top + Math.min(Math.max(rect.height * 0.5, 12), Math.max(12, rect.height - 10));
      return {
        x: Math.round(Math.max(12, Math.min(window.innerWidth - 16, x))),
        y: Math.round(Math.max(12, Math.min(window.innerHeight - 16, y))),
        rect: rect
      };
    }

    function showCaption(text, x, y) {
      caption.textContent = text || '';
      var left = Math.max(12, Math.min(window.innerWidth - 320, x + 22));
      var top = Math.max(12, Math.min(window.innerHeight - 54, y + 18));
      caption.style.setProperty('--ocw-caption-transform', 'translate3d(' + left + 'px, ' + top + 'px, 0)');
      caption.classList.toggle('is-visible', !!text);
    }

    function moveCursor(x, y, label, duration) {
      current = { x: x, y: y };
      cursor.style.transitionDuration = String(duration || 720) + 'ms';
      var width = cursor.offsetWidth || 24;
      var height = cursor.offsetHeight || 31;
      cursor.style.transform = 'translate3d(' + Math.round(x - width / 2) + 'px, ' + Math.round(y - height / 2) + 'px, 0)';
      showCaption(label, x, y);
      return sleep((duration || 720) + 80);
    }

    function showHighlight(element) {
      var rect = element.getBoundingClientRect();
      var pad = 8;
      highlight.style.width = Math.round(rect.width + pad * 2) + 'px';
      highlight.style.height = Math.round(rect.height + pad * 2) + 'px';
      highlight.style.transform = 'translate3d(' + Math.round(rect.left - pad) + 'px, ' + Math.round(rect.top - pad) + 'px, 0)';
      highlight.classList.add('is-visible');
    }

    function clearHighlight() {
      highlight.classList.remove('is-visible');
    }

    function ensureElementId(element) {
      if (!element || !element.setAttribute) return '';
      if (!element.dataset.ocwId) {
        element.dataset.ocwId = 'ocw_' + Math.random().toString(36).slice(2, 9);
      }
      return element.dataset.ocwId;
    }

    function elementSummary(element) {
      if (!element || !element.getBoundingClientRect) return null;
      var rect = element.getBoundingClientRect();
      return {
        id: ensureElementId(element),
        tag: (element.tagName || '').toLowerCase(),
        role: element.getAttribute('role') || '',
        label: compactText(element.getAttribute('aria-label') || element.getAttribute('title') || '', 120),
        text: compactText(element.innerText || element.textContent || '', 180),
        href: element.getAttribute('href') || element.getAttribute('data-href') || '',
        bounds: {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        },
        visible: isVisible(element)
      };
    }

    function collectElements(selector, limit) {
      return Array.prototype.slice.call(document.querySelectorAll(selector))
        .filter(isVisible)
        .slice(0, limit)
        .map(elementSummary)
        .filter(Boolean);
    }

    function snapshotPage() {
      var textNodes = collectElements('main p, main li, section p, h1, h2, h3', 40)
        .map(function(item){ return item.text; })
        .filter(Boolean);
      var snapshot = {
        url: location.href,
        title: document.title,
        headings: collectElements('h1,h2,h3,h4', 30),
        ctas: collectElements('a[href],button,[role="button"]', 60),
        navLinks: collectElements('nav a[href],header a[href]', 40),
        visibleText: textNodes.join(' ').slice(0, 4000),
        elements: collectElements('a[href],button,[role="button"],h1,h2,h3,h4,section', 120),
        viewport: { width: window.innerWidth, height: window.innerHeight, scrollY: Math.round(window.scrollY) }
      };
      window.__ocwLastSnapshot = snapshot;
      emit('snapshotTaken', { counts: {
        headings: snapshot.headings.length,
        ctas: snapshot.ctas.length,
        navLinks: snapshot.navLinks.length,
        elements: snapshot.elements.length
      }});
      return snapshot;
    }

    function resolveTarget(target) {
      if (target && target.nodeType === 1) return target;
      if (typeof target === 'string') {
        var key = normalized(target);
        if (specs[key]) return findTarget(key);
        try {
          var selected = document.querySelector(target);
          if (selected && isVisible(selected)) return selected;
        } catch (e) {}
        return findTarget(key) || resolveTarget({ text: [target] });
      }
      if (!target || typeof target !== 'object') return null;
      if (target.key) return findTarget(target.key);
      if (target.ocwId) {
        var byId = document.querySelector('[data-ocw-id="' + String(target.ocwId).replace(/"/g, '') + '"]');
        if (byId && isVisible(byId)) return byId;
      }

      var rule = {
        selector: target.selector || 'a[href],button,[role="button"],h1,h2,h3,h4,section,p,span,div',
        text: Array.isArray(target.text) ? target.text : (target.text ? [target.text] : []),
        href: Array.isArray(target.href) ? target.href : (target.href ? [target.href] : [])
      };
      if (target.role) rule.text.push(target.role);
      if (target.label) rule.text.push(target.label);

      var best = null;
      var candidates = [];
      try {
        candidates = Array.prototype.slice.call(document.querySelectorAll(rule.selector));
      } catch (e) {
        candidates = [];
      }
      candidates.forEach(function(element){
        var score = rule.text.length || rule.href.length ? scoreElement(element, rule) : (isVisible(element) ? 1 : -1);
        if (score <= 0) return;
        var rect = element.getBoundingClientRect();
        var rank = score - Math.max(0, rect.top) / 5000;
        if (!best || rank > best.rank) best = { element: element, rank: rank };
      });
      return best && best.element;
    }

    async function waitForLayout(element) {
      var last = element.getBoundingClientRect();
      for (var i = 0; i < 8; i += 1) {
        await sleep(120);
        var next = element.getBoundingClientRect();
        if (Math.abs(next.top - last.top) < 2 && Math.abs(next.left - last.left) < 2) return;
        last = next;
      }
    }

    async function scrollToElement(target) {
      var element = resolveTarget(target);
      if (!element) throw new Error('Target not found');
      emit('targetResolved', { target: elementSummary(element) });
      element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      emit('scrollStarted', { target: element.dataset.ocwId || ensureElementId(element) });
      await waitForLayout(element);
      return element;
    }

    async function highlightElement(target) {
      var element = resolveTarget(target);
      if (!element) throw new Error('Target not found');
      showHighlight(element);
      emit('highlightShown', { target: elementSummary(element) });
      return element;
    }

    async function moveToElement(element, label) {
      if (!element) throw new Error('Target not found');
      await scrollToElement(element);
      showHighlight(element);
      var point = viewportPointFor(element);
      await moveCursor(point.x, point.y, label || targetLabel(element, 'Selected target'), 780);
      emit('cursorMoved', { target: elementSummary(element), x: point.x, y: point.y });
      return point;
    }

    async function moveCursorToElement(target, label) {
      var element = resolveTarget(target);
      if (!element) throw new Error('Target not found');
      return moveToElement(element, label);
    }

    function dispatchMouse(element, type, point) {
      var event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: point.x,
        clientY: point.y,
        screenX: point.x,
        screenY: point.y
      });
      element.dispatchEvent(event);
    }

    async function clickElement(element, label) {
      var point = await moveToElement(element, label || 'Clicking ' + targetLabel(element, 'target'));
      cursor.classList.add('is-pressing');
      dispatchMouse(element, 'mouseover', point);
      dispatchMouse(element, 'mousemove', point);
      dispatchMouse(element, 'mousedown', point);
      await sleep(115);
      dispatchMouse(element, 'mouseup', point);
      dispatchMouse(element, 'click', point);
      cursor.classList.remove('is-pressing');

      if (element.tagName === 'A' && element.href) {
        var before = location.href;
        window.setTimeout(function(){
          if (location.href === before) location.href = element.href;
        }, 180);
      }
      await sleep(280);
      emit('clicked', { target: elementSummary(element) });
    }

    function toProxyLocation(rawUrl) {
      if (!rawUrl) return location.href;
      try {
        var url = new URL(rawUrl, location.href);
        if (url.origin === location.origin) return url.href;
        if (/^https?:$/.test(url.protocol)) {
          return location.origin + '/__remote/' + url.protocol.slice(0, -1) + '/' + url.host + url.pathname + url.search + url.hash;
        }
      } catch (e) {
        if (String(rawUrl).charAt(0) === '/') return location.origin + rawUrl;
      }
      return rawUrl;
    }

    function navigate(rawUrl, pendingAction) {
      var next = toProxyLocation(rawUrl);
      if (pendingAction) {
        try { window.sessionStorage.setItem('ocwPendingAction', pendingAction); } catch (e) {}
      }
      emit('navigated', { href: next });
      location.href = next;
    }

    function showBookingPrompt() {
      bookingState = 'prompt_shown';
      if (bookingPrompt) bookingPrompt.classList.add('is-open');
      setStatus('Asked for booking confirmation.');
      showCaption('Would you like to book a walkthrough?', Math.max(32, window.innerWidth - 330), Math.max(32, window.innerHeight - 180));
      emit('bookingPromptShown', {});
    }

    function dismissBookingPrompt() {
      bookingState = 'dismissed';
      if (bookingPrompt) bookingPrompt.classList.remove('is-open');
      setStatus('Booking prompt dismissed.');
    }

    function openScheduler() {
      bookingState = 'cal_opened';
      if (bookingPrompt) bookingPrompt.classList.remove('is-open');
      var frame = scheduler && scheduler.querySelector('.ocw-cal-frame');
      if (frame && !frame.getAttribute('src')) frame.setAttribute('src', frame.getAttribute('data-src') || '');
      scheduler.classList.add('is-open');
      setStatus('Opened Cal.com scheduler.');
      emit('calOpened', {});
    }

    function closeScheduler() {
      scheduler.classList.remove('is-open');
      setStatus('Closed scheduler.');
    }

    async function pointTarget(key, spokenLabel) {
      var element = findTarget(key);
      if (!element) {
        setStatus('Could not find target: ' + key);
        showCaption('I cannot find ' + key + ' on this page yet.', current.x, current.y);
        return false;
      }
      setStatus('Moving to ' + spokenLabel + '.');
      await moveToElement(element, spokenLabel);
      return true;
    }

    var payrollAnswer = 'Remote helps with global payroll by giving companies one place to pay distributed employees, handle local payroll rules, support multiple countries, and keep compliance work connected to hiring and HR operations.';

    async function runPayrollFlow(afterNavigation, answerText) {
      var answer = answerText || payrollAnswer;
      setStatus('Answering global payroll question.');
      snapshotPage();
      speak(answer);
      emit('agentAnswered', { text: answer });
      await sleep(afterNavigation ? 650 : 950);

      var payrollTarget = findTarget('payroll');
      if (!payrollTarget && !afterNavigation) {
        setStatus('Navigating to Remote payroll page.');
        showCaption('I will open the payroll page, then point out the relevant section.', current.x, current.y);
        await sleep(500);
        navigate(remoteBasePath + '/global-payroll', 'payrollFlowAfterNav');
        return;
      }

      if (payrollTarget) {
        await moveToElement(payrollTarget, 'Remote global payroll');
        await sleep(650);
      } else {
        showCaption('I could not find payroll text after navigation, but I can still open scheduling.', current.x, current.y);
      }

      speak('If this is relevant, I can book a walkthrough with a Remote specialist now.');
      await sleep(600);
      showBookingPrompt();
    }

    function runDispatchedAction(action) {
      if (typeof action === 'string') return runAction(action);
      if (!action || typeof action.type !== 'string') throw new Error('Action must include a type');
      emit('queued', { id: action.id || '', type: action.type });

      if (action.type === 'moveCursorToElement') return moveCursorToElement(action.target, action.caption);
      if (action.type === 'highlightElement') return highlightElement(action.target);
      if (action.type === 'scrollToElement') return scrollToElement(action.target);
      if (action.type === 'clickElement') return clickElement(resolveTarget(action.target), action.caption);
      if (action.type === 'navigate') return navigate(action.url || action.href || action.target);
      if (action.type === 'showCaption') {
        showCaption(action.caption || action.text || '', current.x, current.y);
        emit('captionShown', { text: action.caption || action.text || '' });
        return Promise.resolve();
      }
      if (action.type === 'openCal') {
        if (bookingState !== 'confirmed') {
          showBookingPrompt();
          emit('openCalDeferred', { reason: 'booking_not_confirmed' });
          return Promise.resolve();
        }
        openScheduler();
        return Promise.resolve();
      }
      if (action.type === 'showBookingPrompt') {
        showBookingPrompt();
        return Promise.resolve();
      }
      if (action.type === 'snapshotPage') return Promise.resolve(snapshotPage());
      if (action.type === 'payrollFlow') return runPayrollFlow(false, action.answer);
      throw new Error('Unknown action type: ' + action.type);
    }

    async function runAction(action) {
      var key = normalized(action);

      if (
        key === 'payrollflow' ||
        key === 'payroll flow' ||
        key === 'payrollflowafternav' ||
        key.indexOf('how does remote help with global payroll') >= 0
      ) {
        await runPayrollFlow(key === 'payrollflowafternav');
        return;
      }

      if (key === 'snapshot' || key === 'page snapshot') {
        var snapshot = snapshotPage();
        setStatus('Snapshot: ' + snapshot.headings.length + ' headings, ' + snapshot.ctas.length + ' CTAs.');
        showCaption('Snapshot captured for the agent.', current.x, current.y);
        return;
      }

      if (key === 'showbookingprompt' || key === 'book meeting' || key === 'booking prompt') {
        showBookingPrompt();
        return;
      }

      if (key === 'connectagent' || key === 'connect agent') {
        await connectAgentTransport();
        return;
      }

      if (key === 'askagent' || key === 'ask agent') {
        await askLocalAgent(false);
        return;
      }

      if (key === 'simulatevoice' || key === 'sim voice' || key === 'voice') {
        await askLocalAgent(true);
        return;
      }

      if (key === 'confirmbooking') {
        bookingState = 'confirmed';
        try { sendAgentMessage({ type: 'booking.confirmed', state: bookingState }); } catch (e) {}
        openScheduler();
        await moveCursor(Math.max(32, window.innerWidth - 344), Math.max(32, window.innerHeight - 228), 'Cal.com scheduler', 620);
        return;
      }

      if (key === 'dismissbookingprompt') {
        dismissBookingPrompt();
        try { sendAgentMessage({ type: 'booking.dismissed', state: bookingState }); } catch (e) {}
        return;
      }

      if (key === 'tour' || key === 'demo tour' || key === 'guided motion' || key === 'run guided motion') {
        setStatus('Running guided motion.');
        await pointTarget('demo', 'First, this is where a buyer can book a demo.');
        await sleep(500);
        await pointTarget('payroll', 'For payroll questions, I would bring them here.');
        await sleep(500);
        await pointTarget('country', 'For country-specific guidance, this is the explorer.');
        await sleep(500);
        showBookingPrompt();
        await moveCursor(Math.max(32, window.innerWidth - 356), Math.max(32, window.innerHeight - 250), 'Then I can offer scheduling.', 620);
        return;
      }

      if (key === 'demo' || key === 'point demo' || key === 'book demo' || key === 'show demo') {
        await pointTarget('demo', 'Book a demo');
        return;
      }

      if (key === 'payroll' || key === 'show payroll' || key === 'global payroll') {
        await pointTarget('payroll', 'Global payroll');
        return;
      }

      if (key === 'country' || key === 'country explorer' || key === 'show country explorer') {
        await pointTarget('country', 'Country explorer');
        return;
      }

      if (key === 'pricing' || key === 'price' || key === 'show pricing') {
        await pointTarget('pricing', 'Pricing');
        return;
      }

      if (key === 'eor' || key === 'employer of record') {
        await pointTarget('eor', 'Employer of record');
        return;
      }

      if (key === 'clickdemo' || key === 'click demo' || key === 'click book demo') {
        var demo = findTarget('demo');
        if (!demo) {
          setStatus('Could not find demo CTA.');
          return;
        }
        setStatus('Clicking demo CTA.');
        await clickElement(demo, 'Clicking Book a demo');
        return;
      }

      if (key === 'clickpricing' || key === 'click pricing') {
        var pricing = findTarget('pricing');
        if (!pricing) {
          setStatus('Could not find pricing link.');
          return;
        }
        setStatus('Clicking pricing.');
        await clickElement(pricing, 'Clicking pricing');
        return;
      }

      if (key === 'schedule' || key === 'open cal' || key === 'cal' || key === 'calendar') {
        showBookingPrompt();
        await moveCursor(Math.max(32, window.innerWidth - 344), Math.max(32, window.innerHeight - 228), 'Booking prompt', 620);
        return;
      }

      if (key === 'closeschedule' || key === 'close schedule') {
        closeScheduler();
        return;
      }

      setStatus('Unknown action: ' + action);
      showCaption('Try: tour, payroll, pricing, country, click demo, open cal', current.x, current.y);
    }

    function enqueue(action) {
      actionLock = actionLock.then(function(){ return runDispatchedAction(action); }).catch(function(error){
        setStatus(error && error.message ? error.message : String(error));
        emit('failed', { message: error && error.message ? error.message : String(error) });
      });
      return actionLock;
    }

    root.addEventListener('click', function(event){
      var button = event.target.closest && event.target.closest('[data-ocw-action]');
      if (!button) return;
      event.preventDefault();
      var actionName = button.getAttribute('data-ocw-action');
      if (actionName === 'connectagent') {
        connectAgentTransport().catch(function(error){ setStatus(error.message || String(error)); });
        return;
      }
      if (actionName === 'askagent') {
        askLocalAgent(false).catch(function(error){ setStatus(error.message || String(error)); });
        return;
      }
      if (actionName === 'simulatevoice') {
        askLocalAgent(true).catch(function(error){ setStatus(error.message || String(error)); });
        return;
      }
      enqueue(actionName);
    });

    var form = root.querySelector('.ocw-command');
    form.addEventListener('submit', function(event){
      event.preventDefault();
      enqueue(commandInput.value || '');
    });

    window.addEventListener('resize', function(){
      moveCursor(Math.min(current.x, window.innerWidth - 16), Math.min(current.y, window.innerHeight - 16), caption.textContent, 120);
    });

    window.OpenClickyWeb = {
      dispatch: enqueue,
      events: function(){ return events.slice(); },
      snapshotPage: snapshotPage,
      find: findTarget,
      moveCursorToElement: function(target, caption){ return enqueue({ type: 'moveCursorToElement', target: target, caption: caption }); },
      highlightElement: function(target){ return enqueue({ type: 'highlightElement', target: target }); },
      scrollToElement: function(target){ return enqueue({ type: 'scrollToElement', target: target }); },
      clickElement: function(target, caption){ return enqueue({ type: 'clickElement', target: target, caption: caption }); },
      navigate: function(url){ return enqueue({ type: 'navigate', url: url }); },
      showCaption: function(text){ return enqueue({ type: 'showCaption', text: text }); },
      openCal: function(){ return enqueue({ type: 'openCal' }); },
      showBookingPrompt: function(){ return enqueue({ type: 'showBookingPrompt' }); },
      runPayrollFlow: function(){ return enqueue({ type: 'payrollFlow' }); },
      run: enqueue
    };
    window.OpenClickyWebMVP = window.OpenClickyWeb;

    window.setTimeout(function(){
      var pending = '';
      try {
        pending = window.sessionStorage.getItem('ocwPendingAction') || '';
        window.sessionStorage.removeItem('ocwPendingAction');
      } catch (e) {}
      moveCursor(Math.max(28, window.innerWidth - 92), Math.max(28, window.innerHeight - 92), 'Ready to guide.', 420);
      if (pending) {
        enqueue(pending);
      } else {
        window.setTimeout(function(){ caption.classList.remove('is-visible'); }, 1400);
      }
    }, 300);
  })();
  </script>
</div>`;
}

function rewriteHtml(html, baseUrl) {
  let rewritten = html
    .replace(/\s(?:integrity|nonce)=(["']).*?\1/gi, "")
    .replace(/\b(srcset|data-srcset)\s*=\s*(["'])(.*?)\2/gis, (_match, attr, quote, value) => {
      return attr + "=" + quote + escapeAttr(rewriteSrcset(value, baseUrl)) + quote;
    })
    .replace(
      /\b(href|src|action|poster|data-src|data-href|data-media-src|data-lottie|data-background-image)\s*=\s*(["'])(.*?)\2/gis,
      (_match, attr, quote, value) => {
        return attr + "=" + quote + escapeAttr(rewriteUrl(value, baseUrl)) + quote;
      },
    )
    .replace(/\bcontent\s*=\s*(["'])(.*?)\1/gis, (_match, quote, value) => {
      if (!looksUrlish(value)) {
        return "content=" + quote + value + quote;
      }

      return "content=" + quote + escapeAttr(rewriteUrl(value, baseUrl)) + quote;
    })
    .replace(/\bstyle\s*=\s*(["'])(.*?)\1/gis, (_match, quote, value) => {
      return "style=" + quote + escapeAttr(rewriteCss(value, baseUrl)) + quote;
    });

  const helper = injectedHelper(baseUrl);

  if (/<\/head>/i.test(rewritten)) {
    rewritten = rewritten.replace(/<\/head>/i, helper + "</head>");
  } else {
    rewritten = helper + rewritten;
  }

  if (shouldInjectOpenClicky(baseUrl)) {
    // Inject after URL rewriting so the widget's own local asset URLs are left intact.
    const widget = injectedOpenClickyWeb();
    if (/<\/body>/i.test(rewritten)) {
      rewritten = rewritten.replace(/<\/body>/i, widget + "</body>");
    } else {
      rewritten = rewritten + widget;
    }
  }

  return rewritten;
}

function rewriteScript(script, baseUrl) {
  const proxiedOrigin = proxyPathFor(baseUrl.origin + "/").slice(0, -1);
  const escapedOrigin = baseUrl.origin.replaceAll("/", "\\/");
  const escapedProxy = proxiedOrigin.replaceAll("/", "\\/");

  return script
    .replaceAll(baseUrl.origin, proxiedOrigin)
    .replaceAll(escapedOrigin, escapedProxy);
}

function shouldInjectOpenClicky(baseUrl) {
  return baseUrl.hostname === "remote.com" || baseUrl.hostname.endsWith(".remote.com");
}

function rewriteLocalReferrer(value, targetUrl) {
  try {
    const url = new URL(value);
    const parsed = parseProxyPath(url.pathname + url.search);
    return parsed ? parsed.href : targetUrl.origin + "/";
  } catch {
    return targetUrl.origin + "/";
  }
}

function buildUpstreamHeaders(req, targetUrl) {
  const headers = new Headers();

  for (const [name, rawValue] of Object.entries(req.headers)) {
    if (!rawValue) continue;

    const lower = name.toLowerCase();
    if (
      HOP_BY_HOP_HEADERS.has(lower) ||
      lower === "host" ||
      lower === "content-length" ||
      lower === "accept-encoding" ||
      lower === "cookie" ||
      lower === "origin" ||
      lower === "referer" ||
      lower === "priority" ||
      lower.startsWith("sec-")
    ) {
      continue;
    }

    const value = Array.isArray(rawValue) ? rawValue.join(", ") : rawValue;

    headers.set(name, value);
  }

  headers.set("accept-encoding", "identity");
  headers.set(
    "user-agent",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  );

  return headers;
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function splitSetCookie(header) {
  if (!header) {
    return [];
  }

  return header.split(/,(?=\s*[^;=]+=[^;]+)/g);
}

function rewriteCookie(cookie, targetUrl) {
  const path = PREFIX + "/" + targetUrl.protocol.slice(0, -1) + "/" + targetUrl.host;
  const parts = cookie
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !/^domain=/i.test(part))
    .filter((part) => !/^secure$/i.test(part));

  const withoutPath = parts.filter((part) => !/^path=/i.test(part));
  withoutPath.push("Path=" + path);
  return withoutPath.join("; ");
}

function writeProxyHeaders(res, upstream, targetUrl, contentTypeOverride) {
  for (const [name, value] of upstream.headers.entries()) {
    const lower = name.toLowerCase();

    if (DROP_RESPONSE_HEADERS.has(lower) || lower === "set-cookie" || lower === "location") {
      continue;
    }

    res.setHeader(name, value);
  }

  const location = upstream.headers.get("location");
  if (location) {
    res.setHeader("location", rewriteUrl(location, targetUrl));
  }

  const getSetCookie = upstream.headers.getSetCookie?.bind(upstream.headers);
  const cookies = getSetCookie ? getSetCookie() : splitSetCookie(upstream.headers.get("set-cookie"));
  if (cookies.length) {
    res.setHeader(
      "set-cookie",
      cookies.map((cookie) => rewriteCookie(cookie, targetUrl)),
    );
  }

  if (contentTypeOverride) {
    res.setHeader("content-type", contentTypeOverride);
  }

  res.setHeader("cache-control", "no-store");
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-credentials", "true");
}

function renderEmbedPage() {
  const target = proxyPathFor(DEFAULT_TARGET);
  return [
    "<!doctype html>",
    '<html lang="en">',
    "  <head>",
    '    <meta charset="utf-8">',
    '    <meta name="viewport" content="width=device-width, initial-scale=1">',
    "    <title>Remote.com live local embed</title>",
    '    <link rel="icon" href="' + proxyPathFor("https://remote.com/hubfs/Logo%20Symbol%20Blue.png") + '">',
    "    <style>",
    "      html,",
    "      body {",
    "        width: 100%;",
    "        height: 100%;",
    "        margin: 0;",
    "        background: #fff;",
    "        overflow: hidden;",
    "      }",
    "      iframe {",
    "        display: block;",
    "        width: 100%;",
    "        height: 100vh;",
    "        border: 0;",
    "        background: #fff;",
    "      }",
    "    </style>",
    "  </head>",
    "  <body>",
    '    <iframe src="' + target + '" title="Remote.com proxied local embed" loading="eager"></iframe>',
    "  </body>",
    "</html>",
  ].join("\n");
}

async function proxyRequest(req, res, targetUrl) {
  const headers = buildUpstreamHeaders(req, targetUrl);
  const init = {
    method: req.method,
    headers,
    redirect: "manual",
  };

  if (!["GET", "HEAD"].includes(req.method || "GET")) {
    const body = await readRequestBody(req);
    if (body.length) {
      init.body = body;
    }
  }

  const upstream = await fetch(targetUrl, init);
  const originalType = upstream.headers.get("content-type") || "";
  const contentType = originalType.split(";")[0].trim().toLowerCase();

  if (req.method === "HEAD") {
    writeProxyHeaders(res, upstream, targetUrl);
    res.writeHead(upstream.status, upstream.statusText);
    res.end();
    return;
  }

  if (contentType === "text/html" || originalType.includes("application/xhtml")) {
    const body = rewriteHtml(await upstream.text(), targetUrl);
    writeProxyHeaders(res, upstream, targetUrl, "text/html; charset=utf-8");
    res.writeHead(upstream.status, upstream.statusText);
    res.end(body);
    return;
  }

  if (contentType === "text/css") {
    const body = rewriteCss(await upstream.text(), targetUrl);
    writeProxyHeaders(res, upstream, targetUrl, originalType || "text/css; charset=utf-8");
    res.writeHead(upstream.status, upstream.statusText);
    res.end(body);
    return;
  }

  if (
    contentType === "application/javascript" ||
    contentType === "text/javascript" ||
    contentType === "application/x-javascript"
  ) {
    const body = rewriteScript(await upstream.text(), targetUrl);
    writeProxyHeaders(res, upstream, targetUrl, originalType || "application/javascript; charset=utf-8");
    res.writeHead(upstream.status, upstream.statusText);
    res.end(body);
    return;
  }

  const body = Buffer.from(await upstream.arrayBuffer());
  writeProxyHeaders(res, upstream, targetUrl);
  res.writeHead(upstream.status, upstream.statusText);
  res.end(body);
}

const server = createServer(async (req, res) => {
  try {
    const localUrl = new URL(req.url || "/", "http://localhost:" + PORT);

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD",
        "access-control-allow-headers": req.headers["access-control-request-headers"] || "*",
        "access-control-allow-credentials": "true",
      });
      res.end();
      return;
    }

    const localAsset =
      localUrl.pathname === CLICKY_CURSOR_PATH ? { url: CLICKY_CURSOR_IMAGE, contentType: "image/svg+xml; charset=utf-8" } :
      localUrl.pathname === LIVEKIT_CLIENT_PATH ? { url: LIVEKIT_CLIENT_BUNDLE, contentType: "text/javascript; charset=utf-8" } :
      null;
    if (localAsset) {
      try {
        const image = await readFile(localAsset.url);
        res.writeHead(200, {
          "content-type": localAsset.contentType,
          "cache-control": "public, max-age=86400",
          "access-control-allow-origin": "*",
        });
        res.end(image);
      } catch {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("Local asset not found.");
      }
      return;
    }

    if (localUrl.pathname === "/" || localUrl.pathname === "/remote-live-embed.html") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(renderEmbedPage());
      return;
    }

    if (localUrl.pathname === "/direct") {
      res.writeHead(302, { location: proxyPathFor(DEFAULT_TARGET) });
      res.end();
      return;
    }

    const targetUrl = parseProxyPath(req.url || "/");
    if (!targetUrl) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found. Use / for the iframe wrapper or /direct for the direct proxied Remote page.");
      return;
    }

    await proxyRequest(req, res, targetUrl);
  } catch (error) {
    res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    res.end("Proxy error: " + (error?.message || error) + "\n");
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("Remote live proxy running at http://localhost:" + PORT + "/");
  console.log("Direct proxied site: http://localhost:" + PORT + "/direct");
});
