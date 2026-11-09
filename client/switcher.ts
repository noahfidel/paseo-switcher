import type { PluginClientContext } from "@getpaseo/plugin/client";
import {
  agentIdFromTabTestId,
  agentStateBucket,
  agentToOpen,
  canDrillInto,
  chatCountLabel,
  chatListState,
  chatFacts,
  chatTitle,
  chatsForWorkspace,
  filterChats,
  keyAction,
  ago,
  rowFacts,
  DEFAULT_SIDEBAR_DISPLAY,
  parseSidebarDisplay,
  workspaceTitle,
  type SidebarDisplay,
  buildCards,
  carriedLists,
  loadedWorkspaces,
  parseKnownNames,
  rememberNames,
  type HostData,
  type KnownNames,
  parseAgentMemory,
  pickFocusedAgent,
  rememberAgent,
  type AgentInfo,
  clampLimit,
  BOT_LABEL,
  botIdForWorkspace,
  isAutomatedChat,
  DEFAULT_INCLUDE_SCREENS,
  isPluginScreenKey,
  keyServerId,
  parseIncludeScreens,
  parsePluginScreenKey,
  parsePluginScreenUrl,
  parseScreens,
  safeImageUrl,
  MAX_AVATAR_BYTES,
  sanitizeSvg,
  scopeSvgIds,
  cleanScreenIcon,
  isImageIcon,
  nextScreenIcon,
  sidebarRowSelector,
  screenRowSelector,
  screensWithoutIcon,
  pickRowIcon,
  DEFAULT_REPO_ICONS,
  parseRepoIcons,
  repoIconKey,
  repoIconRoots,
  repoIconTtl,
  REPO_ICON_RETRY_MS,
  repoIconUrl,
  type ProjectIconAnswer,
  migrateHidden,
  clampIndex,
  setHidden,
  trackScreenVisit,
  type PendingScreenVisit,
  pluginScreenKey,
  pluginScreenUrl,
  prettifyPluginId,
  pruneScreens,
  recordScreen,
  screenTitle,
  visibleKeys,
  type Screens,
  DEFAULT_LAYOUT,
  DEFAULT_INCLUDE_BACKGROUND,
  DEFAULT_COUNT_MESSAGES,
  mergeMessageVisits,
  userMessageAt,
  migrateMru,
  parseCountMessages,
  parseVisits,
  recentKeys,
  recordVisit,
  type Visits,
  DEFAULT_SHORTCUT,
  filterCards,
  listWithBackgroundFallback,
  parseIncludeBackground,
  shouldListWorkspace,
  isReleaseKey,
  matchesShortcut,
  matchRanges,
  MAX_LIMIT,
  DEFAULT_LIMIT,
  initialIndex,
  parseLayout,
  parseShortcut,
  previousKey,
  SHORTCUTS,
  splitKey,
  workspaceKey,
  wrap,
  type Card,
  type Layout,
  type Shortcut,
  type WorkspaceInfo,
} from "./model";

/* Desktop/web adapter for Paseo 0.15. Host DOM is not a public plugin API, so every selector and
 * route this plugin depends on lives in this block. Native clients never run this file.
 * - route: /h/<serverId>/workspace/<workspaceId>
 * - row:   the sidebar workspace row; clicking it is how a person switches
 * - pane:  the workspace deck entry; snapshotted for thumbnails
 * - tab:   an agent tab in the pane's tab row (`workspace-tab-agent_<agentId>`), `aria-selected`
 *          when it is its pane's active tab; read to remember the last focused agent
 * - open:  `?open=agent:<agentId>` on the workspace route makes Paseo reveal that agent's tab
 *          (Paseo marks this input COMPAT(workspace-open-url), kept for bookmarks and deep links)
 * - screen: plugin screens are `/h/<serverId>/plugin/<pluginId>/surface/<screenId>?param.<key>=<value>`, reopened
 *          with the same pushState + popstate as a hidden workspace (a plugin can only open its own screens through
 *          the API). The title is the text of `[data-testid="plugin-surface-title"]` in the screen header.
 *          This URL format is not public: re-check it, and the title test ID, on every Paseo upgrade.
 *          The screen's own icon is the <svg> in the header badge that is the title's previous sibling (Paseo renders
 *          `HeaderIconBadge` then `ScreenTitle` in one fragment, so the badge is the title's previous sibling). That header DOM is not public either: re-check it
 *          on every Paseo upgrade. The markup is sanitized before it is stored or drawn.
 *          Screens registered with addScreen + a sidebar item get no header badge, so the icon of the plugin's
 *          highlighted sidebar row wins: `SidebarRow` renders a pressable with test ID
 *          `plugin-sidebar-<pluginId>-<itemId>[-<rowId>]` (footer: `plugin-sidebar-footer-…`) and
 *          `aria-selected="true"` while the plugin marks it active (see `sidebarRowSelector`). An <img> in it with a
 *          raster data URL is the icon, else its first <svg> that draws something (sanitized); RN-web draws a
 *          tinted image as an <img> beside a hidden svg that holds only the tint filter, which is skipped. Only a
 *          plugin's own rows know its current screen, so another plugin's row is never active then. When the
 *          switcher opens, a stored screen with no icon yet takes the icon of the row whose test ID is exactly
 *          `plugin-sidebar-<pluginId>-<screenId>` (or the footer's), selected or not (see `screenRowSelector`);
 *          with no such row it keeps its puzzle. Not public either: re-check on every upgrade.
 *          Paseo 0.15 re-runs the plugin after each such navigation, so a disposed switcher leaves its
 *          loaded lists in `globalThis.__paseoSwitcherLists` for the next install.
 * - hosts: Paseo 0.15 evaluates the plugin's client once per connected host (`PluginRegistry.byHost`), each
 *          with a `paseo` API bound to that host. All of them share `globalThis.__paseoSwitcherInstalls`, and one
 *          switcher, made by the newest, handles the keys. It reads every host's workspaces and agents through
 *          the SDK's `getPaseoClient(serverId)`, so nothing loaded from one host is read as another's. The hosts
 *          to ask are those in the app's saved host list (localStorage `@paseo:daemon-registry`, an array of
 *          `{ serverId, label, … }`), the one on show, and those of visited workspaces. That key is not public
 *          either: re-check it on every Paseo upgrade. A row names its host by that `label`.
 * - display: rows follow the sidebar's Display settings, read (never written) from Paseo's app settings in
 *          localStorage `@paseo:app-settings` each time the switcher opens: `workspaceTitleSource`
 *          ("title" | "branch"), `sidebarRowItems` ({ branch, project, host, changeRequest, services, labels },
 *          plus the older `checks` and `scripts` switches), `sidebarChecksDisplay` ("iconAndText" | "icon" | "none")
 *          and `sidebarWorkspaceTrailing` ("diff" | "timestamp" | "none"). Unreadable values fall back to Paseo's
 *          defaults (see `parseSidebarDisplay`). Not public either: re-check the key, names and values on every
 *          Paseo upgrade.
 */
