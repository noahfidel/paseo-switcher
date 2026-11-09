// Paseo runs the plugin's client once per connected host. These tests drive the real switcher in a
// minimal fake page: one switcher must handle the keys whatever the number of installations, and each
// host's workspaces must be read through that host's own API.
import assert from "node:assert/strict";
import { test } from "node:test";
import { registerHooks } from "node:module";

// Paseo bundles the client, so client code imports "./model" without an extension; resolve that here.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier)) return next(`${specifier}.ts`, context);
    return next(specifier, context);
  },
});
const { installSwitcher } = await import("../client/switcher.ts");

const g = globalThis as any;
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function element(): any {
  const node: any = {
    dataset: {},
    style: { setProperty() {} },
    classList: { toggle() {}, add() {}, remove() {} },
    children: [],
    setAttribute() {},
    getAttribute: () => null,
    appendChild: (child: any) => child,
    prepend() {},
    remove() {},
    replaceChildren() {},
    addEventListener() {},
    removeEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    cloneNode: () => element(),
    get firstChild() {
      return element();
    },
  };
  return node;
}

/** A fake page; `keydown` counts the live keydown listeners on the window. */
function fakePage(pathname: string, storage: Record<string, string> = {}) {
  const listeners = new Map<string, Set<unknown>>();
  const store = new Map(Object.entries(storage));
  const created: any[] = [];
  const pushed: string[] = [];
  const make = () => {
    const node = element();
    created.push(node);
    return node;
  };
  const document = {
    ...element(),
    head: element(),
    body: element(),
    hidden: false,
    createElement: make,
    createTextNode: (text: string) => Object.assign(make(), { textContent: text }),
  };
  const window = {
    location: { pathname, search: "" },
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    matchMedia: () => ({ matches: false }),
    history: { state: null, pushState: (_state: unknown, _title: string, path: string) => void pushed.push(path) },
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
  return {
    keydown: () => listeners.get("keydown")?.size ?? 0,
    /** Sends a keydown to every listener, as the browser would. */
    press: (event: Record<string, unknown>) => {
      const e = { preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...event };
      for (const fn of [...(listeners.get("keydown") ?? [])]) (fn as (e: unknown) => void)(e);
    },
    /** Releases a key, as the browser would. */
    release: (event: Record<string, unknown>) => {
      const e = { preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}, ...event };
      for (const fn of [...(listeners.get("keyup") ?? [])]) (fn as (e: unknown) => void)(e);
    },
    /** Every route the switcher navigated to by driving the router. */
    pushed,
    store,
    /** Every text the switcher has drawn so far. */
    texts: () => created.map((n) => n.textContent).filter((t): t is string => typeof t === "string"),
  };
}

function cleanGlobals() {
  for (const key of ["document", "window", "MutationObserver", "PopStateEvent", "__paseoSwitcher", "__paseoSwitcherInstalls", "__paseoSwitcherLists", "__paseoSwitcherBuild"]) delete g[key];
}

function listing(host: string, ids: string[]) {
  return {
    entries: ids.map((id) => ({ id, name: `${host} ${id}`, projectDisplayName: host, status: "done", activityAt: "2026-11-01T00:00:00Z" })),
    pageInfo: { hasMore: false },
  };
}

/**
 * A host's API that lists the given workspaces and no agents, recording each call. With `gate`, each
 * workspace list waits for that promise; a gate that never settles is a host that never answers.
 */
function fakeApi(host: string, ids: string[], calls: string[], gate?: () => Promise<unknown>, chats: Record<string, string[]> = {}): any {
  // `chats` maps a workspace id to the idle chats it holds; archiving one removes it from the host's list.
  const alive = new Set(Object.entries(chats).flatMap(([ws, list]) => list.map((id) => `${ws}/${id}`)));
  return {
    workspaces: {
      list: async () => {
        calls.push(`${host}:workspaces`);
        if (gate) await gate();
        return listing(host, ids);
      },
      archive: async (id: string) => {
        calls.push(`${host}:archive:${id}`);
        return { requestId: "r", workspaceId: id, archivedAt: "2026-11-09T00:00:00Z", error: null };
      },
    },
    agents: {
      list: async () => {
        calls.push(`${host}:agents`);
        const entries = [...alive].map((path, i) => {
          const [workspaceId, id] = path.split("/");
          return { agent: { id, workspaceId, title: `chat ${id}`, status: "idle", updatedAt: new Date(Date.UTC(2026, 10, 1, 0, 0, 100 - i)).toISOString(), labels: {} } };
        });
        return { entries, pageInfo: { hasMore: false } };
      },
      ref: (id: string) => ({
        archive: async () => {
          calls.push(`${host}:archive-chat:${id}`);
          for (const path of [...alive]) if (path.endsWith(`/${id}`)) alive.delete(path);
          return { archivedAt: "2026-11-09T00:00:00Z" };
        },
      }),
    },
  };
}

