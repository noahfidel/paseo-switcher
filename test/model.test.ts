import assert from "node:assert/strict";
import { test } from "node:test";
import {
  agentIdFromTabTestId,
  agentToOpen,
  ago,
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
  migrateMru,
  parseCountMessages,
  parseVisits,
  recentKeys,
  recordVisit,
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

test("cards are the most recent visits, capped at the limit", () => {
  const mru = ["1", "2", "3", "4", "5", "6", "7"].map((id) => `${S}:${id}`);
  const ws = list(...["1", "2", "3", "4", "5", "6", "7"].map((id, i) => info(id, i)));
  assert.deepEqual(
    buildCards(mru, S, ws, 5).map((c) => c.workspaceId),
    ["1", "2", "3", "4", "5"],
  );
});

test("deleted workspaces drop out once the list has loaded", () => {
  const mru = [`${S}:gone`, `${S}:a`];
  assert.deepEqual(buildCards(mru, S, list(info("a", 1)), 5).map((c) => c.workspaceId), ["a"]);
  assert.deepEqual(buildCards(mru, S, null, 5).map((c) => c.workspaceId), ["gone", "a"], "kept before load");
});

test("few visits fill in by latest activity", () => {
  const ws = list(info("a", 1), info("b", 30), info("c", 20), info("d", 10));
  assert.deepEqual(
    buildCards([`${S}:a`], S, ws, 3).map((c) => c.workspaceId),
    ["a", "b", "c"],
  );
});

test("visits on another host are kept without data", () => {
  const cards = buildCards([`other:x`, `${S}:a`], S, list(info("a", 1)), 5);
  assert.deepEqual(cards.map((c) => [c.serverId, c.workspaceId, c.info?.id ?? null]), [
    ["other", "x", null],
    [S, "a", "a"],
  ]);
});

test("keys containing colons split on the last one", () => {
  const cards = buildCards([`srv:with:colon:wks_1`], null, null, 5);
  assert.equal(cards[0]?.serverId, "srv:with:colon");
  assert.equal(cards[0]?.workspaceId, "wks_1");
});

test("the first Ctrl+Tab selects the previous workspace", () => {
  const cards = buildCards([`${S}:a`, `${S}:b`], S, null, 5);
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
  const ids = (q: string) => filterCards(q, [], S, ws).map((c) => c.workspaceId);
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
  assert.deepEqual(filterCards("rate", [`${S}:c`], S, ws).map((c) => c.workspaceId), ["c", "a", "b"]);
  assert.deepEqual(filterCards("rate", [], S, ws).map((c) => c.workspaceId), ["a", "c", "b"]);
});

test("filter caps results at the number keys and needs a host and a list", () => {
  const ws = list(...Array.from({ length: 12 }, (_, i) => ({ ...info(String(i), i), name: `Task ${i}` })));
  assert.equal(filterCards("task", [], S, ws).length, 9);
  assert.deepEqual(filterCards("task", [], null, ws), []);
  assert.deepEqual(filterCards("task", [], S, null), []);
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
  const one = rememberAgent(empty, "s:w1", "a1");
  assert.deepEqual(one, { "s:w1": "a1" });
  assert.notEqual(one, empty);
  assert.equal(rememberAgent(one, "s:w1", "a1"), one);
  assert.deepEqual(rememberAgent(one, "s:w1", "a2"), { "s:w1": "a2" });
  let many: Record<string, string> = {};
  for (let i = 0; i < 250; i++) many = rememberAgent(many, `s:w${i}`, `a${i}`);
  assert.equal(Object.keys(many).length, 200);
  assert.equal(many["s:w0"], undefined);
  assert.equal(many["s:w249"], "a249");
  // Updating an old entry moves it to the newest end, so it survives the next trim.
  const touched = rememberAgent(many, "s:w50", "z");
  assert.equal(Object.keys(touched).at(-1), "s:w50");
});

test("parseAgentMemory keeps only string pairs", () => {
  assert.deepEqual(parseAgentMemory({ "s:w": "a", bad: 3, also: null }), { "s:w": "a" });
  assert.deepEqual(parseAgentMemory(null), {});
  assert.deepEqual(parseAgentMemory(["x"]), {});
  assert.deepEqual(parseAgentMemory("nope"), {});
});

test("agentToOpen prefers the remembered agent while it still exists in that workspace", () => {
  const agents: AgentInfo[] = [
    { id: "old", workspaceId: "w1", activityAt: 100 },
    { id: "new", workspaceId: "w1", activityAt: 300 },
    { id: "other", workspaceId: "w2", activityAt: 900 },
  ];
  assert.equal(agentToOpen("w1", "old", agents), "old");
  // Unknown agent list: trust what was remembered.
  assert.equal(agentToOpen("w1", "old", null), "old");
  // Archived or moved away: fall back to the most recently active agent there.
  assert.equal(agentToOpen("w1", "gone", agents), "new");
  assert.equal(agentToOpen("w1", "other", agents), "new");
  // Nothing remembered: most recently active.
  assert.equal(agentToOpen("w1", undefined, agents), "new");
  // The list is one page: a workspace with none of its agents on it says nothing, so trust memory.
  assert.equal(agentToOpen("w3", "kept", agents), "kept");
  // Nothing at all: keep Paseo's default.
  assert.equal(agentToOpen("w3", undefined, agents), null);
  assert.equal(agentToOpen("w3", undefined, null), null);
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
  const next = mergeMessageVisits(visits, S, { serverId: S, list: [msg("bot", 500), msg("bot", 200)] });
  assert.deepEqual(recentKeys(next), [k("bot"), k("a")]);
  assert.equal(next[k("bot")], 500);
  assert.equal(previousKey(recentKeys(next), k("a")), k("bot"));
});

test("a message older than the stored visit does not reorder", () => {
  const visits = { [k("a")]: 300, [k("bot")]: 250 };
  const next = mergeMessageVisits(visits, S, { serverId: S, list: [msg("bot", 200)] });
  assert.equal(next, visits);
  assert.deepEqual(recentKeys(next), [k("a"), k("bot")]);
});

test("a workspace never visited but messaged gets added", () => {
  const next = mergeMessageVisits({ [k("a")]: 300 }, S, { serverId: S, list: [msg("bot", 100)] });
  assert.deepEqual(recentKeys(next), [k("a"), k("bot")]);
});

test("agents without a message, without a workspace, or from another host change nothing", () => {
  const visits = { [k("a")]: 300 };
  assert.equal(mergeMessageVisits(visits, S, { serverId: S, list: [msg("bot", null), msg(null, 900)] }), visits);
  assert.equal(mergeMessageVisits(visits, S, { serverId: "srv_b", list: [msg("bot", 900)] }), visits);
  assert.equal(mergeMessageVisits(visits, null, { serverId: null, list: [msg("bot", 900)] }), visits);
  assert.equal(mergeMessageVisits(visits, S, null), visits);
});

test("merging messages respects the cap", () => {
  const visits: Record<string, number> = {};
  for (let i = 0; i < MAX_VISITS; i++) visits[k(`w${i}`)] = 1000 + i;
  const next = mergeMessageVisits(visits, S, { serverId: S, list: [msg("bot", 5000), msg("stale", 1)] });
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
