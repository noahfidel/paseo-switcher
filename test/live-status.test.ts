// While the switcher is open its status marks must follow Paseo's sidebar. The SDK has no live
// feed, so the open switcher polls; these tests drive it with fake timers and a fake page.
import assert from "node:assert/strict";
import { test } from "node:test";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier)) return next(`${specifier}.ts`, context);
    return next(specifier, context);
  },
});
const { installSwitcher } = await import("../client/switcher.ts");

const g = globalThis as any;

function element(): any {
  return {
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
}

function fakePage(pathname: string) {
  const listeners = new Map<string, Set<unknown>>();
  const store = new Map<string, string>();
  const created: any[] = [];
  const pushed: string[] = [];
  const make = () => {
    const node = element();
    created.push(node);
    return node;
  };
  const document = { ...element(), head: element(), body: element(), hidden: false, createElement: make, createTextNode: (text: string) => Object.assign(make(), { textContent: text }) };
  const window = {
    location: { pathname, search: "" },
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
    matchMedia: () => ({ matches: false }),
    history: { state: null, pushState: (_s: unknown, _t: string, path: string) => void pushed.push(path) },
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
    document,
    press: (event: Record<string, unknown>) => {
      const e = { preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...event };
      for (const fn of [...(listeners.get("keydown") ?? [])]) (fn as (e: unknown) => void)(e);
    },
    texts: () => created.map((n) => n.textContent).filter((t): t is string => typeof t === "string"),
    drawn: () => created.length,
    pushed,
  };
}

function cleanGlobals() {
  for (const key of ["document", "window", "MutationObserver", "PopStateEvent", "__paseoSwitcher", "__paseoSwitcherInstalls", "__paseoSwitcherLists", "__paseoSwitcherBuild", "__paseoBotsChatOpens"]) delete g[key];
}

/** Lets promise chains settle without moving the fake clock. */
const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};

/** A host with two workspaces and one chat whose statuses a test can change; each list is counted and can be held. */
function liveApi() {
  const state = { workspace: "done", third: "done", chat: "idle", workspaceCalls: 0, agentCalls: 0, hold: null as null | Promise<void> };
  const api: any = {
    terminals: { list: async () => ({ entries: [], requestId: "r" }) },
    workspaces: {
      list: async () => {
        state.workspaceCalls++;
        if (state.hold) await state.hold;
        return {
          entries: [
            { id: "wks_1", name: "current", projectDisplayName: "proj", status: "done", activityAt: "2026-11-01T00:00:00Z" },
            { id: "wks_2", name: "other", projectDisplayName: "proj", status: state.workspace, activityAt: "2026-11-01T00:00:00Z" },
            { id: "wks_3", name: "third", projectDisplayName: "proj", status: state.third, activityAt: "2026-10-01T00:00:00Z" },
          ],
          pageInfo: { hasMore: false },
        };
      },
    },
    agents: {
      list: async () => {
        state.agentCalls++;
        if (state.hold) await state.hold;
        return {
          entries: [{ agent: { id: "c1", workspaceId: "wks_2", title: "chat c1", status: state.chat, updatedAt: "2026-11-01T00:00:00Z", labels: {} } }],
          pageInfo: { hasMore: false },
        };
      },
    },
  };
  return { api, state };
}

/** Installs the switcher on workspace 1 with the clock under the test's control, after the first loads landed. */
async function setup(t: any, hold?: Promise<void>) {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 1_000_000 });
  const page = fakePage("/h/srv_a/workspace/wks_1");
  const { api, state } = liveApi();
  state.hold = hold ?? null;
  const switcher = installSwitcher(api);
  t.mock.timers.tick(1);
  await flush();
  return { page, state, switcher, advance: async (ms: number) => (t.mock.timers.tick(ms), flush()) };
}

const OPEN_KEYS = { key: "ArrowRight", code: "ArrowRight" };