test("one switcher handles the keys however many hosts install the plugin, until the last is disposed", async () => {
  const page = fakePage("/h/srv_a/workspace/wks_1");
  try {
    const calls: string[] = [];
    const a = installSwitcher(fakeApi("srv_a", [], calls));
    const b = installSwitcher(fakeApi("srv_b", [], calls));
    await tick();
    assert.equal(page.keydown(), 1, "two installations, one key handler");
    b.dispose();
    assert.equal(page.keydown(), 1, "the other host's installation keeps the switcher");
    b.dispose();
    assert.equal(page.keydown(), 1, "disposing twice changes nothing");
    a.dispose();
    assert.equal(page.keydown(), 0, "the last installation takes it down");
  } finally {
    cleanGlobals();
  }
});

test("a host's installation re-run (Paseo does this after a navigation) keeps a single handler", async () => {
  const page = fakePage("/h/srv_a/workspace/wks_1");
  try {
    const calls: string[] = [];
    const a = installSwitcher(fakeApi("srv_a", [], calls));
    const b = installSwitcher(fakeApi("srv_b", [], calls));
    await tick();
    a.dispose();
    const a2 = installSwitcher(fakeApi("srv_a", [], calls));
    await tick();
    assert.equal(page.keydown(), 1);
    a2.dispose();
    b.dispose();
    assert.equal(page.keydown(), 0);
  } finally {
    cleanGlobals();
  }
});

test("every saved host's workspaces are loaded through that host's own API", async () => {
  const registry = JSON.stringify([{ serverId: "srv_a" }, { serverId: "srv_b" }]);
  fakePage("/h/srv_b/workspace/wks_b1", { "@paseo:daemon-registry": registry });
  try {
    const calls: string[] = [];
    const apis: Record<string, any> = { srv_a: fakeApi("srv_a", ["wks_a1"], calls), srv_b: fakeApi("srv_b", ["wks_b1"], calls) };
    const getPaseoClient = (serverId: string) => {
      const api = apis[serverId];
      if (!api) throw new Error(`Unknown Paseo host: ${serverId}`);
      return api;
    };
    // The installation's own API belongs to one host only; the switcher must not read the others through it.
    const own = fakeApi("own", ["wrong"], calls);
    const switcher = installSwitcher(own, { getPaseoClient });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(calls.filter((c) => c.endsWith(":workspaces")).sort(), ["srv_a:workspaces", "srv_b:workspaces"]);
    assert.ok(!calls.includes("own:workspaces"));
    switcher.dispose();
  } finally {
    cleanGlobals();
  }
});

test("a host that answers is shown at once, even while another host has not answered", async () => {
  const registry = JSON.stringify([{ serverId: "srv_a" }, { serverId: "srv_b" }]);
  const page = fakePage("/h/srv_a/workspace/wks_a0", { "@paseo:daemon-registry": registry });
  try {
    const calls: string[] = [];
    let answerA = () => {};
    const gateA = new Promise<void>((resolve) => (answerA = resolve));
    const apis: Record<string, any> = {
      srv_a: fakeApi("srv_a", ["wks_a1"], calls, () => gateA),
      srv_b: fakeApi("srv_b", ["wks_b1"], calls, () => new Promise(() => {})),
    };
    const switcher = installSwitcher(apis.srv_a, { getPaseoClient: (id: string) => apis[id] });
    await tick();
    switcher.open();
    await tick(20);
    assert.ok(!page.texts().includes("srv_a wks_a1"));
    answerA();
    await tick(20);
    assert.ok(page.texts().includes("srv_a wks_a1"), "host A's workspace is drawn while host B is silent");
    switcher.dispose();
  } finally {
    cleanGlobals();
  }
});

