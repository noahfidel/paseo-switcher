#!/usr/bin/env node
// Records the README demo GIFs of the real switcher, one per layout, running against the local
// daemon, with every workspace name, detail and all conversation text swapped for sample data so
// nothing private is published.
//
//   npm run media    # writes docs/images/switcher-list.gif and switcher-thumbnails.gif
//
// Needs ffmpeg on PATH, or its path in FFMPEG, to encode the GIFs.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { authenticate, findWebUi, ORIGIN, serve } from "./browser.mjs";

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../../docs/images");

const SAMPLES = [
  {
    name: "Checkout redesign", project: "storefront", branch: "checkout-v2", additions: 412, deletions: 96,
    status: "running", time: "for 3m", pr: { number: 482, state: "open", checks: "pending", review: null }, ahead: 0,
  },
  {
    name: "Rate limit the public API", project: "api", branch: "rate-limits", additions: 158, deletions: 23,
    status: "needs_input", time: "for 12m", pr: { number: 477, state: "open", checks: "success", review: "approved" }, ahead: 0,
  },
  {
    name: "Fix the flaky login test on Safari", project: "storefront", branch: "fix-login-flake", additions: 12, deletions: 31,
    status: "done", time: "2h ago", pr: { number: 470, state: "merged", checks: "success", review: null }, ahead: 0,
  },
  {
    name: "Docs search", project: "docs", branch: "search-index", additions: 640, deletions: 118,
    status: "done", time: "5h ago", pr: null, ahead: 2,
  },
  {
    name: "Upgrade to Postgres 17", project: "api", branch: "pg17", additions: 77, deletions: 54,
    status: "failed", time: "for 1d", pr: { number: 455, state: "draft", checks: "failure", review: null }, ahead: 0,
  },
];

/**
 * Runs in the page. Replaces every text node outside the switcher with sample words of the same
 * length, keeps doing so as the app renders, hides images, and hides text typed into inputs.
 */
function scrub(samples) {
  const WORDS = ("the agent read files tests passed update config handler route schema request response " +
    "migration branch commit review change build deploy check error fixed added removed query cache " +
    "index server client value field model state event worker queue retry limit token result output").split(" ");
  const byLength = new Map();
  for (const w of WORDS) (byLength.get(w.length) ?? byLength.set(w.length, []).get(w.length)).push(w);
  let n = 0;
  const word = (len) => {
    const exact = byLength.get(len);
    if (exact) return exact[n++ % exact.length];
    let out = "";
    while (out.length < len) out += (out ? "-" : "") + WORDS[n++ % WORDS.length];
    return out.slice(0, len);
  };
  const sample = (text) => text.replace(/[^\s.,:;()[\]{}'"`/]+/g, (w) => (/^\d+$/.test(w) ? w : word(w.length)));

  const names = new Map(samples.map((s) => [s.key, s.name]));
  const rowKey = (node) =>
    node.parentElement?.closest('[data-testid^="sidebar-workspace-row-"]')?.dataset.testid.slice("sidebar-workspace-row-".length);
  /** What this function last wrote to each node, so its own writes are not rewritten again. */
  const written = new WeakMap();
  const rewrite = (node) => {
    if (written.get(node) === node.data || !node.data.trim() || node.parentElement?.closest(".pws-host, .demo-keys, style, script")) return;
    const key = rowKey(node);
    const name = key && names.get(key);
    // A sidebar row's first multi-letter text is the workspace name; the rest is detail.
    if (name && !node.parentElement.closest("[data-pws-named]") && node.data.trim().length > 1) {
      node.parentElement.closest('[data-testid^="sidebar-workspace-row-"]').setAttribute("data-pws-named", "");
      node.data = name;
    } else {
      node.data = sample(node.data);
    }
    written.set(node, node.data);
  };
  const walk = (root) => {
    if (root.nodeType === Node.TEXT_NODE) return rewrite(root);
    const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (it.nextNode()) rewrite(it.currentNode);
  };
  const style = document.createElement("style");
  style.textContent = `img, video { visibility: hidden !important; }
    textarea, input { color: transparent !important; caret-color: transparent !important; }`;
  document.head.appendChild(style);
  walk(document.body);
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "characterData") rewrite(r.target);
      else for (const node of r.addedNodes) walk(node);
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true });
}

/**
 * Runs in the page. Keeps every card and row in the switcher labeled with its sample, including
 * ones the plugin re-renders while it is open. It runs before the browser paints, after every
 * change to the switcher. A card with no sample hides the switcher and is recorded, so a capture
 * never shows it. Labels mirror the plugin's own markup so the capture looks the same.
 */
