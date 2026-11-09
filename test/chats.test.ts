import assert from "node:assert/strict";
import { test } from "node:test";
import {
  UNTITLED_CHAT,
  agentStateBucket,
  archiveError,
  armedHint,
  clickArchiveAction,
  canDrillInto,
  chatFacts,
  chatTitle,
  chatsForWorkspace,
  filterChats,
  filterSessions,
  providerLabel,
  sessionCountLabel,
  sessionKey,
  sessionListState,
  sessionOpenTarget,
  sessionTitle,
  sessionVerb,
  sessionsForWorkspace,
  UNTITLED_TERMINAL,
  keyAction,
  nextArmed,
  rowFacts,
  type AgentInfo,
  type Card,
  type KeyAction,
  type KeyState,
  type Session,
  type TerminalInfo,
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

// ---- sessions: chats and terminals ---------------------------------------------------------------

const term = (id: string, workspaceId: string, name = `term ${id}`): TerminalInfo => ({ id, workspaceId, name });

test("sessionsForWorkspace: the chats in their order, then the workspace's terminals in the order Paseo lists them", () => {
  const agents = [agent("old", "w", 100), agent("new", "w", 800), agent("other", "x", 1000), agent("focused", "w", 50)];
  const terminals = [term("t2", "w"), term("tx", "x"), term("t1", "w")];
  const ids = (list: Session[]) => list.map((s) => `${s.kind}:${s.id}`);
  assert.deepEqual(ids(sessionsForWorkspace(agents, terminals, "w", "focused")), ["chat:focused", "chat:new", "chat:old", "terminal:t2", "terminal:t1"]);
  // Either list may be missing (not loaded, or failed); the other still shows.
  assert.deepEqual(ids(sessionsForWorkspace(null, terminals, "w", null)), ["terminal:t2", "terminal:t1"]);
  assert.deepEqual(ids(sessionsForWorkspace(agents, null, "w", null)), ["chat:new", "chat:old", "chat:focused"]);
  assert.deepEqual(sessionsForWorkspace(null, null, "w", null), []);
});

test("a session's title, key, open target and ⌫ verb depend on its kind", () => {
  const chat: Session = { kind: "chat", id: "a1", agent: agent("a1", "w", 0, { title: " Fix it " }) };
  const untitled: Session = { kind: "chat", id: "a2", agent: agent("a2", "w", 0) };
  const shell: Session = { kind: "terminal", id: "t1", terminal: term("t1", "w", " zsh ") };
  const blank: Session = { kind: "terminal", id: "t2", terminal: term("t2", "w", "  ") };
  assert.equal(sessionTitle(chat), "Fix it");
  assert.equal(sessionTitle(untitled), UNTITLED_CHAT);
  assert.equal(sessionTitle(shell), "zsh");
  assert.equal(sessionTitle(blank), UNTITLED_TERMINAL);
  assert.equal(sessionKey(chat), "chat:a1");
  assert.equal(sessionKey(shell), "terminal:t1");
  assert.equal(sessionOpenTarget(chat), "agent:a1");
  assert.equal(sessionOpenTarget(shell), "terminal:t1");
  assert.equal(sessionVerb(chat), "archive");
  assert.equal(sessionVerb(shell), "close");
});

test("filterSessions matches every word against chat titles and terminal names alike, keeping the order", () => {
  const list: Session[] = [
    { kind: "chat", id: "1", agent: agent("1", "w", 3, { title: "Build docs" }) },
    { kind: "terminal", id: "t", terminal: term("t", "w", "build watcher") },
    { kind: "chat", id: "2", agent: agent("2", "w", 2, { title: "Fix tests" }) },
  ];
  assert.deepEqual(filterSessions(list, "build").map((s) => s.id), ["1", "t"]);
  assert.deepEqual(filterSessions(list, "WATCHER build").map((s) => s.id), ["t"]);
  assert.deepEqual(filterSessions(list, " ").map((s) => s.id), ["1", "t", "2"]);
});

test("providerLabel names the agent's provider the way Paseo does, and nothing when unknown", () => {
  assert.equal(providerLabel("claude"), "Claude");
  assert.equal(providerLabel("codex"), "Codex");
  assert.equal(providerLabel("opencode"), "OpenCode");
  assert.equal(providerLabel("claude/sonnet"), "Claude");
  assert.equal(providerLabel("my-agent"), "My-agent");
  assert.equal(providerLabel(""), null);
  assert.equal(providerLabel(null), null);
  assert.equal(providerLabel(undefined), null);
});

test("the armed hint says close for a terminal and archive for everything else", () => {
  assert.equal(armedHint("terminal:t1", false), "again to close");
  assert.equal(armedHint("chat:a1", false), "again to archive");
  assert.equal(armedHint("srv:wks", false), "again to archive");
  assert.equal(armedHint("terminal:t1", true), "Tap × again to close");
  assert.equal(armedHint("chat:a1", true), "Tap × again to archive");
});

// ---- which rows have chats, and what the chat list says ------------------------------------------------

const wsCard = (serverId: string, info = true): Card => ({
  key: `${serverId}:w`,
  serverId,
  workspaceId: "w",
  info: info ? { id: "w", name: "w", project: "p", branch: null, status: "done", additions: 0, deletions: 0, activityAt: 0 } : null,
});

test("canDrillInto: any workspace whose host's data has loaded, on whichever host", () => {
  assert.equal(canDrillInto(wsCard("s")), true);
  assert.equal(canDrillInto(wsCard("other")), true);
  assert.equal(canDrillInto(wsCard("s", false)), false);
  assert.equal(canDrillInto({ key: "plugin-screen|s|p|x", serverId: "s", workspaceId: "", info: null, screen: { pluginId: "p", screenId: "x", title: "X" } } as Card), false);
  assert.equal(canDrillInto(undefined), false);
});

test("sessionListState: loading until the lists load or fail, then the list, empty, failed or no match", () => {
  const s = (over: Partial<Parameters<typeof sessionListState>[0]>) => sessionListState({ loaded: false, failed: false, query: "", shown: 0, ...over });
  assert.equal(s({}), "loading");
  assert.equal(s({ failed: true }), "failed");
  assert.equal(s({ loaded: true }), "empty");
  assert.equal(s({ loaded: true, shown: 2 }), "list");
  assert.equal(s({ loaded: true, query: "x" }), "no-match");
  // Chats from an earlier load still show after a failed refresh.
  assert.equal(s({ loaded: true, failed: true, shown: 2 }), "list");
  assert.equal(s({ loaded: true, failed: true }), "failed");
});

test("sessionCountLabel says 'recent' when the host's agent list was cut off, since older chats may be missing", () => {
  assert.equal(sessionCountLabel(3, { loaded: false, capped: false }), "");
  assert.equal(sessionCountLabel(1, { loaded: true, capped: false }), "1 session");
  assert.equal(sessionCountLabel(3, { loaded: true, capped: false }), "3 sessions");
  assert.equal(sessionCountLabel(0, { loaded: true, capped: false }), "0 sessions");
  assert.equal(sessionCountLabel(1, { loaded: true, capped: true }), "1 recent session");
  assert.equal(sessionCountLabel(3, { loaded: true, capped: true }), "3 recent sessions");
});

// ---- keys -----------------------------------------------------------------------------------------

const base: KeyState = { layout: "list", drilled: false, query: "", canDrill: true, hasSelection: true, metaTypes: true, screen: false, armed: false, armedForMs: Infinity, released: true };
const press = (key: string, state: Partial<KeyState> = {}, mods: { ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean; shiftKey?: boolean; repeat?: boolean } = {}) =>
  keyAction(key, { ...base, ...state }, { ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, repeat: false, ...mods });

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

test("Backspace edits the filter and erases all with Ctrl or Alt, whatever level is on show", () => {
  assert.deepEqual(press("Backspace", { hasSelection: false }), { type: "erase", all: false });
  for (const drilled of [false, true]) {
    assert.deepEqual(press("Backspace", { query: "ab", drilled }), { type: "erase", all: false });
    assert.deepEqual(press("Backspace", { query: "ab", drilled }, { altKey: true }), { type: "erase", all: true });
    assert.deepEqual(press("Backspace", { query: "ab", drilled }, { ctrlKey: true }), { type: "erase", all: true });
    // With text typed, even an armed row is not archived.
    assert.deepEqual(press("Backspace", { query: "ab", drilled, armed: true }), { type: "erase", all: false });
  }
});

test("⌫ on a workspace arms it, and a second ⌫ on the same armed row archives it", () => {
  assert.deepEqual(press("Backspace"), { type: "arm" });
  assert.deepEqual(press("Backspace", { armed: true }), { type: "archive" });
  // Hold mode keeps Ctrl down; modifiers other than Shift change nothing.
  assert.deepEqual(press("Backspace", {}, { ctrlKey: true }), { type: "arm" });
  assert.deepEqual(press("Backspace", { armed: true }, { ctrlKey: true, metaKey: true, altKey: true }), { type: "archive" });
});

test("⌫ on a plugin screen hides it, as ⇧⌫ does", () => {
  assert.deepEqual(press("Backspace", { screen: true }), { type: "hide" });
  assert.deepEqual(press("Backspace", { screen: true, armed: true }), { type: "hide" });
});

test("⇧⌫ hides a workspace or screen, with or without Ctrl held, and does nothing on a chat", () => {
  assert.deepEqual(press("Backspace", {}, { shiftKey: true }), { type: "hide" });
  assert.deepEqual(press("Backspace", { screen: true }, { shiftKey: true, ctrlKey: true }), { type: "hide" });
  assert.deepEqual(press("Backspace", { armed: true }, { shiftKey: true }), { type: "hide" });
  assert.deepEqual(press("Backspace", { drilled: true }, { shiftKey: true }), { type: "none" });
  assert.deepEqual(press("Backspace", { drilled: true, armed: true }, { shiftKey: true }), { type: "none" });
  // With a filter typed, Shift+⌫ still edits it.
  assert.deepEqual(press("Backspace", { query: "ab" }, { shiftKey: true }), { type: "erase", all: false });
});

test("⌫ on any session (chat or terminal, idle or busy) arms it, and the second ⌫ archives or closes it", () => {
  const sessions = { drilled: true };
  assert.deepEqual(press("Backspace", sessions), { type: "arm" });
  assert.deepEqual(press("Backspace", { ...sessions, armed: true }), { type: "archive" });
  assert.deepEqual(press("Backspace", sessions, { ctrlKey: true }), { type: "arm" });
});

test("⌫ with nothing selected does nothing to rows", () => {
  assert.deepEqual(press("Backspace", { hasSelection: false }), { type: "erase", all: false });
  assert.deepEqual(press("Backspace", { drilled: true, hasSelection: false }), { type: "none" });
});

test("an armed row stays armed only for the arm action; every other key, even an ignored one, disarms", () => {
  assert.equal(nextArmed("k1", "k2", { type: "arm" }), "k2");
  assert.equal(nextArmed(null, "k1", { type: "arm" }), "k1");
  for (const type of ["move", "drill", "back", "commit", "cancel", "clear", "hide", "erase", "type", "none", "archive"] as const) {
    assert.equal(nextArmed("k1", "k1", { type } as KeyAction), null, type);
  }
});

test("a failed archive says so briefly", () => {
  assert.equal(archiveError(new Error("daemon said no")), "Couldn't archive: daemon said no");
  assert.equal(archiveError("plain"), "Couldn't archive: plain");
  assert.equal(archiveError(undefined), "Couldn't archive");
  assert.equal(archiveError(new Error("x".repeat(200))).length <= 80, true);
  // Closing a terminal says close.
  assert.equal(archiveError(new Error("gone"), "close"), "Couldn't close: gone");
  assert.equal(archiveError(undefined, "close"), "Couldn't close");
});

test("a held ⌫ (auto-repeat) with nothing typed does nothing: no arm, archive or hide, at either level", () => {
  const held = { repeat: true };
  assert.deepEqual(press("Backspace", {}, held), { type: "ignore" });
  assert.deepEqual(press("Backspace", { armed: true, armedForMs: 5000 }, held), { type: "ignore" });
  assert.deepEqual(press("Backspace", { screen: true }, held), { type: "ignore" });
  assert.deepEqual(press("Backspace", {}, { ...held, shiftKey: true }), { type: "ignore" });
  assert.deepEqual(press("Backspace", { drilled: true }, held), { type: "ignore" });
  assert.deepEqual(press("Backspace", { drilled: true, armed: true, armedForMs: 5000 }, held), { type: "ignore" });
  assert.deepEqual(press("Backspace", { hasSelection: false }, held), { type: "ignore" });
});

test("a held ⌫ still erases while the filter has text, and stops doing anything once it is empty", () => {
  for (const drilled of [false, true]) {
    assert.deepEqual(press("Backspace", { query: "ab", drilled }, { repeat: true }), { type: "erase", all: false });
    assert.deepEqual(press("Backspace", { query: "", drilled }, { repeat: true }), { type: "ignore" });
  }
});

test("an ignored key neither arms nor disarms; every other key still disarms", () => {
  assert.equal(nextArmed("k1", "k1", { type: "ignore" }), "k1");
  assert.equal(nextArmed(null, "k1", { type: "ignore" }), null);
});

test("a second ⌫ within 250 ms of arming is ignored, without disarming, and archives after that", () => {
  assert.deepEqual(press("Backspace", { armed: true, armedForMs: 0 }), { type: "ignore" });
  assert.deepEqual(press("Backspace", { armed: true, armedForMs: 249 }), { type: "ignore" });
  assert.deepEqual(press("Backspace", { armed: true, armedForMs: 250 }), { type: "archive" });
  assert.deepEqual(press("Backspace", { armed: true, armedForMs: 249, drilled: true }), { type: "ignore" });
  assert.deepEqual(press("Backspace", { armed: true, armedForMs: 250, drilled: true }), { type: "archive" });
  // Hiding a screen is not archiving; the guard does not apply to it.
  assert.deepEqual(press("Backspace", { screen: true, armedForMs: 0 }), { type: "hide" });
});

test("the archiving ⌫ needs a ⌫ keyup since the arming one, whatever the timing or repeat flag", () => {
  assert.deepEqual(press("Backspace", { armed: true, armedForMs: 5000, released: false }), { type: "ignore" });
  assert.deepEqual(press("Backspace", { armed: true, armedForMs: 5000, released: true }), { type: "archive" });
  const chat = { drilled: true, armed: true, armedForMs: 5000 };
  assert.deepEqual(press("Backspace", { ...chat, released: false }), { type: "ignore" });
  assert.deepEqual(press("Backspace", { ...chat, released: true }), { type: "archive" });
  // Arming itself and hiding need no earlier keyup.
  assert.deepEqual(press("Backspace", { released: false }), { type: "arm" });
  assert.deepEqual(press("Backspace", { drilled: true, released: false }), { type: "arm" });
  assert.deepEqual(press("Backspace", { screen: true, released: false }), { type: "hide" });
});

test("the hover × arms any session first, and the second click after the 250 ms guard archives or closes it", () => {
  const x = (over: Partial<Parameters<typeof clickArchiveAction>[0]> = {}) =>
    clickArchiveAction({ armed: false, armedForMs: Infinity, sinceArchiveMs: Infinity, ...over });
  assert.equal(x(), "arm");
  assert.equal(x({ armed: true, armedForMs: 249 }), "ignore");
  assert.equal(x({ armed: true, armedForMs: 250 }), "archive");
  // A double-click must not reach the row that moved under the pointer.
  assert.equal(x({ armed: true, armedForMs: 5000, sinceArchiveMs: 0 }), "ignore");
  assert.equal(x({ armed: true, armedForMs: 5000, sinceArchiveMs: 249 }), "ignore");
  assert.equal(x({ armed: true, armedForMs: 5000, sinceArchiveMs: 250 }), "archive");
  assert.equal(x({ sinceArchiveMs: 100 }), "ignore");
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
