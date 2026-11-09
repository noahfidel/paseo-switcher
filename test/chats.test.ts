import assert from "node:assert/strict";
import { test } from "node:test";
import {
  UNTITLED_CHAT,
  agentStateBucket,
  chatFacts,
  chatTitle,
  chatsForWorkspace,
  filterChats,
  keyAction,
  rowFacts,
  type AgentInfo,
  type KeyState,
} from "../client/model.ts";

const NOW = 10_000_000;
const agent = (id: string, workspaceId: string | null, activityAt: number, extra: Partial<AgentInfo> = {}): AgentInfo => ({ id, workspaceId, activityAt, ...extra });

// ---- status, as Paseo's sidebar derives it --------------------------------------------------------

test("agentStateBucket matches Paseo's own derivation", () => {
  assert.equal(agentStateBucket({ status: "running", pendingPermissionCount: 1 }), "needs_input");
  assert.equal(agentStateBucket({ status: "idle", attentionReason: "permission" }), "needs_input");
  assert.equal(agentStateBucket({ status: "error" }), "failed");
  assert.equal(agentStateBucket({ status: "idle", attentionReason: "error" }), "failed");
  assert.equal(agentStateBucket({ status: "running" }), "running");
  assert.equal(agentStateBucket({ status: "idle", requiresAttention: true }), "attention");
  assert.equal(agentStateBucket({ status: "idle" }), "done");
  assert.equal(agentStateBucket({ status: "closed" }), "done");
});

test("chatFacts says what a workspace row says for the same state", () => {
  const running = chatFacts(agent("a", "w", NOW - 60_000, { status: "running", statusAt: NOW - 4 * 60_000 }), NOW);
  assert.deepEqual(running, { state: "running", label: "Running · 4m" });
  assert.deepEqual(chatFacts(agent("a", "w", NOW - 2 * 3_600_000, { status: "done" }), NOW), { state: "done", label: "2h ago" });
  assert.deepEqual(chatFacts(agent("a", "w", NOW - 1_000, { status: "attention" }), NOW), { state: "attention", label: "Finished · now" });
  assert.deepEqual(chatFacts(agent("a", "w", NOW - 1_000), NOW), { state: "done", label: "just now" });
  // The same words as a workspace in that state.
  const ws = rowFacts({ id: "w", name: "w", project: "p", branch: null, status: "needs_input", additions: 0, deletions: 0, activityAt: NOW, statusAt: NOW - 5 * 60_000 }, NOW);
  assert.equal(chatFacts(agent("a", "w", NOW, { status: "needs_input", statusAt: NOW - 5 * 60_000 }), NOW).label, ws.label);
});

test("chatTitle uses Paseo's fallback for a chat without a title", () => {
  assert.equal(chatTitle(agent("a", "w", 0, { title: "  Fix the build " })), "Fix the build");
  assert.equal(chatTitle(agent("a", "w", 0, { title: "  " })), UNTITLED_CHAT);
  assert.equal(chatTitle(agent("a", "w", 0)), "New agent");
});

// ---- ordering ----------------------------------------------------------------------------------

test("chatsForWorkspace: the last focused chat first, then by activity, automated chats last", () => {
  const list = [
    agent("old", "w", 100),
    agent("routine", "w", 900, { automated: true }),
    agent("new", "w", 800),
    agent("other", "x", 1000),
    agent("focused", "w", 50),
    agent("ask", "w", 700, { automated: true }),
  ];
  assert.deepEqual(chatsForWorkspace(list, "w", "focused").map((a) => a.id), ["focused", "new", "old", "routine", "ask"]);
  assert.deepEqual(chatsForWorkspace(list, "w", null).map((a) => a.id), ["new", "old", "focused", "routine", "ask"]);
});

test("chatsForWorkspace keeps a remembered automated chat first, and ignores a remembered chat it does not list", () => {
  const list = [agent("a", "w", 500), agent("r", "w", 100, { automated: true })];
  assert.deepEqual(chatsForWorkspace(list, "w", "r").map((a) => a.id), ["r", "a"]);
  assert.deepEqual(chatsForWorkspace(list, "w", "gone").map((a) => a.id), ["a", "r"]);
  assert.deepEqual(chatsForWorkspace(null, "w", "a"), []);
});

