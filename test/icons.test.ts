import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { MAX_AVATAR_BYTES, MAX_ICON_BYTES, BOT_LABEL, botIdForWorkspace, parseScreens, pluginScreenKey, recordScreen, safeImageUrl, sanitizeSvg, scopeSvgIds, type AgentInfo } from "../client/model.ts";

/** The output without the root's fixed namespace and aria attributes, so patterns like "http" only match content. */
const body = (svg: string) => svg.replace(/ xmlns="[^"]*"| aria-hidden="true"/g, "");

const LUCIDE = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide"><path d="M12 3v18"/><circle cx="12" cy="12" r="3"/></svg>';

test("sanitizeSvg keeps drawing elements, currentColor and the viewBox, and drops fixed size and class", () => {
  const out = sanitizeSvg(LUCIDE);
  assert.ok(out);
  assert.match(out, /^<svg /);
  assert.match(out, /viewBox="0 0 24 24"/);
  assert.match(out, /stroke="currentColor"/);
  assert.match(out, /<path d="M12 3v18"\/>/);
  assert.match(out, /<circle cx="12" cy="12" r="3"\/>/);
  assert.doesNotMatch(out, /width="24"|class=|lucide/);
});

test("sanitizeSvg rejects anything that is not a single svg", () => {
  assert.equal(sanitizeSvg(""), null);
  assert.equal(sanitizeSvg("hello"), null);
  assert.equal(sanitizeSvg('<div><svg viewBox="0 0 1 1"/></div>'), null);
  assert.equal(sanitizeSvg(null as unknown as string), null);
});

test("sanitizeSvg drops script, foreignObject and style elements with their contents", () => {
  const out = sanitizeSvg('<svg viewBox="0 0 24 24"><script>alert(1)</script><style>*{x:y}</style><foreignObject><div onclick="x()">hi</div><path d="M0 0"/></foreignObject><path d="M1 1"/></svg>');
  assert.ok(out);
  assert.doesNotMatch(body(out), /script|style|foreignObject|alert|div|hi|M0 0/i);
  assert.match(out, /M1 1/);
});

test("sanitizeSvg drops event handlers and style attributes", () => {
  const out = sanitizeSvg('<svg viewBox="0 0 24 24" onload="x()"><path d="M1 1" onclick="x()" ONMOUSEOVER="x()" style="fill:url(http://e.com/a)"/></svg>');
  assert.ok(out);
  assert.doesNotMatch(out, /on\w+=|style/i);
  assert.match(out, /d="M1 1"/);
});

test("sanitizeSvg keeps only local hrefs", () => {
  const out = sanitizeSvg(
    '<svg viewBox="0 0 24 24"><defs><path id="a" d="M1 1"/></defs><use href="#a"/><use xlink:href="#a"/><use href="http://e.com/x.svg#a"/><use xlink:href="javascript:alert(1)"/><use href="data:image/svg+xml,x"/></svg>',
  );
  assert.ok(out);
  assert.equal((out.match(/href="#a"/g) ?? []).length, 2);
  assert.doesNotMatch(body(out), /http|javascript|data:/);
});

test("sanitizeSvg keeps url(#ref) and drops any other url()", () => {
  const out = sanitizeSvg(
    '<svg viewBox="0 0 24 24"><clipPath id="c"><rect width="1" height="1"/></clipPath><g clip-path="url(#c)"><path d="M1 1" fill="url(http://e.com/x)"/><path d="M2 2" fill="url(#c) url(javascript:x)"/><path d="M3 3" stroke="URL( &#35;c )"/></g></svg>',
  );
  assert.ok(out);
  assert.match(out, /clip-path="url\(#c\)"/);
  assert.doesNotMatch(body(out), /http|javascript|&/);
  assert.doesNotMatch(out, /M2 2" fill|M1 1" fill/);
});

test("sanitizeSvg drops values that could hide an escape", () => {
  const out = sanitizeSvg('<svg viewBox="0 0 24 24"><path d="M1 1" fill="u&#114;l(http://e.com)"/><path d="M2 2" fill="red&quot; onload=&quot;x"/><path d="M3 3" fill="\\75rl(x)"/></svg>');
  assert.ok(out);
  assert.doesNotMatch(out, /&|\\|onload|fill=/);
});

test("sanitizeSvg drops comments, text and unknown elements but keeps their drawing children out too", () => {
  const out = sanitizeSvg('<svg viewBox="0 0 24 24"><!-- <script>x</script> -->text<animate attributeName="d"/><a href="javascript:x"><path d="M9 9"/></a><image href="http://e.com/i.png"/><path d="M1 1"/></svg>');
  assert.ok(out);
  assert.doesNotMatch(out, /text|animate|<a|image|M9 9|script/);
  assert.match(out, /M1 1/);
});