test("a host whose request never settles is asked again after the load timeout", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const registry = JSON.stringify([{ serverId: "srv_a" }, { serverId: "srv_b" }]);
  fakePage("/h/srv_a/workspace/wks_a0", { "@paseo:daemon-registry": registry });
  const flush = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  try {
    const calls: string[] = [];
    const apis: Record<string, any> = {
      srv_a: fakeApi("srv_a", ["wks_a1"], calls),
      srv_b: fakeApi("srv_b", ["wks_b1"], calls, () => new Promise(() => {})),
    };
    const switcher = installSwitcher(apis.srv_a, { getPaseoClient: (id: string) => apis[id] });
    await flush();
    const asked = () => calls.filter((c) => c === "srv_b:workspaces").length;
    assert.equal(asked(), 1);
    switcher.open();
    t.mock.timers.tick(200);
    await flush();
    assert.equal(asked(), 1, "still waiting: not asked twice at once");
    t.mock.timers.tick(10_000);
    await flush();
    switcher.open();
    t.mock.timers.tick(200);
    await flush();
    assert.equal(asked(), 2, "asked again once the first request timed out");
    switcher.dispose();
  } finally {
    t.mock.timers.reset();
    cleanGlobals();
  }
});

test("a burst of installations builds one switcher, which asks each host once", async () => {
  const registry = JSON.stringify([{ serverId: "srv_a" }, { serverId: "srv_b" }, { serverId: "srv_c" }]);
  const page = fakePage("/h/srv_a/workspace/wks_a1", { "@paseo:daemon-registry": registry });
  try {
    const calls: string[] = [];
    const apis: Record<string, any> = {
      srv_a: fakeApi("srv_a", ["wks_a1"], calls),
      srv_b: fakeApi("srv_b", ["wks_b1"], calls),
      srv_c: fakeApi("srv_c", ["wks_c1"], calls),
    };
    const getPaseoClient = (id: string) => apis[id];
    const handles = ["srv_a", "srv_b", "srv_c"].map((id) => installSwitcher(apis[id], { getPaseoClient }));
    await tick(20);
    assert.equal(calls.filter((c) => c.endsWith(":workspaces")).length, 3);
    assert.equal(calls.filter((c) => c.endsWith(":agents")).length, 3);
    assert.equal(page.keydown(), 1);
    for (const h of handles) h.dispose();
    assert.equal(page.keydown(), 0);
  } finally {
    cleanGlobals();
  }
});

test("the shortcut is known before the switcher is built", () => {
  fakePage("/h/srv_a/workspace/wks_1", { "paseo-switcher:shortcut": JSON.stringify("ctrl-tab") });
  try {
    const a = installSwitcher(fakeApi("srv_a", [], []));
    assert.equal(a.getShortcut(), "ctrl-tab");
    a.dispose();
  } finally {
    cleanGlobals();
  }
});

test("a switcher's loads that land after it is gone change nothing", async () => {
  const registry = JSON.stringify([{ serverId: "srv_a" }]);
  const page = fakePage("/h/srv_a/workspace/wks_a1", {
    "@paseo:daemon-registry": registry,
    "paseo-switcher:visits": JSON.stringify({ "srv_a:wks_a1": 1 }),
  });
  try {
    const calls: string[] = [];
    let answer = () => {};
    const gate = new Promise<void>((resolve) => (answer = resolve));
    const api = fakeApi("srv_a", ["wks_a1"], calls, () => gate);
    const a = installSwitcher(api, { getPaseoClient: () => api });
    await tick();
    assert.deepEqual(calls, ["srv_a:workspaces", "srv_a:agents"]);
    a.dispose();
    answer();
    await tick(20);
    assert.equal(page.store.get("paseo-switcher:names"), undefined, "no names written by a disposed switcher");
    assert.equal(g.__paseoSwitcherLists?.hosts.get("srv_a")?.workspaces ?? null, null, "the carried lists are not filled in later");
  } finally {
    cleanGlobals();
  }
});