function labels(samples) {
  const byKey = new Map(samples.map((s) => [s.key, s]));
  const make = (tag, className, textContent = "") => Object.assign(document.createElement(tag), { className, textContent });
  const host = document.querySelector(".pws-host");
  const hue = (text) => {
    let h = 0;
    for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360;
    return `hsl(${h} 45% 45%)`;
  };
  const diff = (s) => {
    const span = make("span", "pws-diff");
    span.append(make("span", "pws-add", `+${s.additions}`), make("span", "pws-del", `−${s.deletions}`));
    return span;
  };
  const labelCard = (card, s) => {
    card.querySelector(".pws-name").textContent = s.name;
    card.querySelector(".pws-where").textContent = `${s.project} · ${s.branch}`;
    card.querySelector(".pws-dot")?.remove();
    if (s.status !== "done") card.querySelector(".pws-title").prepend(make("span", `pws-dot pws-${s.status}`));
    card.querySelector(".pws-diff")?.remove();
    card.querySelector(".pws-meta").append(diff(s));
  };
  const labelRow = (row, s) => {
    const badge = row.querySelector(".pws-badge");
    badge.textContent = s.project[0].toUpperCase();
    badge.style.background = hue(s.project);
    const meta = make("div", "pws-meta");
    const part = (className, text) => meta.appendChild(make("span", `pws-part ${className}`, text));
    part("", s.project);
    if (s.branch !== s.name) part("pws-branch", s.branch);
    if (s.pr) {
      const state = s.pr.state === "open" ? "" : ` ${s.pr.state[0].toUpperCase()}${s.pr.state.slice(1)}`;
      const chip = part(`pws-pr pws-pr-${s.pr.state}`, `#${s.pr.number}${state}`);
      if (s.pr.state === "open" || s.pr.state === "draft") {
        const mark = { success: "✓", failure: "✕", pending: "●" }[s.pr.checks];
        if (mark) chip.appendChild(make("span", `pws-checks pws-checks-${s.pr.checks}`, ` ${mark}`));
        if (s.pr.review === "approved") part("pws-approved", "Approved");
      }
    }
    const d = diff(s);
    d.classList.add("pws-part");
    meta.appendChild(d);
    if (s.ahead) part("", `↑${s.ahead}`);
    row.querySelector(".pws-main").replaceChildren(make("div", "pws-name", s.name), meta);
    const side = [];
    if (s.status !== "done") {
      const label = { running: "Running", needs_input: "Needs input", attention: "Needs attention", failed: "Failed" }[s.status];
      const status = make("div", `pws-status pws-status-${s.status}`);
      status.append(make("span", `pws-dot pws-${s.status}`), make("span", "", label));
      side.push(status);
    }
    side.push(make("div", "pws-time", s.time));
    row.querySelector(".pws-side").replaceChildren(...side);
  };
  window.__pwsUnlabeled = [];
  new MutationObserver(() => {
    for (const card of host.querySelectorAll(".pws-card")) {
      const s = byKey.get(card.dataset.key);
      if (!s) {
        card.closest(".pws-root").style.visibility = "hidden";
        window.__pwsUnlabeled.push(card.dataset.key);
      } else if (card.dataset.sample !== card.textContent) {
        if (card.classList.contains("pws-row")) labelRow(card, s);
        else labelCard(card, s);
        card.setAttribute("aria-label", s.name);
        // Any later change by the plugin no longer matches this text and is relabeled.
        card.dataset.sample = card.textContent;
      }
    }
  }).observe(host, { subtree: true, childList: true, characterData: true });
}

/** Never publish a capture that could show a real workspace. */
async function assertLabeled(page, samples) {
  const problem = await page.evaluate((names) => {
    if (window.__pwsUnlabeled.length) return `${window.__pwsUnlabeled.length} card(s) had no sample`;
    const shown = [...document.querySelectorAll(".pws-name")].map((n) => n.textContent);
    if (shown.find((name) => !names.includes(name))) return "a card shows a name that is not a sample";
    const cards = [...document.querySelectorAll(".pws-card")];
    return cards.some((c) => c.dataset.sample !== c.textContent) ? "a card has text that is not from its sample" : null;
  }, samples.map((s) => s.name));
  if (problem) throw new Error(`Refusing to write the capture: ${problem}`);
}

/** Runs in the page. Adds `window.showKeys(...)`, which draws keycaps, since a GIF cannot show key presses. */
function keycaps() {
  const box = document.createElement("div");
  box.className = "demo-keys";
  box.style.cssText = `position: fixed; left: 50%; bottom: 150px; transform: translateX(-50%); z-index: 2147483647;
    display: flex; gap: 8px; pointer-events: none; font: 600 22px/1 system-ui, sans-serif;`;
  document.body.appendChild(box);
  window.showKeys = (keys) =>
    box.replaceChildren(
      ...keys.map((key) => {
        const cap = document.createElement("span");
        cap.textContent = key;
        cap.style.cssText = `padding: 10px 16px; border-radius: 10px; color: #fff; background: rgba(20, 20, 24, 0.88);
          box-shadow: 0 2px 0 rgba(0, 0, 0, 0.5), inset 0 0 0 1px rgba(255, 255, 255, 0.18);`;
        return cap;
      }),
    );
}

