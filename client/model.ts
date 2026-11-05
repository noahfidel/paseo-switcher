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

export interface Card {
  /** `${serverId}:${workspaceId}`, the same key Paseo uses in sidebar test IDs. */
  key: string;
  serverId: string;
  workspaceId: string;
  info: WorkspaceInfo | null;
}

export const MIN_LIMIT = 2;
/** One card per number key. */
export const MAX_LIMIT = 9;
export const DEFAULT_LIMIT = 5;
const MAX_MRU = 40;

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

/** Moves `key` to the front of the most-recently-used list. */
export function touch(mru: readonly string[], key: string): string[] {
  if (mru[0] === key) return mru as string[];
  return [key, ...mru.filter((k) => k !== key)].slice(0, MAX_MRU);
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
): Card[] {
  const cards: Card[] = [];
  const seen = new Set<string>();
  for (const key of mru) {
    if (cards.length >= limit) return cards;
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
}

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

/** Records `agentId` as the last focused agent of a workspace. Newest last; oldest dropped past the cap. */
export function rememberAgent(memory: Record<string, string>, key: string, agentId: string): Record<string, string> {
  const keys = Object.keys(memory);
  if (memory[key] === agentId && keys[keys.length - 1] === key) return memory;
  const next: Record<string, string> = {};
  for (const k of keys.slice(-(MAX_REMEMBERED_AGENTS - 1))) if (k !== key) next[k] = memory[k];
  next[key] = agentId;
  return next;
}

export function parseAgentMemory(value: unknown): Record<string, string> {
  const memory: Record<string, string> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return memory;
  for (const [k, v] of Object.entries(value)) if (typeof v === "string") memory[k] = v;
  return memory;
}

/**
 * The agent tab to open when switching to a workspace: the one last focused there while it still
 * belongs to it, else the workspace's most recently active agent, else none (Paseo's default).
 * The agent list is one page, so it only overrules memory when it lists agents of this workspace;
 * with no list, or none of the workspace's agents on it, the remembered agent is trusted.
 */
export function agentToOpen(workspaceId: string, remembered: string | undefined, agents: readonly AgentInfo[] | null): string | null {
  let latest: AgentInfo | null = null;
  for (const agent of agents ?? []) {
    if (agent.workspaceId !== workspaceId) continue;
    if (agent.id === remembered) return remembered;
    if (!latest || agent.activityAt > latest.activityAt) latest = agent;
  }
  return latest?.id ?? remembered ?? null;
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
