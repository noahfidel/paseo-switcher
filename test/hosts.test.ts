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
  };
  return node;
}

/** A fake page; `keydown` counts the live keydown listeners on the window. */
function fakePage(pathname: string, storage: Record<string, string> = {}) {
  const listeners = new Map<string, Set<unknown>>();
  const store = new Map(Object.entries(storage));
  const document = {
    ...element(),
    head: element(),
    body: element(),
    hidden: false,
    createElement: () => element(),
    createTextNode: () => element(),
  };
  const window = {
    location: { pathname, search: "" },
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
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
  g.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  return { keydown: () => listeners.get("keydown")?.size ?? 0, store };
}

function cleanGlobals() {
  for (const key of ["document", "window", "MutationObserver", "__paseoSwitcher", "__paseoSwitcherInstalls", "__paseoSwitcherLists"]) delete g[key];
}

/** A host's API that lists the given workspaces and no agents, recording each call. */
function fakeApi(host: string, ids: string[], calls: string[]): any {
  return {
    workspaces: {
      list: async () => {
        calls.push(`${host}:workspaces`);
        return {
          entries: ids.map((id) => ({ id, name: `${host} ${id}`, projectDisplayName: host, status: "done", activityAt: "2026-11-01T00:00:00Z" })),
          pageInfo: { hasMore: false },
        };
      },
    },
    agents: {
      list: async () => {
        calls.push(`${host}:agents`);
        return { entries: [], pageInfo: { hasMore: false } };
      },
    },
  };
}

test("one switcher handles the keys however many hosts install the plugin, until the last is disposed", () => {
  const page = fakePage("/h/srv_a/workspace/wks_1");
  try {
    const calls: string[] = [];
    const a = installSwitcher(fakeApi("srv_a", [], calls));
    const b = installSwitcher(fakeApi("srv_b", [], calls));
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

test("a host's installation re-run (Paseo does this after a navigation) keeps a single handler", () => {
  const page = fakePage("/h/srv_a/workspace/wks_1");
  try {
    const calls: string[] = [];
    const a = installSwitcher(fakeApi("srv_a", [], calls));
    const b = installSwitcher(fakeApi("srv_b", [], calls));
    a.dispose();
    const a2 = installSwitcher(fakeApi("srv_a", [], calls));
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
