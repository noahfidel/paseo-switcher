// The open switcher polls its lists every 1.5 s. A poll must not redraw what the user is looking
// at: rows that show the same thing keep their nodes (so icons don't reload, spinners don't restart
// and hover stays put), and a row whose status changed changes alone. These tests run the real
// switcher in a small DOM that keeps node identity (test/mini-dom.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { registerHooks } from "node:module";
import { miniDocument, MiniElement, type MiniNode } from "./mini-dom.ts";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier)) return next(`${specifier}.ts`, context);
    return next(specifier, context);
  },
});
const { installSwitcher } = await import("../client/switcher.ts");

const g = globalThis as any;

function page(pathname: string, storage: Record<string, string> = {}) {
  const listeners = new Map<string, Set<unknown>>();
  const store = new Map(Object.entries(storage));
  const { document } = miniDocument();
  const window = {
    location: { pathname, search: "" },
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
    matchMedia: () => ({ matches: false }),
    history: { state: null, pushState() {} },
    innerWidth: 1200,
    innerHeight: 800,
    requestAnimationFrame: (f: () => void) => setTimeout(f, 0),
    queueMicrotask: (f: () => void) => queueMicrotask(f),
    getComputedStyle: () => ({ backgroundColor: "rgb(255, 255, 255)" }),
    addEventListener(type: string, fn: unknown) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: unknown) {
      listeners.get(type)?.delete(fn);
    },
    dispatchEvent() {},
  };
  g.document = document;
  g.window = window;
  g.PopStateEvent = class {};
  g.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  // paseo-bots' avatars, so rows carry an <img> that would visibly reload if it were recreated.
  g.__paseoBotsAvatars = { version: 1, get: () => ({ imageUrl: "https://example.com/bot.png" }) };
  return {
    document,
    press: (event: Record<string, unknown>) => {
      const e = { preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...event };
      for (const fn of [...(listeners.get("keydown") ?? [])]) (fn as (e: unknown) => void)(e);
    },
    root: (): MiniElement => {
      const root = document.body.querySelector(".pws-root");
      assert.ok(root, "the switcher is drawn");
      return root;
    },
  };
}

function cleanGlobals() {
  for (const key of ["document", "window", "MutationObserver", "PopStateEvent", "__paseoSwitcher", "__paseoSwitcherInstalls", "__paseoSwitcherLists", "__paseoSwitcherBuild", "__paseoBotsChatOpens", "__paseoBotsAvatars"]) delete g[key];
}

const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};

/**
 * Three workspaces and two chats in workspace 2. Every list call moves the activity times forward,
 * as Paseo's do while an agent works, without changing anything a row shows.
 */
function liveApi() {
  const state = { status: { wks_2: "done", wks_3: "done" } as Record<string, string>, chats: { c1: "idle", c2: "idle" } as Record<string, string>, newest: "c2" };
  const recent = () => new Date(Date.now() - 1000).toISOString();
  const workspace = (id: string, name: string, status: string) => ({ id, name, projectDisplayName: "proj", status, activityAt: recent(), statusEnteredAt: recent(), gitRuntime: { currentBranch: `b-${id}` } });
  const api: any = {
    terminals: { list: async () => ({ entries: [], requestId: "r" }) },
    workspaces: {
      list: async () => ({
        entries: [workspace("wks_1", "current", "done"), workspace("wks_2", "other", state.status.wks_2), workspace("wks_3", "third", state.status.wks_3)],
        pageInfo: { hasMore: false },
      }),
    },
    agents: {
      list: async () => {
        const chat = (id: string, offset: number) => ({
          agent: { id, workspaceId: "wks_2", title: `chat ${id}`, status: state.chats[id], updatedAt: new Date(Date.now() - offset).toISOString(), labels: { "paseo-bots.bot": "bot1" } },
        });
        const [a, b] = state.newest === "c2" ? [chat("c2", 1000), chat("c1", 2000)] : [chat("c1", 1000), chat("c2", 2000)];
        return { entries: [a, b], pageInfo: { hasMore: false } };
      },
    },
  };
  return { api, state };
}

async function setup(t: any, storage: Record<string, string> = {}) {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 1_000_000 });
  // Visits make wks_2 and wks_3 the recent workspaces, so they are on show.
  const visits = JSON.stringify({ "srv_a:wks_1": 999_000, "srv_a:wks_2": 998_000, "srv_a:wks_3": 997_000 });
  const p = page("/h/srv_a/workspace/wks_1", { "paseo-switcher:visits": visits, ...storage });
  const { api, state } = liveApi();
  const switcher = installSwitcher(api);
  t.mock.timers.tick(1);
  await flush();
  const advance = async (ms: number) => {
    t.mock.timers.tick(ms);
    await flush();
  };
  const done = () => {
    switcher.dispose();
    t.mock.timers.reset();
    cleanGlobals();
  };
  return { ...p, state, switcher, advance, done };
}

/** Every node under the switcher, in order. */
function allNodes(root: MiniElement): MiniNode[] {
  const out: MiniNode[] = [];
  const walk = (node: MiniElement) => {
    for (const kid of node.childNodes) {
      out.push(kid);
      if (kid instanceof MiniElement) walk(kid);
    }
  };
  walk(root);
  return out;
}