test("showing the switcher fetches fresh lists even when the cache is under 5 seconds old", async (t) => {
  const { state, switcher, advance } = await setup(t);
  try {
    const [w, a] = [state.workspaceCalls, state.agentCalls];
    await advance(1000);
    switcher.open();
    await advance(1);
    assert.equal(state.workspaceCalls, w + 1, "workspaces reloaded on show");
    assert.equal(state.agentCalls, a + 1, "agents reloaded on show");
  } finally {
    switcher.dispose();
    t.mock.timers.reset();
    cleanGlobals();
  }
});

test("a tap-tap within half a second does not fetch twice", async (t) => {
  const { state, switcher, page, advance } = await setup(t);
  try {
    await advance(1000);
    switcher.open();
    await advance(1);
    const w = state.workspaceCalls;
    page.press({ key: "Escape", code: "Escape" });
    await advance(100);
    switcher.open();
    await advance(1);
    assert.equal(state.workspaceCalls, w, "a list under half a second old is reused");
  } finally {
    switcher.dispose();
    t.mock.timers.reset();
    cleanGlobals();
  }
});

test("while open, workspaces and agents reload about every 1.5 seconds", async (t) => {
  const { state, switcher, advance } = await setup(t);
  try {
    switcher.open();
    await advance(1);
    const [w, a] = [state.workspaceCalls, state.agentCalls];
    await advance(1500);
    assert.equal(state.workspaceCalls, w + 1);
    assert.equal(state.agentCalls, a + 1);
    await advance(1500);
    assert.equal(state.workspaceCalls, w + 2);
    assert.equal(state.agentCalls, a + 2);
  } finally {
    switcher.dispose();
    t.mock.timers.reset();
    cleanGlobals();
  }
});

test("a status that changes while the list is open updates the rendered mark", async (t) => {
  const { state, switcher, page, advance } = await setup(t);
  try {
    switcher.open();
    await advance(1);
    assert.ok(!page.texts().some((x) => x.startsWith("Running")), "idle at first");
    state.workspace = "running";
    await advance(1600);
    assert.ok(page.texts().some((x) => x.startsWith("Running")), page.texts().join("|"));
  } finally {
    switcher.dispose();
    t.mock.timers.reset();
    cleanGlobals();
  }
});

test("a chat that changes status while its session list is open updates the row", async (t) => {
  const { state, switcher, page, advance } = await setup(t);
  try {
    switcher.open();
    await advance(1);
    page.press({ key: "Tab", code: "Tab", ctrlKey: true });
    page.press(OPEN_KEYS);
    await advance(50);
    assert.ok(page.texts().includes("chat c1"), "the session list is open");
    state.chat = "running";
    await advance(1600);
    assert.ok(page.texts().some((x) => x.startsWith("Running")), page.texts().join("|"));
  } finally {
    switcher.dispose();
    t.mock.timers.reset();
    cleanGlobals();
  }
});

test("a poll that finds nothing changed draws nothing", async (t) => {
  const { switcher, page, advance } = await setup(t);
  try {
    switcher.open();
    await advance(1);
    await advance(1500);
    const drawn = page.drawn();
    await advance(1500);
    await advance(1500);
    assert.equal(page.drawn(), drawn, "no new nodes while nothing changed");
  } finally {
    switcher.dispose();
    t.mock.timers.reset();
    cleanGlobals();
  }
});

test("closing stops the polling", async (t) => {
  const { state, switcher, page, advance } = await setup(t);
  try {
    switcher.open();
    await advance(1);
    page.press({ key: "Escape", code: "Escape" });
    await advance(100);
    const [w, a] = [state.workspaceCalls, state.agentCalls];
    await advance(4000);
    assert.equal(state.workspaceCalls, w);
    assert.equal(state.agentCalls, a);
  } finally {
    switcher.dispose();
    t.mock.timers.reset();
    cleanGlobals();
  }
});

test("a hidden page is not polled", async (t) => {
  const { state, switcher, page, advance } = await setup(t);
  try {
    switcher.open();
    await advance(1);
    page.document.hidden = true;
    const w = state.workspaceCalls;
    await advance(4000);
    assert.equal(state.workspaceCalls, w);
    page.document.hidden = false;
    await advance(1500);
    assert.equal(state.workspaceCalls, w + 1, "polling resumes when the page is visible again");
  } finally {
    switcher.dispose();
    t.mock.timers.reset();
    cleanGlobals();
  }
});

