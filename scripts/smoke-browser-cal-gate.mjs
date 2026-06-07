#!/usr/bin/env node
import { createServer } from "node:http";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { chromium } from "playwright";

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const artifactDir = join("artifacts", "smoke", "browser-cal-gate-" + timestamp);
const labPort = Number(process.env.SMOKE_LAB_PORT || 4691);
const mockRemotePort = Number(process.env.SMOKE_REMOTE_PORT || 4692);
const labUrl = "http://127.0.0.1:" + labPort;
const mockRemoteUrl = "http://127.0.0.1:" + mockRemotePort + "/";
const calUrl = process.env.CAL_URL || "https://cal.com/remote?smoke=cal-gate";
const children = [];
let mockServer;
let browser;

function logPath(name) {
  return join(artifactDir, name + ".log");
}

function spawnLogged(name, command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const out = createWriteStream(logPath(name));
  child.stdout.pipe(out);
  child.stderr.pipe(out);
  children.push(child);
  return child;
}

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttp(url, timeoutMs = 8000) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      lastError = new Error(url + " returned HTTP " + response.status);
    } catch (error) {
      lastError = error;
    }
    await wait(150);
  }
  throw lastError || new Error("Timed out waiting for " + url);
}

function startMockRemote() {
  mockServer = createServer((req, res) => {
    if (req.url === "/favicon.ico") {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html>
<html>
  <head>
    <title>Remote local browser smoke</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
  </head>
  <body>
    <header>
      <nav>
        <a href="/pricing">Pricing</a>
        <a href="/country-explorer">Country explorer</a>
        <a href="/global-payroll">Global payroll</a>
      </nav>
      <a href="/book-demo">Book a demo</a>
    </header>
    <main>
      <h1>Global payroll</h1>
      <p>Remote helps companies run global payroll, local compliance, HR, and employee operations.</p>
      <button>Book a demo</button>
    </main>
  </body>
</html>`);
  });
  return new Promise((resolve) => mockServer.listen(mockRemotePort, "127.0.0.1", resolve));
}

async function closeMockRemote() {
  if (!mockServer) return;
  await new Promise((resolve) => mockServer.close(resolve));
  mockServer = null;
}

async function stopAll() {
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  if (browser) await browser.close().catch(() => {});
  await closeMockRemote();
}

function proxiedMockPath() {
  const target = new URL(mockRemoteUrl);
  return labUrl + "/__remote/" + target.protocol.slice(0, -1) + "/" + target.host + target.pathname;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readCalState(page) {
  return page.evaluate(() => {
    const frame = document.querySelector(".ocw-cal-frame");
    const scheduler = document.querySelector(".ocw-scheduler");
    const prompt = document.querySelector(".ocw-booking-prompt");
    const calLink = document.querySelector(".ocw-cal-link");
    const status = document.querySelector(".ocw-status");
    const chipText = (name) => document.querySelector('[data-ocw-chip="' + name + '"]')?.textContent || "";
    const events = window.InboundNow.events();
    const schedulerStyle = scheduler ? getComputedStyle(scheduler) : null;
    return {
      pageUrl: location.href,
      frameSrc: frame?.getAttribute("src") || "",
      frameDataSrc: frame?.getAttribute("data-src") || "",
      schedulerOpen: scheduler?.classList.contains("is-open") || false,
      schedulerVisible: schedulerStyle ? schedulerStyle.visibility !== "hidden" && Number(schedulerStyle.opacity || 0) > 0 : false,
      calLinkHref: calLink?.getAttribute("href") || "",
      promptOpen: prompt?.classList.contains("is-open") || false,
      status: status?.textContent || "",
      asrChip: chipText("asr"),
      turnChip: chipText("turn"),
      voiceChip: chipText("voice"),
      events: events.map((event) => event.type),
    };
  });
}

await mkdir(artifactDir, { recursive: true });

try {
  await startMockRemote();
  spawnLogged("lab", "node", ["apps/website-lab/server.mjs"], {
    PORT: String(labPort),
    CAL_URL: calUrl,
    TOKEN_SERVER_URL: "http://127.0.0.1:1",
    LIVEKIT_ROOM: "browser-cal-gate-smoke",
    INBOUNDNOW_EMBED_HOSTS: "127.0.0.1,localhost",
  });
  await waitForHttp(labUrl + "/__ocw-assets/inboundnow-cursor.svg");

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const browserConsole = [];
  page.on("console", (message) => browserConsole.push({ type: message.type(), text: message.text() }));
  page.on("pageerror", (error) => browserConsole.push({ type: "pageerror", text: error.message }));

  await page.goto(proxiedMockPath(), { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.InboundNow && document.querySelector(".ocw-cal-frame")), null, { timeout: 10_000 });
  await page.waitForTimeout(400);

  const initial = await readCalState(page);
  assert(!initial.frameSrc, "Cal iframe src must be empty on initial load");
  assert(initial.frameDataSrc === calUrl, "Cal iframe data-src should hold the configured Cal URL");
  assert(!initial.schedulerOpen, "Scheduler must start closed");
  assert(!initial.schedulerVisible, "Scheduler must not be visible before confirmation");
  assert(initial.calLinkHref === calUrl, "Hidden scheduler link should keep the configured Cal URL");
  assert(!initial.promptOpen, "Booking prompt must start closed");
  assert(initial.asrChip === "ASR: text fallback", "ASR chip should clearly start as text fallback");
  assert(initial.turnChip === "Turn: idle", "Turn chip should start idle");

  await page.evaluate(() => window.InboundNow.dispatch("confirmBooking"));
  await page.waitForFunction(() => window.InboundNow.events().some((event) => event.type === "bookingPromptShown"), null, { timeout: 5000 });
  const directConfirm = await readCalState(page);
  assert(directConfirm.promptOpen, "Direct confirmBooking without a shown prompt should ask for confirmation");
  assert(!directConfirm.frameSrc, "Direct confirmBooking must not load Cal before confirmation context exists");
  assert(!directConfirm.schedulerOpen, "Direct confirmBooking must not open the scheduler before confirmation context exists");
  assert(!directConfirm.events.includes("calOpened"), "Direct confirmBooking must not emit calOpened");

  await page.evaluate(() => window.InboundNow.openCal());
  await page.waitForFunction(() => window.InboundNow.events().some((event) => event.type === "openCalDeferred"), null, { timeout: 5000 });
  const deferredOpen = await readCalState(page);
  assert(deferredOpen.promptOpen, "openCal should show or keep the booking prompt open");
  assert(!deferredOpen.frameSrc, "openCal must not set iframe src before explicit yes");
  assert(!deferredOpen.schedulerOpen, "openCal must not open scheduler before explicit yes");
  assert(!deferredOpen.schedulerVisible, "openCal must keep scheduler hidden before explicit yes");

  await page.evaluate(() => window.InboundNow.navigate("https://cal.com/remote?smoke=nav-bypass"));
  await page.waitForFunction(() => window.InboundNow.events().some((event) => event.type === "calNavigationBlocked"), null, { timeout: 5000 });
  const navBlocked = await readCalState(page);
  assert(navBlocked.promptOpen, "direct Cal navigation should show or keep the booking prompt open");
  assert(!navBlocked.frameSrc, "direct Cal navigation must not load Cal before explicit yes");
  assert(!navBlocked.schedulerOpen, "direct Cal navigation must not open scheduler before explicit yes");
  assert(navBlocked.pageUrl === deferredOpen.pageUrl, "direct Cal navigation must not move the page before explicit yes");

  await page.evaluate(() => window.InboundNow.clickElement({ text: "Book a demo" }, "Book a demo"));
  await page.waitForFunction(() => window.InboundNow.events().filter((event) => event.type === "calNavigationBlocked").length >= 2, null, { timeout: 5000 });
  const clickBlocked = await readCalState(page);
  assert(clickBlocked.promptOpen, "booking CTA clicks should show or keep the booking prompt open");
  assert(!clickBlocked.frameSrc, "booking CTA clicks must not load Cal before explicit yes");
  assert(!clickBlocked.schedulerOpen, "booking CTA clicks must not open scheduler before explicit yes");
  assert(clickBlocked.pageUrl === deferredOpen.pageUrl, "booking CTA clicks must not navigate before explicit yes");

  await page.evaluate(() => window.InboundNow.dispatch("dismissBookingPrompt"));
  await page.waitForFunction(() => !document.querySelector(".ocw-booking-prompt")?.classList.contains("is-open"), null, { timeout: 5000 });
  await page.evaluate(() => window.InboundNow.dispatch("yes"));
  await page.waitForFunction(() => {
    const prompt = document.querySelector(".ocw-booking-prompt");
    return prompt?.classList.contains("is-open") && window.InboundNow.events().filter((event) => event.type === "bookingPromptShown").length >= 2;
  }, null, { timeout: 5000 });
  const dismissedYes = await readCalState(page);
  assert(dismissedYes.promptOpen, "A yes after dismissal should ask for fresh confirmation");
  assert(!dismissedYes.frameSrc, "A yes after dismissal must not load Cal");
  assert(!dismissedYes.schedulerOpen, "A yes after dismissal must not open scheduler");

  await page.click('[data-ocw-action="confirmBooking"]');
  await page.waitForFunction(() => {
    const frame = document.querySelector(".ocw-cal-frame");
    return window.InboundNow.events().some((event) => event.type === "calOpened") && Boolean(frame?.getAttribute("src"));
  }, null, { timeout: 5000 });
  await page.waitForTimeout(260);
  const confirmed = await readCalState(page);
  assert(confirmed.frameSrc === calUrl, "Confirmed booking should load the configured Cal URL");
  assert(confirmed.schedulerOpen, "Confirmed booking should open scheduler");
  assert(confirmed.schedulerVisible, "Confirmed booking should make scheduler visible");
  assert(!confirmed.promptOpen, "Confirmed booking should close prompt");
  const promptShownIndex = confirmed.events.indexOf("bookingPromptShown");
  const calOpenedIndex = confirmed.events.indexOf("calOpened");
  assert(promptShownIndex >= 0 && calOpenedIndex > promptShownIndex, "bookingPromptShown must precede calOpened");

  const summary = {
    ok: true,
    artifactDir,
    labUrl,
    proxiedUrl: proxiedMockPath(),
    calUrl,
    checks: {
      initialCalUnloaded: true,
      initialVoiceFallbackVisible: true,
      directConfirmBlocked: true,
      openCalDeferred: true,
      directCalNavigationBlocked: true,
      bookingCtaClickBlocked: true,
      dismissedYesReprompts: true,
      yesButtonLoadsCal: true,
    },
    states: { initial, directConfirm, deferredOpen, navBlocked, clickBlocked, dismissedYes, confirmed },
    browserConsole,
  };

  await writeFile(join(artifactDir, "result.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await stopAll();
}
