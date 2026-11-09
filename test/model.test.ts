import assert from "node:assert/strict";
import { test } from "node:test";
import {
  agentIdFromTabTestId,
  agentToOpen,
  REMEMBER_REFRESH_MS,
  type AgentMemory,
  type RememberedAgent,
  ago,
  rowFacts,
  DEFAULT_SIDEBAR_DISPLAY,
  parseSidebarDisplay,
  workspaceTitle,
  type SidebarDisplay,
  buildCards,
  parseAgentMemory,
  pickFocusedAgent,
  rememberAgent,
  type AgentInfo,
  clampLimit,
  DEFAULT_LIMIT,
  filterCards,
  isBackgroundUnsupported,
  isReleaseKey,
  listWithBackgroundFallback,
  parseIncludeBackground,
  shouldListWorkspace,
  matchesShortcut,
  matchRanges,
  parseShortcut,
  SHORTCUTS,
  DEFAULT_SHORTCUT,
  type Shortcut,
  STATUS_LABEL,
  initialIndex,
  parseLayout,
  previousKey,
  wrap,
  type WorkspaceInfo,
  DEFAULT_COUNT_MESSAGES,
  MAX_VISITS,
  mergeMessageVisits,
  userMessageAt,
  migrateMru,
  parseCountMessages,
  parseVisits,
  recentKeys,
  recordVisit,
  parsePluginScreenUrl,
  pluginScreenUrl,
  pluginScreenKey,
  isPluginScreenKey,
  keyServerId,
  prettifyPluginId,
  screenTitle,
  parseScreens,
  recordScreen,
  visibleKeys,
  DEFAULT_INCLUDE_SCREENS,
  parseIncludeScreens,
  parseHidden,
  setHidden,
  migrateHidden,
  clampIndex,
  pruneScreens,
  trackScreenVisit,
  SCREEN_DWELL_MS,
  type PendingScreenVisit,
  carriedLists,
  loadedWorkspaces,
  parseKnownNames,
  rememberNames,
} from "../client/model.ts";

const S = "srv_a";
const info = (id: string, activityAt: number): WorkspaceInfo => ({
  id,
  name: id,
  project: "p",
  branch: null,
  status: "done",
  additions: 0,
  deletions: 0,
  activityAt,
});
const list = (...items: WorkspaceInfo[]) => new Map(items.map((w) => [w.id, w]));
/** One host's loaded list, keyed by host the way the switcher keeps them. */
const one = (ws: ReadonlyMap<string, WorkspaceInfo> | null) => (ws ? new Map([[S, ws]]) : null);

test("cards are the most recent visits, capped at the limit", () => {
  const mru = ["1", "2", "3", "4", "5", "6", "7"].map((id) => `${S}:${id}`);
  const ws = list(...["1", "2", "3", "4", "5", "6", "7"].map((id, i) => info(id, i)));
  assert.deepEqual(
    buildCards(mru, one(ws), 5).map((c) => c.workspaceId),
    ["1", "2", "3", "4", "5"],
  );
});

test("deleted workspaces drop out once the list has loaded", () => {
  const mru = [`${S}:gone`, `${S}:a`];
  assert.deepEqual(buildCards(mru, one(list(info("a", 1))), 5).map((c) => c.workspaceId), ["a"]);
  assert.deepEqual(buildCards(mru, null, 5).map((c) => c.workspaceId), ["gone", "a"], "kept before load");
});

test("few visits fill in by latest activity", () => {
  const ws = list(info("a", 1), info("b", 30), info("c", 20), info("d", 10));
  assert.deepEqual(
    buildCards([`${S}:a`], one(ws), 3).map((c) => c.workspaceId),
    ["a", "b", "c"],
  );
});

test("visits on another host are kept without data", () => {
  const cards = buildCards([`other:x`, `${S}:a`], one(list(info("a", 1))), 5);
  assert.deepEqual(cards.map((c) => [c.serverId, c.workspaceId, c.info?.id ?? null]), [
    ["other", "x", null],
    [S, "a", "a"],
  ]);
});

// Paseo runs the plugin once per connected host. The workspaces of each host are kept under its server
// ID, so a row never borrows another host's data, and the host on show never blanks the others' rows.
test("with two hosts, each row shows its own host's workspace, whichever host is on show", () => {
  const hosts = new Map([
    [S, list(info("a", 1))],
    ["srv_b", list(info("x", 2))],
  ]);
  const cards = buildCards([`srv_b:x`, `${S}:a`], hosts, 5);
  assert.deepEqual(cards.map((c) => [c.key, c.info?.id ?? null]), [
    ["srv_b:x", "x"],
    [`${S}:a`, "a"],
  ]);
});

test("a host that has not loaded keeps its rows without data, and the list fills from every loaded host", () => {
  const hosts = new Map([
    [S, list(info("a", 1), info("gone-from-a", 0))],
    ["srv_b", list(info("x", 5), info("y", 3))],
  ]);
  const cards = buildCards([`srv_c:z`, `${S}:gone`, `${S}:a`], hosts, 4);
  assert.deepEqual(cards.map((c) => [c.key, c.info?.id ?? null]), [
    ["srv_c:z", null],
    [`${S}:a`, "a"],
    ["srv_b:x", "x"],
    ["srv_b:y", "y"],
  ]);
});

test("keys containing colons split on the last one", () => {
  const cards = buildCards([`srv:with:colon:wks_1`], null, 5);
  assert.equal(cards[0]?.serverId, "srv:with:colon");
  assert.equal(cards[0]?.workspaceId, "wks_1");
});

test("the first Ctrl+Tab selects the previous workspace", () => {
  const cards = buildCards([`${S}:a`, `${S}:b`], null, 5);
  assert.equal(initialIndex(cards, `${S}:a`), 1);
  assert.equal(initialIndex(cards, `${S}:elsewhere`), 0);
  assert.equal(initialIndex(cards.slice(0, 1), `${S}:a`), 0);
});

test("previousKey skips the current workspace", () => {
  assert.equal(previousKey(["a", "b"], "a"), "b");
  assert.equal(previousKey(["a", "b"], "z"), "a");
  assert.equal(previousKey(["a"], "a"), null);
});

test("limits clamp to 2..9", () => {
  assert.equal(clampLimit(5), 5);
  assert.equal(clampLimit("3"), 3);
  assert.equal(clampLimit(1), 2);
  assert.equal(clampLimit(40), 9);
  assert.equal(clampLimit("nope"), DEFAULT_LIMIT);
  assert.equal(clampLimit(undefined), DEFAULT_LIMIT);
});

test("wrap cycles in both directions", () => {
  assert.equal(wrap(5, 5), 0);
  assert.equal(wrap(-1, 5), 4);
  assert.equal(wrap(3, 0), 0);
});

test("parseLayout accepts the strip and falls back to the list", () => {
  assert.equal(parseLayout("strip"), "strip");
  assert.equal(parseLayout("list"), "list");
  assert.equal(parseLayout("grid"), "list");
  assert.equal(parseLayout(null), "list");
});

test("ago gives compact ages", () => {
  const now = Date.UTC(2026, 0, 2);
  assert.equal(ago(0, now), null);
  assert.equal(ago(now - 20_000, now), "now");
  assert.equal(ago(now - 5 * 60_000, now), "5m");
  assert.equal(ago(now - 3 * 3_600_000, now), "3h");
  assert.equal(ago(now - 50 * 3_600_000, now), "2d");
});

