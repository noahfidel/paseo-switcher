// The directories Paseo itself knows as projects or workspaces. The icon RPC answers only for these, so a
// client cannot make the daemon search an arbitrary path.

/** The part of Paseo's SDK this needs; the handler's `paseo` fits it. */
export interface RootSource {
  projects: { list(): Promise<{ projects: ReadonlyArray<{ projectRootPath?: string | null }> }> };
  workspaces: {
    list(options?: any): Promise<{ entries: ReadonlyArray<{ projectRootPath?: string | null; directory?: string | null }> }>;
  };
}

/** Every project root and workspace directory on this host. A call that fails adds nothing. */
export async function paseoRoots(paseo: RootSource): Promise<string[]> {
  const roots = new Set<string>();
  const add = (path: string | null | undefined) => {
    if (path) roots.add(path);
  };
  const [projects, workspaces] = await Promise.allSettled([
    paseo.projects.list(),
    // Background workspaces too; a host without that filter rejects it, so ask again without.
    paseo.workspaces
      .list({ page: { limit: 500 }, filter: { includeBackground: true } })
      .catch(() => paseo.workspaces.list({ page: { limit: 500 } })),
  ]);
  if (projects.status === "fulfilled") for (const p of projects.value.projects ?? []) add(p.projectRootPath);
  if (workspaces.status === "fulfilled") {
    for (const w of workspaces.value.entries ?? []) {
      add(w.projectRootPath);
      add(w.directory);
    }
  }
  if (projects.status === "rejected" && workspaces.status === "rejected") throw projects.reason;
  return [...roots];
}

/** Lists Paseo's roots again on a miss, but not more often than this. */
export const KNOWN_ROOTS_INTERVAL_MS = 10_000;

export interface KnownRoots {
  has(root: string, list: () => Promise<string[]>): Promise<boolean>;
}

/**
 * Remembers the last listing. A root not in it triggers a fresh listing (a project added since), at most
 * once per interval; a listing that fails keeps the previous one.
 */
export function createKnownRoots(options: { now?: () => number; minIntervalMs?: number } = {}): KnownRoots {
  const now = options.now ?? Date.now;
  const interval = options.minIntervalMs ?? KNOWN_ROOTS_INTERVAL_MS;
  let roots = new Set<string>();
  let listedAt = -Infinity;
  let listing: Promise<void> | null = null;

  function refresh(list: () => Promise<string[]>): Promise<void> {
    listedAt = now();
    listing ??= list()
      .then(
        (next) => {
          roots = new Set(next);
        },
        () => {},
      )
      .finally(() => {
        listing = null;
      });
    return listing;
  }

  return {
    async has(root, list) {
      if (listing) await listing;
      if (roots.has(root)) return true;
      if (now() - listedAt <= interval) return false;
      await refresh(list);
      return roots.has(root);
    },
  };
}
