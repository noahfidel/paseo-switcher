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
}

export interface PullRequestInfo {
  number: number | null;
  state: "open" | "draft" | "merged" | "closed";
  checks: "none" | "pending" | "success" | "failure";
  review: "approved" | "changes_requested" | "pending" | null;
}

export type Layout = "strip" | "list";
export const DEFAULT_LAYOUT: Layout = "list";

export function parseLayout(value: unknown): Layout {
  return value === "strip" ? "strip" : DEFAULT_LAYOUT;
}

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