test("filter matches name, project, branch and PR number, all words required", () => {
  const ws = list(
    { ...info("a", 1), name: "Rate limit the public API", project: "api", branch: "rate-limits" },
    { ...info("b", 2), name: "Upgrade to Postgres 17", project: "api", branch: "pg17", pr: { number: 455, state: "draft", checks: "failure", review: null } },
    { ...info("c", 3), name: "Checkout redesign", project: "storefront", branch: "checkout-v2" },
  );
  const ids = (q: string) => filterCards(q, [], one(ws)).map((c) => c.workspaceId);
  assert.deepEqual(ids("api").sort(), ["a", "b"]);
  assert.deepEqual(ids("455"), ["b"]);
  assert.deepEqual(ids("#455"), ["b"]);
  assert.deepEqual(ids("checkout v2"), ["c"]);
  assert.deepEqual(ids("api postgres"), ["b"]);
  assert.deepEqual(ids("zzz"), []);
  assert.deepEqual(ids("   "), [], "a blank query filters nothing");
});

test("filter ranks word-start name matches first, then recency", () => {
  const ws = list(
    { ...info("a", 5), name: "Rate limit the public API", project: "api" },
    { ...info("b", 9), name: "Grapefruit", project: "rate-service" },
    { ...info("c", 1), name: "Rates page", project: "web" },
  );
  // "b" matches only through its project, so it ranks after both name matches.
  assert.deepEqual(filterCards("rate", [`${S}:c`], one(ws)).map((c) => c.workspaceId), ["c", "a", "b"]);
  assert.deepEqual(filterCards("rate", [], one(ws)).map((c) => c.workspaceId), ["a", "c", "b"]);
});

test("filter caps results at the number keys and needs a loaded list", () => {
  const ws = list(...Array.from({ length: 12 }, (_, i) => ({ ...info(String(i), i), name: `Task ${i}` })));
  assert.equal(filterCards("task", [], one(ws)).length, 9);
  assert.deepEqual(filterCards("task", [], null), []);
});

test("match ranges are merged and sorted for highlighting", () => {
  assert.deepEqual(matchRanges("Rate limit the public API", "api rate"), [[0, 4], [22, 25]]);
  assert.deepEqual(matchRanges("aaaa", "aa a"), [[0, 4]]);
  assert.deepEqual(matchRanges("Docs", ""), []);
});

test("attention reads as finished, the way Paseo shows it", () => {
  assert.equal(STATUS_LABEL.attention, "Finished");
});

const press = (code: string, mods: Partial<Record<"ctrlKey" | "altKey" | "metaKey" | "shiftKey", boolean>> = {}) => ({
  code,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  shiftKey: false,
  ...mods,
});

test("the shortcut defaults to Cmd+` and falls back to it for unknown values", () => {
  assert.equal(DEFAULT_SHORTCUT, "cmd-backquote");
  assert.equal(parseShortcut("cmd-backquote"), "cmd-backquote");
  assert.equal(parseShortcut("ctrl-tab"), "ctrl-tab");
  assert.equal(parseShortcut("alt-tab"), "alt-tab");
  assert.equal(parseShortcut("meta-tab"), "cmd-backquote");
  assert.equal(parseShortcut(null), "cmd-backquote");
});

test("a stored Ctrl+` setting from before Cmd+` stays valid", () => {
  assert.equal(parseShortcut("ctrl-backquote"), "ctrl-backquote");
});

test("Cmd+` opens, advances and goes back, matched by code", () => {
  assert.equal(matchesShortcut("cmd-backquote", press("Backquote", { metaKey: true })), true);
  assert.equal(matchesShortcut("cmd-backquote", press("Backquote", { metaKey: true, shiftKey: true })), true);
  assert.equal(matchesShortcut("cmd-backquote", press("Backquote", { ctrlKey: true })), false);
  assert.equal(matchesShortcut("cmd-backquote", press("Tab", { metaKey: true })), false);
  assert.equal(matchesShortcut("cmd-backquote", press("Backquote", { metaKey: true, altKey: true })), false);
  assert.equal(matchesShortcut("cmd-backquote", press("Backquote", { metaKey: true, ctrlKey: true })), false);
  assert.equal(matchesShortcut("cmd-backquote", press("Backquote")), false);
});

test("Ctrl+` opens, advances and goes back, matched by code", () => {
  assert.equal(matchesShortcut("ctrl-backquote", press("Backquote", { ctrlKey: true })), true);
  assert.equal(matchesShortcut("ctrl-backquote", press("Backquote", { ctrlKey: true, shiftKey: true })), true);
});

test("Ctrl+Tab opens, advances and goes back", () => {
  assert.equal(matchesShortcut("ctrl-tab", press("Tab", { ctrlKey: true })), true);
  assert.equal(matchesShortcut("ctrl-tab", press("Tab", { ctrlKey: true, shiftKey: true })), true);
});

test("Option+Tab opens, advances and goes back", () => {
  assert.equal(matchesShortcut("alt-tab", press("Tab", { altKey: true })), true);
  assert.equal(matchesShortcut("alt-tab", press("Tab", { altKey: true, shiftKey: true })), true);
});

test("a combo that is not the chosen shortcut does nothing", () => {
  const combos: Record<Shortcut, ReturnType<typeof press>> = {
    "cmd-backquote": press("Backquote", { metaKey: true }),
    "ctrl-backquote": press("Backquote", { ctrlKey: true }),
    "ctrl-tab": press("Tab", { ctrlKey: true }),
    "alt-tab": press("Tab", { altKey: true }),
  };
  for (const chosen of Object.keys(combos) as Shortcut[]) {
    for (const other of Object.keys(combos) as Shortcut[]) {
      assert.equal(matchesShortcut(chosen, combos[other]), chosen === other, `${chosen} vs ${other}`);
    }
  }
});

test("extra modifiers and bare keys never match", () => {
  for (const shortcut of Object.keys(SHORTCUTS) as Shortcut[]) {
    const { code, modifier } = SHORTCUTS[shortcut];
    const flag = { Control: "ctrlKey", Alt: "altKey", Meta: "metaKey" } as const;
    const mod = flag[modifier];
    assert.equal(matchesShortcut(shortcut, press(code)), false, "no modifier");
    for (const other of Object.values(flag)) {
      if (other === mod) continue;
      assert.equal(matchesShortcut(shortcut, press(code, { [mod]: true, [other]: true })), false, `with ${other}`);
    }
  }
});

test("releasing the chosen modifier, and only that one, switches", () => {
  assert.equal(isReleaseKey("cmd-backquote", "Meta"), true);
  assert.equal(isReleaseKey("cmd-backquote", "Control"), false);
  assert.equal(isReleaseKey("cmd-backquote", "`"), false);
  assert.equal(isReleaseKey("ctrl-tab", "Meta"), false);
  assert.equal(isReleaseKey("ctrl-backquote", "Control"), true);
  assert.equal(isReleaseKey("ctrl-tab", "Control"), true);
  assert.equal(isReleaseKey("alt-tab", "Alt"), true);
  assert.equal(isReleaseKey("alt-tab", "Control"), false);
  assert.equal(isReleaseKey("ctrl-tab", "Alt"), false);
  assert.equal(isReleaseKey("ctrl-tab", "Tab"), false);
});

