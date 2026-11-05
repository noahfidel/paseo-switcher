#!/usr/bin/env node
// Records the README media of the real switcher: two GIFs and four stills.
//
//   E2E_ORIGIN=http://127.0.0.1:<port> PASEO_HOME=<home> npm run media
//
// Run it against a throwaway daemon that holds only sample workspaces, named as in SAMPLES below
// (a `paseo daemon run --home <dir>` with the web UI enabled; TESTING.md has the details). The
// script adds each sample's pull request, checks, diff and status to the daemon's messages inside
// the page, and refuses to write anything if a card shows a name that is not a sample.
//
// GIFs are encoded with ffmpeg when it is on PATH (or FFMPEG), otherwise with sharp when SHARP
// names a directory it can be required from.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { hostname, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { authenticate, ORIGIN, startWebUi } from "./browser.mjs";

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../../docs/media");
const H = 3600e3;

/** Oldest visit first; the switcher lists the last one first. */
const SAMPLES = [
  { name: "Mobile push tokens", add: 0, del: 0, status: "done", since: 50, pr: { number: 90, state: "closed", checks: "none" } },
  { name: "Search reindex OOM", add: 19, del: 4, status: "done", since: 28 },
  { name: "Onboarding emails", add: 88, del: 7, status: "attention", since: 0.6 },
  { name: "Docs search", add: 640, del: 118, status: "done", since: 5, ahead: 2 },
  { name: "Upgrade to Postgres 17", add: 77, del: 54, status: "failed", since: 26, pr: { number: 455, state: "open", draft: true, checks: "failure" } },
  { name: "Fix the flaky login test on Safari", add: 12, del: 31, status: "done", since: 2, pr: { number: 470, state: "merged", checks: "success" } },
  { name: "Invoice retry backoff", add: 236, del: 41, pr: { number: 418, state: "open", checks: "success", review: "changes_requested" } },
  { name: "Rate limit the public API", add: 158, del: 23, status: "needs_input", since: 0.2, pr: { number: 477, state: "open", checks: "success", review: "approved" } },
  { name: "Checkout redesign", add: 412, del: 96, pr: { number: 482, state: "open", checks: "pending" } },
];

/** Runs in the page before the app: adds the samples' details to workspace descriptors from the daemon. */
function enrich(samples, host) {
  const byName = new Map(samples.map((s) => [s.name, s]));
  const t0 = Date.now();
  const fix = (o) => {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) return o.forEach(fix);
    const s = typeof o.projectDisplayName === "string" && byName.get(o.name);
    if (s) {
      o.diffStat = { additions: s.add, deletions: s.del };
      if (s.status) {
        const at = new Date(t0 - s.since * 3600e3).toISOString();
        Object.assign(o, { status: s.status, statusEnteredAt: at, activityAt: at, lastUserMessageAt: at, createdAt: new Date(t0 - (s.since + 1) * 3600e3).toISOString() });
      }
      if (o.gitRuntime && s.ahead) o.gitRuntime = { ...o.gitRuntime, aheadOfOrigin: s.ahead };
      if (s.pr) {
        const pr = { number: s.pr.number, url: `https://github.com/acme/app/pull/${s.pr.number}`, title: s.name, state: s.pr.state, isMerged: s.pr.state === "merged", isDraft: !!s.pr.draft, checksStatus: s.pr.checks, reviewDecision: s.pr.review ?? null, baseRefName: "main", headRefName: "x", checks: [] };
        o.githubRuntime = { featuresEnabled: true, error: null, pullRequest: pr };
      }
      return;
    }
    for (const k in o) if (o[k] && typeof o[k] === "object") fix(o[k]);
  };
  const data = Object.getOwnPropertyDescriptor(MessageEvent.prototype, "data");
  const seen = new WeakMap();
  Object.defineProperty(MessageEvent.prototype, "data", {
    ...data,
    get() {
      const raw = data.get.call(this);
      if (typeof raw !== "string" || !(this.target instanceof WebSocket) || !raw.includes("projectDisplayName")) return raw;
      if (!seen.has(this)) {
        let out = raw;
        try {
          const json = JSON.parse(raw);
          fix(json);
          out = JSON.stringify(json);
        } catch {}
        seen.set(this, out);
      }
      return seen.get(this);
    },
  });
  // The daemon reports the machine's real name; show a neutral one.
  const names = host.split(".").length > 1 ? [host, host.split(".")[0]] : [host];
  new MutationObserver(() => {
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) for (const name of names) if (n.data.includes(name)) n.data = n.data.split(name).join("dev-box");
  }).observe(document, { subtree: true, childList: true, characterData: true });
}