/** What a plugin copy from before several hosts were supported does: replace whatever switcher is up. */
function installOld(page: { keydown: () => number }) {
  const onKey = () => {};
  g.__paseoSwitcher?.dispose();
  g.window.addEventListener("keydown", onKey);
  const old: any = {
    disposed: false,
    dispose() {
      old.disposed = true;
      g.window.removeEventListener("keydown", onKey);
      if (g.__paseoSwitcher === old) g.__paseoSwitcher = undefined;
    },
  };
  g.__paseoSwitcher = old;
  return old;
}

test("an older plugin copy on another host cannot take the keys from this one", async () => {
  const page = fakePage("/h/srv_a/workspace/wks_1");
  try {
    const a = installSwitcher(fakeApi("srv_a", [], []));
    await tick();
    assert.equal(typeof g.__paseoSwitcher.multiHost, "number", "this code's switcher is tagged");
    const old = installOld(page);
    await tick();
    assert.equal(old.disposed, true, "the older switcher is replaced again");
    assert.equal(typeof g.__paseoSwitcher?.multiHost, "number");
    assert.equal(page.keydown(), 1);
    a.dispose();
    assert.equal(page.keydown(), 0);
  } finally {
    cleanGlobals();
  }
});

test("the last installation going leaves an untagged switcher it did not make alone", async () => {
  const page = fakePage("/h/srv_a/workspace/wks_1");
  try {
    const a = installSwitcher(fakeApi("srv_a", [], []));
    await tick();
    const old = installOld(page);
    a.dispose();
    await tick();
    assert.equal(old.disposed, false);
    assert.equal(g.__paseoSwitcher, old);
    assert.equal(page.keydown(), 1);
  } finally {
    cleanGlobals();
  }
});

test("a newer plugin copy's switcher is not replaced by this one", async () => {
  const page = fakePage("/h/srv_a/workspace/wks_1");
  try {
    let replaced = false;
    const newer = { multiHost: 99, dispose: () => (replaced = true), teardown: () => (replaced = true) };
    g.__paseoSwitcher = newer;
    installSwitcher(fakeApi("srv_a", [], []));
    await tick();
    assert.equal(replaced, false);
    assert.equal(g.__paseoSwitcher, newer);
    assert.equal(page.keydown(), 0, "this code added no key handler of its own");
  } finally {
    cleanGlobals();
  }
});

test("without the SDK's host lookup and with several installations, no installation's API is taken for the host on show", async () => {
  const registry = JSON.stringify([{ serverId: "srv_a" }, { serverId: "srv_b" }]);
  fakePage("/h/srv_a/workspace/wks_a1", { "@paseo:daemon-registry": registry });
  try {
    const calls: string[] = [];
    // Which host each belongs to is unknown without getPaseoClient; the newest is srv_b's.
    const a = installSwitcher(fakeApi("srv_a", ["wks_a1"], calls));
    const b = installSwitcher(fakeApi("srv_b", ["wks_b1"], calls));
    await tick(20);
    assert.deepEqual(calls.filter((c) => c.endsWith(":workspaces")), []);
    a.dispose();
    b.dispose();
  } finally {
    cleanGlobals();
  }
});

test("⌫ archives the selected workspace through its own host's API, after a second press, and the row goes at once", async () => {
  const registry = JSON.stringify([{ serverId: "srv_a" }, { serverId: "srv_b" }]);
  const page = fakePage("/h/srv_a/workspace/wks_a0", { "@paseo:daemon-registry": registry });
  try {
    const calls: string[] = [];
    const apis: Record<string, any> = { srv_a: fakeApi("srv_a", ["wks_a0"], calls), srv_b: fakeApi("srv_b", ["wks_b1"], calls) };
    const getPaseoClient = (serverId: string) => apis[serverId];
    const switcher = installSwitcher(fakeApi("own", ["wrong"], calls), { getPaseoClient });
    await tick(20);
    // Open with the shortcut (the previous workspace, on the other host, is selected), then ⌫ with Cmd held.
    page.press({ key: "`", code: "Backquote", metaKey: true });
    page.press({ key: "Backspace", code: "Backspace", metaKey: true });
    await tick(10);
    assert.deepEqual(calls.filter((c) => c.includes("archive")), [], "the first ⌫ only arms");
    await tick(300);
    page.press({ key: "Backspace", code: "Backspace", metaKey: true });
    await tick(20);
    assert.deepEqual(calls.filter((c) => c.includes("archive")), ["srv_b:archive:wks_b1"]);
    assert.ok(!calls.includes("own:archive:wks_b1"));
    switcher.dispose();
  } finally {
    cleanGlobals();
  }
});