test("sanitizeSvg refuses markup it cannot parse", () => {
  assert.equal(sanitizeSvg('<svg viewBox="0 0 24 24"><path d="M1 1"/><script>if(a<b){}</script></svg>'), null);
  assert.equal(sanitizeSvg("<svg viewBox='0 0 24 24'><path d='M1 1'/>< /svg"), null);
});

test("sanitizeSvg closes unclosed elements and ignores stray closers", () => {
  const out = sanitizeSvg('<svg viewBox="0 0 24 24"></g><g><path d="M1 1"/>');
  assert.ok(out);
  assert.match(out, /<g><path d="M1 1"\/><\/g><\/svg>$/);
});

test("sanitizeSvg caps size", () => {
  const big = `<svg viewBox="0 0 24 24"><path d="${"M1 1 ".repeat(3000)}"/></svg>`;
  assert.equal(sanitizeSvg(big), null);
  assert.ok(sanitizeSvg(big, 100_000));
});

test("sanitizeSvg gives a viewBox from width and height when the root has none", () => {
  assert.match(sanitizeSvg('<svg width="16" height="16"><rect width="16" height="16"/></svg>') ?? "", /viewBox="0 0 16 16"/);
});

test("sanitizeSvg accepts a paseo-bots avatar", () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" shape-rendering="crispEdges"><clipPath id="pb-1"><circle cx="4" cy="4" r="4"/></clipPath><g clip-path="url(#pb-1)"><rect width="8" height="8" fill="#fde"/><rect x="2" y="2" width="1" height="1" fill="#333"/></g></svg>';
  const out = sanitizeSvg(svg);
  assert.ok(out);
  assert.match(out, /shape-rendering="crispEdges"/);
  assert.match(out, /clip-path="url\(#pb-1\)"/);
  assert.match(out, /fill="#fde"/);
});

test("safeImageUrl allows http(s) and raster data URLs only", () => {
  assert.equal(safeImageUrl("https://x.test/a.png"), "https://x.test/a.png");
  assert.equal(safeImageUrl("http://x.test/a.png"), "http://x.test/a.png");
  assert.equal(safeImageUrl("data:image/png;base64,AAAA"), "data:image/png;base64,AAAA");
  assert.equal(safeImageUrl("data:image/webp;base64,AAAA"), "data:image/webp;base64,AAAA");
  assert.equal(safeImageUrl("data:image/svg+xml;base64,AAAA"), null);
  assert.equal(safeImageUrl("data:text/html;base64,AAAA"), null);
  assert.equal(safeImageUrl("javascript:alert(1)"), null);
  assert.equal(safeImageUrl("file:///etc/passwd"), null);
  assert.equal(safeImageUrl('https://x.test/"onerror="x'), null);
  assert.equal(safeImageUrl(undefined), null);
});

const agent = (id: string, workspaceId: string | null, activityAt: number, botId?: string | null): AgentInfo => ({ id, workspaceId, activityAt, botId });

test("botIdForWorkspace picks the most recent bot chat in the workspace", () => {
  assert.equal(BOT_LABEL, "paseo-bots.bot");
  const list = [agent("a", "w1", 10, "old"), agent("b", "w1", 30, "new"), agent("c", "w1", 50, null), agent("d", "w2", 99, "other")];
  assert.equal(botIdForWorkspace(list, "w1"), "new");
  assert.equal(botIdForWorkspace(list, "w2"), "other");
  assert.equal(botIdForWorkspace(list, "w3"), null);
  assert.equal(botIdForWorkspace(null, "w1"), null);
  assert.equal(botIdForWorkspace(list, ""), null);
});

const KEY = pluginScreenKey("srv", "p", "s");
const KEY_T = pluginScreenKey("srv", "p", "t");
const KEY_U = pluginScreenKey("srv", "p", "u");
test("screen icons are stored, kept across records that have none, and replaced by new ones", () => {
  const icon = sanitizeSvg(LUCIDE)!;
  let screens = recordScreen({}, KEY, { title: "T", search: "", icon });
  assert.equal(screens[KEY].icon, icon);
  assert.equal(recordScreen(screens, KEY, { title: "T", search: "", icon }), screens);
  const other = icon.replace("M12 3v18", "M1 1");
  screens = recordScreen(screens, KEY, { title: "T", search: "", icon: other });
  assert.equal(screens[KEY].icon, other);
});