function rowFor(root: MiniElement, key: string): MiniElement {
  const row = root.querySelector(`.pws-card[data-key="${key}"]`);
  assert.ok(row, `row ${key} is drawn`);
  return row;
}

function sameNodes(before: MiniNode[], after: MiniNode[], what: string) {
  assert.equal(after.length, before.length, `${what}: as many nodes`);
  for (let i = 0; i < before.length; i++) assert.equal(after[i], before[i], `${what}: node ${i} kept`);
}

test("a poll where only activity times moved leaves every node of the list in place", async (t) => {
  const s = await setup(t);
  try {
    s.switcher.open();
    await s.advance(1);
    await s.advance(1500);
    const root = s.root();
    assert.ok(root.querySelectorAll(".pws-card").length >= 2, "rows are drawn");
    assert.ok(root.querySelectorAll("img").length > 0, "a row shows an avatar image");
    const before = allNodes(root);
    await s.advance(1500);
    await s.advance(1500);
    assert.equal(s.root(), root, "the overlay is the same");
    sameNodes(before, allNodes(root), "list");
  } finally {
    s.done();
  }
});

test("a workspace whose status changes redraws only that row, and its avatar stays", async (t) => {
  const s = await setup(t);
  try {
    s.switcher.open();
    await s.advance(1);
    await s.advance(1500);
    const root = s.root();
    const other = rowFor(root, "srv_a:wks_3");
    const otherNodes = allNodes(other);
    const changing = rowFor(root, "srv_a:wks_2");
    const avatar = changing.querySelector("img");
    assert.ok(avatar, "the changing row has an avatar");
    s.state.status.wks_2 = "running";
    await s.advance(1500);
    const row = rowFor(root, "srv_a:wks_2");
    assert.ok(row.querySelector(".pws-status-running"), "the row shows running");
    assert.equal(row.querySelector("img"), avatar, "the avatar image was not recreated");
    assert.equal(rowFor(root, "srv_a:wks_3"), other, "the other row is the same node");
    sameNodes(otherNodes, allNodes(other), "unchanged row");
  } finally {
    s.done();
  }
});

test("a running spinner is not restarted by a poll", async (t) => {
  const s = await setup(t);
  try {
    s.state.status.wks_2 = "running";
    s.switcher.open();
    await s.advance(1);
    await s.advance(1500);
    const spin = s.root().querySelector(".pws-spin");
    assert.ok(spin, "a spinner is drawn");
    await s.advance(1500);
    assert.equal(s.root().querySelector(".pws-spin"), spin, "the same spinner keeps turning");
  } finally {
    s.done();
  }
});

/** Opens the switcher on wks_2's sessions: the preselected row is the previous workspace. */
async function drillIn(s: Awaited<ReturnType<typeof setup>>) {
  s.switcher.open();
  await s.advance(1);
  s.press({ key: "ArrowRight", code: "ArrowRight" });
  await s.advance(50);
  await s.advance(1500);
  const root = s.root();
  assert.ok(root.querySelector('[data-agent="c1"]'), "the session list is open");
  return root;
}

test("a poll where only update times moved leaves the session list in place", async (t) => {
  const s = await setup(t);
  try {
    const root = await drillIn(s);
    const before = allNodes(root);
    await s.advance(1500);
    await s.advance(1500);
    sameNodes(before, allNodes(root), "sessions");
  } finally {
    s.done();
  }
});

test("a chat whose status changes redraws only its session row", async (t) => {
  const s = await setup(t);
  try {
    const root = await drillIn(s);
    const other = root.querySelector('[data-agent="c2"]')!;
    const otherNodes = allNodes(other);
    s.state.chats.c1 = "running";
    await s.advance(1500);
    assert.ok(root.querySelector('[data-agent="c1"] .pws-status-running'), "c1 shows running");
    assert.equal(root.querySelector('[data-agent="c2"]'), other, "c2 is the same node");
    sameNodes(otherNodes, allNodes(other), "c2");
  } finally {
    s.done();
  }
});

test("after rows trade places, hovering and clicking a kept row act on that row", async (t) => {
  const s = await setup(t);
  try {
    const root = await drillIn(s);
    const c1 = root.querySelector('[data-agent="c1"]')!;
    s.state.newest = "c1";
    await s.advance(1500);
    const rows = root.querySelectorAll(".pws-card");
    assert.equal(rows[0].getAttribute("data-agent"), "c1", "c1 moved to the top");
    assert.equal(rows[0], c1, "and kept its node");
    rows[1].fire("mousemove");
    assert.ok(rows[1].classList.contains("pws-selected"), "hover selects the row under the pointer");
    rows[0].fire("mousemove");
    assert.ok(rows[0].classList.contains("pws-selected"), "hover selects the moved row");
    assert.ok(!rows[1].classList.contains("pws-selected"));
  } finally {
    s.done();
  }
});

test("in the strip, a poll where only activity times moved leaves every card in place", async (t) => {
  const s = await setup(t, { "paseo-switcher:layout": JSON.stringify("strip") });
  try {
    s.switcher.open();
    await s.advance(1);
    await s.advance(1500);
    const root = s.root();
    assert.ok(root.querySelector(".pws-thumb"), "cards with thumbnails are drawn");
    const before = allNodes(root);
    await s.advance(1500);
    await s.advance(1500);
    sameNodes(before, allNodes(root), "strip");
  } finally {
    s.done();
  }
});
