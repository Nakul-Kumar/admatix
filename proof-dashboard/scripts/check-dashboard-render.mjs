import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const cwd = process.cwd();
const checks = [
  { path: "/", wrappers: 1, chartBars: { "artifacts-head-to-head": 4 } },
  { path: "/artifacts", wrappers: 1, chartBars: { "artifacts-head-to-head": 4 } },
  { path: "/overview", wrappers: 1, chartLines: { "overview-cumulative-return": 4 } },
  { path: "/worlds", wrappers: 6, lines: 24 },
  {
    path: "/benchmark",
    wrappers: 2,
    barsMin: 4,
    chartLines: { "benchmark-cumulative-return": 4 },
  },
  { path: "/validation", wrappers: 4, lines: 5, barsMin: 60 },
  { path: "/decisions", wrappers: 0, timelineMin: 1 },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function killProcessTree(pid) {
  if (!pid) return Promise.resolve();
  if (process.platform === "win32") {
    return new Promise((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
        stdio: "ignore",
      });
      killer.on("exit", resolve);
      killer.on("error", resolve);
    });
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Already gone.
  }
  return Promise.resolve();
}

async function waitForHttp(url, timeoutMs = 15000) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status < 500) return response;
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}

async function startPreviewServer() {
  if (process.env.DASHBOARD_URL) {
    return { baseUrl: process.env.DASHBOARD_URL.replace(/\/$/, ""), stop: () => {} };
  }

  const port = await freePort();
  const viteBin = join(cwd, "node_modules", "vite", "bin", "vite.js");
  const server = spawn(
    process.execPath,
    [viteBin, "preview", "--host", "127.0.0.1", "--port", String(port)],
    { cwd, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  server.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  server.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  server.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.error(output);
    }
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHttp(baseUrl);
  return {
    baseUrl,
    stop: async () => {
      if (!server.killed) server.kill();
      await killProcessTree(server.pid);
    },
  };
}

function chromeCandidates() {
  if (process.env.CHROME_PATH) return [process.env.CHROME_PATH];
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA ?? "";
    return [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      join(local, "Google", "Chrome", "Application", "chrome.exe"),
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    ];
  }
  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "google-chrome",
      "chromium",
    ];
  }
  return ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"];
}

function findChrome() {
  for (const candidate of chromeCandidates()) {
    if (candidate.includes("/") || candidate.includes("\\")) {
      if (existsSync(candidate)) return candidate;
    } else {
      return candidate;
    }
  }
  throw new Error("No Chrome/Edge executable found. Set CHROME_PATH to run render checks.");
}

async function startBrowser() {
  const port = await freePort();
  const profile = await mkdtemp(join(tmpdir(), "admatix-dashboard-render-"));
  const chrome = findChrome();
  const browser = spawn(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--disable-extensions",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${port}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );

  const versionUrl = `http://127.0.0.1:${port}/json/version`;
  await waitForHttp(versionUrl, 15000);
  let page;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {
      method: "PUT",
    });
    if (response.ok) page = await response.json();
  } catch {
    page = null;
  }
  if (!page?.webSocketDebuggerUrl) {
    const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    page = pages.find((entry) => entry.type === "page") ?? pages[0];
  }
  if (!page?.webSocketDebuggerUrl) {
    throw new Error("Could not open a Chrome DevTools Protocol page target.");
  }
  return {
    wsUrl: page.webSocketDebuggerUrl,
    stop: async () => {
      if (!browser.killed) browser.kill();
      await Promise.race([
        new Promise((resolve) => browser.once("exit", resolve)),
        sleep(2000),
      ]);
      await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 }).catch(() => {});
    },
  };
}

function connectCdp(wsUrl) {
  let id = 0;
  const pending = new Map();
  const listeners = new Map();
  const ws = new WebSocket(wsUrl);

  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    }
    if (message.method && listeners.has(message.method)) {
      for (const resolve of listeners.get(message.method)) resolve(message.params);
      listeners.delete(message.method);
    }
  });

  const ready = new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });

  function send(method, params = {}) {
    const requestId = ++id;
    ws.send(JSON.stringify({ id: requestId, method, params }));
    return new Promise((resolve, reject) => {
      pending.set(requestId, { resolve, reject });
      setTimeout(() => {
        if (pending.has(requestId)) {
          pending.delete(requestId);
          reject(new Error(`CDP command timed out: ${method}`));
        }
      }, 15000);
    });
  }

  function waitFor(method, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), timeoutMs);
      const wrapped = (params) => {
        clearTimeout(timeout);
        resolve(params);
      };
      const queue = listeners.get(method) ?? [];
      queue.push(wrapped);
      listeners.set(method, queue);
    });
  }

  return {
    ready,
    send,
    waitFor,
    close: () => ws.close(),
  };
}

