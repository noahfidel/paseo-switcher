import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_RASTER_ICON_BYTES,
  cleanScreenIcon,
  isImageIcon,
  nextScreenIcon,
  parseScreens,
  pluginScreenKey,
  recordScreen,
  sanitizeSvg,
  sidebarRowSelector,
} from "../client/model.ts";

const KEY = pluginScreenKey("srv", "flowly", "board");
const SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 3v18"/></svg>';
const CLEAN = sanitizeSvg(SVG)!;
const OTHER = sanitizeSvg('<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/></svg>')!;
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

test("cleanScreenIcon keeps sanitized svg and small raster data URLs only", () => {
  assert.equal(cleanScreenIcon(SVG), CLEAN);
  assert.equal(cleanScreenIcon(PNG), PNG);
  assert.equal(cleanScreenIcon(`data:image/png;base64,${"A".repeat(MAX_RASTER_ICON_BYTES)}`), null);
  assert.equal(cleanScreenIcon("data:image/svg+xml;base64,PHN2Zz4="), null);
  assert.equal(cleanScreenIcon("https://example.com/icon.png"), null);
  assert.equal(cleanScreenIcon("<div>no</div>"), null);
  assert.equal(cleanScreenIcon(42), null);
  assert.equal(MAX_RASTER_ICON_BYTES, 16 * 1024);
});

test("isImageIcon tells a raster data URL from svg markup", () => {
  assert.equal(isImageIcon(PNG), true);
  assert.equal(isImageIcon(CLEAN), false);
});

test("nextScreenIcon: the active sidebar row's icon wins over the header badge", () => {
  assert.deepEqual(nextScreenIcon(undefined, { row: PNG, title: true, badge: CLEAN }), { icon: PNG, iconFrom: "row" });
  assert.deepEqual(nextScreenIcon({ icon: CLEAN, iconFrom: "badge" }, { row: OTHER, title: true, badge: CLEAN }), { icon: OTHER, iconFrom: "row" });
});

test("nextScreenIcon: with no active row, a row icon already stored is kept", () => {
  const stored = { icon: PNG, iconFrom: "row" as const };
  assert.deepEqual(nextScreenIcon(stored, { row: null, title: true, badge: CLEAN }), stored);
  assert.deepEqual(nextScreenIcon(stored, { row: null, title: true, badge: null }), stored);
  assert.deepEqual(nextScreenIcon(stored, { row: null, title: false, badge: null }), stored);
});

test("nextScreenIcon: with no row, the badge decides once the title is drawn", () => {
  assert.deepEqual(nextScreenIcon(undefined, { row: null, title: true, badge: CLEAN }), { icon: CLEAN, iconFrom: "badge" });
  // An icon saved before sources were tracked counts as a badge icon, so a missing badge clears it.
  assert.deepEqual(nextScreenIcon({ icon: CLEAN }, { row: null, title: true, badge: null }), {});
  assert.deepEqual(nextScreenIcon({ icon: CLEAN, iconFrom: "badge" }, { row: null, title: true, badge: null }), {});
  // Before the title is drawn nothing changes.
  assert.deepEqual(nextScreenIcon({ icon: CLEAN, iconFrom: "badge" }, { row: null, title: false, badge: null }), { icon: CLEAN, iconFrom: "badge" });
  assert.deepEqual(nextScreenIcon(undefined, { row: null, title: false, badge: null }), {});
});

test("recordScreen stores where the icon came from and notices a change of source", () => {
  let screens = recordScreen({}, KEY, { title: "Board", search: "", icon: PNG, iconFrom: "row" });
  assert.deepEqual(screens[KEY], { title: "Board", search: "", icon: PNG, iconFrom: "row" });
  assert.equal(recordScreen(screens, KEY, { title: "Board", search: "", icon: PNG, iconFrom: "row" }), screens);
  screens = recordScreen(screens, KEY, { title: "Board", search: "", icon: PNG, iconFrom: "badge" });
  assert.equal(screens[KEY].iconFrom, "badge");
});

test("parseScreens reads raster icons and their source back, and drops unsafe ones", () => {
  const parsed = parseScreens({
    [KEY]: { title: "Board", search: "", icon: PNG, iconFrom: "row" },
    [pluginScreenKey("srv", "a", "b")]: { title: "A", search: "", icon: "data:text/html;base64,PGI+", iconFrom: "row" },
    [pluginScreenKey("srv", "c", "d")]: { title: "C", search: "", icon: SVG, iconFrom: "nonsense" },
  });
  assert.deepEqual(parsed[KEY], { title: "Board", search: "", icon: PNG, iconFrom: "row" });
  assert.deepEqual(parsed[pluginScreenKey("srv", "a", "b")], { title: "A", search: "" });
  assert.deepEqual(parsed[pluginScreenKey("srv", "c", "d")], { title: "C", search: "", icon: CLEAN, iconFrom: "badge" });
});

test("sidebarRowSelector matches the plugin's active header and footer rows, with the id escaped", () => {
  assert.equal(
    sidebarRowSelector("flowly"),
    '[data-testid^="plugin-sidebar-flowly-"][aria-selected="true"], [data-testid^="plugin-sidebar-footer-flowly-"][aria-selected="true"]',
  );
  assert.match(sidebarRowSelector('a"b\\c'), /plugin-sidebar-a\\"b\\\\c-/);
});
