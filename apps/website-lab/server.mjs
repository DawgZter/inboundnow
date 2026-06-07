#!/usr/bin/env node
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const PORT = Number(process.env.PORT || 4188);
const PREFIX = "/__remote";
const DEFAULT_TARGET = "https://remote.com/";

// Local support widget injected into every proxied HTML page.
const SUPPORT_ASSET_PATH = "/__support-assets/reps.png";
const SUPPORT_REPS_IMAGE = new URL("./support-reps.png", import.meta.url);
const SUPPORT_AVATAR_PATH = "/__support-assets/reps-avatar.png";
const SUPPORT_AVATAR_IMAGE = new URL("./support-reps-avatar.png", import.meta.url);
const CLICKY_CURSOR_PATH = "/__support-assets/clicky-cursor.svg";
const CLICKY_CURSOR_IMAGE = new URL(
  "../../install-this-i-want-to-test/outputs/clicky-cursor.svg",
  import.meta.url,
);

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

function injectedSupportWidget() {
  const assetUrl = "http://localhost:" + PORT + SUPPORT_ASSET_PATH;
  const avatarUrl = "http://localhost:" + PORT + SUPPORT_AVATAR_PATH;
  return `
<div id="rsw-root" data-rsw-open="false" aria-live="polite">
  <style>
    #rsw-root, #rsw-root *, #rsw-root *::before, #rsw-root *::after { box-sizing: border-box; }
    #rsw-root {
      position: fixed; left: 24px; bottom: 24px; z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      -webkit-font-smoothing: antialiased; text-align: left; color: #141415; line-height: 1.45;
    }
    #rsw-root button { font-family: inherit; cursor: pointer; border: 0; background: none; }

    /* Launcher */
    .rsw-launcher {
      position: relative; display: flex; align-items: center; justify-content: center;
      width: 60px; height: 60px; border-radius: 50% !important;
      background: linear-gradient(135deg, #0564ff 0%, #0047bc 100%) !important;
      box-shadow: 0 12px 30px rgba(5, 100, 255, 0.38), 0 2px 6px rgba(0, 35, 92, 0.25);
      transition: transform 0.18s ease, box-shadow 0.18s ease;
    }
    .rsw-launcher:hover { transform: translateY(-2px) scale(1.03); box-shadow: 0 16px 38px rgba(5, 100, 255, 0.45); }
    .rsw-launcher:active { transform: translateY(0) scale(0.98); }
    .rsw-launcher svg { width: 26px; height: 26px; color: #fff; transition: opacity 0.15s ease, transform 0.2s ease; }
    .rsw-ic-photo {
      position: absolute; inset: 0; width: 100% !important; height: 100% !important; max-width: none !important;
      object-fit: cover; object-position: 50% 35%; border-radius: 50% !important; border: 2px solid #fff !important;
      transition: opacity 0.18s ease, transform 0.2s ease;
    }
    .rsw-launcher .rsw-ic-close { position: absolute; opacity: 0; transform: rotate(-30deg) scale(0.6); z-index: 1; }
    #rsw-root[data-rsw-open="true"] .rsw-ic-photo { opacity: 0; transform: scale(0.6); }
    #rsw-root[data-rsw-open="true"] .rsw-launcher .rsw-ic-close { opacity: 1; transform: rotate(0) scale(1); }
    .rsw-badge {
      position: absolute; top: -3px; right: -3px; min-width: 20px; height: 20px; padding: 0 5px;
      display: flex; align-items: center; justify-content: center;
      background: #00235c; color: #fff; font-size: 10px; font-weight: 700; letter-spacing: 0.3px;
      border-radius: 10px; border: 2px solid #fff; z-index: 5;
    }

    /* Panel */
    .rsw-panel {
      position: absolute; left: 0; bottom: 74px; width: 366px; max-width: calc(100vw - 48px);
      background: #fff; border-radius: 18px; overflow: hidden;
      box-shadow: 0 24px 60px rgba(0, 35, 92, 0.22), 0 4px 14px rgba(0, 35, 92, 0.12);
      transform-origin: left bottom; transform: translateY(10px) scale(0.97); opacity: 0;
      visibility: hidden; pointer-events: none;
      transition: opacity 0.2s ease, transform 0.22s cubic-bezier(0.22, 1, 0.36, 1), visibility 0.2s;
    }
    #rsw-root[data-rsw-open="true"] .rsw-panel { opacity: 1; transform: translateY(0) scale(1); visibility: visible; pointer-events: auto; }

    /* Intro view */
    .rsw-hero { position: relative; height: 150px; background: #00235c; }
    .rsw-hero img { width: 100%; height: 100%; object-fit: cover; object-position: 50% 26%; display: block; }
    .rsw-hero::after {
      content: ""; position: absolute; inset: 0;
      background: linear-gradient(180deg, rgba(0,35,92,0) 40%, rgba(0,35,92,0.55) 100%);
    }
    .rsw-status {
      position: absolute; left: 16px; bottom: 14px; z-index: 1;
      display: inline-flex; align-items: center; gap: 7px;
      background: rgba(255,255,255,0.96); color: #00235c;
      padding: 5px 11px; border-radius: 999px; font-size: 12px; font-weight: 600;
      box-shadow: 0 2px 8px rgba(0,35,92,0.18);
    }
    .rsw-dot { width: 8px; height: 8px; border-radius: 50%; background: #f5a623; box-shadow: 0 0 0 3px rgba(245,166,35,0.22); }
    .rsw-intro-body { padding: 20px 20px 18px; }
    .rsw-intro-body h3 { margin: 0 0 8px; font-size: 18px; font-weight: 700; color: #141415; letter-spacing: -0.01em; white-space: nowrap; }
    .rsw-intro-body p { margin: 0 0 18px; font-size: 14px; color: #595b5f; }
    .rsw-start {
      display: flex; align-items: center; justify-content: center; gap: 9px; width: 100%;
      padding: 13px 16px; border-radius: 12px; font-size: 15px; font-weight: 600; color: #fff;
      background: linear-gradient(135deg, #0564ff 0%, #0047bc 100%) !important;
      box-shadow: 0 8px 20px rgba(5,100,255,0.32); transition: transform 0.16s ease, box-shadow 0.16s ease;
    }
    .rsw-start:hover { transform: translateY(-1px); box-shadow: 0 12px 26px rgba(5,100,255,0.4); }
    .rsw-start svg { width: 21px; height: 28px; overflow: visible; }
    @media (max-width: 480px) { #rsw-root { left: 16px; bottom: 16px; } .rsw-panel { bottom: 70px; } }
  </style>

  <div class="rsw-panel" role="dialog" aria-label="Remote support">
    <!-- Intro -->
    <div class="rsw-intro">
      <div class="rsw-hero">
        <img src="${assetUrl}" alt="Remote Global Employment Specialists" />
        <span class="rsw-status"><span class="rsw-dot"></span>Specialists offline</span>
      </div>
      <div class="rsw-intro-body">
        <h3>Talk to our employment team</h3>
        <p>Our specialists are offline right now — but you don't have to wait. Chat with their AI personas: a fully conversational agent that answers in real time and walks you around the page as you talk, pulling up exactly what you need on global hiring, payroll, and compliance.</p>
        <button class="rsw-start" type="button">
          <svg viewBox="0 0 96 128" fill="none" aria-hidden="true">
            <defs>
              <filter id="rsw-btn-glow" x="-45%" y="-45%" width="190%" height="190%" color-interpolation-filters="sRGB">
                <feGaussianBlur in="SourceGraphic" stdDeviation="3.8" result="blur"/>
                <feColorMatrix in="blur" type="matrix" values="0 0 0 0 0.0196  0 0 0 0 0.3922  0 0 0 0 1  0 0 0 0.42 0" result="blueGlow"/>
                <feMerge><feMergeNode in="blueGlow"/></feMerge>
              </filter>
              <filter id="rsw-btn-shadow" x="-30%" y="-30%" width="170%" height="170%" color-interpolation-filters="sRGB">
                <feDropShadow dx="0" dy="3.4" stdDeviation="2.8" flood-color="#000000" flood-opacity="0.24"/>
              </filter>
            </defs>
            <path d="M23.52 19 L23.52 96 L40.08 77 L50.88 110 L67.44 100 L56.64 70 L78.24 70 Z" fill="none" stroke="#0564FF" stroke-width="12.6" stroke-linejoin="round" opacity="0.42" filter="url(#rsw-btn-glow)"/>
            <g filter="url(#rsw-btn-shadow)">
              <path d="M23.52 19 L23.52 96 L40.08 77 L50.88 110 L67.44 100 L56.64 70 L78.24 70 Z" fill="#0564FF"/>
              <path d="M23.52 19 L23.52 96 L40.08 77 L50.88 110 L67.44 100 L56.64 70 L78.24 70 Z" fill="none" stroke="#FFFFFF" stroke-width="4.35" stroke-linejoin="round" opacity="0.96"/>
            </g>
          </svg>
          Chat with our AI personas
        </button>
      </div>
    </div>
  </div>

  <button class="rsw-launcher" type="button" aria-label="Open support chat">
    <span class="rsw-badge">AI</span>
    <img class="rsw-ic-photo" src="${avatarUrl}" alt="Our Global Employment Specialists" />
    <svg class="rsw-ic-close" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
  </button>

  <script>
  (function(){
    if (window.__rswInit) return; window.__rswInit = true;
    var root = document.getElementById('rsw-root');
    if (!root) return;
    // Keep the widget last in <body> so it shares the top stacking order with the host's
    // highest-z elements (e.g. modals) and wins the tie, and re-assert if the host appends later.
    function keepOnTop(){ if (document.body && document.body.lastElementChild !== root) document.body.appendChild(root); }
    keepOnTop();
    try { new MutationObserver(keepOnTop).observe(document.body, { childList: true }); } catch (e) {}
    var launcher = root.querySelector('.rsw-launcher');
    function setOpen(open){ root.setAttribute('data-rsw-open', open ? 'true' : 'false'); }
    launcher.addEventListener('click', function(){ setOpen(root.getAttribute('data-rsw-open') !== 'true'); });
  })();
  </script>
</div>`;
}

