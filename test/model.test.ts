import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCards,
  clampLimit,
  DEFAULT_LIMIT,
  initialIndex,
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
