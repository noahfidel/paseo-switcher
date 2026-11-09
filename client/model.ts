// Pure ordering logic, kept free of DOM and React so it is easy to test.

export interface WorkspaceInfo {
  id: string;
  name: string;
  project: string;
  branch: string | null;
  status: "needs_input" | "failed" | "running" | "attention" | "done";
  additions: number;
  deletions: number;
  activityAt: number;
  /** When the workspace entered its current status, for "Running · 4m". */
  statusAt?: number;
  pr?: PullRequestInfo | null;
  /** Commits not yet pushed to origin. */
  ahead?: number;
  /** Hidden from the sidebar. */
  background?: boolean;
}

export interface PullRequestInfo {
  number: number | null;
  state: "open" | "draft" | "merged" | "closed";
  checks: "none" | "pending" | "success" | "failure";
  review: "approved" | "changes_requested" | "pending" | null;
}

export type Shortcut = "cmd-backquote" | "ctrl-backquote" | "ctrl-tab" | "alt-tab";
export const DEFAULT_SHORTCUT: Shortcut = "cmd-backquote";

/**
 * Each shortcut is a held modifier plus a physical key. Matching uses `code`, so Cmd+` works on
 * every keyboard layout and Option never turns Tab or ` into another character on macOS.
 * "ctrl-backquote" stays valid so a saved setting still parses, but Paseo binds Ctrl+` itself.
 */
export const SHORTCUTS: Record<
  Shortcut,
  { label: string; code: string; modifier: "Control" | "Alt" | "Meta"; modifierLabel: string; keyLabel: string }
> = {
  "cmd-backquote": { label: "Cmd+`", code: "Backquote", modifier: "Meta", modifierLabel: "Cmd", keyLabel: "`" },
  "ctrl-backquote": { label: "Ctrl+`", code: "Backquote", modifier: "Control", modifierLabel: "Ctrl", keyLabel: "`" },
  "ctrl-tab": { label: "Ctrl+Tab", code: "Tab", modifier: "Control", modifierLabel: "Ctrl", keyLabel: "Tab" },
  "alt-tab": { label: "Option+Tab", code: "Tab", modifier: "Alt", modifierLabel: "Option", keyLabel: "Tab" },
};

export function parseShortcut(value: unknown): Shortcut {
  return typeof value === "string" && Object.hasOwn(SHORTCUTS, value) ? (value as Shortcut) : DEFAULT_SHORTCUT;
}