test("shouldListWorkspace skips archiving workspaces, and background ones unless included", () => {
  assert.equal(shouldListWorkspace({}, false), true);
  assert.equal(shouldListWorkspace({ background: true }, false), false);
  assert.equal(shouldListWorkspace({ background: true }, true), true);
  assert.equal(shouldListWorkspace({ archivingAt: "2026-01-01" }, true), false);
  assert.equal(shouldListWorkspace({ archivingAt: "2026-01-01", background: true }, true), false);
});

test("parseIncludeBackground defaults to on and only accepts booleans", () => {
  assert.equal(parseIncludeBackground(undefined), true);
  assert.equal(parseIncludeBackground(null), true);
  assert.equal(parseIncludeBackground("no"), true);
  assert.equal(parseIncludeBackground(true), true);
  assert.equal(parseIncludeBackground(false), false);
});

test("isBackgroundUnsupported recognizes the host rejection by its message", () => {
  assert.equal(isBackgroundUnsupported(new Error("Host does not support background workspaces")), true);
  assert.equal(isBackgroundUnsupported("Unsupported: Background Workspaces discovery"), true);
  assert.equal(isBackgroundUnsupported(new Error("network down")), false);
  assert.equal(isBackgroundUnsupported(null), false);
});

test("listWithBackgroundFallback retries once without the filter when the host rejects it", async () => {
  const calls: boolean[] = [];
  const result = await listWithBackgroundFallback(true, async (includeBackground) => {
    calls.push(includeBackground);
    if (includeBackground) throw new Error("Inclusive discovery needs background workspaces support");
    return "plain";
  });
  assert.deepEqual(calls, [true, false]);
  assert.deepEqual(result, { value: "plain", includedBackground: false });
});

test("listWithBackgroundFallback asks once when included, and never asks when off", async () => {
  const calls: boolean[] = [];
  const ask = async (includeBackground: boolean) => (calls.push(includeBackground), "ok");
  assert.deepEqual(await listWithBackgroundFallback(true, ask), { value: "ok", includedBackground: true });
  assert.deepEqual(await listWithBackgroundFallback(false, ask), { value: "ok", includedBackground: false });
  assert.deepEqual(calls, [true, false]);
});

test("listWithBackgroundFallback rethrows other errors and failures of the retry", async () => {
  await assert.rejects(listWithBackgroundFallback(true, async () => { throw new Error("boom"); }), /boom/);
  await assert.rejects(listWithBackgroundFallback(false, async () => { throw new Error("background workspaces"); }), /background/);
});

// ---- last focused agent per workspace ------------------------------------------------------------

test("agentIdFromTabTestId reads agent tabs and ignores other tab kinds", () => {
  assert.equal(agentIdFromTabTestId("workspace-tab-agent_abc-123"), "abc-123");
  assert.equal(agentIdFromTabTestId("workspace-tab-terminal_t1"), null);
  assert.equal(agentIdFromTabTestId("workspace-tab-provider_subagent_3_abc_1_x"), null);
  assert.equal(agentIdFromTabTestId("workspace-tab-agent_"), null);
  assert.equal(agentIdFromTabTestId(null), null);
});

test("pickFocusedAgent keeps the remembered agent among several selected tabs, else the first", () => {
  assert.equal(pickFocusedAgent([], "a"), null);
  assert.equal(pickFocusedAgent(["b"], "a"), "b");
  assert.equal(pickFocusedAgent(["b", "a"], "a"), "a");
  assert.equal(pickFocusedAgent(["b", "c"], "a"), "b");
  assert.equal(pickFocusedAgent(["b", "c"], undefined), "b");
});

test("rememberAgent records the latest agent, keeps the object when unchanged, and stays bounded", () => {
  const empty = {};
  const one = rememberAgent(empty, "s:w1", "a1", 1000);
  assert.deepEqual(one, { "s:w1": { agentId: "a1", at: 1000 } });
  assert.notEqual(one, empty);
  // Same agent, time barely moved: nothing to write.
  assert.equal(rememberAgent(one, "s:w1", "a1", 1000 + REMEMBER_REFRESH_MS - 1), one);
  // Same agent, stored time stale: the time is refreshed.
  assert.deepEqual(rememberAgent(one, "s:w1", "a1", 1000 + REMEMBER_REFRESH_MS), { "s:w1": { agentId: "a1", at: 1000 + REMEMBER_REFRESH_MS } });
  // A different agent is recorded at once.
  assert.deepEqual(rememberAgent(one, "s:w1", "a2", 1001), { "s:w1": { agentId: "a2", at: 1001 } });
  let many: AgentMemory = {};
  for (let i = 0; i < 250; i++) many = rememberAgent(many, `s:w${i}`, `a${i}`, i);
  assert.equal(Object.keys(many).length, 200);
  assert.equal(many["s:w0"], undefined);
  assert.equal(many["s:w249"]?.agentId, "a249");
  // Updating an old entry moves it to the newest end, so it survives the next trim.
  const touched = rememberAgent(many, "s:w50", "z", 999);
  assert.equal(Object.keys(touched).at(-1), "s:w50");
});

test("parseAgentMemory migrates the old agent-id format to time 0 and reads the new one", () => {
  assert.deepEqual(parseAgentMemory({ "s:w": "a", bad: 3, also: null }), { "s:w": { agentId: "a", at: 0 } });
  assert.deepEqual(parseAgentMemory({ "s:w": { agentId: "a", at: 50 }, "s:x": { agentId: "b" }, "s:y": { agentId: 3, at: 1 } }), {
    "s:w": { agentId: "a", at: 50 },
    "s:x": { agentId: "b", at: 0 },
  });
  assert.deepEqual(parseAgentMemory(null), {});
  assert.deepEqual(parseAgentMemory(["x"]), {});
  assert.deepEqual(parseAgentMemory("nope"), {});
});

const mem = (agentId: string, at: number): RememberedAgent => ({ agentId, at });

test("agentToOpen opens the remembered tab when it is newer than your last message", () => {
  const agents: AgentInfo[] = [
    { id: "focused", workspaceId: "w1", activityAt: 100, lastUserMessageAt: 400 },
    { id: "messaged", workspaceId: "w1", activityAt: 300, lastUserMessageAt: 500 },
    { id: "other", workspaceId: "w2", activityAt: 900, lastUserMessageAt: 900 },
  ];
  assert.equal(agentToOpen("w1", mem("focused", 600), agents), "focused");
  // Unknown agent list: trust what was remembered.
  assert.equal(agentToOpen("w1", mem("focused", 600), null), "focused");
  // A list with none of this workspace's agents says nothing, so trust memory.
  assert.equal(agentToOpen("w3", mem("kept", 1), agents), "kept");
});

test("agentToOpen opens the chat you messaged when that is newer than the remembered tab", () => {
  const agents: AgentInfo[] = [
    { id: "focused", workspaceId: "w1", activityAt: 100, lastUserMessageAt: 200 },
    // A bot chat used from the Bots screen after the workspace page was left.
    { id: "bot", workspaceId: "w1", activityAt: 300, lastUserMessageAt: 700, automated: true },
    { id: "older", workspaceId: "w1", activityAt: 300, lastUserMessageAt: 650 },
  ];
  assert.equal(agentToOpen("w1", mem("focused", 600), agents), "bot");
  // Old-format memory (time 0) loses to any message.
  assert.equal(agentToOpen("w1", mem("focused", 0), agents), "bot");
  // The message newest overall wins among several.
  assert.equal(agentToOpen("w1", undefined, agents), "bot");
});