test("parseScreens reads old entries without an icon, and re-sanitizes stored icons", () => {
  const parsed = parseScreens({
    [KEY]: { title: "T", search: "" },
    [KEY_T]: { title: "U", search: "", icon: '<svg viewBox="0 0 1 1"><script>x</script><path d="M1 1" onclick="x"/></svg>' },
    [KEY_U]: { title: "V", search: "", icon: "<div>no</div>" },
  });
  assert.deepEqual(parsed[KEY], { title: "T", search: "" });
  assert.doesNotMatch(parsed[KEY_T].icon ?? "", /script|onclick/);
  assert.match(parsed[KEY_T].icon ?? "", /M1 1/);
  assert.deepEqual(parsed[KEY_U], { title: "V", search: "" });
});

test("recordScreen clears a stored icon when the new record has none", () => {
  const icon = sanitizeSvg(LUCIDE)!;
  const withIcon = recordScreen({}, KEY, { title: "T", search: "", icon });
  const cleared = recordScreen(withIcon, KEY, { title: "T", search: "" });
  assert.notEqual(cleared, withIcon);
  assert.deepEqual(cleared[KEY], { title: "T", search: "" });
});

const WITH_REFS = sanitizeSvg(
  '<svg viewBox="0 0 8 8"><defs><path id="p" d="M1 1"/><clipPath id="c"><rect width="1" height="1"/></clipPath></defs><use href="#p"/><use href="#gone"/><g clip-path="url(#c)"><rect width="2" height="2" fill="url(#missing)"/></g></svg>',
)!;

test("scopeSvgIds gives every id the prefix and points local refs at the new ids", () => {
  const out = scopeSvgIds(WITH_REFS, "pws7-");
  assert.match(out, /id="pws7-p"/);
  assert.match(out, /id="pws7-c"/);
  assert.match(out, /href="#pws7-p"/);
  assert.match(out, /clip-path="url\(#pws7-c\)"/);
  assert.doesNotMatch(out, /id="p"|id="c"|href="#p"|url\(#c\)/);
});

test("scopeSvgIds drops refs that do not point at an id inside the svg", () => {
  const out = scopeSvgIds(WITH_REFS, "pws7-");
  assert.doesNotMatch(out, /gone|missing/);
  assert.match(out, /<rect width="2" height="2"\/>/);
});

test("scopeSvgIds gives two draws of the same svg different ids", () => {
  const a = scopeSvgIds(WITH_REFS, "pws1-");
  const b = scopeSvgIds(WITH_REFS, "pws2-");
  const ids = (s: string) => [...s.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(ids(a).filter((id) => ids(b).includes(id)).length, 0);
});

test("scopeSvgIds leaves an svg without ids alone", () => {
  const plain = sanitizeSvg(LUCIDE)!;
  assert.equal(scopeSvgIds(plain, "pws1-"), plain);
});

// A real paseo-bots avatar (avatarSvg output, 11 037 bytes): about half of all generated avatars are over 8 KB.
const AVATAR = readFileSync(new URL("./fixtures/avatar-large.svg", import.meta.url), "utf8");
const count = (svg: string, re: RegExp) => svg.match(re)?.length ?? 0;

test("the avatar fixture is over the icon limit and under the avatar limit", () => {
  assert.ok(AVATAR.length > MAX_ICON_BYTES && AVATAR.length < MAX_AVATAR_BYTES);
  assert.equal(MAX_ICON_BYTES, 8 * 1024);
  assert.equal(MAX_AVATAR_BYTES, 32 * 1024);
});

test("a large bot avatar passes the avatar limit with its drawing intact, and is refused at the icon limit", () => {
  assert.equal(sanitizeSvg(AVATAR), null);
  const out = sanitizeSvg(AVATAR, MAX_AVATAR_BYTES);
  assert.ok(out);
  assert.equal(count(out, /<rect /g), count(AVATAR, /<rect /g));
  assert.equal(count(out, /fill="#[0-9a-f]+"/gi), count(AVATAR, /fill="#[0-9a-f]+"/gi));
  assert.match(out, /viewBox="0 0 30 30"/);
  assert.match(out, /shape-rendering="crispEdges"/);
  const clip = /<clipPath id="([\w-]+)"/.exec(AVATAR)![1];
  assert.match(out, new RegExp(`<clipPath id="${clip}"`));
  assert.match(out, new RegExp(`clip-path="url\\(#${clip}\\)"`));
});

test("a large bot avatar is unchanged by id scoping apart from its clip id", () => {
  const out = sanitizeSvg(AVATAR, MAX_AVATAR_BYTES)!;
  const clip = /<clipPath id="([\w-]+)"/.exec(out)![1];
  const scoped = scopeSvgIds(out, "pws-s1-");
  assert.equal(scoped.replaceAll(`pws-s1-${clip}`, clip), out);
});

test("a stored screen icon over the icon limit is dropped when read back", () => {
  const parsed = parseScreens({ [KEY]: { title: "T", search: "", icon: AVATAR } });
  assert.deepEqual(parsed[KEY], { title: "T", search: "" });
});