/** Runs in the page. Adds `window.showKeys(...)`, which draws keycaps, since a GIF cannot show key presses. */
function keycaps() {
  const box = document.createElement("div");
  box.className = "demo-keys";
  box.style.cssText = `position: fixed; left: 50%; bottom: 120px; transform: translateX(-50%); z-index: 2147483647;
    display: flex; gap: 8px; pointer-events: none; font: 600 22px/1 system-ui, sans-serif;`;
  document.body.appendChild(box);
  window.showKeys = (keys) =>
    box.replaceChildren(
      ...keys.map((key) => {
        const cap = document.createElement("span");
        cap.textContent = key;
        cap.style.cssText = `padding: 10px 16px; border-radius: 10px; color: #fff; background: rgba(20, 20, 24, 0.9);
          box-shadow: 0 2px 0 rgba(0, 0, 0, 0.5), inset 0 0 0 1px rgba(255, 255, 255, 0.18);`;
        return cap;
      }),
    );
}

/** Never publish a capture that could show a real workspace. */
async function assertSamples(page) {
  const names = SAMPLES.map((s) => s.name);
  const shown = await page.$$eval(".pws-card", (cards) => cards.map((c) => c.getAttribute("aria-label")));
  const stray = shown.find((name) => !names.includes(name));
  if (stray !== undefined) throw new Error(`Refusing to write the capture: "${stray}" is not a sample workspace`);
}