test("agentToOpen ignores a remembered agent that is gone", () => {
  const agents: AgentInfo[] = [
    { id: "a", workspaceId: "w1", activityAt: 100, lastUserMessageAt: 200 },
    { id: "other", workspaceId: "w2", activityAt: 900, lastUserMessageAt: 900 },
  ];
  // Archived, or moved to another workspace.
  assert.equal(agentToOpen("w1", mem("gone", 9999), agents), "a");
  assert.equal(agentToOpen("w1", mem("other", 9999), agents), "a");
});

test("agentToOpen never falls back to an automated chat", () => {
  const agents: AgentInfo[] = [
    { id: "routine", workspaceId: "w1", activityAt: 900, automated: true },
    { id: "plain-old", workspaceId: "w1", activityAt: 100 },
    { id: "plain-new", workspaceId: "w1", activityAt: 300 },
  ];
  assert.equal(agentToOpen("w1", undefined, agents), "plain-new");
  assert.equal(agentToOpen("w1", mem("gone", 5), agents), "plain-new");
  // Only automated chats listed: fall through to the remembered tab, else Paseo's default.
  const onlyBots: AgentInfo[] = [{ id: "routine", workspaceId: "w1", activityAt: 900, automated: true }];
  assert.equal(agentToOpen("w1", mem("gone", 5), onlyBots), "gone");
  assert.equal(agentToOpen("w1", undefined, onlyBots), null);
});

test("agentToOpen returns null when nothing is available", () => {
  assert.equal(agentToOpen("w3", undefined, null), null);
  assert.equal(agentToOpen("w3", undefined, [{ id: "x", workspaceId: "w2", activityAt: 1 }]), null);
});

// ---- visit times and messages as visits ---------------------------------------------------------

const k = (id: string) => `${S}:${id}`;

test("migrating an old visit order keeps it", () => {
  const visits = migrateMru([k("c"), k("a"), k("b")], 1_000_000);
  assert.deepEqual(recentKeys(visits), [k("c"), k("a"), k("b")]);
  // Junk in old storage is dropped, and a repeated key keeps its first (most recent) place.
  assert.deepEqual(recentKeys(migrateMru([k("a"), 3, k("b"), k("a")] as unknown[], 1_000_000)), [k("a"), k("b")]);
  assert.deepEqual(migrateMru("nope", 1), {});
});

test("parseVisits keeps only finite numeric times", () => {
  assert.deepEqual(parseVisits({ [k("a")]: 5, [k("b")]: "6", [k("c")]: Number.NaN }), { [k("a")]: 5 });
  assert.equal(parseVisits(null), null);
  assert.equal(parseVisits([1, 2]), null);
});

test("recordVisit stores the time and sorts newest first", () => {
  let visits = recordVisit({}, k("a"), 100);
  visits = recordVisit(visits, k("b"), 200);
  visits = recordVisit(visits, k("a"), 300);
  assert.deepEqual(recentKeys(visits), [k("a"), k("b")]);
  assert.equal(visits[k("a")], 300);
});

test("recordVisit keeps the newest visits past the cap", () => {
  let visits: Record<string, number> = {};
  for (let i = 0; i < MAX_VISITS + 5; i++) visits = recordVisit(visits, k(`w${i}`), i);
  const keys = recentKeys(visits);
  assert.equal(keys.length, MAX_VISITS);
  assert.equal(keys[0], k(`w${MAX_VISITS + 4}`));
  assert.ok(!keys.includes(k("w0")));
});

const msg = (workspaceId: string | null, lastUserMessageAt: number | null): AgentInfo => ({
  id: `agent-${workspaceId}-${lastUserMessageAt}`,
  workspaceId,
  activityAt: lastUserMessageAt ?? 0,
  lastUserMessageAt,
});

test("a message newer than a workspace's visit moves it to the front", () => {
  const visits = { [k("a")]: 300, [k("bot")]: 100 };
  const next = mergeMessageVisits(visits, S, { list: [msg("bot", 500), msg("bot", 200)] });
  assert.deepEqual(recentKeys(next), [k("bot"), k("a")]);
  assert.equal(next[k("bot")], 500);
  assert.equal(previousKey(recentKeys(next), k("a")), k("bot"));
});

test("a message older than the stored visit does not reorder", () => {
  const visits = { [k("a")]: 300, [k("bot")]: 250 };
  const next = mergeMessageVisits(visits, S, { list: [msg("bot", 200)] });
  assert.equal(next, visits);
  assert.deepEqual(recentKeys(next), [k("a"), k("bot")]);
});

test("a workspace never visited but messaged gets added", () => {
  const next = mergeMessageVisits({ [k("a")]: 300 }, S, { list: [msg("bot", 100)] });
  assert.deepEqual(recentKeys(next), [k("a"), k("bot")]);
});

test("agents without a message, without a workspace, or without a host change nothing", () => {
  const visits = { [k("a")]: 300 };
  assert.equal(mergeMessageVisits(visits, S, { list: [msg("bot", null), msg(null, 900)] }), visits);
  assert.equal(mergeMessageVisits(visits, null, { list: [msg("bot", 900)] }), visits);
  assert.equal(mergeMessageVisits(visits, S, null), visits);
});

test("merging messages respects the cap", () => {
  const visits: Record<string, number> = {};
  for (let i = 0; i < MAX_VISITS; i++) visits[k(`w${i}`)] = 1000 + i;
  const next = mergeMessageVisits(visits, S, { list: [msg("bot", 5000), msg("stale", 1)] });
  const keys = recentKeys(next);
  assert.equal(keys.length, MAX_VISITS);
  assert.equal(keys[0], k("bot"));
  assert.ok(!keys.includes(k("stale")));
  assert.ok(!keys.includes(k("w0")));
});

test("counting messages as visits is on by default", () => {
  assert.equal(DEFAULT_COUNT_MESSAGES, true);
  assert.equal(parseCountMessages(undefined), true);
  assert.equal(parseCountMessages("yes"), true);
  assert.equal(parseCountMessages(false), false);
  assert.equal(parseCountMessages(true), true);
});

const T0 = 1_000_000;
const automated = (label: string, offsetMs: number | null) => ({
  createdAt: T0,
  lastUserMessageAt: offsetMs === null ? null : T0 + offsetMs,
  labels: { [label]: "x" },
});

test("userMessageAt ignores the opening prompt of a routine chat", () => {
  assert.equal(userMessageAt(automated("paseo-bots.routine", 1000)), null);
});

test("userMessageAt ignores the opening prompt of an asked-by chat", () => {
  assert.equal(userMessageAt(automated("paseo-bots.asked-by", 1000)), null);
});

test("userMessageAt ignores the opening prompt of a pr-review-watch chat", () => {
  assert.equal(
    userMessageAt({ createdAt: T0, lastUserMessageAt: T0 + 1000, labels: { "pr-review-watch": "org/repo#12" } }),
    null,
  );
});

test("userMessageAt counts a later reply in a pr-review-watch chat", () => {
  assert.equal(
    userMessageAt({ createdAt: T0, lastUserMessageAt: T0 + 60_000, labels: { "pr-review-watch": "org/repo#12" } }),
    T0 + 60_000,
  );
});

test("userMessageAt counts a later reply in an automated chat", () => {
  assert.equal(userMessageAt(automated("paseo-bots.routine", 60_000)), T0 + 60_000);
});