test("a slow load is never overlapped by another request", async (t) => {
  let release!: () => void;
  const hold = new Promise<void>((resolve) => (release = resolve));
  const { state, switcher, advance } = await setup(t, hold);
  try {
    switcher.open();
    await advance(1);
    await advance(6000);
    assert.equal(state.workspaceCalls, 1, "one workspace request in flight");
    assert.equal(state.agentCalls, 1, "one agent request in flight");
    release();
    await flush();
    await advance(1500);
    assert.equal(state.workspaceCalls, 2, "polling goes on once the slow load lands");
  } finally {
    switcher.dispose();
    t.mock.timers.reset();
    cleanGlobals();
  }
});

// The pinned group is fixed when the switcher opens: nothing moves under the cursor while it is open.
test("a workspace that starts needing input while open does not move; the next open pins it", async (t) => {
  const { state, switcher, page, advance } = await setup(t);
  try {
    switcher.open();
    await advance(1);
    state.third = "needs_input";
    await advance(1600);
    assert.ok(page.texts().some((x) => x.startsWith("Needs input")), "its row shows the live status");
    page.press({ key: "Enter", code: "Enter" });
    await advance(50);
    assert.match(page.pushed.at(-1) ?? "", /wks_2/, "the cursor stayed on the previous workspace");
    switcher.open();
    await advance(1);
    page.press({ key: "Enter", code: "Enter" });
    await advance(50);
    assert.match(page.pushed.at(-1) ?? "", /wks_3/, "reopened, the waiting workspace is first and selected");
  } finally {
    switcher.dispose();
    t.mock.timers.reset();
    cleanGlobals();
  }
});

test("a pinned workspace that is answered while open stays pinned until it closes", async (t) => {
  const { state, switcher, page, advance } = await setup(t);
  try {
    state.third = "needs_input";
    switcher.open();
    await advance(1600);
    page.press({ key: "Escape", code: "Escape" });
    await advance(100);
    switcher.open(); // the list loaded by the last open is what this one pins from
    await advance(1);
    state.third = "done";
    await advance(1600);
    page.press({ key: "Enter", code: "Enter" });
    await advance(50);
    assert.match(page.pushed.at(-1) ?? "", /wks_3/, "still first and selected");
    switcher.open();
    await advance(1);
    page.press({ key: "Enter", code: "Enter" });
    await advance(50);
    assert.match(page.pushed.at(-1) ?? "", /wks_2/, "back in its normal place after reopening");
  } finally {
    switcher.dispose();
    t.mock.timers.reset();
    cleanGlobals();
  }
});

// The pin set comes from cached lists, so they are kept fresh in idle time while the switcher is closed.
/** Advances in small steps: the fake clock's Date only moves between ticks, so the refresh timer must see it move. */
const stepsOf = (advance: (ms: number) => Promise<void>) => async (ms: number) => {
  for (let spent = 0; spent < ms; spent += 1000) await advance(1000);
};

test("a workspace that needs input while closed is pinned on the first open", async (t) => {
  const { state, switcher, page, advance } = await setup(t);
  const steps = stepsOf(advance);
  try {
    await advance(3000);
    state.third = "needs_input";
    await steps(8000);
    switcher.open();
    await advance(1);
    page.press({ key: "Enter", code: "Enter" });
    await advance(50);
    assert.match(page.pushed.at(-1) ?? "", /wks_3/);
  } finally {
    switcher.dispose();
    t.mock.timers.reset();
    cleanGlobals();
  }
});

test("the closed switcher does not reload workspaces while the page is hidden", async (t) => {
  const { state, switcher, page, advance } = await setup(t);
  const steps = stepsOf(advance);
  try {
    await advance(3000);
    page.document.hidden = true;
    const w = state.workspaceCalls;
    await steps(20_000);
    assert.equal(state.workspaceCalls, w);
    page.document.hidden = false;
    await steps(8000);
    assert.ok(state.workspaceCalls > w, "resumes once visible");
  } finally {
    switcher.dispose();
    t.mock.timers.reset();
    cleanGlobals();
  }
});