test("a key between the two ⌫ presses disarms, so the next ⌫ arms again", async () => {
  const registry = JSON.stringify([{ serverId: "srv_a" }, { serverId: "srv_b" }]);
  const page = fakePage("/h/srv_a/workspace/wks_a0", { "@paseo:daemon-registry": registry });
  try {
    const calls: string[] = [];
    const apis: Record<string, any> = { srv_a: fakeApi("srv_a", ["wks_a0"], calls), srv_b: fakeApi("srv_b", ["wks_b1"], calls) };
    const switcher = installSwitcher(fakeApi("own", [], calls), { getPaseoClient: (serverId: string) => apis[serverId] });
    await tick(20);
    page.press({ key: "`", code: "Backquote", metaKey: true });
    page.press({ key: "Backspace", code: "Backspace", metaKey: true });
    page.press({ key: "ArrowDown", code: "ArrowDown", metaKey: true });
    page.press({ key: "ArrowUp", code: "ArrowUp", metaKey: true });
    page.press({ key: "Backspace", code: "Backspace", metaKey: true });
    await tick(20);
    assert.deepEqual(calls.filter((c) => c.includes("archive")), []);
    switcher.dispose();
  } finally {
    cleanGlobals();
  }
});

test("⇧⌫ hides the selected workspace instead of archiving it", async () => {
  const registry = JSON.stringify([{ serverId: "srv_a" }, { serverId: "srv_b" }]);
  const page = fakePage("/h/srv_a/workspace/wks_a0", { "@paseo:daemon-registry": registry });
  try {
    const calls: string[] = [];
    const apis: Record<string, any> = { srv_a: fakeApi("srv_a", ["wks_a0"], calls), srv_b: fakeApi("srv_b", ["wks_b1"], calls) };
    const switcher = installSwitcher(fakeApi("own", [], calls), { getPaseoClient: (serverId: string) => apis[serverId] });
    await tick(20);
    page.press({ key: "`", code: "Backquote", metaKey: true });
    page.press({ key: "Backspace", code: "Backspace", metaKey: true, shiftKey: true });
    await tick(20);
    assert.deepEqual(calls.filter((c) => c.includes("archive")), []);
    assert.deepEqual(JSON.parse(page.store.get("paseo-switcher:hidden") ?? "[]"), ["srv_b:wks_b1"]);
    switcher.dispose();
  } finally {
    cleanGlobals();
  }
});

const BS = { key: "Backspace", code: "Backspace", metaKey: true };

/** Two hosts; srv_b's workspace holds the given idle chats. The switcher is open on srv_b's workspace. */
async function openWithChats(chatIds: string[]) {
  const registry = JSON.stringify([{ serverId: "srv_a" }, { serverId: "srv_b" }]);
  const page = fakePage("/h/srv_a/workspace/wks_a0", { "@paseo:daemon-registry": registry });
  const calls: string[] = [];
  const apis: Record<string, any> = {
    srv_a: fakeApi("srv_a", ["wks_a0"], calls),
    srv_b: fakeApi("srv_b", ["wks_b1", "wks_b2"], calls, undefined, { wks_b1: chatIds }),
  };
  const switcher = installSwitcher(fakeApi("own", [], calls), { getPaseoClient: (serverId: string) => apis[serverId] });
  await tick(20);
  page.press({ key: "`", code: "Backquote", metaKey: true });
  await tick(150);
  const archived = () => calls.filter((c) => c.includes("archive"));
  return { page, calls, archived, switcher };
}