test("userMessageAt counts the first message of an unlabelled chat", () => {
  assert.equal(userMessageAt({ createdAt: T0, lastUserMessageAt: T0 + 1000, labels: {} }), T0 + 1000);
});

test("userMessageAt is null without a message", () => {
  assert.equal(userMessageAt(automated("paseo-bots.routine", null)), null);
});

// ---- plugin screens ------------------------------------------------------------------------------

const screen = (pluginId: string, screenId: string, search = "", title = pluginId) => ({ pluginId, screenId, search, title });

test("a plugin screen URL parses to host, plugin and screen, with its params", () => {
  assert.deepEqual(parsePluginScreenUrl("/h/srv_a/plugin/flowly/surface/board"), {
    serverId: "srv_a", pluginId: "flowly", screenId: "board", search: "",
  });
  assert.deepEqual(parsePluginScreenUrl("/h/srv_a/plugin/flowly/surface/board/", "?param.id=7&param.tab=a%20b"), {
    serverId: "srv_a", pluginId: "flowly", screenId: "board", search: "?param.id=7&param.tab=a%20b",
  });
});

test("plugin screen URL segments are decoded", () => {
  assert.deepEqual(parsePluginScreenUrl("/h/srv%3Aa/plugin/%40x%2Fbots/surface/my%20screen"), {
    serverId: "srv:a", pluginId: "@x/bots", screenId: "my screen", search: "",
  });
});

test("the legacy sidebar form and non-plugin paths are not plugin screens", () => {
  assert.equal(parsePluginScreenUrl("/h/srv_a/plugin/flowly/sidebar/board"), null);
  assert.equal(parsePluginScreenUrl("/h/srv_a/workspace/ws1"), null);
  assert.equal(parsePluginScreenUrl("/"), null);
  assert.equal(parsePluginScreenUrl("/h/srv_a/plugin/flowly/surface/board/extra"), null);
  assert.equal(parsePluginScreenUrl("/h/%E0%A4%A/plugin/flowly/surface/board"), null);
});

test("the reopen URL rebuilds the route with encoded segments and the latest params", () => {
  assert.equal(pluginScreenUrl({ serverId: "srv_a", pluginId: "flowly", screenId: "board", search: "" }), "/h/srv_a/plugin/flowly/surface/board");
  assert.equal(
    pluginScreenUrl({ serverId: "srv:a", pluginId: "@x/bots", screenId: "my screen", search: "?param.id=7" }),
    "/h/srv%3Aa/plugin/%40x%2Fbots/surface/my%20screen?param.id=7",
  );
  const route = parsePluginScreenUrl("/h/srv%3Aa/plugin/%40x%2Fbots/surface/my%20screen", "?param.k=%26");
  assert.deepEqual(parsePluginScreenUrl(...(pluginScreenUrl(route!).split("?").map((x, i) => (i ? `?${x}` : x)) as [string, string])), route);
});

test("a screen key ignores params, differs per screen and host, and never looks like a workspace key", () => {
  const a = pluginScreenKey("srv_a", "flowly", "board");
  assert.equal(a, pluginScreenKey("srv_a", "flowly", "board"));
  assert.notEqual(a, pluginScreenKey("srv_a", "flowly", "list"));
  assert.notEqual(a, pluginScreenKey("srv_b", "flowly", "board"));
  assert.ok(isPluginScreenKey(a));
  assert.ok(!isPluginScreenKey(`${S}:ws1`));
  assert.equal(keyServerId(a), "srv_a");
  assert.equal(keyServerId(`${S}:ws1`), S);
  assert.equal(keyServerId(pluginScreenKey("a|b:c", "p", "s")), "a|b:c");
});

test("a screen label is its title as shown, else a prettified plugin id", () => {
  assert.equal(screenTitle("  Flowly board ", "flowly"), "Flowly board");
  assert.equal(screenTitle("", "paseo-bots"), "Paseo Bots");
  assert.equal(screenTitle(null, "@acme/linear_sync"), "Acme Linear Sync");
  assert.equal(prettifyPluginId("flowly"), "Flowly");
});

test("recording a screen keeps only the latest params and title, and reports no change when identical", () => {
  let screens = parseScreens(null);
  const key = pluginScreenKey(S, "flowly", "board");
  screens = recordScreen(screens, key, { title: "Board", search: "?param.id=1" });
  const same = recordScreen(screens, key, { title: "Board", search: "?param.id=1" });
  assert.equal(same, screens);
  const next = recordScreen(screens, key, { title: "Board 2", search: "?param.id=2" });
  assert.deepEqual(next[key], { title: "Board 2", search: "?param.id=2" });
  assert.deepEqual(Object.keys(next), [key]);
});

test("stored screens are read defensively", () => {
  const k = pluginScreenKey(S, "p", "s");
  assert.deepEqual(parseScreens({ [k]: { title: "T", search: "?a=1" }, [`${S}:ws`]: { title: "T", search: "" }, bad: 3, worse: { title: 1 } }), {
    [k]: { title: "T", search: "?a=1" },
  });
  assert.deepEqual(parseScreens([]), {});
  assert.deepEqual(parseScreens("x"), {});
});

test("plugin screens and workspaces mix by visit order within the limit", () => {
  const board = pluginScreenKey(S, "flowly", "board");
  const bots = pluginScreenKey(S, "paseo-bots", "bots");
  const mru = [`${S}:a`, board, `${S}:b`, bots, `${S}:c`];
  const screens = { [board]: { title: "Board", search: "?param.id=1" }, [bots]: { title: "Bots", search: "" } };
  const cards = buildCards(mru, one(list(info("a", 1), info("b", 1), info("c", 1))), 4, screens);
  assert.deepEqual(cards.map((c) => c.key), [`${S}:a`, board, `${S}:b`, bots]);
  assert.equal(cards[0].screen, undefined);
  assert.deepEqual(cards[1].screen, { pluginId: "flowly", screenId: "board", title: "Board", search: "?param.id=1" });
  assert.equal(cards[1].info, null);
  assert.equal(cards[1].serverId, S);
});

test("a screen with no stored details is skipped, and without screens no screen is listed", () => {
  const board = pluginScreenKey(S, "flowly", "board");
  const mru = [board, `${S}:a`];
  assert.deepEqual(buildCards(mru, one(list(info("a", 1))), 5, {}).map((c) => c.key), [`${S}:a`]);
  assert.deepEqual(buildCards(mru, one(list(info("a", 1))), 5, null).map((c) => c.key), [`${S}:a`]);
  assert.deepEqual(buildCards(mru, one(list(info("a", 1))), 5).map((c) => c.key), [`${S}:a`]);
});

test("screens fill the limit before workspaces by activity do", () => {
  const board = pluginScreenKey(S, "flowly", "board");
  const cards = buildCards([board], one(list(info("a", 5), info("b", 9))), 2, { [board]: { title: "Board", search: "" } });
  assert.deepEqual(cards.map((c) => c.key), [board, `${S}:b`]);
});

test("visiting a screen again moves it up without a second entry, params stay out of the key", () => {
  const key = pluginScreenKey(S, "flowly", "board");
  let visits = recordVisit({}, `${S}:a`, 10);
  visits = recordVisit(visits, key, 20);
  visits = recordVisit(visits, `${S}:b`, 30);
  visits = recordVisit(visits, key, 40);
  assert.deepEqual(recentKeys(visits), [key, `${S}:b`, `${S}:a`]);
});