function routeUrl(baseUrl, routePath) {
  return new URL(routePath.replace(/^\//, ""), `${baseUrl}/`).href;
}

async function evaluateRoute(client, baseUrl, check) {
  const load = client.waitFor("Page.loadEventFired").catch(() => undefined);
  await client.send("Page.navigate", { url: routeUrl(baseUrl, check.path) });
  await load;
  await sleep(750);

  const expression = `(() => {
    const text = document.body?.innerText ?? "";
    const count = (selector, root = document) => root.querySelectorAll(selector).length;
    const chart = (id) => document.querySelector('[data-chart-id="' + id + '"]');
    const chartLines = {};
    const chartBars = {};
    for (const id of ${JSON.stringify(Object.keys(check.chartLines ?? {}))}) {
      const root = chart(id);
      chartLines[id] = root ? count('.recharts-line-curve', root) : -1;
    }
    for (const id of ${JSON.stringify(Object.keys(check.chartBars ?? {}))}) {
      const root = chart(id);
      chartBars[id] = root ? count('.recharts-bar-rectangle', root) : -1;
    }
    return {
      title: document.querySelector('h1')?.textContent ?? '',
      wrappers: count('.recharts-wrapper'),
      lines: count('.recharts-line-curve'),
      bars: count('.recharts-bar-rectangle'),
      timelineItems: count('.tl-item'),
      unavailable: /unavailable\\./i.test(text),
      chartLines,
      chartBars
    };
  })()`;
  const result = await client.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  return result.result.value;
}

function assertRoute(check, observed) {
  const failures = [];
  const prefix = check.path;
  if (observed.unavailable) failures.push(`${prefix}: rendered an unavailable/error panel`);
  if (check.wrappers !== undefined && observed.wrappers !== check.wrappers) {
    failures.push(`${prefix}: expected ${check.wrappers} chart wrappers, got ${observed.wrappers}`);
  }
  if (check.lines !== undefined && observed.lines !== check.lines) {
    failures.push(`${prefix}: expected ${check.lines} line paths, got ${observed.lines}`);
  }
  if (check.barsMin !== undefined && observed.bars < check.barsMin) {
    failures.push(`${prefix}: expected at least ${check.barsMin} bar rectangles, got ${observed.bars}`);
  }
  if (check.timelineMin !== undefined && observed.timelineItems < check.timelineMin) {
    failures.push(`${prefix}: expected at least ${check.timelineMin} timeline item, got ${observed.timelineItems}`);
  }
  for (const [id, expected] of Object.entries(check.chartLines ?? {})) {
    if (observed.chartLines[id] !== expected) {
      failures.push(`${prefix}: chart ${id} expected ${expected} line paths, got ${observed.chartLines[id]}`);
    }
  }
  for (const [id, expected] of Object.entries(check.chartBars ?? {})) {
    if (observed.chartBars[id] !== expected) {
      failures.push(`${prefix}: chart ${id} expected ${expected} bar rectangles, got ${observed.chartBars[id]}`);
    }
  }
  return failures;
}

const preview = await startPreviewServer();
const browser = await startBrowser();
const client = connectCdp(browser.wsUrl);
await client.ready;
await client.send("Page.enable");
await client.send("Runtime.enable");

const failures = [];
const observations = [];
try {
  for (const check of checks) {
    const observed = await evaluateRoute(client, preview.baseUrl, check);
    observations.push({ route: check.path, ...observed });
    failures.push(...assertRoute(check, observed));
  }
} finally {
  client.close();
  await browser.stop();
  await preview.stop?.();
}

if (failures.length > 0) {
  console.error("Dashboard render check failed:");
  for (const observation of observations) {
    console.error(JSON.stringify(observation));
  }
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

for (const observation of observations) {
  console.log(
    `${observation.route}: ${observation.wrappers} chart(s), ${observation.lines} line path(s), ${observation.bars} bar rectangle(s)`,
  );
}
console.log(`Dashboard render check passed at ${preview.baseUrl}.`);