async function prepare(browser, { scheme = "dark", layout = "list", width = 1440, height = 900 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, deviceScaleFactor: 2, reducedMotion: "no-preference" });
  await authenticate(context).catch(() => {});
  await context.addInitScript(enrich, SAMPLES, hostname());
  await context.addInitScript((layout) => {
    try {
      localStorage.setItem("paseo-switcher:layout", JSON.stringify(layout));
      localStorage.removeItem("paseo-switcher:mru");
      localStorage.removeItem("paseo-switcher:visits");
    } catch {}
  }, layout);
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/`);
  await page.waitForSelector(".pws-host", { state: "attached", timeout: 30000 });
  if (width < 600) {
    await page.waitForTimeout(3000);
    return { context, page };
  }
  await page.waitForSelector('[data-testid^="sidebar-workspace-row-"]', { state: "attached", timeout: 30000 });
  await page.waitForTimeout(1500);
  for (const sample of SAMPLES) {
    const row = page.locator('[data-testid^="sidebar-workspace-row-"]', { hasText: sample.name }).first();
    if (!(await row.count())) throw new Error(`No sample workspace named "${sample.name}"`);
    const before = await page.evaluate(() => performance.getEntriesByName("pws:draw").length);
    await row.click({ force: true });
    // The banner comes back for each project.
    if (layout === "list") {
      await dismissBanner(page);
      continue;
    }
    // A thumbnail is taken once the app is idle, after a quiet period following the switch.
    await page
      .waitForFunction((n) => performance.getEntriesByName("pws:draw").length > n, before, { timeout: 20000 })
      .catch(() => console.warn(`No thumbnail for ${sample.name}`));
    await dismissBanner(page);
  }
  await dismissBanner(page);
  await page.mouse.move(1100, 110);
  return { context, page };
}

/** Closes the sidebar's "Set up worktree scripts" banner, which is not part of the switcher. */
async function dismissBanner(page) {
  await page.waitForTimeout(700);
  const banner = page.getByText("Set up worktree scripts", { exact: true });
  if (!(await banner.count())) return;
  const box = await banner.first().boundingBox();
  for (const button of await page.locator('[role="button"]').all()) {
    const b = await button.boundingBox();
    if (b && box && Math.abs(b.y + b.height / 2 - (box.y + box.height / 2)) < 16 && b.x > box.x + 150 && b.width < 50) {
      await button.click({ force: true });
      await page.waitForTimeout(500);
      return;
    }
  }
}

/** A still of the open switcher, cropped to it with some of the app around it. */
async function still(page, file, pad = 40) {
  await assertSamples(page);
  const box = await page.evaluate(() => {
    const parts = [...document.querySelectorAll(".pws-query, .pws-panel, .pws-hint")].map((e) => e.getBoundingClientRect());
    const x = Math.min(...parts.map((r) => r.left));
    const y = Math.min(...parts.map((r) => r.top));
    return { x, y, right: Math.max(...parts.map((r) => r.right)), bottom: Math.max(...parts.map((r) => r.bottom)), vw: innerWidth, vh: innerHeight };
  });
  const x = Math.max(0, box.x - pad);
  const y = Math.max(0, box.y - pad);
  const clip = { x, y, width: Math.min(box.vw, box.right + pad) - x, height: Math.min(box.vh, box.bottom + pad) - y };
  await page.screenshot({ path: file, clip });
  console.log(`Wrote ${file}`);
}

/** Records frames while `script` runs, then encodes a GIF. */
async function record(context, page, file, script) {
  await page.evaluate(keycaps);
  await page.waitForTimeout(1500);
  const frames = [];
  const cdp = await context.newCDPSession(page);
  cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    frames.push({ buf: Buffer.from(data, "base64"), at: metadata.timestamp });
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1440, maxHeight: 900 });
  const wait = (ms) => page.waitForTimeout(ms);
  const show = (...keys) => page.evaluate((keys) => window.showKeys(keys), keys);
  await script({ wait, show, keyboard: page.keyboard, check: () => assertSamples(page) });
  await cdp.send("Page.stopScreencast");
  await encode(frames, file);
}

async function encode(frames, file) {
  const delays = frames.map((f, i) => Math.max(0.04, (frames[i + 1]?.at ?? f.at + 1.2) - f.at));
  const ffmpeg = process.env.FFMPEG ?? "ffmpeg";
  if (spawnSync(ffmpeg, ["-version"], { stdio: "ignore" }).status === 0) {
    const dir = mkdtempSync(join(tmpdir(), "pws-demo-"));
    const list = frames.map((f, i) => {
      const path = join(dir, `${String(i).padStart(5, "0")}.jpg`);
      writeFileSync(path, f.buf);
      return `file '${path}'\nduration ${delays[i].toFixed(3)}`;
    });
    writeFileSync(join(dir, "frames.txt"), `${list.join("\n")}\nfile '${join(dir, `${String(frames.length - 1).padStart(5, "0")}.jpg`)}'\n`);
    const filters = "fps=15,scale=1200:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle";
    const result = spawnSync(ffmpeg, ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", join(dir, "frames.txt"), "-vf", filters, "-loop", "0", file], { stdio: "inherit" });
    rmSync(dir, { recursive: true, force: true });
    if (result.status !== 0) throw new Error(`ffmpeg failed to encode ${file}`);
  } else if (process.env.SHARP) {
    const sharp = createRequire(join(resolve(process.env.SHARP), "package.json"))("sharp");
    const width = 1200;
    const height = 750;
    // About 15 frames a second: merge frames that arrive faster into the one before.
    const kept = [];
    for (const [i, f] of frames.entries()) {
      if (kept.length && kept.at(-1).delay < 0.066) kept.at(-1).delay += delays[i];
      else kept.push({ buf: f.buf, delay: delays[i] });
    }
    const raws = [];
    for (const f of kept) raws.push(await sharp(f.buf).resize({ width, height }).ensureAlpha().raw().toBuffer());
    await sharp(Buffer.concat(raws), { raw: { width, height: height * raws.length, channels: 4, pageHeight: height }, limitInputPixels: false })
      .gif({ delay: kept.map((f) => Math.round(Math.min(f.delay, 2) * 1000)), loop: 0, effort: 10, colours: 96, dither: 0, interFrameMaxError: 4, reuse: true })
      .toFile(file);
  } else {
    throw new Error("No GIF encoder: install ffmpeg (or set FFMPEG), or set SHARP to a directory that can require sharp.");
  }
  console.log(`Wrote ${file} (${frames.length} frames, ${Math.round(readFileSync(file).length / 1024)} KB)`);
}

const tab = async ({ wait, show, keyboard }, ...modifiers) => {
  await show("Ctrl", ...modifiers, "Tab");
  for (const m of modifiers) await keyboard.down(m);
  await keyboard.press("Tab");
  for (const m of modifiers) await keyboard.up(m);
  await wait(260);
  await show("Ctrl");
  await wait(560);
};

/** Hold to browse, release to switch, a quick tap back, then type to filter. */
async function listDemo(k) {
  const { wait, show, keyboard, check } = k;
  await wait(600);
  await show("Ctrl");
  await keyboard.down("Control");
  await wait(250);
  await tab(k);
  await tab(k);
  await tab(k);
  await tab(k, "Shift");
  await check();
  await keyboard.up("Control");
  await show();
  await wait(1600);
  // A quick tap goes straight back to the previous workspace without drawing the switcher.
  await show("Ctrl", "Tab");
  await keyboard.down("Control");
  await keyboard.press("Tab");
  await keyboard.up("Control");
  await wait(350);
  await show();
  await wait(1500);
  // Typing filters every workspace, not only the recent ones, and keeps the switcher open.
  await show("Ctrl", "Tab");
  await keyboard.down("Control");
  await keyboard.press("Tab");
  await wait(450);
  await show("Ctrl");
  for (const ch of "search") {
    await keyboard.press(ch);
    await wait(130);
  }
  await keyboard.up("Control");
  await show();
  await wait(900);
  await keyboard.press("ArrowDown");
  await wait(700);
  await check();
  await show("Enter");
  await keyboard.press("Enter");
  await wait(300);
  await show();
  await wait(1700);
}

async function stripDemo(k) {
  const { wait, show, keyboard, check } = k;
  await wait(600);
  await show("Ctrl");
  await keyboard.down("Control");
  await wait(250);
  await tab(k);
  await tab(k);
  await tab(k);
  await check();
  await keyboard.up("Control");
  await show();
  await wait(1800);
}

async function hold(page) {
  await page.keyboard.down("Control");
  await page.keyboard.press("Tab");
  await page.waitForTimeout(600);
}
async function release(page) {
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.keyboard.up("Control");
  await page.waitForTimeout(300);
}

mkdirSync(OUT, { recursive: true });
const server = await startWebUi();
const browser = await chromium.launch();
try {
  for (const scheme of ["dark", "light"]) {
    const { context, page } = await prepare(browser, { scheme });
    await hold(page);
    await still(page, join(OUT, `switcher-list-${scheme}.png`));
    await release(page);
    if (scheme === "dark") {
      await hold(page);
      await page.keyboard.type("api");
      await page.waitForTimeout(400);
      await still(page, join(OUT, "switcher-filter-dark.png"));
      await release(page);
      await record(context, page, join(OUT, "switcher.gif"), listDemo);
    }
    await context.close();
  }
  {
    const { context, page } = await prepare(browser, { layout: "strip" });
    await record(context, page, join(OUT, "switcher-thumbnails.gif"), stripDemo);
    await context.close();
  }
  {
    // A phone browser has no Ctrl+Tab; Switch workspace in the Command Center opens the same list.
    const { context, page } = await prepare(browser, { width: 390, height: 844 });
    await page.evaluate(() => window.__paseoSwitcher.open());
    await page.waitForTimeout(800);
    await assertSamples(page);
    await page.screenshot({ path: join(OUT, "switcher-phone-dark.png") });
    console.log(`Wrote ${join(OUT, "switcher-phone-dark.png")}`);
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
