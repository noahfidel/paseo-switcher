import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_RASTER_ICON_BYTES,
  cleanScreenIcon,
  healScreenTitle,
  isImageIcon,
  nextScreenIcon,
  parseScreens,
  pluginScreenKey,
  recordScreen,
  sanitizeSvg,
  sidebarRowSelector,
  pickRowIcon,
  screenRowSelector,
  screensWithoutIcon,
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

// RN-web draws a tinted <Image> as an <img> plus a hidden svg holding only the tint filter.
const TINT = '<svg style="position:absolute;height:0;visibility:hidden;width:0"><defs><filter id="tint-1"><feFlood flood-color="#888"/><feComposite in2="SourceAlpha" operator="atop"/></filter></defs></svg>';

test("pickRowIcon prefers a raster img over an svg, and skips svgs that only hold defs or filters", () => {
  assert.equal(pickRowIcon([{ kind: "svg", markup: TINT }, { kind: "img", src: PNG }]), PNG);
  assert.equal(pickRowIcon([{ kind: "svg", markup: SVG }, { kind: "img", src: PNG }]), PNG, "the img wins even after a drawn svg");
  assert.equal(pickRowIcon([{ kind: "svg", markup: TINT }, { kind: "svg", markup: SVG }]), CLEAN);
  assert.equal(pickRowIcon([{ kind: "svg", markup: TINT }]), null);
  assert.equal(pickRowIcon([{ kind: "svg", markup: '<svg viewBox="0 0 24 24"><filter id="f"><feFlood/></filter></svg>' }]), null);
  assert.equal(pickRowIcon([{ kind: "img", src: "https://example.com/a.png" }, { kind: "svg", markup: SVG }]), CLEAN, "an unusable img falls through");
  assert.equal(pickRowIcon([]), null);
});

test("screenRowSelector finds a screen's own sidebar row, selected or not, in the header or footer", () => {
  assert.equal(
    screenRowSelector("flowly", "board"),
    '[data-testid="plugin-sidebar-flowly-board"], [data-testid="plugin-sidebar-footer-flowly-board"]',
  );
  assert.match(screenRowSelector('a"b', "c\\d"), /plugin-sidebar-a\\"b-c\\\\d"/);
});

test("screensWithoutIcon lists the stored screens that have no icon yet", () => {
  const screens = parseScreens({
    [KEY]: { title: "Board", search: "", icon: PNG, iconFrom: "row" },
    [pluginScreenKey("srv", "a", "b")]: { title: "A", search: "" },
  });
  assert.deepEqual(screensWithoutIcon(screens), [pluginScreenKey("srv", "a", "b")]);
});

test("healScreenTitle replaces a sibling's title or the prettified plugin id with the own label", () => {
  assert.equal(healScreenTitle("Flowly", "Linear", ["Flowly"], "flowly"), "Linear");
  assert.equal(healScreenTitle("Paseo Bots", "Bots", [], "paseo-bots"), "Bots");
});

test("healScreenTitle keeps a genuinely different title, a missing own label and an equal title", () => {
  assert.equal(healScreenTitle("My Linear", "Linear", ["Flowly"], "flowly"), "My Linear");
  assert.equal(healScreenTitle("Flowly", null, ["Flowly"], "flowly"), "Flowly");
  assert.equal(healScreenTitle("Linear", "Linear", ["Linear"], "flowly"), "Linear");
});
