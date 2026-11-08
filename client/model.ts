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

export type RowState = "running" | "needs-you" | "idle";

/** What a list row shows, picked from a workspace (or plugin screen) so the DOM adapter stays dumb. */
export interface RowFacts {
  state: RowState;
  /** "Running · 4m", "Needs you · 11m", "1h ago", or null when nothing is known. */
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
      state: "idle",
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
  let state: RowState = "idle";
  let label: string | null;
  if (info.status === "done") {
    label = idleLabel(info.activityAt);
  } else {
    state = info.status === "running" ? "running" : "needs-you";
    const since = ago(info.statusAt || info.activityAt, now);
    const word = state === "running" ? "Running" : "Needs you";
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

export interface ScreenMeta {
  title: string;
  search: string;
}
/** Latest title and params per screen key. */
export type Screens = Record<string, ScreenMeta>;

export function parseScreens(value: unknown): Screens {
  const screens: Screens = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return screens;
  for (const [k, v] of Object.entries(value)) {
    const m = v as Partial<ScreenMeta> | null;
    if (isPluginScreenKey(k) && m && typeof m.title === "string" && typeof m.search === "string") screens[k] = { title: m.title, search: m.search };
  }
  return screens;
}

/** Stores the latest title and params for a screen; returns `screens` itself when nothing changed. */
export function recordScreen(screens: Screens, key: string, meta: ScreenMeta): Screens {
  const current = screens[key];
  if (current && current.title === meta.title && current.search === meta.search) return screens;
  return { ...screens, [key]: { title: meta.title, search: meta.search } };
}

/** Drops details of screens no longer in the visit history. Returns `screens` itself when none were. */
export function pruneScreens(screens: Screens, visits: Visits): Screens {
  const stale = Object.keys(screens).filter((k) => !Object.hasOwn(visits, k));
  if (!stale.length) return screens;
  const kept: Screens = {};
  for (const [k, v] of Object.entries(screens)) if (Object.hasOwn(visits, k)) kept[k] = v;
  return kept;
}

function screenCard(key: string, meta: ScreenMeta | undefined): Card | null {
  const parts = parsePluginScreenKey(key);
  if (!parts || !meta) return null;
  return {
    key,
    serverId: parts.serverId,
    workspaceId: "",
    info: null,
    screen: { pluginId: parts.pluginId, screenId: parts.screenId, title: meta.title, search: meta.search },
  };
}

/** The visit order to use: plugin screens only when they are included. */
export function visibleKeys(mru: readonly string[], includeScreens: boolean): string[] {
  return includeScreens ? [...mru] : mru.filter((key) => !isPluginScreenKey(key));
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
): Visits {
  if (!serverId || !agents || agents.serverId !== serverId) return visits;
  let next: Visits | null = null;
  for (const agent of agents.list) {
    const at = agent.lastUserMessageAt;
    if (!agent.workspaceId || !at) continue;
    const key = workspaceKey(serverId, agent.workspaceId);
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
      .filter((w) => !seen.has(workspaceKey(serverId, w.id)))
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