async function prepare(browser, scheme, layout) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme, deviceScaleFactor: 2 });
  await authenticate(context);
  await context.addInitScript((layout) => {
    try {
      localStorage.setItem("paseo-switcher:layout", JSON.stringify(layout));
    } catch {}
  }, layout);
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/`);
  await page.waitForSelector(".pws-host", { state: "attached", timeout: 30000 });
  await page.waitForSelector('[data-testid^="sidebar-workspace-row-"]', { state: "attached", timeout: 30000 });
  const keys = (
    await page.$$eval('[data-testid^="sidebar-workspace-row-"]', (els) =>
      els.map((e) => e.dataset.testid.replace("sidebar-workspace-row-", "")),
    )
  ).slice(0, SAMPLES.length);
  if (keys.length < SAMPLES.length) throw new Error(`Need at least ${SAMPLES.length} workspaces in the sidebar`);
  const samples = SAMPLES.map((s, i) => ({ ...s, key: keys[i] }));
  await page.evaluate(() => localStorage.removeItem("paseo-switcher:mru"));
  await page.evaluate(scrub, samples);
  await page.evaluate(labels, samples);

  // The strip lists the most recent first, so visit in reverse to put the first sample first.
  for (const { key } of [...samples].reverse()) {
    const before = await page.evaluate(() => performance.getEntriesByName("pws:draw").length);
    const [, workspace] = key.split(/:(?=[^:]*$)/);
    await page.locator(`[data-testid="sidebar-workspace-row-${key}"]`).click({ force: true });
    await page.waitForURL((url) => url.pathname.endsWith(`/workspace/${encodeURIComponent(workspace)}`), { timeout: 10000 });
    if (layout === "list") {
      await page.waitForTimeout(800);
      continue;
    }
    // A thumbnail is taken once the app is idle, after a quiet period following the switch.
    await page
      .waitForFunction((n) => performance.getEntriesByName("pws:draw").length > n, before, { timeout: 20000 })
      .catch(() => console.warn(`No thumbnail for ${key}`));
  }
  return { context, page, samples };
}

/** Records hold-to-browse, release-to-switch, and a quick tap back, then encodes a GIF. */
async function demo(context, page, samples, ffmpeg, file) {
  await page.evaluate(keycaps);
  // Park the mouse away from the sidebar and the strip so no tooltip or hover shows.
  await page.mouse.move(1100, 110);
  await page.waitForTimeout(2500);
  const dir = mkdtempSync(join(tmpdir(), "pws-demo-"));
  const frames = [];
  const cdp = await context.newCDPSession(page);
  cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    const file = join(dir, `${String(frames.length).padStart(5, "0")}.jpg`);
    writeFileSync(file, Buffer.from(data, "base64"));
    frames.push({ file, at: metadata.timestamp });
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1440, maxHeight: 900 });
  const wait = (ms) => page.waitForTimeout(ms);
  // The plugin stops the key events it handles, so the script draws the keycaps itself.
  const show = (...keys) => page.evaluate((keys) => window.showKeys(keys), keys);
  const tab = async (...modifiers) => {
    await show("Ctrl", ...modifiers, "Tab");
    for (const m of modifiers) await page.keyboard.down(m);
    await page.keyboard.press("Tab");
    for (const m of modifiers) await page.keyboard.up(m);
    await wait(220);
    await show("Ctrl");
    await wait(480);
  };
  await wait(900);
  await show("Ctrl");
  await page.keyboard.down("Control");
  await wait(250);
  await tab();
  await tab();
  await tab();
  await tab("Shift");
  await page.keyboard.up("Control");
  await show();
  await wait(1700);
  // A quick tap goes straight back to the previous workspace without drawing the strip.
  await show("Ctrl", "Tab");
  await page.keyboard.down("Control");
  await page.keyboard.press("Tab");
  await page.keyboard.up("Control");
  await wait(300);
  await show();
  await wait(1700);
  await cdp.send("Page.stopScreencast");
  await assertLabeled(page, samples);

  const list = frames.map((f, i) => `file '${f.file}'\nduration ${((frames[i + 1]?.at ?? f.at + 1) - f.at).toFixed(3)}`);
  writeFileSync(join(dir, "frames.txt"), `${list.join("\n")}\nfile '${frames.at(-1).file}'\n`);
  const filters = "fps=15,scale=1200:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle";
  const result = spawnSync(ffmpeg, ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", join(dir, "frames.txt"), "-vf", filters, "-loop", "0", file], { stdio: "inherit" });
  rmSync(dir, { recursive: true, force: true });
  if (result.status !== 0) throw new Error(`ffmpeg failed to encode ${file}`);
  console.log(`Wrote ${file} (${frames.length} frames)`);
}

const ffmpeg = process.env.FFMPEG ?? "ffmpeg";
if (spawnSync(ffmpeg, ["-version"], { stdio: "ignore" }).status !== 0) {
  throw new Error("ffmpeg not found. Install it, or set FFMPEG to its path.");
}
mkdirSync(OUT, { recursive: true });
const server = await serve(findWebUi());
const browser = await chromium.launch();
try {
  for (const [layout, name] of [["list", "switcher-list.gif"], ["strip", "switcher-thumbnails.gif"]]) {
    const { context, page, samples } = await prepare(browser, "dark", layout);
    await demo(context, page, samples, ffmpeg, join(OUT, name));
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