function injectedClickyMvp() {
  const cursorUrl = "http://localhost:" + PORT + CLICKY_CURSOR_PATH;
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
      backdrop-filter: blur(14px); overflow: hidden;
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
    .ocw-body { padding: 12px 12px 13px; }
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
      position: fixed; right: 18px; bottom: 18px; width: 390px; max-width: calc(100vw - 36px);
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
    .ocw-slots { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; }
    .ocw-slot {
      min-height: 39px; border: 1px solid rgba(5, 100, 255, 0.22); border-radius: 8px;
      background: rgba(5, 100, 255, 0.06); color: #003284; font-size: 12px; font-weight: 700; cursor: pointer;
    }
    .ocw-scheduler-body p { margin: 0; font-size: 12px; color: #4b5563; }

    @media (max-width: 700px) {
      .ocw-panel { left: 12px; right: 12px; top: 12px; width: auto; }
      .ocw-scheduler { left: 12px; right: 12px; bottom: 12px; width: auto; }
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
        <strong>OpenClicky-Web MVP</strong>
        <span>Deterministic browser action bus</span>
      </div>
    </div>
    <div class="ocw-body">
      <div class="ocw-grid">
        <button class="ocw-action primary" data-ocw-action="tour" type="button">Run guided motion</button>
        <button class="ocw-action" data-ocw-action="demo" type="button">Point demo</button>
        <button class="ocw-action" data-ocw-action="payroll" type="button">Show payroll</button>
        <button class="ocw-action" data-ocw-action="country" type="button">Country explorer</button>
        <button class="ocw-action" data-ocw-action="pricing" type="button">Pricing</button>
        <button class="ocw-action" data-ocw-action="clickDemo" type="button">Click demo</button>
        <button class="ocw-action" data-ocw-action="schedule" type="button">Open Cal</button>
      </div>
      <form class="ocw-command">
        <input class="ocw-input" value="show payroll" autocomplete="off" aria-label="Deterministic action command" />
        <button class="ocw-run" type="submit">Run</button>
      </form>
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
      <strong>Cal.com scheduling preview</strong>
      <button class="ocw-close" data-ocw-action="closeSchedule" type="button" aria-label="Close scheduler">x</button>
    </div>
    <div class="ocw-scheduler-body">
      <p>This is the local MVP mount point. The production version would embed Cal.com or call the Cal API after confirmation.</p>
      <div class="ocw-slots">
        <button class="ocw-slot" type="button">Today 2:30 PM</button>
        <button class="ocw-slot" type="button">Tomorrow 10:00 AM</button>
        <button class="ocw-slot" type="button">Thu 1:00 PM</button>
        <button class="ocw-slot" type="button">Fri 9:30 AM</button>
      </div>
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
    var scheduler = root.querySelector('.ocw-scheduler');
    var commandInput = root.querySelector('.ocw-input');
    var sizeSlider = root.querySelector('.ocw-size-slider');
    var sizeValue = root.querySelector('.ocw-size-value');
    var current = { x: Math.max(24, window.innerWidth - 92), y: Math.max(24, window.innerHeight - 92) };
    var actionLock = Promise.resolve();
    var sizeStorageKey = 'openClickyWebMvp.cursorSizePercent';

    var specs = {
      demo: [
        { selector: 'a[href],button,[role="button"]', text: ['book a demo', 'request demo', 'get a demo'], href: ['demo', 'request'] }
      ],
      payroll: [
        { selector: 'a[href],button,[role="button"],h1,h2,h3,h4,p,span,div', text: ['global payroll', 'run payroll', 'payroll'], href: ['payroll'] }
      ],
      country: [
        { selector: 'a[href],button,[role="button"],h1,h2,h3,h4,p,span,div', text: ['country explorer', 'country', 'explorer'], href: ['country'] }
      ],
      pricing: [
        { selector: 'a[href],button,[role="button"],h1,h2,h3,h4,p,span,div', text: ['pricing', 'price'], href: ['pricing'] }
      ],
      eor: [
        { selector: 'a[href],button,[role="button"],h1,h2,h3,h4,p,span,div', text: ['employer of record', 'eor'], href: ['employer-of-record', 'eor'] }
      ]
    };

    function sleep(ms) {
      return new Promise(function(resolve){ window.setTimeout(resolve, ms); });
    }

    function setStatus(text) {
      if (status) status.textContent = text;
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

    function isOurUi(element) {
      return !!(element && element.closest && (element.closest('#ocw-root') || element.closest('#rsw-root')));
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

    async function moveToElement(element, label) {
      if (!element) throw new Error('Target not found');
      element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      await sleep(760);
      showHighlight(element);
      var point = viewportPointFor(element);
      await moveCursor(point.x, point.y, label || targetLabel(element, 'Selected target'), 780);
      return point;
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
    }

    function openScheduler() {
      scheduler.classList.add('is-open');
      setStatus('Opened Cal.com scheduling preview.');
    }

    function closeScheduler() {
      scheduler.classList.remove('is-open');
      setStatus('Closed scheduling preview.');
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

    async function runAction(action) {
      var key = normalized(action);

      if (key === 'tour' || key === 'demo tour' || key === 'guided motion' || key === 'run guided motion') {
        setStatus('Running guided motion.');
        await pointTarget('demo', 'First, this is where a buyer can book a demo.');
        await sleep(500);
        await pointTarget('payroll', 'For payroll questions, I would bring them here.');
        await sleep(500);
        await pointTarget('country', 'For country-specific guidance, this is the explorer.');
        await sleep(500);
        openScheduler();
        await moveCursor(Math.max(32, window.innerWidth - 356), Math.max(32, window.innerHeight - 250), 'Then I can open scheduling.', 620);
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
        openScheduler();
        await moveCursor(Math.max(32, window.innerWidth - 344), Math.max(32, window.innerHeight - 228), 'Scheduling preview', 620);
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
      actionLock = actionLock.then(function(){ return runAction(action); }).catch(function(error){
        setStatus(error && error.message ? error.message : String(error));
      });
      return actionLock;
    }

    root.addEventListener('click', function(event){
      var button = event.target.closest && event.target.closest('[data-ocw-action]');
      if (!button) return;
      event.preventDefault();
      enqueue(button.getAttribute('data-ocw-action'));
    });

    var form = root.querySelector('.ocw-command');
    form.addEventListener('submit', function(event){
      event.preventDefault();
      enqueue(commandInput.value || '');
    });

    window.addEventListener('resize', function(){
      moveCursor(Math.min(current.x, window.innerWidth - 16), Math.min(current.y, window.innerHeight - 16), caption.textContent, 120);
    });

    window.OpenClickyWebMVP = {
      run: enqueue,
      find: findTarget,
      moveTo: function(key){ return enqueue(key); },
      clickDemo: function(){ return enqueue('click demo'); },
      openCal: function(){ return enqueue('open cal'); }
    };

    window.setTimeout(function(){
      moveCursor(Math.max(28, window.innerWidth - 92), Math.max(28, window.innerHeight - 92), 'Ready to guide.', 420);
      window.setTimeout(function(){ caption.classList.remove('is-visible'); }, 1400);
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

  // Inject after URL rewriting so the widget's own (local) asset URLs are left intact.
  const widget = injectedSupportWidget();
  const clickyMvp = injectedClickyMvp();
  if (/<\/body>/i.test(rewritten)) {
    rewritten = rewritten.replace(/<\/body>/i, widget + clickyMvp + "</body>");
  } else {
    rewritten = rewritten + widget + clickyMvp;
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

    const supportAsset =
      localUrl.pathname === SUPPORT_ASSET_PATH ? { url: SUPPORT_REPS_IMAGE, contentType: "image/png" } :
      localUrl.pathname === SUPPORT_AVATAR_PATH ? { url: SUPPORT_AVATAR_IMAGE, contentType: "image/png" } :
      localUrl.pathname === CLICKY_CURSOR_PATH ? { url: CLICKY_CURSOR_IMAGE, contentType: "image/svg+xml; charset=utf-8" } :
      null;
    if (supportAsset) {
      try {
        const image = await readFile(supportAsset.url);
        res.writeHead(200, {
          "content-type": supportAsset.contentType,
          "cache-control": "public, max-age=86400",
          "access-control-allow-origin": "*",
        });
        res.end(image);
      } catch {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("Support asset not found.");
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