test("with plugin screens off, their keys leave the order used for cards and the quick tap", () => {
  const board = pluginScreenKey(S, "flowly", "board");
  const mru = [board, `${S}:a`, `${S}:b`];
  assert.deepEqual(visibleKeys(mru, true), mru);
  assert.deepEqual(visibleKeys(mru, false), [`${S}:a`, `${S}:b`]);
  assert.equal(previousKey(visibleKeys(mru, false), `${S}:a`), `${S}:b`);
  assert.equal(previousKey(visibleKeys(mru, true), `${S}:a`), board);
});

test("the plugin screens setting defaults on and reads only booleans", () => {
  assert.equal(DEFAULT_INCLUDE_SCREENS, true);
  assert.equal(parseIncludeScreens(undefined), true);
  assert.equal(parseIncludeScreens("no"), true);
  assert.equal(parseIncludeScreens(false), false);
  assert.equal(parseIncludeScreens(true), true);
});

test("the hidden list is read defensively and keeps workspace and plugin screen keys once each", () => {
  const k = pluginScreenKey(S, "paseo-bots", "bots");
  assert.deepEqual(parseHidden(undefined), []);
  assert.deepEqual(parseHidden("x"), []);
  assert.deepEqual(parseHidden({ [k]: true }), []);
  assert.deepEqual(parseHidden([k, k, `${S}:ws`, `${S}:ws`, 3, null, "plugin-screen|bad", "nocolon", `${S}:`]), [k, `${S}:ws`]);
});

test("hiding adds a key once, and unhiding removes it", () => {
  const k = `${S}:a`;
  const on = setHidden([], k, true);
  assert.deepEqual(on, [k]);
  assert.equal(setHidden(on, k, true), on);
  assert.equal(setHidden([], k, false).length, 0);
  assert.deepEqual(setHidden(on, k, false), []);
});

test("the old skipped-screens list is merged into the hidden list once", () => {
  const bots = pluginScreenKey(S, "paseo-bots", "bots");
  const board = pluginScreenKey(S, "flowly", "board");
  assert.deepEqual(migrateHidden([`${S}:a`], [bots, board]), [`${S}:a`, bots, board]);
  assert.deepEqual(migrateHidden([bots], [bots, `${S}:zz`, 5]), [bots]);
  assert.deepEqual(migrateHidden(undefined, [bots]), [bots]);
  assert.deepEqual(migrateHidden(undefined, undefined), []);
});

test("a hidden key is dropped from the order, cards and the quick tap, workspace or screen; the rest stay", () => {
  const bots = pluginScreenKey(S, "paseo-bots", "bots");
  const board = pluginScreenKey(S, "flowly", "board");
  const mru = [bots, `${S}:a`, board, `${S}:b`];
  assert.deepEqual(visibleKeys(mru, true, [bots]), [`${S}:a`, board, `${S}:b`]);
  assert.deepEqual(visibleKeys(mru, true, [`${S}:a`]), [bots, board, `${S}:b`]);
  assert.deepEqual(visibleKeys(mru, true, []), mru);
  assert.deepEqual(visibleKeys(mru, false, [bots]), [`${S}:a`, `${S}:b`]);
  assert.equal(previousKey(visibleKeys(mru, true, [bots]), `${S}:a`), board);
  const screens = { [bots]: { title: "Bots", search: "" }, [board]: { title: "Board", search: "" } };
  const cards = buildCards(visibleKeys(mru, true, [bots]), one(list(info("a", 1), info("b", 1))), 5, screens);
  assert.deepEqual(cards.map((c) => c.key), [`${S}:a`, board, `${S}:b`]);
});

test("a hidden workspace is not used to fill the list up to the limit, and the list refills from the next ones", () => {
  const ws = list(info("a", 30), info("b", 20), info("c", 10));
  const hidden = [`${S}:a`];
  assert.deepEqual(buildCards(visibleKeys([`${S}:b`], true, hidden), one(ws), 2, null, hidden).map((c) => c.key), [`${S}:b`, `${S}:c`]);
  assert.deepEqual(buildCards([], one(ws), 5, null, hidden).map((c) => c.key), [`${S}:b`, `${S}:c`]);
});

test("filtering still finds a hidden workspace", () => {
  const ws = list(info("a", 30), info("b", 20));
  assert.deepEqual(filterCards("a", [`${S}:a`], one(ws), 9).map((c) => c.key), [`${S}:a`]);
});

test("messages to a hidden workspace do not count as visits", () => {
  const agents = { list: [{ id: "x", workspaceId: "a", activityAt: 1, lastUserMessageAt: 500 }, { id: "y", workspaceId: "b", activityAt: 1, lastUserMessageAt: 600 }] };
  const next = mergeMessageVisits({}, S, agents, [`${S}:a`]);
  assert.deepEqual(Object.keys(next), [`${S}:b`]);
});

test("the selection stays on its index after a hide, clamped to the shorter list", () => {
  assert.equal(clampIndex(2, 5), 2);
  assert.equal(clampIndex(4, 4), 3);
  assert.equal(clampIndex(0, 0), 0);
  assert.equal(clampIndex(-1, 3), 0);
});

test("a hidden screen keeps its title in the store even with no visits, so Settings can name it", () => {
  const bots = pluginScreenKey(S, "paseo-bots", "bots");
  const board = pluginScreenKey(S, "flowly", "board");
  const screens = { [bots]: { title: "Bots", search: "" }, [board]: { title: "Board", search: "" } };
  const visits = { [`${S}:a`]: 1 };
  assert.deepEqual(Object.keys(pruneScreens(screens, visits, [bots])), [bots]);
  assert.deepEqual(Object.keys(pruneScreens(screens, visits)), []);
});

test("a screen left in under a second records no visit; one left after a second does, at the time it was opened", () => {
  const k = pluginScreenKey(S, "paseo-bots", "bots");
  const t0 = 1_000_000;
  // Opened, then left (route is a workspace) 400 ms later: nothing recorded.
  let step = trackScreenVisit(null, k, t0);
  assert.equal(step.record, null);
  step = trackScreenVisit(step.pending, k, t0 + 400);
  assert.equal(step.record, null);
  step = trackScreenVisit(step.pending, null, t0 + 500);
  assert.equal(step.record, null);
  assert.equal(step.pending, null);
  // Opened and still there after the dwell: recorded once, at the open time.
  let kept: PendingScreenVisit | null = null;
  step = trackScreenVisit(kept, k, t0);
  step = trackScreenVisit(step.pending, k, t0 + SCREEN_DWELL_MS - 1);
  assert.equal(step.record, null);
  step = trackScreenVisit(step.pending, k, t0 + SCREEN_DWELL_MS);
  assert.deepEqual(step.record, { key: k, at: t0 });
  step = trackScreenVisit(step.pending, k, t0 + SCREEN_DWELL_MS + 300);
  assert.equal(step.record, null);
  // Moving straight to another screen restarts the clock.
  const other = pluginScreenKey(S, "flowly", "board");
  step = trackScreenVisit(step.pending, other, t0 + 5000);
  assert.equal(step.record, null);
  assert.deepEqual(step.pending, { key: other, since: t0 + 5000, recorded: false });
  assert.equal(SCREEN_DWELL_MS, 1000);
});