interface KeyLike {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

/** The chosen modifier must be held alone (Shift is allowed and means "back"). */
export function matchesShortcut(shortcut: Shortcut, e: KeyLike): boolean {
  const { code, modifier } = SHORTCUTS[shortcut];
  return e.code === code && e.ctrlKey === (modifier === "Control") && e.altKey === (modifier === "Alt") && e.metaKey === (modifier === "Meta");
}

/** Releasing the chosen modifier commits the selection. */
export function isReleaseKey(shortcut: Shortcut, key: string): boolean {
  return key === SHORTCUTS[shortcut].modifier;
}

export type Layout = "strip" | "list";
export const DEFAULT_LAYOUT: Layout = "list";

export function parseLayout(value: unknown): Layout {
  return value === "strip" ? "strip" : DEFAULT_LAYOUT;
}

/** What a status reads as. `attention` is Paseo's "finished, not looked at yet". */
export const STATUS_LABEL: Record<Exclude<WorkspaceInfo["status"], "done">, string> = {
  running: "Running",
  needs_input: "Needs input",
  attention: "Finished",
  failed: "Failed",
};

/** Compact age: "now", "4m", "3h", "2d". */
export function ago(at: number | undefined, now: number): string | null {
  if (!at) return null;
  const minutes = Math.floor((now - at) / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** Paseo's own workspace status, one to one. */
export type RowState = WorkspaceInfo["status"];

/** What a list row shows, picked from a workspace (or plugin screen) so the DOM adapter stays dumb. */
export interface RowFacts {
  state: RowState;
  /** "Running · 4m", "Needs input · 4m", "Failed · 4m", "Finished · 4m", "1h ago", or null when nothing is known. */
  label: string | null;
  /** Project name, or the prettified plugin name for a screen. */
  project: string | null;
  /** Null when absent or equal to the name. */
  branch: string | null;
  hidden: boolean;
  pr: { number: number | null; state: PullRequestInfo["state"] } | null;
  /** Only while the pull request is open or draft. */
  checks: "pending" | "success" | "failure" | null;
  diff: { additions: number; deletions: number } | null;
  ahead: number;
}

const STATUS_WORD = { running: "Running", needs_input: "Needs input", failed: "Failed", attention: "Finished" } as const;

export function rowFacts(
  info: WorkspaceInfo | null,
  now: number,
  screen?: { screen: ScreenStop; visitedAt?: number },
): RowFacts {
  const idleLabel = (at: number | undefined) => {
    const since = ago(at, now);
    return since === null ? null : since === "now" ? "just now" : `${since} ago`;
  };
  if (!info) {
    return {
      state: "done",
      label: idleLabel(screen?.visitedAt),
      project: screen ? prettifyPluginId(screen.screen.pluginId) : null,
      branch: null,
      hidden: false,
      pr: null,
      checks: null,
      diff: null,
      ahead: 0,
    };
  }
  const state = info.status;
  let label: string | null;
  if (state === "done") {
    label = idleLabel(info.activityAt);
  } else {
    const since = ago(info.statusAt || info.activityAt, now);
    const word = STATUS_WORD[state];
    label = since ? `${word} · ${since}` : word;
  }
  const pr = info.pr ?? null;
  const live = pr && (pr.state === "open" || pr.state === "draft");
  return {
    state,
    label,
    project: info.project || null,
    branch: info.branch && info.branch !== info.name ? info.branch : null,
    hidden: Boolean(info.background),
    pr: pr ? { number: pr.number, state: pr.state } : null,
    checks: live && pr.checks !== "none" ? pr.checks : null,
    diff: info.additions || info.deletions ? { additions: info.additions, deletions: info.deletions } : null,
    ahead: info.ahead ?? 0,
  };
}

export interface Card {
  /** `${serverId}:${workspaceId}`, the same key Paseo uses in sidebar test IDs. */
  key: string;
  serverId: string;
  workspaceId: string;
  info: WorkspaceInfo | null;
  /** Set for a plugin screen stop; `workspaceId` is then empty and `info` null. */
  screen?: ScreenStop;
}

/** A plugin screen as shown on a card. */
export interface ScreenStop {
  pluginId: string;
  screenId: string;
  title: string;
  /** The query string last seen on the screen (`?param.…`), or "". */
  search: string;
  /** The screen's own icon when one was seen: sanitized svg, or a raster data URL (see `isImageIcon`). */
  icon?: string;
}

export const MIN_LIMIT = 2;
/** One card per number key. */
export const MAX_LIMIT = 9;
export const DEFAULT_LIMIT = 5;
/** How many visited workspaces are remembered. */
export const MAX_VISITS = 40;

export function clampLimit(value: unknown): number {
  const n = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.round(n)));
}

export function workspaceKey(serverId: string, workspaceId: string): string {
  return `${serverId}:${workspaceId}`;
}

export function splitKey(key: string): { serverId: string; workspaceId: string } {
  const at = key.lastIndexOf(":");
  return { serverId: key.slice(0, at), workspaceId: key.slice(at + 1) };
}

// ---- plugin screens ---------------------------------------------------------------------------------

/*
 * Plugin screens are stops in the switcher like workspaces. They are reopened by URL because the plugin
 * API only lets a plugin open its own screens. Paseo's route is `/h/<host>/plugin/<pluginId>/surface/<screenId>`
 * with optional `?param.<key>=<value>`; it is not a public format, so re-check it on every Paseo upgrade.
 */
const SCREEN_ROUTE = /^\/h\/([^/]+)\/plugin\/([^/]+)\/surface\/([^/]+)\/?$/;
const SCREEN_KEY_PREFIX = "plugin-screen|";

export interface PluginScreenRoute {
  serverId: string;
  pluginId: string;
  screenId: string;
  search: string;
}

/** The plugin screen a URL shows; null for any other page, including the legacy `/sidebar/` form (Paseo redirects it). */
export function parsePluginScreenUrl(pathname: string, search = ""): PluginScreenRoute | null {
  const match = SCREEN_ROUTE.exec(pathname);
  if (!match) return null;
  try {
    return {
      serverId: decodeURIComponent(match[1]),
      pluginId: decodeURIComponent(match[2]),
      screenId: decodeURIComponent(match[3]),
      search: search === "?" ? "" : search,
    };
  } catch {
    return null;
  }
}

/** Path plus params, for reopening a screen. */
export function pluginScreenUrl(route: PluginScreenRoute): string {
  const e = encodeURIComponent;
  return `/h/${e(route.serverId)}/plugin/${e(route.pluginId)}/surface/${e(route.screenId)}${route.search}`;
}

/** One key per screen (params are not part of it). `|` is always encoded in the parts, and no workspace key starts with this. */
export function pluginScreenKey(serverId: string, pluginId: string, screenId: string): string {
  const e = encodeURIComponent;
  return `${SCREEN_KEY_PREFIX}${e(serverId)}|${e(pluginId)}|${e(screenId)}`;
}

export function isPluginScreenKey(key: string): boolean {
  return key.startsWith(SCREEN_KEY_PREFIX);
}

export function parsePluginScreenKey(key: string): { serverId: string; pluginId: string; screenId: string } | null {
  if (!isPluginScreenKey(key)) return null;
  const parts = key.slice(SCREEN_KEY_PREFIX.length).split("|");
  if (parts.length !== 3) return null;
  try {
    return { serverId: decodeURIComponent(parts[0]), pluginId: decodeURIComponent(parts[1]), screenId: decodeURIComponent(parts[2]) };
  } catch {
    return null;
  }
}

/** The host a workspace or plugin screen key belongs to. */
export function keyServerId(key: string): string {
  return parsePluginScreenKey(key)?.serverId ?? splitKey(key).serverId;
}

/** "paseo-bots" -> "Paseo Bots"; a scope like "@acme/" reads as a word too. */
export function prettifyPluginId(pluginId: string): string {
  const words = pluginId.split(/[^A-Za-z0-9]+/).filter(Boolean);
  return words.length ? words.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ") : "Plugin";
}

/** The title shown on the screen when visited, else a prettified plugin id. */
export function screenTitle(shown: string | null | undefined, pluginId: string): string {
  return shown?.trim() || prettifyPluginId(pluginId);
}

/** Where a screen's icon was read: its highlighted sidebar row, or the badge beside its header title. */
export type IconSource = "row" | "badge";

export interface ScreenMeta {
  title: string;
  search: string;
  /** The screen's icon: sanitized svg markup, or a raster data URL; absent when none was captured. */
  icon?: string;
  /** Where `icon` came from; a stored icon without one predates rows and counts as a badge icon. */
  iconFrom?: IconSource;
}
/** Latest title and params per screen key. */
export type Screens = Record<string, ScreenMeta>;

/** Size limit for a raster screen icon (a data URL), such as a tinted PNG mark in a sidebar row. */
export const MAX_RASTER_ICON_BYTES = 16 * 1024;

/** Whether an icon is a raster data URL (drawn as an img) rather than svg markup. */
export function isImageIcon(icon: string): boolean {
  return icon.startsWith("data:");
}

/** A screen icon safe to store and draw: sanitized svg, or a raster data URL of at most MAX_RASTER_ICON_BYTES. */
export function cleanScreenIcon(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (isImageIcon(value)) return value.length <= MAX_RASTER_ICON_BYTES && safeImageUrl(value) ? value : null;
  return sanitizeSvg(value);
}

/**
 * The icon to keep for a screen after looking at the page. The highlighted sidebar row's icon wins. With no
 * such row (sidebar collapsed, or the plugin draws none), a row icon already stored is kept; otherwise the
 * header badge decides once the title is drawn (no badge clears the icon), and before that nothing changes.
 * `row` and `badge` are already cleaned (null when absent or unusable).
 */
export function nextScreenIcon(
  stored: { icon?: string; iconFrom?: IconSource } | undefined,
  seen: { row: string | null; title: boolean; badge: string | null },
): { icon?: string; iconFrom?: IconSource } {
  if (seen.row) return { icon: seen.row, iconFrom: "row" };
  if (!seen.title || stored?.iconFrom === "row") {
    if (!stored?.icon) return {};
    return stored.iconFrom ? { icon: stored.icon, iconFrom: stored.iconFrom } : { icon: stored.icon };
  }
  return seen.badge ? { icon: seen.badge, iconFrom: "badge" } : {};
}

/**
 * The plugin's highlighted sidebar row. Paseo gives each `SidebarRow` a test ID of
 * `plugin-sidebar-<pluginId>-<itemId>[-<rowId>]` (footer items: `plugin-sidebar-footer-…`) and sets
 * `aria-selected="true"` on it when the plugin marks it active. Not a public API; re-check on every upgrade.
 */
export function sidebarRowSelector(pluginId: string): string {
  const id = pluginId.replace(/["\\]/g, "\\$&");
  return `[data-testid^="plugin-sidebar-${id}-"][aria-selected="true"], [data-testid^="plugin-sidebar-footer-${id}-"][aria-selected="true"]`;
}

function screenMeta(title: string, search: string, icon: string | null | undefined, iconFrom: IconSource | undefined): ScreenMeta {
  if (!icon) return { title, search };
  return iconFrom ? { title, search, icon, iconFrom } : { title, search, icon };
}

export function parseScreens(value: unknown): Screens {
  const screens: Screens = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return screens;
  for (const [k, v] of Object.entries(value)) {
    const m = v as Partial<ScreenMeta> | null;
    if (!isPluginScreenKey(k) || !m || typeof m.title !== "string" || typeof m.search !== "string") continue;
    // Stored icons are cleaned again on the way in, in case the saved value was edited.
    const icon = cleanScreenIcon(m.icon);
    const from: IconSource | undefined = m.iconFrom === "row" ? "row" : m.iconFrom === undefined ? undefined : "badge";
    screens[k] = screenMeta(m.title, m.search, icon, from);
  }
  return screens;
}

/** Stores the latest title and params for a screen; returns `screens` itself when nothing changed. */
export function recordScreen(screens: Screens, key: string, meta: ScreenMeta): Screens {
  const current = screens[key];
  if (current && current.title === meta.title && current.search === meta.search && current.icon === meta.icon && current.iconFrom === meta.iconFrom) {
    return screens;
  }
  return { ...screens, [key]: screenMeta(meta.title, meta.search, meta.icon, meta.iconFrom) };
}

/**
 * Drops details of screens no longer in the visit history, except hidden ones (they stay so Settings can name
 * them). Returns `screens` itself when none were dropped.
 */
export function pruneScreens(screens: Screens, visits: Visits, hidden: readonly string[] = []): Screens {
  const keep = (k: string) => Object.hasOwn(visits, k) || hidden.includes(k);
  if (Object.keys(screens).every(keep)) return screens;
  const kept: Screens = {};
  for (const [k, v] of Object.entries(screens)) if (keep(k)) kept[k] = v;
  return kept;
}

/** Whether a key is one the switcher can hide: a plugin screen key, or `serverId:workspaceId`. */
function isHideableKey(key: unknown): key is string {
  if (typeof key !== "string") return false;
  if (isPluginScreenKey(key)) return parsePluginScreenKey(key) !== null;
  const i = key.indexOf(":");
  return i > 0 && i < key.length - 1;
}

/** Keys hidden from the switcher (workspaces and plugin screens), each once, in the order they were hidden. */
export function parseHidden(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const keys: string[] = [];
  for (const k of value) if (isHideableKey(k) && !keys.includes(k)) keys.push(k);
  return keys;
}

/** Returns `hidden` itself when nothing changes. */
export function setHidden(hidden: readonly string[], key: string, hide: boolean): string[] {
  if (hidden.includes(key) === hide) return hidden as string[];
  return hide ? [...hidden, key] : hidden.filter((k) => k !== key);
}

/** The hidden list with the retired per-screen "skipped screens" list folded in (plugin screen keys only). */
export function migrateHidden(stored: unknown, legacySkipped: unknown): string[] {
  const keys = parseHidden(stored);
  if (Array.isArray(legacySkipped)) {
    for (const k of legacySkipped) if (typeof k === "string" && parsePluginScreenKey(k) && !keys.includes(k)) keys.push(k);
  }
  return keys;
}

/** Keeps a selection on the same index after the list changed length. */
export function clampIndex(index: number, length: number): number {
  return length <= 0 ? 0 : Math.max(0, Math.min(index, length - 1));
}

/** A plugin screen left sooner than this records no visit, so redirect screens never reach the recents. */
export const SCREEN_DWELL_MS = 1000;

export interface PendingScreenVisit {
  key: string;
  since: number;
  recorded: boolean;
}

/**
 * Feed it the plugin screen key on show (null on any other page, or for a hidden screen) on every route check.
 * It reports the visit once the screen has stayed open for SCREEN_DWELL_MS, stamped with when it was opened.
 */
export function trackScreenVisit(
  pending: PendingScreenVisit | null,
  key: string | null,
  now: number,
): { pending: PendingScreenVisit | null; record: { key: string; at: number } | null } {
  if (!key) return { pending: null, record: null };
  if (!pending || pending.key !== key) return { pending: { key, since: now, recorded: false }, record: null };
  if (pending.recorded || now - pending.since < SCREEN_DWELL_MS) return { pending, record: null };
  return { pending: { ...pending, recorded: true }, record: { key, at: pending.since } };
}

function screenCard(key: string, meta: ScreenMeta | undefined): Card | null {
  const parts = parsePluginScreenKey(key);
  if (!parts || !meta) return null;
  return {
    key,
    serverId: parts.serverId,
    workspaceId: "",
    info: null,
    screen: { pluginId: parts.pluginId, screenId: parts.screenId, title: meta.title, search: meta.search, ...(meta.icon ? { icon: meta.icon } : {}) },
  };
}

/** The visit order to use: plugin screens only when they are included, minus anything hidden from the switcher. */
export function visibleKeys(mru: readonly string[], includeScreens: boolean, hidden: readonly string[] = []): string[] {
  const shown = includeScreens ? mru : mru.filter((key) => !isPluginScreenKey(key));
  return hidden.length ? shown.filter((key) => !hidden.includes(key)) : [...shown];
}

export const DEFAULT_INCLUDE_SCREENS = true;

export function parseIncludeScreens(value: unknown): boolean {
  return typeof value === "boolean" ? value : DEFAULT_INCLUDE_SCREENS;
}

// ---- visit times ----------------------------------------------------------------------------------

/** When each workspace was last visited (opened, or messaged when that counts), in epoch ms. */
export type Visits = Record<string, number>;

/** Stored visit times, or null when there are none yet (so the old visit order can be migrated). */
export function parseVisits(value: unknown): Visits | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const visits: Visits = {};
  for (const [k, v] of Object.entries(value)) if (typeof v === "number" && Number.isFinite(v)) visits[k] = v;
  return visits;
}

/** Turns the old most-recent-first key list into visit times one millisecond apart, keeping its order. */
export function migrateMru(mru: unknown, now: number): Visits {
  const visits: Visits = {};
  if (!Array.isArray(mru)) return visits;
  let i = 0;
  for (const key of mru) {
    if (i >= MAX_VISITS) break;
    if (typeof key !== "string" || Object.hasOwn(visits, key)) continue;
    visits[key] = now - i++;
  }
  return visits;
}

/** Visited workspace keys, most recent first. */
export function recentKeys(visits: Visits): string[] {
  return Object.keys(visits).sort((a, b) => visits[b] - visits[a]);
}

function capVisits(visits: Visits): Visits {
  const keys = recentKeys(visits);
  if (keys.length <= MAX_VISITS) return visits;
  const kept: Visits = {};
  for (const key of keys.slice(0, MAX_VISITS)) kept[key] = visits[key];
  return kept;
}

/** Records a visit to `key` at `at`, dropping the oldest visits past the cap. */
export function recordVisit(visits: Visits, key: string, at: number): Visits {
  if (visits[key] === at) return visits;
  return capVisits({ ...visits, [key]: at });
}

// Labels on chats started automatically, from the paseo-bots plugin and from the pr-review-watch launchd job,
// and how long after creation the opening prompt lands.
export const AUTOMATED_CHAT_LABELS = ["paseo-bots.routine", "paseo-bots.asked-by", "pr-review-watch"];
export const OPENING_PROMPT_GRACE_MS = 10_000;

/**
 * When you last messaged an agent, or null if that message was an automated chat's opening prompt
 * (so bot-started chats do not count as visits until you reply).
 */
export function userMessageAt(agent: {
  lastUserMessageAt: number | null;
  createdAt: number;
  labels: Record<string, string>;
}): number | null {
  const at = agent.lastUserMessageAt;
  if (!at) return null;
  const automated = AUTOMATED_CHAT_LABELS.some((label) => label in agent.labels);
  if (automated && at <= agent.createdAt + OPENING_PROMPT_GRACE_MS) return null;
  return at;
}

/**
 * Counts the last message you sent in each workspace as a visit at that time. Only agents listed
 * for the host in question count, and only their `lastUserMessageAt`; agent output never does.
 * Returns `visits` itself when nothing moved.
 */
export function mergeMessageVisits(
  visits: Visits,
  serverId: string | null,
  agents: { serverId: string | null; list: readonly AgentInfo[] } | null,
  hidden: readonly string[] = [],
): Visits {
  if (!serverId || !agents || agents.serverId !== serverId) return visits;
  let next: Visits | null = null;
  for (const agent of agents.list) {
    const at = agent.lastUserMessageAt;
    if (!agent.workspaceId || !at) continue;
    const key = workspaceKey(serverId, agent.workspaceId);
    if (hidden.includes(key)) continue;
    const current = (next ?? visits)[key];
    if (current !== undefined && current >= at) continue;
    next ??= { ...visits };
    next[key] = at;
  }
  return next ? capVisits(next) : visits;
}

export const DEFAULT_COUNT_MESSAGES = true;

export function parseCountMessages(value: unknown): boolean {
  return typeof value === "boolean" ? value : DEFAULT_COUNT_MESSAGES;
}

/**
 * The `limit` most recently visited workspaces. Visited workspaces that no longer exist are
 * dropped once the workspace list has loaded. Until enough have been visited, the rest of the
 * selected host's workspaces fill in by latest activity.
 */
export function buildCards(
  mru: readonly string[],
  serverId: string | null,
  workspaces: ReadonlyMap<string, WorkspaceInfo> | null,
  limit: number,
  screens?: Screens | null,
  hidden: readonly string[] = [],
): Card[] {
  const cards: Card[] = [];
  const seen = new Set<string>();
  for (const key of mru) {
    if (cards.length >= limit) return cards;
    if (isPluginScreenKey(key)) {
      const card = screens ? screenCard(key, screens[key]) : null;
      if (card) cards.push(card);
      continue;
    }
    const parts = splitKey(key);
    const sameHost = parts.serverId === serverId;
    const info = sameHost ? workspaces?.get(parts.workspaceId) ?? null : null;
    if (workspaces && sameHost && !info) continue;
    cards.push({ key, ...parts, info });
    seen.add(key);
  }
  if (serverId && workspaces && cards.length < limit) {
    const rest = [...workspaces.values()]
      .filter((w) => !seen.has(workspaceKey(serverId, w.id)) && !hidden.includes(workspaceKey(serverId, w.id)))
      .sort((a, b) => b.activityAt - a.activityAt);
    for (const info of rest) {
      if (cards.length >= limit) break;
      cards.push({ key: workspaceKey(serverId, info.id), serverId, workspaceId: info.id, info });
    }
  }
  return cards;
}

/** Arc starts on the previous tab, so a single Ctrl+Tab flips back. */
export function initialIndex(cards: readonly Card[], currentKey: string | null): number {
  if (cards.length < 2) return 0;
  return cards[0]?.key === currentKey ? 1 : 0;
}

export function wrap(index: number, length: number): number {
  return length === 0 ? 0 : ((index % length) + length) % length;
}

/**
 * The quick-tap target: the most recent workspace that is not the current one. Computed from the
 * MRU list alone so the tap path needs no workspace data, DOM reads, or rendering.
 */
export function previousKey(mru: readonly string[], currentKey: string | null): string | null {
  for (const key of mru) if (key !== currentKey) return key;
  return null;
}

// ---- type to filter ---------------------------------------------------------------------------

/** Lowercased words of a query; empty when there is nothing to filter by. */
export function queryWords(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

function haystack(info: WorkspaceInfo): string {
  const pr = info.pr?.number ? ` #${info.pr.number} ${info.pr.number}` : "";
  return `${info.name} ${info.project} ${info.branch ?? ""}${pr}`.toLowerCase();
}

function startsWord(text: string, at: number): boolean {
  return at === 0 || /[^a-z0-9]/i.test(text[at - 1]);
}

/**
 * Every workspace whose name, project, branch or pull request number contains all the query's
 * words. Names that match at the start of a word come first; ties keep recency (visit order, then
 * latest activity), so the workspace you were just in stays near the top.
 */
export function filterCards(
  query: string,
  mru: readonly string[],
  serverId: string | null,
  workspaces: ReadonlyMap<string, WorkspaceInfo> | null,
  max = MAX_LIMIT,
): Card[] {
  const words = queryWords(query);
  if (!words.length || !serverId || !workspaces) return [];
  const recent = new Map(mru.map((key, i) => [key, i]));
  const scored: Array<{ card: Card; rank: number; recency: number; activity: number }> = [];
  for (const info of workspaces.values()) {
    const text = haystack(info);
    if (!words.every((w) => text.includes(w))) continue;
    const name = info.name.toLowerCase();
    const named = words.every((w) => {
      for (let at = name.indexOf(w); at !== -1; at = name.indexOf(w, at + 1)) if (startsWord(name, at)) return true;
      return false;
    });
    const key = workspaceKey(serverId, info.id);
    scored.push({ card: { key, serverId, workspaceId: info.id, info }, rank: named ? 0 : 1, recency: recent.get(key) ?? Infinity, activity: info.activityAt });
  }
  scored.sort((a, b) => a.rank - b.rank || a.recency - b.recency || b.activity - a.activity);
  return scored.slice(0, max).map((s) => s.card);
}

/** [start, end) ranges of `text` that match the query's words, merged and sorted, for highlighting. */
export function matchRanges(text: string, query: string): Array<[number, number]> {
  const lower = text.toLowerCase();
  const ranges: Array<[number, number]> = [];
  for (const w of queryWords(query)) {
    for (let at = lower.indexOf(w); at !== -1; at = lower.indexOf(w, at + w.length)) ranges.push([at, at + w.length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

// ---- last focused agent per workspace ------------------------------------------------------------

/** An agent the host lists, reduced to what choosing a tab needs. */
export interface AgentInfo {
  id: string;
  workspaceId: string | null;
  activityAt: number;
  /** When you last sent this agent a message (epoch ms); null when never. */
  lastUserMessageAt?: number | null;
  /** Started automatically (routine, ask, pr-review-watch); never picked as a fallback. */
  automated?: boolean;
  /** The paseo-bots bot this chat is with (label `paseo-bots.bot`). */
  botId?: string | null;
}

/** Label paseo-bots puts on a chat with a bot; its value is the bot's id. */
export const BOT_LABEL = "paseo-bots.bot";

/** The bot behind the most recently active bot chat in a workspace, or null. */
export function botIdForWorkspace(agents: readonly AgentInfo[] | null | undefined, workspaceId: string): string | null {
  if (!agents || !workspaceId) return null;
  let best: AgentInfo | null = null;
  for (const agent of agents) {
    if (agent.workspaceId !== workspaceId || !agent.botId) continue;
    if (!best || agent.activityAt > best.activityAt) best = agent;
  }
  return best?.botId ?? null;
}

const SVG_ELEMENTS = new Set(["svg", "g", "path", "circle", "ellipse", "line", "polyline", "polygon", "rect", "defs", "clippath", "use"]);
const SVG_CANONICAL: Record<string, string> = { clippath: "clipPath" };
const SVG_ATTRS = new Map(
  [
    "viewBox", "preserveAspectRatio", "d", "cx", "cy", "r", "rx", "ry", "x", "y", "x1", "y1", "x2", "y2", "points", "width", "height",
    "transform", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray",
    "stroke-dashoffset", "fill-rule", "clip-rule", "clip-path", "opacity", "fill-opacity", "stroke-opacity", "shape-rendering", "id",
    "clipPathUnits", "href", "xlink:href",
  ].map((name) => [name.toLowerCase(), name]),
);
/** Plain tokens only: no quotes, `&`, `\`, `;` or `<`, so entities and CSS escapes cannot hide anything. */
const SVG_VALUE = /^[\w\s#.,()%+-]*$/;
const SVG_TAG = /<(\/?)([A-Za-z][\w:-]*)((?:\s+[^\s=>/"']+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>/y;
const SVG_ATTR = /([^\s=>/"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g;
/** Size limit for a plugin screen's header icon, which is stored; paseo-bots avatars are far bigger (up to ~11 KB, pixel rects). */
export const MAX_ICON_BYTES = 8 * 1024;
export const MAX_AVATAR_BYTES = 32 * 1024;

function safeSvgValue(name: string, value: string): boolean {
  if (!SVG_VALUE.test(value)) return false;
  if (name === "href" || name === "xlink:href") return /^#[\w-]+$/.test(value);
  const refs = value.match(/url\s*\(/gi)?.length ?? 0;
  if (!refs) return true;
  const ok = value.match(/url\(#[\w-]+\)/g)?.length ?? 0;
  return ok === refs && !/\burl\s+\(/i.test(value);
}

/**
 * Re-writes svg markup from an allowlist: drawing elements and presentation attributes only, and nothing
 * that can run or fetch (scripts, foreignObject, style, event handlers, links or url() beyond local #ids).
 * Colours such as currentColor pass through untouched. Returns null when the markup is not a single svg,
 * cannot be parsed, or is over `maxBytes`. The result is built from parts, never the input text.
 */
export function sanitizeSvg(markup: string, maxBytes = MAX_ICON_BYTES): string | null {
  if (typeof markup !== "string" || !markup || markup.length > maxBytes) return null;
  const src = markup.replace(/<!--[\s\S]*?-->/g, "");
  let out = "";
  const open: string[] = [];
  let skip = 0;
  let sawRoot = false;
  let at = 0;
  while (at < src.length) {
    const lt = src.indexOf("<", at);
    if (lt < 0) break;
    SVG_TAG.lastIndex = lt;
    const m = SVG_TAG.exec(src);
    if (!m) return null;
    at = lt + m[0].length;
    const [, closing, rawName, rawAttrs, selfClose] = m;
    const name = rawName.toLowerCase();
    if (closing) {
      if (skip) skip--;
      else if (open.length && open[open.length - 1] === name) {
        out += `</${SVG_CANONICAL[name] ?? name}>`;
        open.pop();
      }
      continue;
    }
    if (skip || !SVG_ELEMENTS.has(name) || (!sawRoot && name !== "svg") || (sawRoot && name === "svg")) {
      if (!sawRoot) return null;
      if (!selfClose) skip++;
      continue;
    }
    const attrs = new Map<string, string>();
    for (const a of rawAttrs.matchAll(SVG_ATTR)) {
      const canonical = SVG_ATTRS.get(a[1].toLowerCase());
      const value = (a[2] ?? a[3] ?? "").trim();
      if (!canonical || attrs.has(canonical)) continue;
      if (safeSvgValue(canonical === "xlink:href" ? "href" : canonical, value)) attrs.set(canonical, value);
    }
    if (name !== "use") {
      attrs.delete("href");
      attrs.delete("xlink:href");
    }
    if (name === "svg") {
      sawRoot = true;
      const w = attrs.get("width");
      const h = attrs.get("height");
      if (!attrs.has("viewBox") && w && h && /^\d+(\.\d+)?$/.test(w) && /^\d+(\.\d+)?$/.test(h)) attrs.set("viewBox", `0 0 ${w} ${h}`);
      attrs.delete("width");
      attrs.delete("height");
      out += '<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true"';
    } else out += `<${SVG_CANONICAL[name] ?? name}`;
    for (const [k, v] of attrs) out += ` ${k}="${v}"`;
    if (selfClose) out += "/>";
    else {
      out += ">";
      open.push(name);
    }
  }
  if (!sawRoot) return null;
  while (open.length) {
    const name = open.pop() as string;
    out += `</${SVG_CANONICAL[name] ?? name}>`;
  }
  return out.length <= maxBytes ? out : null;
}

/**
 * Prefixes every id in sanitized svg and points local refs at the new ids, so two drawings of one icon never
 * share ids and an id cannot shadow an element on the page. A ref to an id that is not in this svg is dropped
 * (the whole attribute). Expects `sanitizeSvg` output.
 */
export function scopeSvgIds(svg: string, prefix: string): string {
  const ids = new Set([...svg.matchAll(/\sid="([\w-]+)"/g)].map((m) => m[1]));
  if (!ids.size && !/href="#|url\(#/.test(svg)) return svg;
  return svg.replace(/\s([\w:-]+)="([^"]*)"/g, (whole, name: string, value: string) => {
    if (name === "id") return ` id="${prefix}${value}"`;
    if (name === "href" || name === "xlink:href") {
      const id = value.slice(1);
      return ids.has(id) ? ` ${name}="#${prefix}${id}"` : "";
    }
    if (!/url\(/.test(value)) return whole;
    let ok = true;
    const next = value.replace(/url\(#([\w-]+)\)/g, (_, id: string) => {
      if (!ids.has(id)) ok = false;
      return `url(#${prefix}${id})`;
    });
    return ok ? ` ${name}="${next}"` : "";
  });
}

/** An image URL safe to put in an img: http(s) or a raster data URL. */
export function safeImageUrl(url: unknown): string | null {
  if (typeof url !== "string" || url.length > 2_000_000) return null;
  if (/^https?:\/\/[^\s"'<>\\]+$/i.test(url)) return url;
  if (/^data:image\/(png|jpeg|gif|webp|avif);base64,[A-Za-z0-9+/=]+$/.test(url)) return url;
  return null;
}

/** The agent tab last seen focused in a workspace, and when (epoch ms; 0 for data saved before times were kept). */
export interface RememberedAgent {
  agentId: string;
  at: number;
}
export type AgentMemory = Record<string, RememberedAgent>;

/** Whether a chat carries any of the labels automated chats are started with. */
export function isAutomatedChat(labels: Record<string, string>): boolean {
  return AUTOMATED_CHAT_LABELS.some((label) => label in labels);
}

/** How often an unchanged focused agent has its time rewritten to storage. */
export const REMEMBER_REFRESH_MS = 30_000;

const AGENT_TAB_PREFIX = "workspace-tab-agent_";
const MAX_REMEMBERED_AGENTS = 200;

/** The agent id in an agent tab's test ID (`workspace-tab-agent_<id>`); null for any other tab. */
export function agentIdFromTabTestId(testId: string | null | undefined): string | null {
  if (!testId?.startsWith(AGENT_TAB_PREFIX)) return null;
  return testId.slice(AGENT_TAB_PREFIX.length) || null;
}

/**
 * Split panes each have a selected tab. Keep the remembered agent while it is still one of them,
 * so a split doesn't flip the memory back and forth; otherwise take the first.
 */
export function pickFocusedAgent(selected: readonly string[], remembered: string | undefined): string | null {
  if (remembered && selected.includes(remembered)) return remembered;
  return selected[0] ?? null;
}

/**
 * Records `agentId` as the agent focused in a workspace at `now`. Newest last; oldest dropped past
 * the cap. Returns `memory` itself (nothing to write) while the same agent stays focused and its
 * stored time is under REMEMBER_REFRESH_MS old.
 */
export function rememberAgent(memory: AgentMemory, key: string, agentId: string, now: number): AgentMemory {
  const keys = Object.keys(memory);
  const current = memory[key];
  if (current && current.agentId === agentId && keys[keys.length - 1] === key && now - current.at < REMEMBER_REFRESH_MS) {
    return memory;
  }
  const next: AgentMemory = {};
  for (const k of keys.slice(-(MAX_REMEMBERED_AGENTS - 1))) if (k !== key) next[k] = memory[k];
  next[key] = { agentId, at: now };
  return next;
}

/** Reads stored memory. The older format, a bare agent id, becomes one with time 0. */
export function parseAgentMemory(value: unknown): AgentMemory {
  const memory: AgentMemory = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return memory;
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === "string") memory[k] = { agentId: v, at: 0 };
    else if (v && typeof v === "object" && typeof (v as RememberedAgent).agentId === "string") {
      const at = (v as RememberedAgent).at;
      memory[k] = { agentId: (v as RememberedAgent).agentId, at: typeof at === "number" && Number.isFinite(at) ? at : 0 };
    }
  }
  return memory;
}

/**
 * The agent tab to open when switching to a workspace; the newest of two wins:
 * the tab last seen focused there (while it is still listed for it) and the agent you last
 * messaged there (which also catches chats used outside the workspace page, such as the Bots
 * screen). With neither, the most recently active chat that is not automated, then the remembered
 * tab even if unlisted, then none (Paseo's default).
 * The agent list is one page, so it only overrules memory when it lists agents of this workspace;
 * with no list, or none of the workspace's agents on it, the remembered agent is trusted.
 */
export function agentToOpen(workspaceId: string, remembered: RememberedAgent | undefined, agents: readonly AgentInfo[] | null): string | null {
  let rememberedListed = false;
  let anyListed = false;
  let messaged: AgentInfo | null = null;
  let fallback: AgentInfo | null = null;
  for (const agent of agents ?? []) {
    if (agent.workspaceId !== workspaceId) continue;
    anyListed = true;
    if (agent.id === remembered?.agentId) rememberedListed = true;
    const at = agent.lastUserMessageAt;
    if (at && (!messaged || at > messaged.lastUserMessageAt!)) messaged = agent;
    if (!agent.automated && (!fallback || agent.activityAt > fallback.activityAt)) fallback = agent;
  }
  const rememberedUsable = remembered && (rememberedListed || !anyListed) ? remembered : null;
  if (rememberedUsable && messaged) return messaged.lastUserMessageAt! > rememberedUsable.at ? messaged.id : rememberedUsable.agentId;
  if (rememberedUsable) return rememberedUsable.agentId;
  if (messaged) return messaged.id;
  return fallback?.id ?? remembered?.agentId ?? null;
}

/** Whether a workspace belongs in the switcher: never one being archived; background ones only when included. */
export function shouldListWorkspace(w: { archivingAt?: unknown; background?: boolean }, includeBackground: boolean): boolean {
  if (w.archivingAt) return false;
  return includeBackground || !w.background;
}

export const DEFAULT_INCLUDE_BACKGROUND = true;

export function parseIncludeBackground(value: unknown): boolean {
  return typeof value === "boolean" ? value : DEFAULT_INCLUDE_BACKGROUND;
}

/**
 * What a switcher had loaded when it was disposed. Paseo re-runs the plugin after a route change made
 * outside its router (the switcher reopens plugin screens and hidden workspaces that way), so without
 * this every switch would start over with no workspace list, and an open before the reload lands would
 * show bare rows.
 */
export interface CarriedLists {
  includeBackground: boolean;
  workspaces: ReadonlyMap<string, WorkspaceInfo> | null;
  workspacesAt: number;
  homeServer: string | null;
  agents: { serverId: string | null; list: AgentInfo[] } | null;
  agentsAt: number;
}

/** The previous switcher's lists, unless they were loaded under the other background setting. */
export function carriedLists(saved: unknown, includeBackground: boolean): CarriedLists | null {
  if (!saved || typeof saved !== "object") return null;
  const s = saved as CarriedLists;
  if (s.includeBackground !== includeBackground) return null;
  if (s.workspaces !== null && !(s.workspaces instanceof Map)) return null;
  return s;
}

/** Hosts without background support reject inclusive discovery with a message that names it. */
export function isBackgroundUnsupported(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return /background workspaces/i.test(message);
}

/**
 * Asks for the list with background workspaces when wanted. If the host rejects that, asks once
 * more without them, so the switcher keeps working on older hosts.
 */
export async function listWithBackgroundFallback<T>(
  includeBackground: boolean,
  list: (includeBackground: boolean) => Promise<T>,
): Promise<{ value: T; includedBackground: boolean }> {
  if (!includeBackground) return { value: await list(false), includedBackground: false };
  try {
    return { value: await list(true), includedBackground: true };
  } catch (error) {
    if (!isBackgroundUnsupported(error)) throw error;
    return { value: await list(false), includedBackground: false };
  }
}
