import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ago,
  buildCards,
  clampLimit,
  DEFAULT_LIMIT,
  filterCards,
  matchRanges,
  STATUS_LABEL,
  initialIndex,
  parseLayout,
  previousKey,
  touch,
  wrap,
  type WorkspaceInfo,
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

test("touch moves a key to the front without duplicates", () => {
  assert.deepEqual(touch(["a", "b", "c"], "c"), ["c", "a", "b"]);
  const same = ["a", "b"];
  assert.equal(touch(same, "a"), same, "unchanged order returns the same array");
});

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