const FACTS_NOW = 1_700_000_000_000;
function facts(over: Partial<WorkspaceInfo> = {}): WorkspaceInfo {
  return {
    id: "w", name: "feature-x", project: "paseo", branch: "feature-x", status: "done",
    additions: 0, deletions: 0, activityAt: FACTS_NOW - 3_600_000, ...over,
  };
}

/** Every sidebar detail on, so the tests below see each fact. */
const ALL: SidebarDisplay = {
  titleSource: "title",
  items: { branch: true, project: true, host: true, changeRequest: true, services: true, labels: true },
  checks: "iconAndText",
  trailing: "timestamp",
};

test("rowFacts: running shows the state and how long", () => {
  const f = rowFacts(facts({ status: "running", statusAt: FACTS_NOW - 4 * 60_000 }), FACTS_NOW);
  assert.equal(f.state, "running");
  assert.equal(f.label, "Running · 4m");
});

test("rowFacts: each Paseo status keeps its own state and word", () => {
  const expected = {
    needs_input: "Needs input · 11m",
    failed: "Failed · 11m",
    attention: "Finished · 11m",
  } as const;
  for (const status of ["needs_input", "failed", "attention"] as const) {
    const f = rowFacts(facts({ status, statusAt: FACTS_NOW - 11 * 60_000 }), FACTS_NOW);
    assert.equal(f.state, status);
    assert.equal(f.label, expected[status], status);
  }
});

test("rowFacts: a status that just began says now", () => {
  assert.equal(rowFacts(facts({ status: "running", statusAt: FACTS_NOW - 5_000 }), FACTS_NOW).label, "Running · now");
});

test("rowFacts: idle shows how long ago, falling back to activity time", () => {
  const f = rowFacts(facts(), FACTS_NOW);
  assert.equal(f.state, "done");
  assert.equal(f.label, "1h ago");
  assert.equal(rowFacts(facts({ activityAt: FACTS_NOW - 10_000 }), FACTS_NOW).label, "just now");
  assert.equal(rowFacts(facts({ activityAt: 0 }), FACTS_NOW).label, null);
});

test("rowFacts: the branch is left out when it matches the name", () => {
  assert.equal(rowFacts(facts(), FACTS_NOW, undefined, ALL).branch, null);
  assert.equal(rowFacts(facts({ branch: "other" }), FACTS_NOW, undefined, ALL).branch, "other");
  assert.equal(rowFacts(facts({ branch: null }), FACTS_NOW, undefined, ALL).branch, null);
  assert.equal(rowFacts(facts(), FACTS_NOW, undefined, ALL).project, "paseo");
});

test("rowFacts: hidden workspaces are flagged", () => {
  assert.equal(rowFacts(facts({ background: true }), FACTS_NOW).hidden, true);
  assert.equal(rowFacts(facts(), FACTS_NOW).hidden, false);
});

test("rowFacts: pull request, checks, diff and unpushed commits, only when they apply", () => {
  const none = rowFacts(facts(), FACTS_NOW);
  assert.equal(none.pr, null);
  assert.equal(none.checks, null);
  assert.equal(none.diff, null);
  assert.equal(none.ahead, 0);

  const full = rowFacts(
    facts({ pr: { number: 9161, state: "open", checks: "pending", review: null }, additions: 214, deletions: 37, ahead: 2 }),
    FACTS_NOW,
    undefined,
    { ...ALL, trailing: "diff" },
  );
  assert.deepEqual(full.pr, { number: 9161, state: "open" });
  assert.equal(full.checks, "pending");
  assert.deepEqual(full.diff, { additions: 214, deletions: 37 });
  assert.equal(full.ahead, 2);
});

test("rowFacts: checks only count while the pull request is open or draft", () => {
  const merged = rowFacts(facts({ pr: { number: 1, state: "merged", checks: "success", review: null } }), FACTS_NOW);
  assert.equal(merged.checks, null);
  const noChecks = rowFacts(facts({ pr: { number: 1, state: "open", checks: "none", review: null } }), FACTS_NOW);
  assert.equal(noChecks.checks, null);
});

test("rowFacts: a plugin screen shows only its plugin name and when it was visited", () => {
  const screen = { pluginId: "flowly", screenId: "home", title: "Home", search: "" };
  const f = rowFacts(null, FACTS_NOW, { screen, visitedAt: FACTS_NOW - 2 * 3_600_000 });
  assert.equal(f.state, "done");
  assert.equal(f.project, "Flowly");
  assert.equal(f.branch, null);
  assert.equal(f.label, "2h ago");
  assert.equal(f.pr, null);
  assert.equal(f.diff, null);
  assert.equal(f.ahead, 0);
  assert.equal(f.hidden, false);
});

// The rows follow the sidebar's Display settings (Paseo's app settings), read each time the switcher opens.
test("sidebar display: Paseo's defaults when nothing or junk is saved", () => {
  assert.deepEqual(DEFAULT_SIDEBAR_DISPLAY, {
    titleSource: "title",
    items: { branch: false, project: false, host: true, changeRequest: true, services: true, labels: true },
    checks: "iconAndText",
    trailing: "timestamp",
  });
  assert.deepEqual(parseSidebarDisplay(null), DEFAULT_SIDEBAR_DISPLAY);
  assert.deepEqual(parseSidebarDisplay("nope"), DEFAULT_SIDEBAR_DISPLAY);
  assert.deepEqual(
    parseSidebarDisplay({ workspaceTitleSource: "x", sidebarChecksDisplay: 3, sidebarWorkspaceTrailing: "soon", sidebarRowItems: { branch: "yes", host: null } }),
    DEFAULT_SIDEBAR_DISPLAY,
  );
});

test("sidebar display: saved values are read, each field on its own", () => {
  const d = parseSidebarDisplay({
    workspaceTitleSource: "branch",
    sidebarRowItems: { branch: true, project: true, host: false, changeRequest: false, services: false, labels: false },
    sidebarChecksDisplay: "icon",
    sidebarWorkspaceTrailing: "diff",
  });
  assert.deepEqual(d, {
    titleSource: "branch",
    items: { branch: true, project: true, host: false, changeRequest: false, services: false, labels: false },
    checks: "icon",
    trailing: "diff",
  });
  assert.equal(parseSidebarDisplay({ sidebarRowItems: { project: true } }).items.branch, false, "a missing item keeps its default");
});

test("sidebar display: Paseo's older checks and scripts switches still count", () => {
  assert.equal(parseSidebarDisplay({ sidebarRowItems: { checks: false } }).checks, "none");
  assert.equal(parseSidebarDisplay({ sidebarRowItems: { checks: false }, sidebarChecksDisplay: "icon" }).checks, "icon", "the newer setting wins");
  assert.equal(parseSidebarDisplay({ sidebarRowItems: { scripts: false } }).items.services, false);
  assert.equal(parseSidebarDisplay({ sidebarRowItems: { scripts: false, services: true } }).items.services, true);
});

test("sidebar display: the title is the workspace's title or its branch, like the sidebar", () => {
  const branch = { ...DEFAULT_SIDEBAR_DISPLAY, titleSource: "branch" as const };
  assert.equal(workspaceTitle(facts({ name: "Fix login", branch: "fix-login" }), DEFAULT_SIDEBAR_DISPLAY), "Fix login");
  assert.equal(workspaceTitle(facts({ name: "Fix login", branch: "fix-login" }), branch), "fix-login");
  assert.equal(workspaceTitle(facts({ name: "Fix login", branch: null }), branch), "Fix login", "no branch: the title");
});