test("a held ⌫ never archives rows: it clears the filter, stops at empty, and archives nothing", async () => {
  const { page, archived, switcher } = await openWithChats([]);
  try {
    page.press({ key: "w", code: "KeyW", metaKey: true });
    page.press(BS);
    for (let i = 0; i < 8; i++) page.press({ ...BS, repeat: true });
    await tick(300);
    for (let i = 0; i < 8; i++) page.press({ ...BS, repeat: true });
    await tick(20);
    assert.deepEqual(archived(), []);
  } finally {
    switcher.dispose();
    cleanGlobals();
  }
});

test("a held ⌫ in the chat list archives only the first chat, and does not go on to the workspaces", async () => {
  const { page, archived, switcher } = await openWithChats(["c1", "c2", "c3"]);
  try {
    page.press({ key: "ArrowRight", code: "ArrowRight", metaKey: true });
    await tick(30);
    page.press(BS);
    for (let i = 0; i < 10; i++) page.press({ ...BS, repeat: true });
    await tick(300);
    for (let i = 0; i < 10; i++) page.press({ ...BS, repeat: true });
    await tick(20);
    assert.equal(archived().length, 1, archived().join());
    assert.ok(archived()[0].startsWith("srv_b:archive-chat:"));
  } finally {
    switcher.dispose();
    cleanGlobals();
  }
});

test("emptying the chat list by ⌫ returns to the workspaces, and a held ⌫ then archives no workspace", async () => {
  const { page, archived, switcher } = await openWithChats(["c1"]);
  try {
    page.press({ key: "ArrowRight", code: "ArrowRight", metaKey: true });
    await tick(30);
    page.press(BS);
    for (let i = 0; i < 10; i++) page.press({ ...BS, repeat: true });
    await tick(300);
    for (let i = 0; i < 10; i++) page.press({ ...BS, repeat: true });
    await tick(20);
    assert.deepEqual(archived(), ["srv_b:archive-chat:c1"]);
  } finally {
    switcher.dispose();
    cleanGlobals();
  }
});

test("a second ⌫ right after arming is ignored and keeps the row armed; after the guard it archives", async () => {
  const { page, archived, switcher } = await openWithChats([]);
  try {
    page.press(BS);
    page.press(BS);
    await tick(20);
    assert.deepEqual(archived(), []);
    await tick(300);
    page.press(BS);
    await tick(20);
    assert.deepEqual(archived(), ["srv_b:archive:wks_b1"]);
  } finally {
    switcher.dispose();
    cleanGlobals();
  }
});

const RELEASE = { key: "Meta" };

test("releasing the modifier still switches when nothing was archived or hidden", async () => {
  const { page, switcher } = await openWithChats([]);
  try {
    page.release(RELEASE);
    await tick(30);
    assert.deepEqual(page.pushed.map((p) => p.includes("wks_b1")), [true]);
  } finally {
    switcher.dispose();
    cleanGlobals();
  }
});

test("after archiving a workspace in hold mode, releasing the modifier opens nothing", async () => {
  const { page, archived, switcher } = await openWithChats([]);
  try {
    page.press(BS);
    await tick(300);
    page.press(BS);
    await tick(20);
    assert.deepEqual(archived(), ["srv_b:archive:wks_b1"]);
    page.release(RELEASE);
    await tick(30);
    assert.deepEqual(page.pushed, []);
  } finally {
    switcher.dispose();
    cleanGlobals();
  }
});

test("after archiving a chat in hold mode, releasing the modifier opens nothing", async () => {
  const { page, archived, switcher } = await openWithChats(["c1", "c2"]);
  try {
    page.press({ key: "ArrowRight", code: "ArrowRight", metaKey: true });
    await tick(30);
    page.press(BS);
    await tick(20);
    assert.equal(archived().length, 1);
    page.release(RELEASE);
    await tick(30);
    assert.deepEqual(page.pushed, []);
  } finally {
    switcher.dispose();
    cleanGlobals();
  }
});

test("after hiding a workspace in hold mode, releasing the modifier opens nothing", async () => {
  const { page, switcher } = await openWithChats([]);
  try {
    page.press({ ...BS, shiftKey: true });
    await tick(20);
    page.release(RELEASE);
    await tick(30);
    assert.deepEqual(page.pushed, []);
  } finally {
    switcher.dispose();
    cleanGlobals();
  }
});