test("filterChats keeps the order and matches every word of the title", () => {
  const list = [agent("1", "w", 3, { title: "Fix build cache" }), agent("2", "w", 2, { title: "Build docs" }), agent("3", "w", 1, { title: null })];
  assert.deepEqual(filterChats(list, "build").map((a) => a.id), ["1", "2"]);
  assert.deepEqual(filterChats(list, "cache FIX").map((a) => a.id), ["1"]);
  assert.deepEqual(filterChats(list, "new agent").map((a) => a.id), ["3"]);
  assert.deepEqual(filterChats(list, "  ").map((a) => a.id), ["1", "2", "3"]);
});

// ---- keys -----------------------------------------------------------------------------------------

const base: KeyState = { layout: "list", drilled: false, query: "", canDrill: true, hasSelection: true, metaTypes: true };
const press = (key: string, state: Partial<KeyState> = {}, mods: { ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean } = {}) =>
  keyAction(key, { ...base, ...state }, { ctrlKey: false, altKey: false, metaKey: false, ...mods });

test("list layout: → opens a workspace's chats; ↑ ↓ ← move; → on a plugin screen does nothing", () => {
  assert.deepEqual(press("ArrowRight"), { type: "drill" });
  assert.deepEqual(press("ArrowRight", { canDrill: false }), { type: "none" });
  assert.deepEqual(press("ArrowDown"), { type: "move", delta: 1 });
  assert.deepEqual(press("ArrowUp"), { type: "move", delta: -1 });
  assert.deepEqual(press("ArrowLeft"), { type: "move", delta: -1 });
});

test("thumbnails layout: ← → still move between cards and ↓ opens the chats", () => {
  const strip = { layout: "strip" as const };
  assert.deepEqual(press("ArrowRight", strip), { type: "move", delta: 1 });
  assert.deepEqual(press("ArrowLeft", strip), { type: "move", delta: -1 });
  assert.deepEqual(press("ArrowUp", strip), { type: "move", delta: -1 });
  assert.deepEqual(press("ArrowDown", strip), { type: "drill" });
  assert.deepEqual(press("ArrowDown", { ...strip, canDrill: false }), { type: "none" });
});

test("drilled in, in either layout: ↑ ↓ move, ← goes back, → does nothing", () => {
  for (const layout of ["list", "strip"] as const) {
    const s = { layout, drilled: true };
    assert.deepEqual(press("ArrowDown", s), { type: "move", delta: 1 });
    assert.deepEqual(press("ArrowUp", s), { type: "move", delta: -1 });
    assert.deepEqual(press("ArrowLeft", s), { type: "back" });
    assert.deepEqual(press("ArrowRight", s), { type: "none" });
  }
});

test("Enter commits, Esc clears a filter before it cancels, at either level", () => {
  assert.deepEqual(press("Enter"), { type: "commit" });
  assert.deepEqual(press("Enter", { drilled: true }), { type: "commit" });
  assert.deepEqual(press("Escape"), { type: "cancel" });
  assert.deepEqual(press("Escape", { query: "x" }), { type: "clear" });
  assert.deepEqual(press("Escape", { drilled: true }), { type: "cancel" });
  assert.deepEqual(press("Escape", { drilled: true, query: "x" }), { type: "clear" });
});

test("Backspace hides a workspace with nothing typed, edits a filter, and never hides a chat", () => {
  assert.deepEqual(press("Backspace"), { type: "hide" });
  assert.deepEqual(press("Backspace", { hasSelection: false }), { type: "erase", all: false });
  assert.deepEqual(press("Backspace", { query: "ab" }), { type: "erase", all: false });
  assert.deepEqual(press("Backspace", { query: "ab" }, { altKey: true }), { type: "erase", all: true });
  assert.deepEqual(press("Backspace", { drilled: true }), { type: "none" });
  assert.deepEqual(press("Backspace", { drilled: true, query: "ab" }), { type: "erase", all: false });
});

test("printable keys type into the filter of the level on show", () => {
  assert.deepEqual(press("a"), { type: "type", text: "a" });
  assert.deepEqual(press("a", { drilled: true }), { type: "type", text: "a" });
  // A leading space is not a filter; inside one it is.
  assert.deepEqual(press(" "), { type: "none" });
  assert.deepEqual(press(" ", { query: "a" }), { type: "type", text: " " });
  // With Cmd held as the switcher's own modifier, keys still type; with Cmd held otherwise they do not.
  assert.deepEqual(press("k", {}, { metaKey: true }), { type: "type", text: "k" });
  assert.deepEqual(press("k", { metaTypes: false }, { metaKey: true }), { type: "none" });
  assert.deepEqual(press("Tab"), { type: "none" });
});