const ROUTE = /^\/h\/([^/]+)\/workspace\/([^/?#]+)/;
const ROW_PREFIX = "sidebar-workspace-row-";
const rowSelector = (key: string) => `[data-testid="${ROW_PREFIX}${key}"]`;
const paneSelector = (key: string) => `[data-testid="workspace-deck-entry-${key}"]`;
const SELECTED_AGENT_TABS = '[data-testid^="workspace-tab-agent_"][aria-selected="true"]';
function workspaceRoute(serverId: string, workspaceId: string, agentId: string | null): string {
  const path = `/h/${encodeURIComponent(serverId)}/workspace/${encodeURIComponent(workspaceId)}`;
  return agentId ? `${path}?open=${encodeURIComponent(`agent:${agentId}`)}` : path;
}

/** Visit time per workspace key. Replaces the visit order in MRU_KEY, which is read once to migrate. */
const VISITS_KEY = "paseo-switcher:visits";
const MRU_KEY = "paseo-switcher:mru";
const COUNT_MESSAGES_KEY = "paseo-switcher:count-messages";
const LIMIT_KEY = "paseo-switcher:limit";
const LAYOUT_KEY = "paseo-switcher:layout";
const SHORTCUT_KEY = "paseo-switcher:shortcut";
const SCREENS_KEY = "paseo-switcher:screens";
const INCLUDE_SCREENS_KEY = "paseo-switcher:include-screens";
/** Keys hidden from the switcher (workspaces and plugin screens). */
const HIDDEN_KEY = "paseo-switcher:hidden";
/** Retired per-screen switches; read once into the hidden list, then deleted. */
const LEGACY_SKIPPED_SCREENS_KEY = "paseo-switcher:skipped-screens";
const SCREEN_TITLE = '[data-testid="plugin-surface-title"]';
const BACKGROUND_KEY = "paseo-switcher:include-background";
const REPO_ICONS_KEY = "paseo-switcher:repo-icons";
/** Last focused agent tab per workspace key. */
const AGENTS_KEY = "paseo-switcher:last-agent";
const HOSTS_KEY = "@paseo:daemon-registry";
/** Paseo's app settings, read for the sidebar's Display settings (see the adapter notes). */
const APP_SETTINGS_KEY = "@paseo:app-settings";
/** Last known name and project of each visited workspace, for rows whose host has not answered. */
const NAMES_KEY = "paseo-switcher:names";
/** Global slot where a disposed switcher leaves its loaded lists for the next install. */
const CARRY_KEY = "__paseoSwitcherLists";
/** Global list of the plugin's live installations, one per host that runs it. */
const INSTALLS_KEY = "__paseoSwitcherInstalls";
/** Global slot of the one switcher that handles the keys. */
const ACTIVE_KEY = "__paseoSwitcher";
/** A tap shorter than this switches without ever drawing the strip. */
const SHOW_DELAY_MS = 110;
const POLL_ROUTE_MS = 300;
/** How often a changed workspace view is re-snapshotted while you stay in it. */
const REFRESH_MS = 2000;
/**
 * Background work waits this long after any workspace change so it never competes with Paseo
 * rendering the workspace you just opened. It also lets that workspace finish loading.
 */
const QUIET_AFTER_SWITCH_MS = 2000;
const WORKSPACES_STALE_MS = 5000;
/** While the switcher is closed, the agent list is refreshed in idle time this often (5 s), so messages count. */
const AGENTS_BACKGROUND_MS = 5000;
const MAX_THUMBS = 12;

const CARD_MAX = 240;
const CARD_MIN = 176;
const ASPECT = 0.66;
/** Estimated list row height, so the list knows it overflows without measuring. */
const ROW_H = 64;
/** A chat row has one line. */
const CHAT_ROW_H = 44;
/** Thumbnails zoom past the pane's side margins toward the conversation column. */
const ZOOM = 1.35;
const BLANK_IMAGE = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const LIVE_TAGS = new Set(["IFRAME", "CANVAS", "VIDEO", "AUDIO", "OBJECT", "EMBED", "WEBVIEW"]);

type Paseo = PluginClientContext["paseo"];
type Mode = "hold" | "sticky";
/** Optional API paseo-bots publishes on `globalThis.__paseoBotsAvatars` (version 1) while it is installed. */
interface BotAvatarsApi {
  version: 1;
  get(botId: string, opts: { dark: boolean }): { name?: string; svg?: string; imageUrl?: string } | null;
  subscribe?(listener: () => void): () => void;
}
/* The plugin typechecks without the DOM library; this adapter works with loosely typed nodes. */
type Node = any;
const g = globalThis as any;

/** A cheap, detached copy of a workspace view, rasterized later when the browser is idle. */
interface Snapshot {
  key: string;
  clone: Node;
  width: number;
  height: number;
  surface: string;
}

export interface Switcher {
  open(): void;
  getLimit(): number;
  setLimit(limit: number): void;
  getLayout(): Layout;
  setLayout(layout: Layout): void;
  getShortcut(): Shortcut;
  setShortcut(shortcut: Shortcut): void;
  getIncludeBackground(): boolean;
  setIncludeBackground(include: boolean): void;
  getIncludeScreens(): boolean;
  setIncludeScreens(include: boolean): void;
  /** Every plugin screen recorded so far, with whether it is switched off. */
  /** What is hidden from the switcher, named for Settings. */
  getHidden(): Array<{ key: string; title: string; subtitle: string }>;
  unhide(key: string): void;
  getCountMessages(): boolean;
  setCountMessages(count: boolean): void;
  getRepoIcons(): boolean;
  setRepoIcons(show: boolean): void;
  /** Called after the shortcut changes, so labels that name it can follow. Returns an unsubscribe. */
  onShortcutChange(listener: (shortcut: Shortcut) => void): () => void;
  dispose(): void;
}

export interface SwitcherOptions {
  /** Asks this plugin's daemon side for a project's icon (see shared/icons.ts). Reaches this installation's host only. */
  projectIcon?: (rootPath: string) => Promise<ProjectIconAnswer>;
  /** Borrows any online host's API (the SDK's `getPaseoClient`); throws for an unknown or offline host. */
  getPaseoClient?: (serverId: string) => Paseo;
}

/** One host's installation of the plugin. */
interface Installation {
  paseo: Paseo;
  options: SwitcherOptions;
  /** Told when the shortcut changes, so this installation's Command Center title can follow. */
  listeners: Set<(shortcut: Shortcut) => void>;
  /** A workspace ID this installation's own host lists (null: none), to learn which host its RPCs reach. */
  probe?: string | null;
  probedAt?: number;
}

const noop: Switcher = {
    open() {},
    getLimit: () => DEFAULT_LIMIT,
    setLimit() {},
    getLayout: () => DEFAULT_LAYOUT,
    setLayout() {},
    getShortcut: () => DEFAULT_SHORTCUT,
    setShortcut() {},
    getIncludeBackground: () => DEFAULT_INCLUDE_BACKGROUND,
    setIncludeBackground() {},
    getIncludeScreens: () => DEFAULT_INCLUDE_SCREENS,
    setIncludeScreens() {},
    getHidden: () => [],
    unhide() {},
    getCountMessages: () => DEFAULT_COUNT_MESSAGES,
    setCountMessages() {},
    getRepoIcons: () => DEFAULT_REPO_ICONS,
    setRepoIcons() {},
  onShortcutChange: () => () => {},
  dispose() {},
};

/**
 * Installs the plugin for one host. Paseo runs the plugin once per connected host, but only one switcher
 * may handle the keys: the newest installation's code runs it, and it reads every host's data itself.
 * It stays up while any installation is live, and goes when the last one is disposed.
 */
export function installSwitcher(paseo: Paseo, options: SwitcherOptions = {}): Switcher {
  if (!g.document || !g.window) return noop;
  const installs: Installation[] = Array.isArray(g[INSTALLS_KEY]) ? g[INSTALLS_KEY] : (g[INSTALLS_KEY] = []);
  const mine: Installation = { paseo, options, listeners: new Set() };
  installs.push(mine);
  createSwitcher(installs);
  const active = (): Switcher => g[ACTIVE_KEY] ?? noop;
  return {
    open: () => active().open(),
    getLimit: () => active().getLimit(),
    setLimit: (v) => active().setLimit(v),
    getLayout: () => active().getLayout(),
    setLayout: (v) => active().setLayout(v),
    getShortcut: () => active().getShortcut(),
    setShortcut: (v) => active().setShortcut(v),
    getIncludeBackground: () => active().getIncludeBackground(),
    setIncludeBackground: (v) => active().setIncludeBackground(v),
    getIncludeScreens: () => active().getIncludeScreens(),
    setIncludeScreens: (v) => active().setIncludeScreens(v),
    getHidden: () => active().getHidden(),
    unhide: (key) => active().unhide(key),
    getCountMessages: () => active().getCountMessages(),
    setCountMessages: (v) => active().setCountMessages(v),
    getRepoIcons: () => active().getRepoIcons(),
    setRepoIcons: (v) => active().setRepoIcons(v),
    onShortcutChange(listener) {
      mine.listeners.add(listener);
      return () => void mine.listeners.delete(listener);
    },
    dispose() {
      const at = installs.indexOf(mine);
      if (at === -1) return;
      installs.splice(at, 1);
      mine.listeners.clear();
      // Another host's installation keeps the switcher; the last one takes it down.
      if (!installs.length) active().dispose();
    },
  };
}

function createSwitcher(installs: Installation[]): Switcher {
  const doc = g.document;
  const win = g.window;
  // Only one switcher may own the keyboard: this one replaces the last (which leaves its lists behind).
  g[ACTIVE_KEY]?.dispose();
  // While the switcher is open it owns the keyboard, so typing to filter never fires a Paseo shortcut.
  let shortcut = parseShortcut(readJson(SHORTCUT_KEY, DEFAULT_SHORTCUT));
  const keys = claimKeys(() => open, () => shortcut);

  let visits: Visits = parseVisits(readJson(VISITS_KEY, null)) ?? migrateMru(readJson(MRU_KEY, []), Date.now());
  /** Also list plugin screens (and record visits to them). */
  let includeScreens = parseIncludeScreens(readJson(INCLUDE_SCREENS_KEY, DEFAULT_INCLUDE_SCREENS));
  /** Latest title and params of each visited plugin screen. */
  let screens: Screens = parseScreens(readJson(SCREENS_KEY, {}));
  /** Hidden from the switcher: no visits recorded, never listed or cycled to. Filtering still finds them. */
  let hiddenKeys: string[] = migrateHidden(readJson(HIDDEN_KEY, []), readJson(LEGACY_SKIPPED_SCREENS_KEY, []));
  try {
    if (win.localStorage?.getItem(LEGACY_SKIPPED_SCREENS_KEY) != null) {
      writeJson(HIDDEN_KEY, hiddenKeys);
      win.localStorage.removeItem(LEGACY_SKIPPED_SCREENS_KEY);
    }
  } catch {
    // Storage can be unavailable; the migration runs again next time.
  }
  /** The plugin screen on show and how long it has been open; it counts as a visit after SCREEN_DWELL_MS. */
  let pendingScreen: PendingScreenVisit | null = null;
  /** Visited keys (workspaces, and plugin screens when included), most recent first; derived from `visits`. */
  let mru: string[] = visibleKeys(recentKeys(visits), includeScreens, hiddenKeys);
  /** Count a message you sent in a workspace as a visit to it. */
  let countMessages = parseCountMessages(readJson(COUNT_MESSAGES_KEY, DEFAULT_COUNT_MESSAGES));
  let limit = clampLimit(readJson(LIMIT_KEY, DEFAULT_LIMIT));
  /** The list layout has no thumbnails, so it skips all background snapshot work. */
  let layout = parseLayout(readJson(LAYOUT_KEY, DEFAULT_LAYOUT));
  /** Also list workspaces hidden from the sidebar. */
  let includeBackground = parseIncludeBackground(readJson(BACKGROUND_KEY, DEFAULT_INCLUDE_BACKGROUND));
  // A reinstalled switcher (Paseo re-runs the plugin after a route change) starts from what the last one loaded.
  const carried = carriedLists(g[CARRY_KEY], includeBackground);
  const carriedIconCache = g[CARRY_KEY]?.repoIcons;
  g[CARRY_KEY] = undefined;
  /** Each host's workspaces and agents, by server ID. A host's lists are only ever read under that host. */
  const hostData = new Map<string, HostData>(carried?.hosts ?? []);
  /** The sidebar's Display settings, re-read each time the switcher opens. */
  let display: SidebarDisplay = DEFAULT_SIDEBAR_DISPLAY;
  /** Host names for rows, set only when there is more than one host; re-read with `display`. */
  let hostNames = new Map<string, string>();
  /** Names of visited workspaces, for rows whose host has not answered and that have no sidebar row. */
  let knownNames: KnownNames = parseKnownNames(readJson(NAMES_KEY, {}));
  /** The agent tab last focused in each workspace, so switching back reopens it. */
  let agentMemory = parseAgentMemory(readJson(AGENTS_KEY, {}));
  /** Show each workspace's repo icon (asked of the daemon side lazily, per project root). */
  let repoIcons = parseRepoIcons(readJson(REPO_ICONS_KEY, DEFAULT_REPO_ICONS));
  /** Answers per project root, carried across reinstalls like the lists (whatever the background setting). */
  const repoIconCache: Map<string, { url: string | null; at: number; ttl?: number }> = carriedIconCache instanceof Map ? carriedIconCache : new Map();
  const repoIconPending = new Set<string>();
  /** Rasterized thumbnails by workspace key, oldest first. Each canvas records its theme. */
  const thumbs = new Map<string, Node>();

  // Switcher state. `open` is true from the first press of the shortcut; `root` exists only once drawn.
  let open = false;
  let mode: Mode = "hold";
  let cards: Card[] = [];
  let index = 0;
  let showTimer: any = null;
  let root: Node = null;
  let lastKey: string | null = null;
  let overflowing = false;
  let dark = false;
  /** Typed while the switcher is open; filters every workspace, not only recent ones. */
  let query = "";
  /**
   * One workspace's chats, shown in place of the workspaces (→ on a row, ↓ on thumbnails). The
   * workspace list keeps its own selection and filter underneath, so ← returns to it as it was.
   */
  let drill: {
    key: string;
    name: string;
    /** The chats on show (filtered when there is a query). */
    chats: AgentInfo[];
    /** All the workspace's chats, before the filter. */
    total: number;
    /** The agent list for this host has loaded. */
    loaded: boolean;
    /** The last load of the agent list failed. */
    failed: boolean;
    index: number;
    query: string;
  } | null = null;
  /** Every match for the query; only the first MAX_LIMIT are listed. */
  let matches = 0;
  const coarse = Boolean(win.matchMedia?.("(hover: none) and (pointer: coarse)").matches);

  const style = doc.createElement("style");
  style.setAttribute("data-paseo-switcher", "");
  style.textContent = CSS;
  doc.head.appendChild(style);
  // A permanent, empty host keeps opening from changing the page's top-level children, which
  // would make the browser restyle the whole app.
  const host = doc.createElement("div");
  host.setAttribute("data-paseo-switcher", "");
  host.className = "pws-host";
  doc.body.appendChild(host);

  // ---- storage --------------------------------------------------------------------------------

  function readJson(key: string, fallback: any): any {
    try {
      const raw = win.localStorage?.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function writeJson(key: string, value: unknown) {
    try {
      win.localStorage?.setItem(key, JSON.stringify(value));
    } catch {
      // Storage can be unavailable; the switcher still works for this session.
    }
  }

  // ---- route and most-recently-used order ------------------------------------------------------

  function currentKey(): string | null {
    const match = ROUTE.exec(win.location.pathname);
    return match ? workspaceKey(decodeURIComponent(match[1]), decodeURIComponent(match[2])) : null;
  }

  /** The plugin screen on show, when plugin screens are included. */
  function currentScreen() {
    return includeScreens ? parsePluginScreenUrl(win.location.pathname, win.location.search) : null;
  }

  /** The workspace or plugin screen on show: the current stop of the switcher. */
  function currentStopKey(): string | null {
    const workspace = currentKey();
    if (workspace) return workspace;
    const screen = currentScreen();
    return screen ? pluginScreenKey(screen.serverId, screen.pluginId, screen.screenId) : null;
  }

  /** The host of the workspace or screen on show, else of the latest visit, else the app's only host. */
  function shownHost(): string | null {
    const key = currentStopKey() ?? mru[0];
    if (key) return keyServerId(key);
    const saved = savedHosts();
    return saved.length === 1 ? saved[0] : null;
  }

  /** The app's saved hosts, connected or not, with their names. */
  function savedHostEntries(): { serverId: string; label: string | null }[] {
    const saved = readJson(HOSTS_KEY, null);
    const list = Array.isArray(saved) ? saved : saved?.hosts;
    if (!Array.isArray(list)) return [];
    return list
      .filter((h: any) => typeof h?.serverId === "string" && h.serverId !== "")
      .map((h: any) => ({ serverId: h.serverId, label: typeof h.label === "string" && h.label.trim() ? h.label.trim() : null }));
  }

  function savedHosts(): string[] {
    return savedHostEntries().map((h) => h.serverId);
  }

  /** The names of the saved hosts, but only when there is more than one, as the sidebar shows them. */
  function hostLabels(): Map<string, string> {
    const entries = savedHostEntries();
    if (entries.length < 2) return new Map();
    return new Map(entries.map((h) => [h.serverId, h.label ?? h.serverId]));
  }

  /** Hosts to load: the saved ones, the one on show, and those of visited workspaces. */
  function knownHosts(): string[] {
    const hosts = new Set(savedHosts());
    const shown = shownHost();
    if (shown) hosts.add(shown);
    for (const key of mru) if (!isPluginScreenKey(key)) hosts.add(keyServerId(key));
    return [...hosts];
  }

  /**
   * One host's API, borrowed through the newest installation that can. Without that SDK call (an older
   * Paseo), only the installation's own API is known, taken to be the host on show.
   */
  function apiFor(host: string): Paseo | null {
    for (let i = installs.length - 1; i >= 0; i--) {
      const borrow = installs[i].options.getPaseoClient;
      if (!borrow) continue;
      try {
        return borrow(host);
      } catch {
        // Unknown or offline: its rows keep what was loaded before, or their names.
        return null;
      }
    }
    const own = installs[installs.length - 1];
    return own && host === shownHost() ? own.paseo : null;
  }

  function dataOf(host: string): HostData {
    let data = hostData.get(host);
    if (!data) {
      data = { workspaces: null, workspacesAt: 0, agents: null, agentsAt: 0 };
      hostData.set(host, data);
    }
    return data;
  }

  function agentsOf(host: string): { list: AgentInfo[]; capped?: boolean } | null {
    return hostData.get(host)?.agents ?? null;
  }

  function workspaceInfo(key: string): WorkspaceInfo | null {
    const { serverId: host, workspaceId } = splitKey(key);
    return hostData.get(host)?.workspaces?.get(workspaceId) ?? null;
  }

  function setVisits(next: Visits) {
    if (next === visits) return;
    visits = next;
    mru = visibleKeys(recentKeys(visits), includeScreens, hiddenKeys);
    writeJson(VISITS_KEY, visits);
    const kept = pruneScreens(screens, visits, hiddenKeys);
    if (kept !== screens) {
      screens = kept;
      writeJson(SCREENS_KEY, screens);
    }
  }

  /** Keeps the latest params and shown title of the screen on show; the title may appear after the route does. */
  function noteScreen(key: string, route: { pluginId: string; search: string }) {
    const titleNode = doc.querySelector(SCREEN_TITLE);
    const shown: string | null = titleNode?.textContent?.trim() || null;
    // The highlighted sidebar row's icon wins; else the header badge decides once the title is drawn.
    const row = doc.querySelector(sidebarRowSelector(route.pluginId));
    const icon = nextScreenIcon(screens[key], {
      row: row ? sidebarRowIcon(row) : null,
      title: Boolean(titleNode),
      badge: titleNode ? screenIconSvg(titleNode) : null,
    });
    const title = shown ?? screens[key]?.title ?? screenTitle(null, route.pluginId);
    const next = recordScreen(screens, key, { title, search: route.search, ...icon });
    if (next === screens) return;
    screens = next;
    writeJson(SCREENS_KEY, screens);
    if (root) refreshCardsAndRender();
  }

  /** The sanitized svg of the header icon badge: the title's own previous sibling (Paseo renders badge, then title, in one fragment). */
  function screenIconSvg(title: Node): string | null {
    const before = title.previousElementSibling;
    if (!before) return null;
    const svg = before.tagName.toLowerCase() === "svg" ? before : before.querySelector("svg");
    return svg ? sanitizeSvg(svg.outerHTML) : null;
  }

  /** A sidebar row's icon: an img with a small raster data URL, else its first svg that draws something (sanitized). */
  function sidebarRowIcon(row: Node): string | null {
    const found: Node[] = Array.from(row.querySelectorAll("svg, img"));
    return pickRowIcon(
      found.map((n) => (n.tagName.toLowerCase() === "img" ? { kind: "img" as const, src: n.getAttribute("src") } : { kind: "svg" as const, markup: n.outerHTML })),
    );
  }

  /** Stored screens with no icon take their own sidebar row's, selected or not. Quietly does nothing without one. */
  function fillScreenIcons() {
    let next = screens;
    for (const key of screensWithoutIcon(screens)) {
      const parts = parsePluginScreenKey(key);
      if (!parts) continue;
      try {
        const row = doc.querySelector(screenRowSelector(parts.pluginId, parts.screenId));
        const icon = row ? sidebarRowIcon(row) : null;
        if (icon) next = recordScreen(next, key, { ...next[key], icon, iconFrom: "row" });
      } catch {
        // An odd ID or markup leaves the screen with its puzzle icon.
      }
    }
    if (next === screens) return;
    screens = next;
    writeJson(SCREENS_KEY, screens);
  }

  function syncRoute() {
    const screen = currentScreen();
    const key = currentStopKey();
    // A plugin screen counts as a visit only once it has stayed open a moment, and never while hidden.
    const skipped = Boolean(screen && key && hiddenKeys.includes(key));
    const tracked = trackScreenVisit(pendingScreen, screen && !skipped ? key : null, Date.now());
    pendingScreen = tracked.pending;
    if (tracked.record) setVisits(recordVisit(visits, tracked.record.key, tracked.record.at));
    if (!key || (key === lastKey && !screen)) return;
    if (key !== lastKey) {
      lastKey = key;
      if (!screen && !hiddenKeys.includes(key)) setVisits(recordVisit(visits, key, Date.now()));
    }
    // Keep the title and params of a recorded screen current; a hidden one only while it is still stored.
    if (screen && key && (pendingScreen?.recorded || (skipped && screens[key]))) noteScreen(key, screen);
    if (currentKey()) watchPane();
  }

  /** Folds the loaded agents' last messages into the visit times, when that setting is on. */
  function countMessageVisits() {
    if (!countMessages) return;
    for (const [host, data] of hostData) setVisits(mergeMessageVisits(visits, host, data.agents, hiddenKeys));
  }

  /** Remembers which agent tab is active in the current workspace. One query inside the pane. */
  function rememberFocusedAgent() {
    const key = currentKey();
    const pane = key ? currentPane() : null;
    if (!key || !pane) return;
    const selected: string[] = [];
    for (const tab of pane.querySelectorAll(SELECTED_AGENT_TABS)) {
      const id = agentIdFromTabTestId(tab.getAttribute("data-testid"));
      if (id) selected.push(id);
    }
    const agentId = pickFocusedAgent(selected, agentMemory[key]?.agentId);
    if (!agentId) return;
    const next = rememberAgent(agentMemory, key, agentId, Date.now());
    if (next === agentMemory) return;
    agentMemory = next;
    writeJson(AGENTS_KEY, agentMemory);
  }

  /** The agent tab to reveal when switching to `key` by route, or null for Paseo's default. */
  function agentFor(key: string): string | null {
    const { serverId: server, workspaceId } = splitKey(key);
    return agentToOpen(workspaceId, agentMemory[key], agentsOf(server)?.list ?? null);
  }

  // ---- workspace data -------------------------------------------------------------------------

  /** Loads in flight, by host. */
  const loadingWorkspaces = new Map<string, Promise<boolean>>();
  const loadingAgents = new Map<string, Promise<boolean>>();
  /** Bumped when the background setting changes, so a load that started before it is discarded. */
  let generation = 0;

  /** Reloads the workspaces of every known host whose list is older than `maxAge`; true when any landed. */
  function loadWorkspaces(maxAge = 0): Promise<boolean> {
    const now = Date.now();
    const hosts = knownHosts().filter((host) => now - (hostData.get(host)?.workspacesAt ?? 0) > maxAge);
    return Promise.all(hosts.map(loadHostWorkspaces)).then((done) => done.some(Boolean));
  }

  function loadHostWorkspaces(host: string): Promise<boolean> {
    const running = loadingWorkspaces.get(host);
    if (running) return running;
    const api = apiFor(host);
    if (!api) return Promise.resolve(false);
    const mine = generation;
    const wanted = includeBackground;
    const promise: Promise<boolean> = listWithBackgroundFallback(wanted, (include) =>
      api.workspaces.list({
        page: { limit: 200 },
        sort: [{ key: "activity_at", direction: "desc" }],
        ...(include ? { filter: { includeBackground: true } } : {}),
      }),
    )
      .then(({ value: result, includedBackground }) => {
        if (mine !== generation) return false;
        const next = new Map<string, WorkspaceInfo>();
        for (const w of result.entries) {
          if (!shouldListWorkspace(w, includedBackground)) continue;
          const pr = w.githubRuntime?.pullRequest;
          next.set(w.id, {
            id: w.id,
            name: w.name,
            project: w.projectDisplayName,
            branch: w.gitRuntime?.currentBranch ?? null,
            status: w.status,
            additions: w.diffStat?.additions ?? 0,
            deletions: w.diffStat?.deletions ?? 0,
            // The sidebar's own time; idle workspaces may have none, so fall back to the latest one known.
            activityAt: latest(w.activityAt) || latest(w.lastUserMessageAt, w.statusEnteredAt, w.createdAt),
            statusAt: latest(w.statusEnteredAt),
            ahead: w.gitRuntime?.aheadOfOrigin ?? 0,
            background: Boolean(w.background),
            projectRoot: w.projectRootPath || undefined,
            pr: pr
              ? {
                  number: pr.number ?? null,
                  state: pr.isMerged ? "merged" : pr.isDraft ? "draft" : pr.state.toLowerCase() === "open" ? "open" : "closed",
                  checks: pr.checksStatus ?? "none",
                  review: pr.reviewDecision ?? null,
                }
              : null,
          });
        }
        const data = dataOf(host);
        data.workspaces = next;
        data.workspacesAt = Date.now();
        noteNames();
        return true;
      })
      .catch(() => {
        // Keep the previous list; rows fall back to sidebar labels and remembered names.
        return false;
      })
      .finally(() => {
        if (loadingWorkspaces.get(host) === promise) loadingWorkspaces.delete(host);
      });
    loadingWorkspaces.set(host, promise);
    return promise;
  }

  /** Keeps the names of visited workspaces for when their host is offline. */
  function noteNames() {
    const next = rememberNames(knownNames, visits, loadedWorkspaces(hostData));
    if (next === knownNames) return;
    knownNames = next;
    writeJson(NAMES_KEY, knownNames);
  }

  /** Reloads the agents of every known host whose list is older than `maxAge`. */
  function loadAgents(maxAge = 0): Promise<boolean> {
    const hosts = knownHosts().filter((host) => agentsStale(host, maxAge));
    return Promise.all(hosts.map(loadHostAgents)).then((done) => done.some(Boolean));
  }

  function agentsStale(host: string, maxAge: number): boolean {
    return !loadingAgents.has(host) && Date.now() - (hostData.get(host)?.agentsAt ?? 0) > maxAge;
  }

  function loadHostAgents(host: string): Promise<boolean> {
    const running = loadingAgents.get(host);
    if (running) return running;
    const api = apiFor(host);
    if (!api) {
      chatsFailed(host);
      return Promise.resolve(false);
    }
    const mine = generation;
    const wanted = includeBackground;
    const promise: Promise<boolean> = listWithBackgroundFallback(wanted, (include) =>
      api.agents.list({
        page: { limit: 200 },
        sort: [{ key: "updated_at", direction: "desc" }],
        ...(include ? { filter: { includeBackground: true } } : {}),
      }),
    )
      .then(({ value: result }) => {
        if (mine !== generation) return false;
        const list: AgentInfo[] = [];
        for (const { agent } of result.entries) {
          if (agent.archivedAt || agent.internal) continue;
          const status = agentStateBucket({
            status: agent.status,
            pendingPermissionCount: agent.pendingPermissions?.length ?? 0,
            requiresAttention: agent.requiresAttention,
            attentionReason: agent.attentionReason,
          });
          list.push({
            id: agent.id,
            workspaceId: agent.workspaceId ?? null,
            activityAt: latest(agent.updatedAt, agent.lastUserMessageAt),
            lastUserMessageAt: userMessageAt({
              lastUserMessageAt: latest(agent.lastUserMessageAt) || null,
              createdAt: latest(agent.createdAt),
              labels: agent.labels ?? {},
            }),
            automated: isAutomatedChat(agent.labels ?? {}),
            botId: agent.labels?.[BOT_LABEL] || null,
            title: agent.title ?? null,
            status,
            // How long it has been running, or waiting since it asked or finished.
            statusAt: (status === "running" ? latest(agent.activeTurn?.startedAt) : status === "done" ? 0 : latest(agent.attentionTimestamp)) || undefined,
          });
        }
        // One page of the host's most recently changed agents; Paseo cannot list one workspace's.
        const data = dataOf(host);
        data.agents = { list, capped: Boolean(result.pageInfo?.hasMore) };
        data.agentsAt = Date.now();
        const before = visits;
        countMessageVisits();
        const drilled = drill && splitKey(drill.key).serverId === host;
        if (drilled && drill) drill.failed = false;
        if (root && drilled) refreshChats();
        if (root && visits !== before) refreshCardsAndRender();
        else if (root && drilled) render();
        return true;
      })
      .catch(() => {
        // Keep the previous list; switching then uses only the remembered agent. An open chat list
        // stops waiting and says it could not load.
        chatsFailed(host);
        return false;
      })
      .finally(() => {
        if (loadingAgents.get(host) === promise) loadingAgents.delete(host);
      });
    loadingAgents.set(host, promise);
    return promise;
  }

  /** An open chat list of this host stops waiting and says it could not load. */
  function chatsFailed(host: string) {
    if (!drill || splitKey(drill.key).serverId !== host) return;
    drill.failed = true;
    if (root) render();
  }

  // ---- thumbnails -------------------------------------------------------------------------------
  //
  // Live DOM copies made the strip slow: the browser restyled every copied element on each open.
  // Instead, a snapshot is a detached clone (about 1 ms), and rasterizing it into a small canvas
  // happens in idle time. Opening the strip then only places a few canvases.

  let watched: Node = null;
  let dirty = true;
  let quietUntil = 0;
  const observer = new g.MutationObserver(() => {
    dirty = true;
  });

  function currentPane(): Node {
    const key = currentKey();
    return key ? doc.querySelector(paneSelector(key)) : null;
  }

  function watchPane() {
    const pane = currentPane();
    if (pane === watched) return;
    observer.disconnect();
    watched = pane;
    dirty = true;
    if (pane) observer.observe(pane, { childList: true, subtree: true, characterData: true });
    quietUntil = Date.now() + QUIET_AFTER_SWITCH_MS;
  }

  /** Runs `work` only when the browser is idle and nothing is switching. */
  function whenIdle(work: () => void) {
    const run = (deadline?: any) => {
      // Each step is a few milliseconds, so a busy page (streaming agent, spinners) that never has a
      // long idle period still gets its turn once the idle timeout passes.
      const tooBusy = deadline && !deadline.didTimeout && deadline.timeRemaining() < 4;
      if (open || Date.now() < quietUntil || tooBusy) {
        setTimeout(() => whenIdle(work), Math.max(100, quietUntil - Date.now()));
        return;
      }
      work();
    };
    if (g.requestIdleCallback) g.requestIdleCallback(run, { timeout: 1000 });
    else setTimeout(run, 50);
  }

  function onScroll(e: any) {
    if (watched && e.target?.nodeType === 1 && watched.contains(e.target)) dirty = true;
  }

  function snapshotIfDirty() {
    if (!dirty || open || doc.hidden || Date.now() < quietUntil) return;
    const key = currentKey();
    const pane = currentPane();
    if (!key || !pane) return;
    if (pane !== watched) watchPane();
    const started = now();
    const snap = snapshot(key, pane);
    measure("snapshot", started);
    if (!snap) return;
    dirty = false;
    queueRaster(snap);
  }

  function snapshot(key: string, pane: Node): Snapshot | null {
    const width = pane.offsetWidth;
    const height = pane.offsetHeight;
    if (width < 200 || height < 150) return null;
    const box = pane.getBoundingClientRect();
    // Only the thumbnail's crop of the pane is ever drawn; everything outside it is emptied.
    const crop = cropOf(width, height);
    const left = box.left + crop.x;
    const top = box.top + crop.y;
    const right = left + crop.width;
    const bottom = top + crop.height;
    const clone = pane.cloneNode(true);
    const emptied: Array<[Node, number, number]> = [];

    const walk = (from: Node, to: Node) => {
      for (let i = 0; i < from.children.length; i++) {
        const a = from.children[i];
        const b = to.children[i];
        if (!b) continue;
        const r = a.getBoundingClientRect();
        // Zero-size boxes (display: contents wrappers, absolute anchors) can still paint children
        // anywhere, so only real boxes that lie fully outside the crop are emptied.
        const sized = r.width > 0 && r.height > 0;
        if (sized && (r.bottom < top || r.top > bottom || r.right < left || r.left > right)) {
          // Off the thumbnail: keep the box so later siblings stay in place, drop its contents.
          emptied.push([b, r.width, r.height]);
          continue;
        }
        if (LIVE_TAGS.has(a.tagName)) {
          // Live surfaces do not clone and cannot render inside an image.
          const stand = doc.createElement("div");
          stand.setAttribute("class", b.getAttribute("class") ?? "");
          stand.setAttribute("style", b.getAttribute("style") ?? "");
          b.replaceWith(stand);
          continue;
        }
        if (a.tagName === "IMG" && !String(a.getAttribute("src") ?? "").startsWith("data:")) {
          // An image inside an SVG image cannot load URLs; keep its box, drop its pixels.
          b.setAttribute("src", BLANK_IMAGE);
          b.removeAttribute("srcset");
        }
        if (a.scrollTop || a.scrollLeft) {
          // Clones lose scroll offsets; bake them in as transforms on the scrolled content.
          b.style.overflow = "hidden";
          for (let c = 0; c < a.children.length; c++) {
            const base = win.getComputedStyle(a.children[c]).transform;
            b.children[c].style.transform =
              `translate(${-a.scrollLeft}px, ${-a.scrollTop}px)` + (base && base !== "none" ? ` ${base}` : "");
          }
        }
        walk(a, b);
      }
    };
    walk(pane, clone);
    for (const [el, w, h] of emptied) {
      el.replaceChildren();
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
      el.style.boxSizing = "border-box";
      el.style.visibility = "hidden";
    }
    return { key, clone, width, height, surface: surfaceOf(pane) };
  }

  function cropOf(width: number, height: number) {
    const w = width / ZOOM;
    const h = Math.min(height, w * ASPECT);
    // Anchored top-left: the tab row names the agent, a short conversation starts at the top, and
    // the conversation column sits left of centre when a side panel is open.
    return { x: 0, y: 0, width: w, height: h };
  }

  const pending = new Map<string, Snapshot>();
  let rastering = false;

  function queueRaster(snap: Snapshot) {
    pending.delete(snap.key);
    pending.set(snap.key, snap);
    if (!rastering) scheduleRaster();
  }

  function scheduleRaster() {
    rastering = true;
    whenIdle(() => void rasterNext());
  }

  async function rasterNext() {
    const next = pending.entries().next().value as [string, Snapshot] | undefined;
    if (!next) {
      rastering = false;
      return;
    }
    pending.delete(next[0]);
    try {
      const canvas = await rasterize(next[1]);
      if (canvas) {
        thumbs.delete(next[0]);
        thumbs.set(next[0], canvas);
        while (thumbs.size > MAX_THUMBS) thumbs.delete(thumbs.keys().next().value as string);
        if (root) swapThumb(next[0], canvas);
      }
    } catch {
      // A failed raster keeps the previous thumbnail.
    }
    if (pending.size) scheduleRaster();
    else rastering = false;
  }

  /**
   * Document CSS rules with the class names their selectors mention. Reading a selector is cheap;
   * serializing a whole rule is not, so rule text is produced only for rules a snapshot uses.
   */
  let cssCache: { signature: string; rules: Array<{ rule: Node; classes: string[] | null }> } = { signature: "", rules: [] };
  const ruleText = new WeakMap<object, string>();
  function documentRules() {
    let count = 0;
    const sheets = doc.styleSheets;
    for (let i = 0; i < sheets.length; i++) {
      try {
        count += sheets[i].cssRules.length;
      } catch {
        // Cross-origin sheets are not readable and are skipped.
      }
    }
    const signature = `${sheets.length}:${count}`;
    if (signature !== cssCache.signature) {
      const rules: Array<{ rule: Node; classes: string[] | null }> = [];
      for (let i = 0; i < sheets.length; i++) {
        if (sheets[i].ownerNode?.hasAttribute?.("data-paseo-switcher")) continue;
        try {
          const list = sheets[i].cssRules;
          for (let r = 0; r < list.length; r++) {
            const rule = list[r];
            const selector: string | undefined = rule.selectorText;
            // Non-style rules (@media, @keyframes, @font-face) are few and always kept.
            rules.push({ rule, classes: selector == null ? null : classNames(selector) });
          }
        } catch {
          // Skipped as above.
        }
      }
      cssCache = { signature, rules };
    }
    return cssCache.rules;
  }

  function classNames(selector: string): string[] {
    const out: string[] = [];
    for (let i = selector.indexOf("."); i !== -1; i = selector.indexOf(".", i + 1)) {
      let j = i + 1;
      while (j < selector.length && /[\w-]/.test(selector[j])) j++;
      if (j > i + 1) out.push(selector.slice(i + 1, j));
    }
    return out;
  }

  /** Only the rules a snapshot can use: those without classes, or naming a class it contains. */
  function cssFor(clone: Node): string {
    const used = new Set<string>();
    for (const el of [clone, ...clone.querySelectorAll("[class]")]) {
      const list = el.classList;
      if (list) for (let i = 0; i < list.length; i++) used.add(list[i]);
    }
    const parts: string[] = [];
    for (const { rule, classes } of documentRules()) {
      if (classes && classes.length && !classes.some((c) => used.has(c))) continue;
      let text = ruleText.get(rule);
      if (text === undefined) {
        text = String(rule.cssText);
        ruleText.set(rule, text);
      }
      parts.push(text);
    }
    return parts.join("\n").replaceAll("]]>", "]]&gt;");
  }

  async function rasterize(snap: Snapshot): Promise<Node> {
    const { width: w, height: h } = snap;
    const started = now();
    const ratio = Math.min(2, win.devicePixelRatio || 1);
    const outW = Math.round(CARD_MAX * ratio);
    const outH = Math.round(CARD_MAX * ASPECT * ratio);
    const crop = cropOf(w, h);
    const html = new g.XMLSerializer().serializeToString(snap.clone);
    measure("xml", started);
    const cssStarted = now();
    const css = cssFor(snap.clone);
    measure("css", cssStarted);
    // The SVG renders straight at thumbnail size, cropped by its viewBox.
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${outW}" height="${outH}" viewBox="${crop.x} ${crop.y} ${crop.width} ${crop.height}">` +
      `<foreignObject x="0" y="0" width="${w}" height="${h}">` +
      `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${w}px;height:${h}px;display:flex;background:${snap.surface};font-family:system-ui,-apple-system,sans-serif">` +
      `<style><![CDATA[${css}]]></style>${html}</div></foreignObject></svg>`;
    const url = g.URL.createObjectURL(new g.Blob([svg], { type: "image/svg+xml" }));
    measure("serialize", started);
    try {
      const img = new g.Image();
      img.src = url;
      await img.decode();
      await new Promise<void>((resolve) => whenIdle(resolve));
      const drawStarted = now();
      const canvas = doc.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      canvas.className = "pws-canvas";
      canvas.dataset.dark = String(isDark(snap.surface));
      canvas.getContext("2d").drawImage(img, 0, 0, outW, outH);
      measure("draw", drawStarted);
      return canvas;
    } finally {
      g.URL.revokeObjectURL(url);
    }
  }

  function surfaceOf(el: Node): string {
    for (let node = el; node; node = node.parentElement) {
      const color = win.getComputedStyle(node).backgroundColor;
      if (color && color !== "transparent" && !/rgba\(.*,\s*0\)$/.test(color)) return color;
    }
    return "rgb(255, 255, 255)";
  }

  // ---- open, move, commit ------------------------------------------------------------------------

  function begin(nextMode: Mode, direction: 1 | -1) {
    syncRoute();
    // A tab picked in the last couple of seconds hasn't been sampled yet; catch it before leaving.
    rememberFocusedAgent();
    mode = nextMode;
    open = true;
    query = "";
    drill = null;
    cards = buildCards(mru, loadedWorkspaces(hostData), limit, includeScreens ? screens : null, hiddenKeys);
    index = direction === 1 ? initialIndex(cards, currentStopKey()) : wrap(-1, cards.length);
    clearTimeout(showTimer);
    // A quick tap flips to the previous workspace without drawing anything.
    showTimer = setTimeout(show, nextMode === "hold" ? SHOW_DELAY_MS : 0);
  }

  function show() {
    if (!open) return;
    display = parseSidebarDisplay(readJson(APP_SETTINGS_KEY, null));
    hostNames = hostLabels();
    fillScreenIcons();
    render();
    void loadAgents(WORKSPACES_STALE_MS);
    void loadWorkspaces(WORKSPACES_STALE_MS).then((landed) => {
      if (landed && root) refreshCardsAndRender();
    });
  }

  /** Rebuilds the open list after new data landed, keeping the selected card if it is still there. */
  function refreshCardsAndRender() {
    const selected = cards[index]?.key;
    const before = cards.length;
    refreshCards();
    const kept = cards.findIndex((c) => c.key === selected);
    // A list that was empty while loading starts like a fresh open: on the previous workspace.
    index = kept >= 0 ? kept : before === 0 && !query ? initialIndex(cards, currentStopKey()) : clampIndex(index, cards.length);
    render();
  }

  function refreshCards() {
    if (!query) {
      cards = buildCards(mru, loadedWorkspaces(hostData), limit, includeScreens ? screens : null, hiddenKeys);
      return;
    }
    const all = filterCards(query, mru, loadedWorkspaces(hostData), Infinity);
    matches = all.length;
    cards = all.slice(0, MAX_LIMIT);
  }

  /** Hides a workspace or plugin screen from the switcher; the selection stays on its index and the list refills. */
  function hideKey(key: string) {
    const next = setHidden(hiddenKeys, key, true);
    if (next === hiddenKeys) return;
    hiddenKeys = next;
    writeJson(HIDDEN_KEY, hiddenKeys);
    mru = visibleKeys(recentKeys(visits), includeScreens, hiddenKeys);
    // A hidden screen on show stops counting as a visit from here on.
    pendingScreen = null;
    if (root) refreshCardsAndRender();
  }

  /** Typing filters; it also turns a held switcher into one that waits for Enter or a click. */
  function setQuery(next: string) {
    if (next === query) return;
    query = next;
    mode = "sticky";
    refreshCards();
    index = query ? 0 : initialIndex(cards, currentStopKey());
    clearTimeout(showTimer);
    if (root) render();
    else show();
  }

  function move(delta: number) {
    if (drill) {
      if (!drill.chats.length) return;
      drill.index = wrap(drill.index + delta, drill.chats.length);
    } else {
      if (!cards.length) return;
      index = wrap(index + delta, cards.length);
    }
    if (root) select();
  }

  // ---- one workspace's chats -----------------------------------------------------------------------

  /** Replaces the list with the selected workspace's chats. Plugin screens have none. */
  function drillIn() {
    const card = cards[index];
    if (!card || !canDrillInto(card)) return;
    drill = { key: card.key, name: cardName(card), chats: [], total: 0, loaded: false, failed: false, index: 0, query: "" };
    refreshChats();
    clearTimeout(showTimer);
    render();
    if (!drill.loaded || agentsStale(card.serverId, WORKSPACES_STALE_MS)) void loadHostAgents(card.serverId);
  }

  /** Back to the workspaces, with the selection on the workspace you came from. */
  function drillOut() {
    drill = null;
    render();
  }

  /** Rebuilds the chat list from the agent list, keeping the selected chat when it is still there. */
  function refreshChats() {
    if (!drill) return;
    const selected = drill.chats[drill.index]?.id;
    const { serverId: server, workspaceId } = splitKey(drill.key);
    const list = agentsOf(server)?.list ?? null;
    const all = chatsForWorkspace(list, workspaceId, agentMemory[drill.key]?.agentId);
    drill.loaded = list !== null;
    drill.total = all.length;
    drill.chats = filterChats(all, drill.query);
    const kept = drill.chats.findIndex((c) => c.id === selected);
    drill.index = kept >= 0 ? kept : clampIndex(drill.index, drill.chats.length);
  }

  function setChatQuery(next: string) {
    if (!drill || next === drill.query) return;
    drill.query = next;
    mode = "sticky";
    refreshChats();
    drill.index = 0;
    render();
  }

  /** Opens a chat in its workspace and remembers it as that workspace's last focused chat. */
  function commitChat(at: number) {
    if (!drill) return;
    const chat = drill.chats[at];
    if (!chat) {
      // Nothing typed and no chats: open the workspace itself. A filter with no match opens nothing.
      if (!drill.query) commit();
      return;
    }
    const key = drill.key;
    agentMemory = rememberAgent(agentMemory, key, chat.id, Date.now());
    writeJson(AGENTS_KEY, agentMemory);
    close();
    const { serverId: server, workspaceId } = splitKey(key);
    // As in commit(): let the closed switcher paint before Paseo renders the chat.
    win.requestAnimationFrame(() => setTimeout(() => goTo(workspaceRoute(server, workspaceId, chat.id)), 0));
  }

  function close() {
    open = false;
    query = "";
    drill = null;
    unwatchAvatars();
    clearTimeout(showTimer);
    if (root) {
      // Canvases are reused by the next open; detach them before dropping the overlay.
      for (const canvas of thumbs.values()) canvas.remove();
      root.remove();
      root = null;
    }
  }

  function commit(at = index) {
    // With a filter, only a match can be the target; nothing matched means nothing to switch to.
    if (query && !cards[at]) return;
    const target = cards[at]?.key ?? previousKey(mru, currentStopKey());
    const drawn = Boolean(root);
    close();
    if (!target || target === currentStopKey()) return;
    if (!drawn) {
      navigate(target);
      return;
    }
    // Paseo renders the next workspace synchronously inside the click. Let the browser paint the
    // closed strip first, or it stays frozen on screen for the whole render.
    win.requestAnimationFrame(() => setTimeout(() => navigate(target), 0));
  }

  function navigate(key: string) {
    const screen = parsePluginScreenKey(key);
    if (screen) {
      // Reopen the screen with the params it had when last seen; Paseo's router reads the URL.
      goTo(pluginScreenUrl({ ...screen, search: screens[key]?.search ?? "" }));
      return;
    }
    const row = doc.querySelector(rowSelector(key));
    if (row) {
      row.click();
      return;
    }
    // Hidden workspace, collapsed project group or a stale sidebar: drive the router the way
    // back/forward does. Without a row click Paseo picks no tab, so name the agent to reveal: the
    // one last focused there, else its most recently active one. Rows keep the click, which runs
    // Paseo's own choice (an agent needing attention, else the workspace's saved layout).
    const { serverId: server, workspaceId } = splitKey(key);
    const path = workspaceRoute(server, workspaceId, agentFor(key));
    goTo(path);
  }

  function goTo(path: string) {
    win.history.pushState(win.history.state, "", path);
    win.dispatchEvent(new g.PopStateEvent("popstate", { state: win.history.state }));
  }

  // ---- rendering ---------------------------------------------------------------------------------

  function render() {
    if (!open) return;
    const fresh = !root;
    if (fresh) {
      root = doc.createElement("div");
      root.setAttribute("data-paseo-switcher", "");
      root.className = "pws-root";
      root.addEventListener("mousedown", (e: any) => {
        if (e.target === root) close();
      });
    } else {
      for (const canvas of thumbs.values()) canvas.remove();
    }
    const surface = surfaceOf(currentPane() ?? doc.body);
    dark = isDark(surface);
    // A workspace's chats are always a list, whatever the layout.
    const list = Boolean(drill) || listShown();
    root.classList.toggle("pws-dark", dark);
    watchAvatars();
    root.classList.toggle("pws-list", list);
    root.classList.toggle("pws-overflow", false);
    root.classList.toggle("pws-entered", !fresh);
    root.style.setProperty("--pws-surface", surface);
    if (drill) {
      // Chat rows plus the header and panel padding, against the panel's max height.
      overflowing = drill.chats.length * CHAT_ROW_H + 12 + 44 > win.innerHeight - Math.max(48, win.innerHeight * 0.16) - 150;
    } else if (list) {
      // Rows plus panel padding, against the panel's max height (see .pws-list .pws-panel).
      overflowing = cards.length * ROW_H + 12 > win.innerHeight - Math.max(48, win.innerHeight * 0.16) - 150;
    } else {
      // Fit every card in the window when possible, within readable thumbnail sizes.
      const fit = Math.floor((win.innerWidth - 96 - 20 - (cards.length - 1) * 6) / Math.max(cards.length, 1)) - 16;
      const cardW = Math.max(CARD_MIN, Math.min(CARD_MAX, fit));
      // Card width + padding + gap, plus panel padding, against the panel's max width.
      overflowing = cards.length * (cardW + 16 + 6) + 14 > win.innerWidth - 96;
      root.classList.toggle("pws-overflow", overflowing);
      root.style.setProperty("--pws-w", `${cardW}px`);
      root.style.setProperty("--pws-h", `${Math.round(cardW * ASPECT)}px`);
    }

    const panel = el("div", "pws-panel");
    panel.setAttribute("role", "listbox");
    const at = Date.now();
    if (drill) {
      panel.setAttribute("aria-label", `Chats in ${drill.name}`);
      if (drill.chats.length) drill.chats.forEach((chat, i) => panel.appendChild(renderChat(chat, i, at)));
      else panel.appendChild(chatEmptyState());
      const sheet = el("div", "pws-sheet");
      sheet.appendChild(drillHeader());
      if (drill.query) sheet.appendChild(queryBar(drill.query, drill.chats.length === 1 ? "1 match" : drill.chats.length ? `${drill.chats.length} matches` : ""));
      sheet.appendChild(panel);
      root.replaceChildren(sheet, hintBar());
      if (fresh) host.appendChild(root);
      select();
      return;
    }
    panel.setAttribute("aria-label", "Switch workspace");
    if (cards.length) cards.forEach((card, i) => panel.appendChild(list ? renderRow(card, i, at) : renderCard(card, i)));
    else panel.appendChild(emptyState());
    if (!query && cards.length === 1 && cards[0].key === currentStopKey()) {
      const note = touchScreen() ? "Open another workspace to switch between them here." : `Open another workspace, then ${SHORTCUTS[shortcut].label} flips between the two.`;
      panel.appendChild(el("div", "pws-note", note));
    }
    // One sheet: the query, when there is one, is its header, so typing never moves the rows.
    const sheet = el("div", "pws-sheet");
    if (query) {
      const count = matches > cards.length ? `${cards.length} of ${matches}` : matches === 1 ? "1 match" : `${matches} matches`;
      sheet.appendChild(queryBar(query, matches ? count : ""));
    }
    sheet.appendChild(panel);
    const parts: Node[] = [sheet];
    if (cards.length || query) parts.push(hintBar());
    root.replaceChildren(...parts);
    if (fresh) host.appendChild(root);
    select();
    requestRepoIcons();
  }

  /**
   * Asks for the repo icons of the workspaces on show, after this render, one request per project root.
   * The RPC reaches only the daemon of the installation that sends it, so each host's roots go to that
   * host's installation; a host that does not run this plugin keeps the branch icons.
   */
  function requestRepoIcons() {
    if (!repoIcons) return;
    for (const inst of installs) {
      const ask = inst.options.projectIcon;
      const host = ask ? installHost(inst) : null;
      if (!ask || !host) continue;
      const roots = repoIconRoots(cards, repoIconCache, repoIconPending, Date.now(), host);
      if (!roots.length) continue;
      for (const root of roots) repoIconPending.add(repoIconKey(host, root));
      setTimeout(() => {
        for (const root of roots) {
          const key = repoIconKey(host, root);
          Promise.resolve()
            .then(() => ask(root))
            // A failed request is asked again in a minute, not kept as "no icon" for a day.
            .then(
              (answer) => answer,
              () => null,
            )
            .then((answer) => {
              const url = repoIconUrl(answer?.icon);
              repoIconPending.delete(key);
              repoIconCache.set(key, { url, at: Date.now(), ttl: repoIconTtl(answer) });
              if (url && repoIcons && cards.some((c) => c.serverId === host && c.info?.projectRoot === root)) render();
            });
        }
      }, 0);
    }
  }

  /**
   * The host an installation runs on, learned from one workspace ID its own API lists. With no host API
   * (an older Paseo) there is one installation, taken to be the host on show.
   */
  function installHost(inst: Installation): string | null {
    if (!installs.some((i) => i.options.getPaseoClient)) return installs.length === 1 ? shownHost() : null;
    if (inst.probe === undefined) probeInstall(inst);
    const id = inst.probe;
    if (!id) return null;
    for (const [host, data] of hostData) if (data.workspaces?.has(id)) return host;
    return null;
  }

  function probeInstall(inst: Installation) {
    if (Date.now() - (inst.probedAt ?? 0) < REPO_ICON_RETRY_MS) return;
    inst.probedAt = Date.now();
    Promise.resolve()
      .then(() => inst.paseo.workspaces.list({ page: { limit: 1 }, sort: [{ key: "activity_at", direction: "desc" }] }))
      .then(
        (result) => {
          inst.probe = result.entries[0]?.id ?? null;
          if (root && inst.probe) render();
        },
        () => {
          // Asked again after REPO_ICON_RETRY_MS.
        },
      );
  }

  /** The repo icon of a workspace card, when one is known and the setting is on. */
  function repoIcon(card: Card, px: number): Node | null {
    const root = card.info?.projectRoot;
    const url = repoIcons && root && !card.screen ? repoIconCache.get(repoIconKey(card.serverId, root))?.url : null;
    const safe = url ? safeImageUrl(url, { svg: true }) : null;
    return safe ? imageNode(safe, "pws-avatar pws-repo-icon", px) : null;
  }

  function narrow(): boolean {
    return win.innerWidth < 600;
  }

  /** The workspaces show as a list: chosen, or a phone, which has room for one column only. */
  function listShown(): boolean {
    return layout === "list" || narrow();
  }

  function touchScreen(): boolean {
    return coarse || narrow();
  }

  /** The typed filter, shown above the results like a search field. */
  function queryBar(text: string, count: string): Node {
    const bar = el("div", "pws-query");
    bar.appendChild(icon("search", "pws-query-icon"));
    bar.appendChild(el("span", "pws-query-text", text));
    bar.appendChild(el("span", "pws-caret"));
    bar.appendChild(el("span", "pws-query-count", count));
    return bar;
  }

  /** Which workspace's chats these are; clicking it, like ←, goes back to the workspaces. */
  function drillHeader(): Node {
    const header = el("div", "pws-drill");
    header.setAttribute("role", "button");
    header.setAttribute("aria-label", "Back to workspaces");
    header.addEventListener("mousedown", (e: any) => {
      e.preventDefault();
      drillOut();
    });
    header.appendChild(el("kbd", "pws-kbd", "←"));
    header.appendChild(el("span", "pws-drill-name", drill?.name ?? ""));
    const total = drill?.total ?? 0;
    const capped = drill ? Boolean(agentsOf(splitKey(drill.key).serverId)?.capped) : false;
    header.appendChild(el("span", "pws-drill-count", chatCountLabel(total, { loaded: Boolean(drill?.loaded), capped })));
    return header;
  }

  function chatEmptyState(): Node {
    const box = el("div", "pws-empty");
    const state = drill ? chatListState({ loaded: drill.loaded, failed: drill.failed, query: drill.query, shown: drill.chats.length }) : "loading";
    if (state === "no-match") {
      box.appendChild(el("div", "pws-empty-title", `No chat matches “${drill?.query}”`));
      box.appendChild(el("div", "pws-empty-text", "Chat titles are searched."));
    } else if (state === "failed") {
      box.appendChild(el("div", "pws-empty-title", "Couldn’t load this workspace’s chats"));
      box.appendChild(el("div", "pws-empty-text", "Enter opens the workspace."));
    } else if (state === "loading") {
      const title = el("div", "pws-empty-title pws-loading");
      title.appendChild(el("span", "pws-spin"));
      title.appendChild(el("span", "", "Loading chats"));
      box.appendChild(title);
    } else {
      box.appendChild(el("div", "pws-empty-title", "No chats in this workspace"));
      box.appendChild(el("div", "pws-empty-text", "Enter opens the workspace."));
    }
    return box;
  }

  /** A chat row: its title, and its status in the words a workspace row uses. */
  function renderChat(chat: AgentInfo, i: number, at: number): Node {
    const title = chatTitle(chat);
    const node = el("div", "pws-card pws-row pws-chat");
    node.setAttribute("role", "option");
    node.setAttribute("aria-label", title);
    node.setAttribute("data-agent", chat.id);
    node.addEventListener("mousemove", () => {
      if (drill && drill.index !== i) {
        drill.index = i;
        select();
      }
    });
    node.addEventListener("click", () => commitChat(i));

    const lead = el("div", "pws-lead");
    lead.appendChild(icon("chat", "pws-icon pws-badge-icon"));
    node.appendChild(lead);

    const line = el("div", "pws-l1");
    line.appendChild(nameNode("pws-name", title, drill?.query ?? ""));
    node.appendChild(line);

    const facts = chatFacts(chat, at);
    if (facts.label) {
      const status = el("div", `pws-status pws-status-${facts.state}`);
      if (facts.state !== "done") status.appendChild(statusMark(facts.state));
      status.appendChild(el("span", "", facts.label));
      node.appendChild(status);
    }
    return node;
  }

  function emptyState(): Node {
    const box = el("div", "pws-empty");
    if (query) {
      box.appendChild(el("div", "pws-empty-title", `No workspace matches “${query}”`));
      box.appendChild(el("div", "pws-empty-text", "Names, projects, branches and pull request numbers are searched."));
    } else if (![...hostData.values()].some((d) => d.workspaces)) {
      const title = el("div", "pws-empty-title pws-loading");
      title.appendChild(el("span", "pws-spin"));
      title.appendChild(el("span", "", "Loading workspaces"));
      box.appendChild(title);
    } else {
      box.appendChild(el("div", "pws-empty-title", "No workspaces yet"));
      box.appendChild(el("div", "pws-empty-text", "Create one with New workspace in the sidebar."));
    }
    return box;
  }

  /** Keys that work right now, as keycaps. Touch screens get one plain sentence instead. */
  function hintBar(): Node {
    const bar = el("div", "pws-hint");
    if (touchScreen()) {
      bar.textContent = drill ? "Tap a chat to open it" : "Tap a workspace to switch";
      return bar;
    }
    const keys = (caps: string[], label: string) => {
      const item = el("span", "pws-hint-item");
      for (const cap of caps) item.appendChild(el("kbd", "pws-kbd", cap));
      item.appendChild(el("span", "", label));
      bar.appendChild(item);
    };
    if (drill) {
      if (drill.query && !drill.chats.length) {
        keys(["Backspace"], "edit");
        keys(["Esc"], "clear");
      } else if (drill.query) {
        keys(["Enter"], "open");
        keys(["↑", "↓"], "move");
        keys(["Esc"], "clear");
      } else if (mode === "hold") {
        keys([SHORTCUTS[shortcut].modifierLabel], "release to open");
        keys(["Shift", SHORTCUTS[shortcut].keyLabel], "back");
        keys(["←"], "workspaces");
        keys(["Esc"], "cancel");
        bar.appendChild(el("span", "pws-hint-item pws-hint-type", "Type to filter"));
      } else {
        keys(["Enter"], "open");
        keys(["↑", "↓"], "move");
        keys(["←"], "workspaces");
        keys(["Esc"], "close");
        bar.appendChild(el("span", "pws-hint-item pws-hint-type", "Type to filter"));
      }
      return bar;
    }
    const arrows = listShown() ? ["↑", "↓"] : ["←", "→"];
    // Only workspaces whose host answered have chats to list; with none on show, "chats" is left out.
    const chats = cards.some((c) => canDrillInto(c)) ? () => keys([listShown() ? "→" : "↓"], "chats") : () => {};
    if (query && !cards.length) {
      keys(["Backspace"], "edit");
      keys(["Esc"], "clear");
    } else if (query) {
      keys(["Enter"], "switch");
      keys(arrows, "move");
      chats();
      keys(["Esc"], "clear");
    } else if (mode === "hold") {
      keys([SHORTCUTS[shortcut].modifierLabel], "release to switch");
      keys(["Shift", SHORTCUTS[shortcut].keyLabel], "back");
      chats();
      keys(["⌫"], "hide from switcher");
      keys(["Esc"], "cancel");
      bar.appendChild(el("span", "pws-hint-item pws-hint-type", "Type to filter"));
    } else {
      keys(["Enter"], "switch");
      keys(arrows, "move");
      chats();
      keys(["⌫"], "hide from switcher");
      keys(["Esc"], "close");
      bar.appendChild(el("span", "pws-hint-item pws-hint-type", "Type to filter"));
    }
    return bar;
  }

  /** The workspace name, with the typed filter marked. */
  function nameNode(className: string, name: string, filter = query): Node {
    const node = el("div", className);
    if (!filter) {
      node.textContent = name;
      return node;
    }
    let from = 0;
    for (const [start, end] of matchRanges(name, filter)) {
      if (start > from) node.appendChild(doc.createTextNode(name.slice(from, start)));
      node.appendChild(el("mark", "pws-mark", name.slice(start, end)));
      from = end;
    }
    if (from < name.length) node.appendChild(doc.createTextNode(name.slice(from)));
    return node;
  }

  function option(card: Card, i: number, className: string, name: string): Node {
    const node = el("div", className);
    node.setAttribute("role", "option");
    node.setAttribute("data-key", card.key);
    node.setAttribute("aria-label", name);
    node.addEventListener("mousemove", () => {
      if (index !== i) {
        index = i;
        select();
      }
    });
    node.addEventListener("click", () => commit(i));
    if (!hiddenKeys.includes(card.key)) {
      const hide = el("button", "pws-hide") as any;
      hide.setAttribute("type", "button");
      hide.setAttribute("aria-label", "Hide from switcher");
      hide.title = "Hide from switcher";
      hide.appendChild(icon("x", "pws-icon"));
      hide.addEventListener("click", (e: any) => {
        e.stopPropagation();
        hideKey(card.key);
      });
      hide.addEventListener("mousedown", (e: any) => e.stopPropagation());
      node.appendChild(hide);
    }
    return node;
  }

  /** A dot for waiting/failed/finished, a turning ring for a running agent, like Paseo's sidebar. */
  function statusMark(status: WorkspaceInfo["status"]): Node {
    return el("span", status === "running" ? "pws-spin pws-running" : `pws-dot pws-${status}`);
  }

  function renderCard(card: Card, i: number): Node {
    const info = card.info;
    const name = cardName(card);
    const node = option(card, i, "pws-card", name);

    const frame = el("div", "pws-thumb");
    const canvas = thumbs.get(card.key);
    // A thumbnail from the other theme would flash; the placeholder reads better until it refreshes.
    if (canvas && canvas.dataset.dark === String(dark)) frame.appendChild(canvas);
    else frame.appendChild(placeholder(card, info?.project ?? knownNames[card.key]?.project ?? null));
    node.appendChild(frame);

    const title = el("div", "pws-title");
    if (info && info.status !== "done") title.appendChild(statusMark(info.status));
    title.appendChild(nameNode("pws-name", name));
    node.appendChild(title);

    const meta = el("div", "pws-meta");
    const facts = cardFacts(card, Date.now());
    meta.appendChild(el("span", "pws-where", card.screen ? `Plugin · ${prettifyPluginId(card.screen.pluginId)}` : [facts.project, facts.branch, facts.host].filter(Boolean).join(" · ")));
    if (info && facts.diff) meta.appendChild(diffNode(info));
    node.appendChild(meta);
    return node;
  }

  function diffNode(info: WorkspaceInfo): Node {
    const diff = el("span", "pws-part pws-diff");
    diff.appendChild(el("span", "pws-add", `+${info.additions}`));
    diff.appendChild(el("span", "pws-del", `−${info.deletions}`));
    return diff;
  }

  /** What a row or card shows, by the sidebar's Display settings. */
  function cardFacts(card: Card, at: number) {
    return rowFacts(card.info, at, card.screen ? { screen: card.screen, visitedAt: visits[card.key] } : undefined, display, hostNames.get(card.serverId) ?? null);
  }

  /** A list row: state dot, name and where it lives, what its agent is doing, and compact facts. */
  function renderRow(card: Card, i: number, at: number): Node {
    const info = card.info;
    const name = cardName(card);
    const node = option(card, i, "pws-card pws-row", name);
    const facts = cardFacts(card, at);

    // The lead says what the row is; the agent's state sits with its label on the right.
    const lead = el("div", "pws-lead");
    lead.appendChild(leadIcon(card, info?.branch ? "gitBranch" : "folder"));
    node.appendChild(lead);

    const title = el("div", "pws-l1");
    title.appendChild(nameNode("pws-name", name));
    if (facts.hidden) {
      const tag = el("span", "pws-tag", "hidden");
      tag.title = "Hidden from the sidebar";
      title.appendChild(tag);
    }
    node.appendChild(title);

    if (facts.label) {
      const status = el("div", `pws-status pws-status-${facts.state}`);
      if (info && facts.state !== "done") status.appendChild(statusMark(facts.state));
      status.appendChild(el("span", "", facts.label));
      node.appendChild(status);
    }

    const where = el("div", "pws-where");
    const parts: [string, string | null][] = [["", facts.project], ["pws-branch", facts.branch], ["pws-hostname", facts.host]];
    for (const [className, text] of parts) {
      if (!text) continue;
      if (where.children.length) where.appendChild(doc.createTextNode(" · "));
      where.appendChild(el("span", className, text));
    }
    node.appendChild(where);

    const bits = el("div", "pws-facts");
    const fact = (className: string, text: string, tip: string, glyph?: keyof typeof ICONS) => {
      const span = el("span", `pws-fact ${className}`);
      span.title = tip;
      if (glyph) span.appendChild(icon(glyph, "pws-icon"));
      if (text) span.appendChild(el("span", "", text));
      bits.appendChild(span);
    };
    if (facts.pr) fact(`pws-pr pws-pr-${facts.pr.state}`, facts.pr.number ? `#${facts.pr.number}` : "PR", `Pull request (${facts.pr.state})`, PR_ICON[facts.pr.state]);
    if (facts.checks) fact(`pws-checks-${facts.checks}`, facts.checksText ? CHECK_LABEL[facts.checks] : "", `Checks ${CHECK_LABEL[facts.checks]}`, CHECK_ICON[facts.checks]);
    if (facts.diff) {
      const diff = el("span", "pws-fact pws-diff");
      diff.appendChild(el("span", "pws-add", `+${facts.diff.additions}`));
      diff.appendChild(el("span", "pws-del", `−${facts.diff.deletions}`));
      bits.appendChild(diff);
    }
    if (facts.ahead) fact("pws-ahead", String(facts.ahead), `${facts.ahead} ${facts.ahead === 1 ? "commit" : "commits"} not pushed`, "arrowUp");
    node.appendChild(bits);
    return node;
  }

  function placeholder(card: Card, project: string | null): Node {
    const box = el("div", "pws-placeholder");
    const plugin = Boolean(card.screen);
    const avatar = card.screen ? null : botAvatar(card, 32) ?? repoIcon(card, 32);
    if (plugin || avatar) {
      const mark = el("div", avatar ? "pws-initial pws-avatar-tile" : "pws-initial");
      mark.appendChild(avatar ?? leadIcon(card, "folder"));
      box.appendChild(mark);
    }
    if (!plugin && project) box.appendChild(el("div", "pws-placeholder-project", project));
    box.appendChild(el("div", "pws-placeholder-text", plugin ? "Plugin screen" : "No preview yet"));
    return box;
  }

  /** What a row or placeholder says it is: a screen's own icon, a bot's avatar, else the generic icon. */
  function leadIcon(card: Card, fallback: "gitBranch" | "folder"): Node {
    if (card.screen) {
      const own = card.screen.icon ? drawScreenIcon(card.screen.icon) : null;
      return own ?? icon("puzzle", "pws-icon pws-badge-icon");
    }
    return botAvatar(card, 16) ?? repoIcon(card, 16) ?? icon(fallback, "pws-icon pws-badge-icon");
  }

  /** A screen's stored icon: a raster data URL as an img, else svg markup. Both are cleaned again before drawing. */
  function drawScreenIcon(stored: string): Node | null {
    if (!isImageIcon(stored)) return drawSvg(stored, "pws-icon pws-badge-icon");
    const url = cleanScreenIcon(stored);
    return url ? imageNode(url, "pws-icon pws-badge-icon pws-icon-img") : null;
  }

  function imageNode(url: string, className: string, px?: number): Node {
    const img = el("img", className) as any;
    img.setAttribute("src", url);
    img.setAttribute("alt", "");
    if (px) {
      img.setAttribute("width", String(px));
      img.setAttribute("height", String(px));
    }
    img.setAttribute("referrerpolicy", "no-referrer");
    img.setAttribute("draggable", "false");
    return img;
  }

  /** Draws svg markup that already went through sanitizeSvg (stored values are sanitized again on load). */
  let svgDraws = 0;
  function drawSvg(markup: string, className: string, px?: number, limit?: number): Node | null {
    const clean = sanitizeSvg(markup, limit);
    if (!clean) return null;
    const holder = doc.createElement("div");
    holder.innerHTML = scopeSvgIds(clean, `pws-s${++svgDraws}-`);
    const node = holder.firstChild as Node | null;
    if (!node) return null;
    node.setAttribute("class", className);
    if (px) {
      node.setAttribute("width", String(px));
      node.setAttribute("height", String(px));
    }
    return node;
  }

  /**
   * The avatar of the bot behind the workspace's latest bot chat, from paseo-bots when it is installed.
   * Its API object is read fresh every time: Paseo re-runs plugin entries after navigations, and paseo-bots
   * then replaces the global.
   */
  function botAvatar(card: Card, px: number): Node | null {
    if (card.screen) return null;
    const botId = botIdForWorkspace(agentsOf(card.serverId)?.list, card.workspaceId);
    const api = botAvatarsApi();
    if (!botId || !api) return null;
    let found: { name?: string; svg?: string; imageUrl?: string } | null = null;
    try {
      found = api.get(botId, { dark });
    } catch {
      return null;
    }
    if (!found) return null;
    if (found.svg) {
      const node = drawSvg(found.svg, "pws-avatar", px, MAX_AVATAR_BYTES);
      if (node) return node;
    }
    const url = safeImageUrl(found.imageUrl);
    return url ? imageNode(url, "pws-avatar pws-avatar-img", px) : null;
  }

  function botAvatarsApi(): BotAvatarsApi | null {
    const api = g.__paseoBotsAvatars;
    return api && api.version === 1 && typeof api.get === "function" ? api : null;
  }

  /** Redraw while open when paseo-bots reports a change; follows the API object if paseo-bots replaced it. */
  let avatarsApi: BotAvatarsApi | null = null;
  let avatarsUnsubscribe: (() => void) | null = null;
  let avatarsRedraw = false;
  function watchAvatars() {
    const api = botAvatarsApi();
    if (api === avatarsApi) return;
    unwatchAvatars();
    if (!api || typeof api.subscribe !== "function") return;
    // Set before subscribing: a subscribe that calls back at once must not look like a new object.
    avatarsApi = api;
    try {
      avatarsUnsubscribe = api.subscribe(() => {
        // Redraw after the current call stack, once per burst, so a callback can never re-enter a render.
        if (avatarsRedraw) return;
        avatarsRedraw = true;
        win.queueMicrotask(() => {
          avatarsRedraw = false;
          if (root && avatarsApi === api) render();
        });
      });
    } catch {
      avatarsUnsubscribe = null;
    }
  }
  function unwatchAvatars() {
    try {
      avatarsUnsubscribe?.();
    } catch {
      // Nothing to undo.
    }
    avatarsUnsubscribe = null;
    avatarsApi = null;
  }

  function swapThumb(key: string, canvas: Node) {
    if (canvas.dataset.dark !== String(dark)) return;
    const frame = root?.querySelector(`.pws-card[data-key="${key}"] .pws-thumb`);
    if (!frame) return;
    const old = frame.querySelector(".pws-canvas, .pws-placeholder");
    if (old) old.replaceWith(canvas);
    else frame.prepend(canvas);
  }

  /** Lucide icons, parsed once and cloned per use. */
  const iconCache = new Map<string, Node>();
  function icon(name: keyof typeof ICONS, className: string): Node {
    let template = iconCache.get(name);
    if (!template) {
      const holder = doc.createElement("div");
      holder.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
      template = holder.firstChild as Node;
      iconCache.set(name, template);
    }
    const node = template.cloneNode(true);
    node.setAttribute("class", className);
    return node;
  }

  function select() {
    if (!root) return;
    const nodes = root.querySelectorAll(".pws-card");
    const at = drill ? drill.index : index;
    for (let i = 0; i < nodes.length; i++) {
      nodes[i].classList.toggle("pws-selected", i === at);
      nodes[i].setAttribute("aria-selected", String(i === at));
    }
    // Scrolling forces a layout; only an overflowing panel (small windows, many cards) needs it.
    if (overflowing) nodes[at]?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }

  function rowLabel(key: string): string | null {
    return doc.querySelector(rowSelector(key))?.getAttribute("aria-label") ?? null;
  }

  /** A row's name: its host's data, else its sidebar row, else the name last seen; "Workspace" only when none is known. */
  function cardName(card: Card): string {
    return card.screen?.title ?? (card.info ? workspaceTitle(card.info, display) : null) ?? rowLabel(card.key) ?? knownNames[card.key]?.name ?? "Workspace";
  }

  function isDark(surface: string): boolean {
    const match = /(\d+),\s*(\d+),\s*(\d+)/.exec(surface);
    if (!match) return false;
    const [r, gr, b] = match.slice(1).map(Number);
    return 0.2126 * r + 0.7152 * gr + 0.0722 * b < 128;
  }

  function el(tag: string, className: string, text?: string): Node {
    const node = doc.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // ---- input -------------------------------------------------------------------------------------

  function stop(e: any) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation?.();
  }

  function onKeyDown(e: any) {
    if (e.isComposing) return;
    const key = keys.realKey(e);
    if (matchesShortcut(shortcut, { code: keys.realCode(e), ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey })) {
      stop(e);
      if (open) move(e.shiftKey ? -1 : 1);
      else begin("hold", e.shiftKey ? -1 : 1);
      return;
    }
    if (!open) return;
    if (key === "Control" || key === "Shift" || key === "Alt" || key === "Meta") return;
    stop(e);
    const card = cards[index];
    const filter = drill ? drill.query : query;
    const edit = drill ? setChatQuery : setQuery;
    const action = keyAction(
      key,
      {
        layout: listShown() ? "list" : "strip",
        drilled: Boolean(drill),
        query: filter,
        canDrill: canDrillInto(card),
        hasSelection: Boolean(card),
        metaTypes: SHORTCUTS[shortcut].modifier === "Meta",
      },
      { ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey },
    );
    switch (action.type) {
      case "move":
        return move(action.delta);
      case "drill":
        return drillIn();
      case "back":
        return drillOut();
      case "commit":
        return drill ? commitChat(drill.index) : commit();
      case "cancel":
        return close();
      case "clear":
        return edit("");
      case "hide":
        return hideKey(card.key);
      case "erase":
        return edit(action.all ? "" : filter.slice(0, -1));
      case "type":
        return edit(filter + action.text);
    }
  }

  function onKeyUp(e: any) {
    if (open && mode === "hold" && isReleaseKey(shortcut, keys.realKey(e))) {
      stop(e);
      if (drill) commitChat(drill.index);
      else commit();
    }
  }

  function onBlur() {
    if (open) close();
  }

  win.addEventListener("keydown", onKeyDown, true);
  win.addEventListener("keyup", onKeyUp, true);
  win.addEventListener("blur", onBlur);
  win.addEventListener("popstate", syncRoute);
  doc.addEventListener("scroll", onScroll, { capture: true, passive: true });
  const routeTimer = setInterval(syncRoute, POLL_ROUTE_MS);
  // Nothing here runs on a navigation path: snapshots happen in idle time while you stay put,
  // right after a frame paints so measuring the pane never forces Paseo's pending layout early.
  const refreshTimer = setInterval(() => {
    if (currentPane() !== watched) watchPane();
    if (!open && !doc.hidden && Date.now() >= quietUntil) rememberFocusedAgent();
    if (layout === "strip" && dirty && !doc.hidden && Date.now() >= quietUntil) {
      whenIdle(() => win.requestAnimationFrame(() => setTimeout(snapshotIfDirty, 0)));
    }
    // A message sent from a screen that isn't a workspace page (a bot chat, say) is only seen
    // through the agent list, so keep it fresh while the switcher is closed.
    if (countMessages && !open && !doc.hidden && Date.now() >= quietUntil && knownHosts().some((h) => agentsStale(h, AGENTS_BACKGROUND_MS))) {
      whenIdle(() => void loadAgents(AGENTS_BACKGROUND_MS));
    }
  }, REFRESH_MS);
  syncRoute();
  void loadWorkspaces();
  void loadAgents();

  const api: Switcher = {
    open: () => begin("sticky", 1),
    getLimit: () => limit,
    setLimit(next) {
      limit = clampLimit(next);
      writeJson(LIMIT_KEY, limit);
    },
    getLayout: () => layout,
    setLayout(next) {
      layout = parseLayout(next);
      writeJson(LAYOUT_KEY, layout);
    },
    getIncludeBackground: () => includeBackground,
    setIncludeBackground(next) {
      const value = parseIncludeBackground(next);
      if (value === includeBackground) return;
      includeBackground = value;
      writeJson(BACKGROUND_KEY, value);
      // The cached list was built for the old setting: drop it so the next open reloads.
      generation++;
      loadingWorkspaces.clear();
      loadingAgents.clear();
      for (const data of hostData.values()) {
        data.workspacesAt = 0;
        data.agentsAt = 0;
        if (!data.workspaces) continue;
        const next = new Map<string, WorkspaceInfo>();
        for (const [id, w] of data.workspaces) if (value || !w.background) next.set(id, w);
        data.workspaces = next;
      }
    },
    getIncludeScreens: () => includeScreens,
    setIncludeScreens(next) {
      const value = parseIncludeScreens(next);
      if (value === includeScreens) return;
      includeScreens = value;
      writeJson(INCLUDE_SCREENS_KEY, value);
      mru = visibleKeys(recentKeys(visits), includeScreens, hiddenKeys);
      // Turning it on starts recording from the screen on show; turning it off keeps what was recorded.
      if (currentScreen()) {
        lastKey = null;
        syncRoute();
      }
    },
    getHidden: () =>
      hiddenKeys.map((key) => {
        const screen = parsePluginScreenKey(key);
        if (screen) return { key, title: screens[key]?.title ?? screenTitle(null, screen.pluginId), subtitle: `Plugin · ${prettifyPluginId(screen.pluginId)}` };
        const info = workspaceInfo(key) ?? knownNames[key];
        return { key, title: info?.name ?? "Workspace", subtitle: info?.project ?? "" };
      }),
    unhide(key) {
      const next = setHidden(hiddenKeys, key, false);
      if (next === hiddenKeys) return;
      hiddenKeys = next;
      writeJson(HIDDEN_KEY, hiddenKeys);
      mru = visibleKeys(recentKeys(visits), includeScreens, hiddenKeys);
      // Visits start counting again from the screen on show.
      pendingScreen = null;
    },
    getRepoIcons: () => repoIcons,
    setRepoIcons(next) {
      repoIcons = parseRepoIcons(next);
      writeJson(REPO_ICONS_KEY, repoIcons);
    },
    getCountMessages: () => countMessages,
    setCountMessages(next) {
      const value = parseCountMessages(next);
      if (value === countMessages) return;
      countMessages = value;
      writeJson(COUNT_MESSAGES_KEY, value);
      // Turning it on counts the messages already loaded; turning it off keeps visits made so far.
      countMessageVisits();
    },
    getShortcut: () => shortcut,
    setShortcut(next) {
      shortcut = parseShortcut(next);
      writeJson(SHORTCUT_KEY, shortcut);
      for (const inst of installs) for (const listener of inst.listeners) listener(shortcut);
    },
    onShortcutChange: () => () => {},
    dispose() {
      close();
      g[CARRY_KEY] = { includeBackground, hosts: hostData, repoIcons: repoIconCache };
      clearInterval(routeTimer);
      clearInterval(refreshTimer);
      observer.disconnect();
      win.removeEventListener("keydown", onKeyDown, true);
      win.removeEventListener("keyup", onKeyUp, true);
      keys.release();
      win.removeEventListener("blur", onBlur);
      win.removeEventListener("popstate", syncRoute);
      doc.removeEventListener("scroll", onScroll, { capture: true });
      style.remove();
      host.remove();
      thumbs.clear();
      pending.clear();
      if (g[ACTIVE_KEY] === api) g[ACTIVE_KEY] = undefined;
    },
  };
  g[ACTIVE_KEY] = api;
  return api;
}

/**
 * Paseo's shortcut engine listens on the window before any plugin loads, so a Paseo shortcut bound
 * to the chosen shortcut or its Shift variant (Next tab, say, on Ctrl+Tab) would act on the same press as the switcher. The
 * switcher owns those keys, and every key while it is open (typing "k" with Ctrl held would
 * otherwise open the Command Center): everyone else reads them as an unidentified key with no
 * code, which matches no shortcut, while the switcher reads the real key through `realKey`.
 */
function claimKeys(isOpen: () => boolean, shortcut: () => Shortcut): { realKey(e: any): string; realCode(e: any): string; release(): void } {
  const proto = g.KeyboardEvent?.prototype;
  const get = (name: string) => (proto ? Object.getOwnPropertyDescriptor(proto, name) : undefined);
  const key = get("key");
  const code = get("code");
  const [keyOf, codeOf, ctrlOf, metaOf, altOf] = [key, code, get("ctrlKey"), get("metaKey"), get("altKey")].map((d) => d?.get);
  if (!keyOf || !codeOf || !ctrlOf || !metaOf || !altOf || !key?.configurable || !code?.configurable) {
    return { realKey: (e) => e.key, realCode: (e) => e.code, release() {} };
  }
  // Modifier presses stay visible, so anything tracking held modifiers never gets stuck.
  const MODIFIERS = new Set(["Control", "Shift", "Alt", "Meta"]);
  const claimed = (e: any) => {
    const k = keyOf.call(e);
    if (isOpen()) return !MODIFIERS.has(k);
    return matchesShortcut(shortcut(), { code: codeOf.call(e), ctrlKey: ctrlOf.call(e), altKey: altOf.call(e), metaKey: metaOf.call(e) });
  };
  const hiddenKey = function (this: any) {
    return claimed(this) ? "Unidentified" : keyOf.call(this);
  };
  const hiddenCode = function (this: any) {
    return claimed(this) ? "" : codeOf.call(this);
  };
  Object.defineProperty(proto, "key", { ...key, get: hiddenKey });
  Object.defineProperty(proto, "code", { ...code, get: hiddenCode });
  return {
    realKey: (e) => keyOf.call(e),
    realCode: (e) => codeOf.call(e),
    release() {
      // Restore only our own getters, in case something else wrapped them since.
      if (get("key")?.get === hiddenKey) Object.defineProperty(proto, "key", key);
      if (get("code")?.get === hiddenCode) Object.defineProperty(proto, "code", code);
    },
  };
}

function now(): number {
  return g.performance?.now?.() ?? Date.now();
}

/** User Timing entries (`pws:*`) let the end-to-end tests check the plugin never blocks the app. */
function measure(name: string, start: number) {
  try {
    g.performance?.measure?.(`pws:${name}`, { start, end: now() });
  } catch {
    // Older runtimes without the options form simply skip the entry.
  }
}

function latest(...times: Array<string | null | undefined>): number {
  let best = 0;
  for (const time of times) {
    const at = time ? Date.parse(time) : 0;
    if (at > best) best = at;
  }
  return best;
}

const PR_ICON = { open: "pr", draft: "prDraft", merged: "merge", closed: "prClosed" } as const;
const CHECK_ICON = { success: "check", failure: "x", pending: "clock" } as const;
/** "pending", not Paseo's "running", so checks never read like the agent's own status. */
const CHECK_LABEL = { success: "passed", failure: "failed", pending: "pending" } as const;

/** Lucide (ISC) paths, drawn at 24×24 with a 2px stroke. */
const ICONS = {
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  pr: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><path d="M6 9v12"/>',
  prDraft: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M18 6V5"/><path d="M18 11v-1"/><path d="M6 9v12"/>',
  prClosed: '<circle cx="6" cy="6" r="3"/><path d="M6 9v12"/><path d="m21 3-6 6"/><path d="m21 9-6-6"/><path d="M18 11.5V15"/><circle cx="18" cy="18" r="3"/>',
  merge: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  circleCheck: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  circleX: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  circle: '<circle cx="12" cy="12" r="10"/>',
  arrowUp: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  gitBranch: '<path d="M15 6a9 9 0 0 0-9 9V3"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  puzzle:
    '<path d="M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z"/>',
};

const CSS = `
.pws-host { position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483000; }
.pws-root {
  --pws-panel: rgba(246, 246, 247, 0.96);
  --pws-solid: #f6f6f7;
  --pws-tile: rgba(0, 0, 0, 0.07);
  --pws-border: rgba(0, 0, 0, 0.1);
  --pws-selected: rgba(0, 0, 0, 0.07);
  --pws-ring: rgba(0, 0, 0, 0.16);
  --pws-fg: #18181b;
  --pws-muted: #63636b;
  --pws-faint: rgba(0, 0, 0, 0.05);
  --pws-thumb-border: rgba(0, 0, 0, 0.08);
  --pws-key: rgba(255, 255, 255, 0.95);
  --pws-mark: rgba(24, 24, 27, 0.12);
  --pws-add: #15803d;
  --pws-del: #dc2626;
  --pws-ok: #16a34a;
  --pws-bad: #dc2626;
  --pws-wait: #b45309;
  --pws-wait-dot: #f59e0b;
  --pws-run: #2563eb;
  --pws-merged: #7c3aed;
  position: fixed; inset: 0; z-index: 2147483000; contain: strict;
  /* Pinned near the top like Spotlight, so the sheet grows downward and never jumps while you type. */
  display: flex; flex-direction: column; align-items: center; justify-content: flex-start; gap: 10px;
  padding-top: max(48px, 16vh); box-sizing: border-box;
  /* Dim enough that page text never competes with the sheet and hint resting on it. */
  background: rgba(24, 24, 27, 0.34);
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased; user-select: none; -webkit-user-select: none;
  animation: pws-fade 140ms ease-out;
}
.pws-root.pws-dark {
  --pws-panel: rgba(30, 30, 33, 0.95);
  --pws-solid: #1e1e21;
  --pws-tile: rgba(255, 255, 255, 0.1);
  --pws-border: rgba(255, 255, 255, 0.09);
  --pws-selected: rgba(255, 255, 255, 0.08);
  --pws-ring: rgba(255, 255, 255, 0.17);
  --pws-fg: #f4f4f5;
  --pws-muted: #a1a1aa;
  --pws-faint: rgba(255, 255, 255, 0.05);
  --pws-thumb-border: rgba(255, 255, 255, 0.07);
  --pws-key: rgba(255, 255, 255, 0.07);
  --pws-mark: rgba(255, 255, 255, 0.16);
  --pws-add: #4ade80;
  --pws-del: #f87171;
  --pws-ok: #4ade80;
  --pws-bad: #f87171;
  --pws-wait: #fbbf24;
  --pws-wait-dot: #fbbf24;
  --pws-run: #60a5fa;
  --pws-merged: #a78bfa;
  background: rgba(0, 0, 0, 0.5);
}
/* One authored moment: the panel settles in from just below. Re-renders while open never replay it. */
.pws-sheet { animation: pws-in 180ms cubic-bezier(0.16, 1, 0.3, 1); }
.pws-hint { animation: pws-fade 220ms ease-out; }
.pws-entered .pws-sheet, .pws-entered .pws-hint { animation: none; }
.pws-sheet {
  display: flex; flex-direction: column; max-width: calc(100vw - 96px); box-sizing: border-box; overflow: hidden;
  background: var(--pws-panel); border: 1px solid var(--pws-border); border-radius: 22px;
  backdrop-filter: blur(28px) saturate(1.4); -webkit-backdrop-filter: blur(28px) saturate(1.4);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.26), 0 2px 8px rgba(0, 0, 0, 0.1);
}
.pws-panel {
  /* Each card keeps its own height, so a two-line name never stretches the selection ring. */
  display: flex; align-items: flex-start; gap: 6px; padding: 10px; box-sizing: border-box; overflow-x: auto;
  scrollbar-width: thin; scrollbar-color: var(--pws-ring) transparent;
}
/* An overflowing strip fades at its edges instead of cutting a card mid-word. */
.pws-overflow .pws-panel {
  -webkit-mask-image: linear-gradient(to right, transparent, #000 28px, #000 calc(100% - 28px), transparent);
  mask-image: linear-gradient(to right, transparent, #000 28px, #000 calc(100% - 28px), transparent);
}
.pws-card {
  flex: 0 0 auto; width: var(--pws-w); padding: 8px 8px 10px; border-radius: 15px; cursor: default;
  transition: background-color 90ms ease, box-shadow 90ms ease;
}
.pws-card.pws-selected { background: var(--pws-selected); box-shadow: inset 0 0 0 1px var(--pws-ring); }
.pws-thumb {
  position: relative; width: var(--pws-w); height: var(--pws-h); overflow: hidden; border-radius: 9px;
  border: 1px solid var(--pws-thumb-border); box-sizing: border-box; background: var(--pws-surface);
}
.pws-canvas { display: block; width: 100%; height: 100%; }
.pws-placeholder {
  height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
  background: var(--pws-faint);
}
.pws-initial {
  width: 36px; height: 36px; border-radius: 10px; background: var(--pws-tile); color: var(--pws-muted); font-size: 17px; font-weight: 650;
  display: flex; align-items: center; justify-content: center;
}
.pws-placeholder-text { color: var(--pws-muted); font-size: 12px; }
.pws-kbd {
  display: inline-block; min-width: 18px; height: 18px; padding: 0 5px; box-sizing: border-box;
  border-radius: 5px; background: var(--pws-key); color: var(--pws-muted); border: 1px solid var(--pws-border);
  box-shadow: 0 1px 0 var(--pws-border);
  font: 600 11px/16px system-ui, -apple-system, sans-serif; text-align: center; font-variant-numeric: tabular-nums;
}
.pws-title { display: flex; align-items: center; gap: 7px; margin: 10px 2px 0; min-width: 0; }
.pws-card:not(.pws-row) .pws-name {
  white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: anywhere; line-height: 19px;
}
.pws-name {
  color: var(--pws-fg); font-size: 14px; font-weight: 600; letter-spacing: -0.01em;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.pws-mark { background: var(--pws-mark); color: inherit; border-radius: 3px; box-shadow: 0 0 0 1px var(--pws-mark); }
.pws-meta { display: flex; align-items: baseline; gap: 8px; margin: 3px 2px 0; font-size: 12px; min-width: 0; color: var(--pws-muted); }
.pws-where { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pws-diff { display: inline-flex; gap: 4px; font-variant-numeric: tabular-nums; flex: 0 0 auto; }
.pws-add { color: var(--pws-add); }
.pws-del { color: var(--pws-del); }
.pws-dot { flex: 0 0 auto; width: 8px; height: 8px; border-radius: 50%; }
.pws-needs_input { background: var(--pws-wait-dot); }
.pws-attention { background: var(--pws-ok); }
.pws-failed { background: var(--pws-bad); }
.pws-spin {
  flex: 0 0 auto; width: 9px; height: 9px; box-sizing: border-box; border-radius: 50%;
  border: 1.75px solid currentColor; border-top-color: transparent; color: var(--pws-muted);
  animation: pws-turn 0.9s linear infinite;
}
.pws-spin.pws-running { color: var(--pws-run); }
.pws-hint {
  display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 4px 14px;
  max-width: calc(100vw - 32px); box-sizing: border-box;
  color: var(--pws-fg); font-size: 12px; line-height: 18px; padding: 5px 12px; border-radius: 999px;
  background: var(--pws-solid); border: 1px solid var(--pws-border);
}
.pws-hint-item { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.pws-hint-item > span { margin-left: 2px; opacity: 0.85; }
.pws-hint-type { color: var(--pws-muted); }
.pws-hint .pws-kbd { color: var(--pws-fg); }
.pws-query {
  display: flex; align-items: center; gap: 10px; box-sizing: border-box; flex: 0 0 auto;
  height: 48px; padding: 0 18px; min-width: 0;
  background: var(--pws-solid); border-bottom: 1px solid var(--pws-border);
  color: var(--pws-fg); font-size: 15px;
}
.pws-query-icon { width: 16px; height: 16px; color: var(--pws-muted); flex: 0 0 auto; }
.pws-query-text { white-space: pre; overflow: hidden; text-overflow: ellipsis; min-width: 0; font-weight: 500; }
.pws-caret { flex: 0 0 auto; width: 1.5px; height: 19px; margin-left: -9px; background: var(--pws-fg); animation: pws-blink 1s steps(1) infinite; }
.pws-query-count { margin-left: auto; flex: 0 0 auto; color: var(--pws-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.pws-empty { padding: 26px 32px; text-align: center; min-width: 280px; box-sizing: border-box; flex: 1; }
.pws-empty-title { color: var(--pws-fg); font-size: 14px; font-weight: 600; overflow-wrap: anywhere; }
.pws-empty-text { color: var(--pws-muted); font-size: 12.5px; margin-top: 4px; }
.pws-loading { display: inline-flex; align-items: center; gap: 8px; font-weight: 500; color: var(--pws-muted); }
.pws-note { color: var(--pws-muted); font-size: 12px; padding: 6px 12px 6px 48px; }
.pws-list .pws-sheet { width: min(680px, calc(100vw - 32px)); max-width: none; border-radius: 18px; }
.pws-list .pws-panel {
  flex-direction: column; align-items: stretch; gap: 2px; padding: 6px;
  max-height: calc(100vh - max(48px, 16vh) - 150px); overflow-x: hidden; overflow-y: auto;
}
.pws-row {
  display: grid; grid-template-columns: 20px minmax(0, 1fr) auto; column-gap: 12px; align-items: baseline;
  width: auto; padding: 10px 12px; border-radius: 12px; border: 1px solid transparent;
}
/* The chats header: which workspace, and the way back. */
.pws-drill {
  display: flex; align-items: center; gap: 10px; box-sizing: border-box; flex: 0 0 auto;
  height: 44px; padding: 0 18px; min-width: 0; cursor: pointer;
  border-bottom: 1px solid var(--pws-border); color: var(--pws-fg); font-size: 14px;
}
.pws-drill-name { font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pws-drill-count { margin-left: auto; flex: 0 0 auto; color: var(--pws-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.pws-row.pws-selected {
  background: color-mix(in srgb, var(--pws-run) 12%, transparent);
  border-color: color-mix(in srgb, var(--pws-run) 38%, transparent);
  box-shadow: none;
}
.pws-lead { grid-row: 1 / span 2; grid-column: 1; align-self: start; height: 20px; display: flex; align-items: center; justify-content: center; }
.pws-l1 { grid-column: 2; grid-row: 1; display: flex; align-items: center; flex-wrap: wrap; gap: 2px 8px; min-width: 0; }
.pws-status { grid-column: 3; grid-row: 1; justify-self: end; display: inline-flex; align-items: center; gap: 6px; text-align: right; font-size: 12px; line-height: 20px; font-weight: 550; color: var(--pws-muted); font-variant-numeric: tabular-nums; }
.pws-status-running { color: var(--pws-run); }
.pws-status-needs_input { color: var(--pws-wait); }
.pws-status-failed { color: var(--pws-bad); }
.pws-status-attention { color: var(--pws-ok); }
.pws-list .pws-name { display: block; font-size: 14px; line-height: 20px; white-space: normal; overflow: visible; text-overflow: clip; overflow-wrap: anywhere; }
.pws-tag {
  flex: 0 0 auto; padding: 0 5px; border: 1px solid var(--pws-border); border-radius: 5px;
  color: var(--pws-muted); font-size: 11px; line-height: 16px; font-weight: 500;
}
.pws-row .pws-where {
  grid-column: 2; grid-row: 2; margin-top: 3px; min-width: 0; font-size: 12px; line-height: 17px; color: var(--pws-muted);
  white-space: normal; overflow: visible; text-overflow: clip; overflow-wrap: anywhere;
}
.pws-branch { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11.5px; }
.pws-facts {
  grid-column: 3; grid-row: 2; justify-self: end; margin-top: 3px; display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap;
  gap: 2px 10px; font-size: 12px; line-height: 17px; color: var(--pws-muted); font-variant-numeric: tabular-nums; white-space: nowrap;
}
.pws-fact { display: inline-flex; align-items: center; gap: 4px; }
.pws-diff { gap: 5px; }
.pws-icon { width: 13px; height: 13px; flex: 0 0 auto; }
.pws-card { position: relative; }
.pws-hide {
  position: absolute; top: 6px; right: 6px; width: 22px; height: 22px; padding: 0; border: 0; border-radius: 6px;
  display: none; align-items: center; justify-content: center; cursor: pointer; z-index: 1;
  background: var(--pws-key); color: var(--pws-muted); box-shadow: inset 0 0 0 1px var(--pws-border);
}
.pws-card:hover .pws-hide { display: flex; }
.pws-hide:hover { color: var(--pws-bad); }
.pws-icon.pws-badge-icon { width: 14px; height: 14px; color: var(--pws-muted); }
.pws-initial .pws-badge-icon { width: 20px; height: 20px; }
.pws-icon-img { display: block; object-fit: contain; }
.pws-avatar { width: 16px; height: 16px; flex: 0 0 auto; display: block; }
.pws-avatar-img { object-fit: cover; border-radius: 50%; }
.pws-repo-icon { object-fit: contain; border-radius: 3px; }
.pws-initial.pws-avatar-tile { background: none; }
.pws-initial .pws-avatar { width: 32px; height: 32px; }
.pws-placeholder-project { color: var(--pws-muted); font-size: 13px; font-weight: 550; padding: 0 12px; text-align: center; overflow-wrap: anywhere; }
.pws-pr { color: var(--pws-fg); }
.pws-pr-open .pws-icon { color: var(--pws-ok); }
.pws-pr-draft .pws-icon { color: var(--pws-muted); }
.pws-pr-closed .pws-icon { color: var(--pws-bad); }
.pws-pr-merged .pws-icon { color: var(--pws-merged); }
.pws-checks-success { color: var(--pws-ok); }
.pws-checks-failure { color: var(--pws-bad); }
.pws-checks-pending { color: var(--pws-wait); }
@media (max-width: 599px) {
  .pws-row { column-gap: 10px; padding: 10px; }
  .pws-note { padding-left: 12px; }
}
/* Narrow: the right-hand facts drop below the left content instead of squeezing it. */
@media (max-width: 480px) {
  .pws-row { grid-template-columns: 20px minmax(0, 1fr); }
  .pws-status { grid-column: 2; grid-row: 3; justify-self: start; text-align: left; margin-top: 3px; }
  .pws-facts { grid-column: 2; grid-row: 4; justify-self: start; justify-content: flex-start; }
}
@keyframes pws-fade { from { opacity: 0; } }
@keyframes pws-in { from { opacity: 0; transform: translateY(6px) scale(0.985); } }
@keyframes pws-turn { to { transform: rotate(360deg); } }
@keyframes pws-blink { 50% { opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .pws-root, .pws-sheet, .pws-hint, .pws-caret { animation: none; }
  .pws-card { transition: none; }
  /* A still ring reads as "in progress" without turning. */
  .pws-spin { animation: none; border-style: dotted; border-top-color: currentColor; }
}
`;