test("sidebar display: only the enabled details show, and the host only when it is given", () => {
  const ws = facts({ name: "Fix login", branch: "fix-login", pr: { number: 7, state: "open", checks: "success", review: null }, additions: 3, deletions: 1 });
  const off = rowFacts(ws, FACTS_NOW, undefined, DEFAULT_SIDEBAR_DISPLAY);
  assert.equal(off.project, null, "project is off by default");
  assert.equal(off.branch, null, "branch is off by default");
  assert.equal(off.host, null, "one host: no host label");
  assert.deepEqual(off.pr, { number: 7, state: "open" });
  assert.equal(rowFacts(ws, FACTS_NOW, undefined, DEFAULT_SIDEBAR_DISPLAY, "Laptop").host, "Laptop");
  assert.equal(rowFacts(ws, FACTS_NOW, undefined, { ...ALL, items: { ...ALL.items, host: false } }, "Laptop").host, null);
  const on = rowFacts(ws, FACTS_NOW, undefined, ALL);
  assert.equal(on.project, "paseo");
  assert.equal(on.branch, "fix-login");
  const noPr = rowFacts(ws, FACTS_NOW, undefined, { ...ALL, items: { ...ALL.items, changeRequest: false } });
  assert.equal(noPr.pr, null);
  assert.equal(noPr.checks, "success", "checks have their own setting, as in the sidebar");
});

test("sidebar display: the branch is left out when it is already the title", () => {
  const ws = facts({ name: "Fix login", branch: "fix-login" });
  assert.equal(rowFacts(ws, FACTS_NOW, undefined, ALL).branch, "fix-login");
  assert.equal(rowFacts(ws, FACTS_NOW, undefined, { ...ALL, titleSource: "branch" }).branch, null);
});

test("sidebar display: checks as icon and text, icon only, or not at all", () => {
  const ws = facts({ pr: { number: 7, state: "open", checks: "failure", review: null } });
  const both = rowFacts(ws, FACTS_NOW, undefined, ALL);
  assert.equal(both.checks, "failure");
  assert.equal(both.checksText, true);
  const icon = rowFacts(ws, FACTS_NOW, undefined, { ...ALL, checks: "icon" });
  assert.equal(icon.checks, "failure");
  assert.equal(icon.checksText, false);
  assert.equal(rowFacts(ws, FACTS_NOW, undefined, { ...ALL, checks: "none" }).checks, null);
});

test("sidebar display: the trailing item is the time, the diff, or neither; status marks stay", () => {
  const ws = facts({ status: "running", statusAt: FACTS_NOW - 4 * 60_000, additions: 5, deletions: 2 });
  const time = rowFacts(ws, FACTS_NOW, undefined, ALL);
  assert.equal(time.label, "Running · 4m");
  assert.equal(time.diff, null);
  const diff = rowFacts(ws, FACTS_NOW, undefined, { ...ALL, trailing: "diff" });
  assert.equal(diff.label, "Running", "the status word stays, without its time");
  assert.equal(diff.state, "running");
  assert.deepEqual(diff.diff, { additions: 5, deletions: 2 });
  const none = rowFacts(ws, FACTS_NOW, undefined, { ...ALL, trailing: "none" });
  assert.equal(none.label, "Running");
  assert.equal(none.diff, null);
  const idle = facts();
  assert.equal(rowFacts(idle, FACTS_NOW, undefined, ALL).label, "1h ago");
  assert.equal(rowFacts(idle, FACTS_NOW, undefined, { ...ALL, trailing: "diff" }).label, null, "idle with no time: no label");
});

test("filtering ranks a word-start match on the title the row shows, the branch when the sidebar titles by branch", () => {
  const fix = { ...info("fix", 1), name: "Fix login", branch: "auth-refactor" };
  const notes = { ...info("notes", 2), name: "auth refactor notes", branch: "notes" };
  const hosts = one(list(fix, notes));
  assert.deepEqual(filterCards("auth", [], hosts).map((c) => c.workspaceId), ["notes", "fix"]);
  const branches = { ...DEFAULT_SIDEBAR_DISPLAY, titleSource: "branch" as const };
  assert.deepEqual(filterCards("auth", [], hosts, undefined, branches).map((c) => c.workspaceId), ["fix", "notes"]);
});

// Paseo re-runs the plugin after the switcher navigates by route (plugin screens, hidden workspaces),
// so a fresh switcher opened right after a switch must start from the lists the previous one loaded.
test("a reinstalled switcher keeps the workspace lists the previous one loaded, per host", () => {
  const ws = list(info("hidden1", 3), info("hidden2", 2));
  const hosts = new Map([
    [S, { workspaces: ws, workspacesAt: 1000, agents: null, agentsAt: 0 }],
    ["srv_b", { workspaces: null, workspacesAt: 0, agents: null, agentsAt: 0 }],
  ]);
  const carried = carriedLists({ includeBackground: true, hosts }, true);
  const cards = buildCards([`${S}:hidden1`, `${S}:hidden2`, "srv_b:x"], loadedWorkspaces(carried?.hosts ?? null), 5);
  assert.deepEqual(cards.map((c) => c.info?.name ?? null), ["hidden1", "hidden2", null]);
  assert.equal(carried?.hosts.get(S)?.workspacesAt, 1000, "keeps the load time, so a stale list is still refreshed");
});

test("lists loaded under the other background setting, in an older shape, or nothing saved, are not carried", () => {
  const hosts = new Map([[S, { workspaces: list(info("a", 1)), workspacesAt: 1, agents: null, agentsAt: 0 }]]);
  assert.equal(carriedLists({ includeBackground: true, hosts }, false), null);
  assert.equal(carriedLists(undefined, true), null);
  assert.equal(carriedLists({ includeBackground: true, hosts: "nope" }, true), null);
  // A switcher from before hosts were kept apart carried one unkeyed list; its host is unknown.
  assert.equal(carriedLists({ includeBackground: true, workspaces: list(info("a", 1)), workspacesAt: 1, homeServer: S, agents: null, agentsAt: 0 }, true), null);
});

// A row whose host is offline (or not loaded yet) and has no sidebar row still shows a name.
test("the names of visited workspaces are remembered per host, and only while they are visited", () => {
  const hosts = new Map([
    [S, list({ ...info("a", 1), name: "Alpha", project: "web" }, info("unvisited", 2))],
    ["srv_b", list({ ...info("a", 1), name: "Other alpha", project: "api" })],
  ]);
  const visits = { [`${S}:a`]: 10, ["srv_b:a"]: 9, ["srv_c:z"]: 8 };
  const names = rememberNames({ ["srv_c:z"]: { name: "Zed", project: "z" }, ["srv_old:q"]: { name: "Q", project: "" } }, visits, hosts);
  assert.deepEqual(names, {
    [`${S}:a`]: { name: "Alpha", project: "web" },
    ["srv_b:a"]: { name: "Other alpha", project: "api" },
    ["srv_c:z"]: { name: "Zed", project: "z" },
  });
  assert.equal(rememberNames(names, visits, hosts), names, "unchanged names keep the same object");
  assert.deepEqual(parseKnownNames({ [`${S}:a`]: { name: "Alpha", project: "web" }, bad: { name: 3 }, also: "x" }), { [`${S}:a`]: { name: "Alpha", project: "web" } });
  assert.deepEqual(parseKnownNames("nope"), {});
});
