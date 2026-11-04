import type { PluginClientContext } from "@getpaseo/plugin/client";
import {
  ago,
  buildCards,
  clampLimit,
  DEFAULT_LAYOUT,
  DEFAULT_LIMIT,
  initialIndex,
  parseLayout,
  previousKey,
  splitKey,
  touch,
  workspaceKey,
  wrap,
  type Card,
  type Layout,
  type WorkspaceInfo,
} from "./model";

/* Desktop/web adapter for Paseo 0.15. Host DOM is not a public plugin API, so every selector and
 * route this plugin depends on lives in this block. Native clients never run this file.
 * - route: /h/<serverId>/workspace/<workspaceId>
 * - row:   the sidebar workspace row; clicking it is how a person switches
 * - pane:  the workspace deck entry; snapshotted for thumbnails
 */
const ROUTE = /^\/h\/([^/]+)\/workspace\/([^/?#]+)/;
const ROW_PREFIX = "sidebar-workspace-row-";
const rowSelector = (key: string) => `[data-testid="${ROW_PREFIX}${key}"]`;
const paneSelector = (key: string) => `[data-testid="workspace-deck-entry-${key}"]`;

const MRU_KEY = "paseo-switcher:mru";
const LIMIT_KEY = "paseo-switcher:limit";
const LAYOUT_KEY = "paseo-switcher:layout";
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
const MAX_THUMBS = 12;

const CARD_MAX = 240;
const CARD_MIN = 176;
const ASPECT = 0.66;
/** Estimated list row height, so the list knows it overflows without measuring. */
const ROW_H = 64;
/** Thumbnails zoom past the pane's side margins toward the conversation column. */
const ZOOM = 1.35;
const BLANK_IMAGE = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const LIVE_TAGS = new Set(["IFRAME", "CANVAS", "VIDEO", "AUDIO", "OBJECT", "EMBED", "WEBVIEW"]);

type Paseo = PluginClientContext["paseo"];
type Mode = "hold" | "sticky";
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
  dispose(): void;
}

export function installSwitcher(paseo: Paseo): Switcher {
  const doc = g.document;
  const win = g.window;
  const noop: Switcher = {
    open() {},
    getLimit: () => DEFAULT_LIMIT,
    setLimit() {},
    getLayout: () => DEFAULT_LAYOUT,
    setLayout() {},
    dispose() {},
  };
  if (!doc || !win) return noop;

  // Each connected host installs the plugin; only one switcher may own the keyboard.
  g.__paseoSwitcher?.dispose();
  const keys = claimCtrlTab();

  let mru: string[] = readJson(MRU_KEY, []).filter((v: unknown) => typeof v === "string");
  let limit = clampLimit(readJson(LIMIT_KEY, DEFAULT_LIMIT));
  /** The list layout has no thumbnails, so it skips all background snapshot work. */
  let layout = parseLayout(readJson(LAYOUT_KEY, DEFAULT_LAYOUT));
  let workspaces: Map<string, WorkspaceInfo> | null = null;
  let workspacesAt = 0;
  /** Rasterized thumbnails by workspace key, oldest first. Each canvas records its theme. */
  const thumbs = new Map<string, Node>();

  // Switcher state. `open` is true from the first Ctrl+Tab; `root` exists only once drawn.
  let open = false;
  let mode: Mode = "hold";
  let cards: Card[] = [];
  let index = 0;
  let showTimer: any = null;
  let root: Node = null;
  let lastKey: string | null = null;
  let overflowing = false;
  let dark = false;

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

  function serverId(): string | null {
    const key = currentKey() ?? mru[0];
    return key ? splitKey(key).serverId : null;
  }

  function syncRoute() {
    const key = currentKey();
    if (!key || key === lastKey) return;
    lastKey = key;
    const next = touch(mru, key);
    if (next !== mru) {
      mru = next;
      writeJson(MRU_KEY, mru);
    }
    watchPane();
  }

  // ---- workspace data -------------------------------------------------------------------------

  let loading: Promise<void> | null = null;
  function loadWorkspaces(): Promise<void> {
    loading ??= paseo.workspaces
      .list({ page: { limit: 200 }, sort: [{ key: "activity_at", direction: "desc" }] })
      .then((result) => {
        const next = new Map<string, WorkspaceInfo>();
        for (const w of result.entries) {
          if (w.archivingAt || w.background) continue;
          const pr = w.githubRuntime?.pullRequest;
          next.set(w.id, {
            id: w.id,
            name: w.name,
            project: w.projectDisplayName,
            branch: w.gitRuntime?.currentBranch ?? null,
            status: w.status,
            additions: w.diffStat?.additions ?? 0,
            deletions: w.diffStat?.deletions ?? 0,
            // Idle workspaces may have no activity time; fall back to the latest one the daemon has.
            activityAt: latest(w.activityAt, w.lastUserMessageAt, w.statusEnteredAt, w.createdAt),
            statusAt: latest(w.statusEnteredAt),
            ahead: w.gitRuntime?.aheadOfOrigin ?? 0,
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
        workspaces = next;
        workspacesAt = Date.now();
      })
      .catch(() => {
        // Keep the previous list; cards fall back to sidebar labels.
      })
      .finally(() => {
        loading = null;
      });
    return loading;
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
    return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
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
    mode = nextMode;
    open = true;
    cards = buildCards(mru, serverId(), workspaces, limit);
    index = direction === 1 ? initialIndex(cards, currentKey()) : wrap(-1, cards.length);
    clearTimeout(showTimer);
    // A quick tap flips to the previous workspace without drawing anything.
    showTimer = setTimeout(show, nextMode === "hold" ? SHOW_DELAY_MS : 0);
  }

  function show() {
    if (!open) return;
    render();
    if (Date.now() - workspacesAt > WORKSPACES_STALE_MS) {
      void loadWorkspaces().then(() => {
        if (!root) return;
        const selected = cards[index]?.key;
        cards = buildCards(mru, serverId(), workspaces, limit);
        const kept = cards.findIndex((c) => c.key === selected);
        index = kept >= 0 ? kept : Math.min(index, cards.length - 1);
        render();
      });
    }
  }

  function move(delta: number) {
    if (!cards.length) return;
    index = wrap(index + delta, cards.length);
    if (root) select();
  }

  function close() {
    open = false;
    clearTimeout(showTimer);
    if (root) {
      // Canvases are reused by the next open; detach them before dropping the overlay.
      for (const canvas of thumbs.values()) canvas.remove();
      root.remove();
      root = null;
    }
  }

  function commit(at = index) {
    const target = cards[at]?.key ?? previousKey(mru, currentKey());
    const drawn = Boolean(root);
    close();
    if (!target || target === currentKey()) return;
    if (!drawn) {
      navigate(target);
      return;
    }
    // Paseo renders the next workspace synchronously inside the click. Let the browser paint the
    // closed strip first, or it stays frozen on screen for the whole render.
    win.requestAnimationFrame(() => setTimeout(() => navigate(target), 0));
  }

  function navigate(key: string) {
    const row = doc.querySelector(rowSelector(key));
    if (row) {
      row.click();
      return;
    }
    // Collapsed project group or a stale sidebar: drive the router the way back/forward does.
    const { serverId: server, workspaceId } = splitKey(key);
    const path = `/h/${encodeURIComponent(server)}/workspace/${encodeURIComponent(workspaceId)}`;
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
    const list = layout === "list";
    root.classList.toggle("pws-dark", dark);
    root.classList.toggle("pws-list", list);
    root.style.setProperty("--pws-surface", surface);
    if (list) {
      // Rows plus panel padding, against the panel's max height (the window less 140px).
      overflowing = cards.length * ROW_H + 12 > win.innerHeight - 140;
    } else {
      // Fit every card in the window when possible, within readable thumbnail sizes.
      const fit = Math.floor((win.innerWidth - 96 - 20 - (cards.length - 1) * 6) / Math.max(cards.length, 1)) - 16;
      const cardW = Math.max(CARD_MIN, Math.min(CARD_MAX, fit));
      // Card width + padding + gap, plus panel padding, against the panel's max width.
      overflowing = cards.length * (cardW + 16 + 6) + 14 > win.innerWidth - 96;
      root.style.setProperty("--pws-w", `${cardW}px`);
      root.style.setProperty("--pws-h", `${Math.round(cardW * ASPECT)}px`);
    }

    const panel = el("div", "pws-panel");
    panel.setAttribute("role", "listbox");
    panel.setAttribute("aria-label", "Switch workspace");
    if (!cards.length) panel.appendChild(el("div", "pws-empty-panel", "No workspaces yet"));
    const at = Date.now();
    cards.forEach((card, i) => panel.appendChild(list ? renderRow(card, i, at) : renderCard(card, i)));
    const arrows = list ? "↑ ↓" : "← →";
    const hint = el(
      "div",
      "pws-hint",
      mode === "hold" ? "Release Ctrl to switch  ·  Shift+Tab back  ·  Esc cancel" : `Enter to switch  ·  ${arrows} move  ·  Esc cancel`,
    );
    root.replaceChildren(panel, hint);
    if (fresh) host.appendChild(root);
    select();
  }

  function renderCard(card: Card, i: number): Node {
    const info = card.info;
    const node = el("div", "pws-card");
    node.setAttribute("role", "option");
    node.setAttribute("data-key", card.key);
    node.setAttribute("aria-label", info?.name ?? rowLabel(card.key) ?? "Workspace");
    node.addEventListener("mousemove", () => {
      if (index !== i) {
        index = i;
        select();
      }
    });
    node.addEventListener("click", () => commit(i));

    const frame = el("div", "pws-thumb");
    const canvas = thumbs.get(card.key);
    // A thumbnail from the other theme would flash; the project initial reads better until it refreshes.
    if (canvas && canvas.dataset.dark === String(dark)) frame.appendChild(canvas);
    else frame.appendChild(placeholder(info?.project ?? null, card.key));
    if (i < 9) frame.appendChild(el("div", "pws-number", String(i + 1)));
    node.appendChild(frame);

    const title = el("div", "pws-title");
    if (info && info.status !== "done") title.appendChild(el("span", `pws-dot pws-${info.status}`));
    title.appendChild(el("span", "pws-name", info?.name ?? rowLabel(card.key) ?? "Workspace"));
    node.appendChild(title);

    const meta = el("div", "pws-meta");
    meta.appendChild(el("span", "pws-where", [info?.project, info?.branch].filter(Boolean).join(" · ")));
    if (info && (info.additions || info.deletions)) {
      const diff = el("span", "pws-diff");
      diff.appendChild(el("span", "pws-add", `+${info.additions}`));
      diff.appendChild(el("span", "pws-del", `−${info.deletions}`));
      meta.appendChild(diff);
    }
    node.appendChild(meta);
    return node;
  }

  /** A list row: the full name, where it lives, its pull request, and what its agent is doing. */
  function renderRow(card: Card, i: number, at: number): Node {
    const info = card.info;
    const name = info?.name ?? rowLabel(card.key) ?? "Workspace";
    const node = el("div", "pws-card pws-row");
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

    node.appendChild(el("div", "pws-number", i < 9 ? String(i + 1) : ""));
    const project = info?.project ?? null;
    const badge = el("div", "pws-badge", (project ?? "?").slice(0, 1).toUpperCase());
    badge.style.background = hue(project ?? card.key);
    node.appendChild(badge);

    const main = el("div", "pws-main");
    main.appendChild(el("div", "pws-name", name));
    const meta = el("div", "pws-meta");
    const part = (className: string, text: string, title?: string) => {
      const span = el("span", className, text);
      if (title) span.title = title;
      meta.appendChild(span);
      return span;
    };
    if (project) part("pws-part", project);
    // The name is often the branch; only show the branch when it adds something.
    if (info?.branch && info.branch !== name) part("pws-part pws-branch", info.branch);
    const pr = info?.pr;
    if (pr) {
      const label = pr.number ? `#${pr.number}` : "PR";
      const state = pr.state === "open" ? "" : ` ${pr.state[0].toUpperCase()}${pr.state.slice(1)}`;
      const chip = part(`pws-part pws-pr pws-pr-${pr.state}`, `${label}${state}`, "Pull request");
      if (pr.state === "open" || pr.state === "draft") {
        if (pr.checks !== "none") {
          const checks = { success: "✓", failure: "✕", pending: "●" }[pr.checks];
          chip.appendChild(el("span", `pws-checks pws-checks-${pr.checks}`, ` ${checks}`));
        }
        if (pr.review === "approved") part("pws-part pws-approved", "Approved");
        else if (pr.review === "changes_requested") part("pws-part pws-changes", "Changes requested");
      }
    }
    if (info && (info.additions || info.deletions)) {
      const diff = el("span", "pws-part pws-diff");
      diff.appendChild(el("span", "pws-add", `+${info.additions}`));
      diff.appendChild(el("span", "pws-del", `−${info.deletions}`));
      meta.appendChild(diff);
    }
    if (info?.ahead) part("pws-part", `↑${info.ahead}`, `${info.ahead} commit(s) not pushed`);
    if (meta.childNodes.length) main.appendChild(meta);
    node.appendChild(main);

    const side = el("div", "pws-side");
    if (info && info.status !== "done") {
      const label = { running: "Running", needs_input: "Needs input", attention: "Needs attention", failed: "Failed" }[info.status];
      const status = el("div", `pws-status pws-status-${info.status}`);
      status.appendChild(el("span", `pws-dot pws-${info.status}`));
      status.appendChild(el("span", "", label));
      side.appendChild(status);
      const since = ago(info.statusAt || info.activityAt, at);
      if (since) side.appendChild(el("div", "pws-time", since === "now" ? "just now" : `for ${since}`));
    } else {
      const since = ago(info?.activityAt, at);
      if (since) side.appendChild(el("div", "pws-time", since === "now" ? "just now" : `${since} ago`));
    }
    node.appendChild(side);
    return node;
  }

  function placeholder(project: string | null, key: string): Node {
    const box = el("div", "pws-placeholder");
    const initial = el("div", "pws-initial", (project ?? "?").slice(0, 1).toUpperCase());
    initial.style.background = hue(project ?? key);
    box.appendChild(initial);
    box.appendChild(el("div", "pws-placeholder-text", project ?? "Not opened yet"));
    return box;
  }

  function swapThumb(key: string, canvas: Node) {
    if (canvas.dataset.dark !== String(dark)) return;
    const frame = root?.querySelector(`.pws-card[data-key="${key}"] .pws-thumb`);
    if (!frame) return;
    const old = frame.querySelector(".pws-canvas, .pws-placeholder");
    if (old) old.replaceWith(canvas);
    else frame.prepend(canvas);
  }

  function select() {
    if (!root) return;
    const nodes = root.querySelectorAll(".pws-card");
    for (let i = 0; i < nodes.length; i++) {
      nodes[i].classList.toggle("pws-selected", i === index);
      nodes[i].setAttribute("aria-selected", String(i === index));
    }
    // Scrolling forces a layout; only an overflowing panel (small windows, many cards) needs it.
    if (overflowing) nodes[index]?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }

  function rowLabel(key: string): string | null {
    return doc.querySelector(rowSelector(key))?.getAttribute("aria-label") ?? null;
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
    if (keys.realKey(e) === "Tab" && e.ctrlKey && !e.metaKey && !e.altKey) {
      stop(e);
      if (open) move(e.shiftKey ? -1 : 1);
      else begin("hold", e.shiftKey ? -1 : 1);
      return;
    }
    if (!open) return;
    if (e.key === "Control" || e.key === "Shift") return;
    stop(e);
    if (e.key === "Escape") close();
    else if (e.key === "Enter") commit();
    else if (e.key === "ArrowRight" || e.key === "ArrowDown") move(1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") move(-1);
    else if (/^[1-9]$/.test(e.key) && Number(e.key) <= cards.length) commit(Number(e.key) - 1);
  }

  function onKeyUp(e: any) {
    if (open && mode === "hold" && e.key === "Control") {
      stop(e);
      commit();
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
    if (layout === "strip" && dirty && !doc.hidden && Date.now() >= quietUntil) {
      whenIdle(() => win.requestAnimationFrame(() => setTimeout(snapshotIfDirty, 0)));
    }
  }, REFRESH_MS);
  syncRoute();
  void loadWorkspaces();

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
    dispose() {
      close();
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
      if (g.__paseoSwitcher === api) g.__paseoSwitcher = undefined;
    },
  };
  g.__paseoSwitcher = api;
  return api;
}

/**
 * Paseo's shortcut engine listens on the window before any plugin loads, so a Paseo shortcut bound
 * to Ctrl+Tab or Ctrl+Shift+Tab (Next tab, say) would act on the same press as the switcher. The
 * switcher owns those keys: everyone else reads them as an unidentified key with no code, which
 * matches no shortcut, while the switcher reads the real key through `realKey`.
 */
function claimCtrlTab(): { realKey(e: any): string; release(): void } {
  const proto = g.KeyboardEvent?.prototype;
  const get = (name: string) => (proto ? Object.getOwnPropertyDescriptor(proto, name) : undefined);
  const key = get("key");
  const code = get("code");
  const [keyOf, codeOf, ctrlOf, metaOf, altOf] = [key, code, get("ctrlKey"), get("metaKey"), get("altKey")].map((d) => d?.get);
  if (!keyOf || !codeOf || !ctrlOf || !metaOf || !altOf || !key?.configurable || !code?.configurable) {
    return { realKey: (e) => e.key, release() {} };
  }
  const claimed = (e: any) => keyOf.call(e) === "Tab" && ctrlOf.call(e) && !metaOf.call(e) && !altOf.call(e);
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

function hue(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360;
  return `hsl(${h} 45% 45%)`;
}

const CSS = `
.pws-host { position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483000; }
.pws-root {
  --pws-panel: rgba(244, 244, 245, 0.88);
  --pws-border: rgba(0, 0, 0, 0.1);
  --pws-selected: rgba(0, 0, 0, 0.08);
  --pws-ring: rgba(0, 0, 0, 0.14);
  --pws-fg: #18181b;
  --pws-muted: #71717a;
  --pws-thumb-border: rgba(0, 0, 0, 0.08);
  --pws-chip: rgba(255, 255, 255, 0.9);
  position: fixed; inset: 0; z-index: 2147483000; contain: strict;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
  background: rgba(24, 24, 27, 0.2);
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  animation: pws-fade 20ms linear;
}
.pws-root.pws-dark {
  --pws-panel: rgba(28, 28, 31, 0.84);
  --pws-border: rgba(255, 255, 255, 0.08);
  --pws-selected: rgba(255, 255, 255, 0.09);
  --pws-ring: rgba(255, 255, 255, 0.16);
  --pws-fg: #f4f4f5;
  --pws-muted: #a1a1aa;
  --pws-thumb-border: rgba(255, 255, 255, 0.07);
  --pws-chip: rgba(24, 24, 27, 0.9);
  background: rgba(0, 0, 0, 0.4);
}
.pws-panel {
  display: flex; gap: 6px; padding: 10px; max-width: calc(100vw - 96px); box-sizing: border-box; overflow-x: auto;
  background: var(--pws-panel); border: 1px solid var(--pws-border); border-radius: 22px;
  backdrop-filter: blur(28px) saturate(1.4); -webkit-backdrop-filter: blur(28px) saturate(1.4);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.28), 0 2px 8px rgba(0, 0, 0, 0.12);
  scrollbar-width: none;
}
.pws-card {
  flex: 0 0 auto; width: var(--pws-w); padding: 8px 8px 10px; border-radius: 15px; cursor: default;
  transition: background-color 90ms ease;
}
.pws-card.pws-selected { background: var(--pws-selected); box-shadow: inset 0 0 0 1px var(--pws-ring); }
.pws-thumb {
  position: relative; width: var(--pws-w); height: var(--pws-h); overflow: hidden; border-radius: 9px;
  border: 1px solid var(--pws-thumb-border); box-sizing: border-box; background: var(--pws-surface);
}
.pws-canvas { display: block; width: 100%; height: 100%; }
.pws-placeholder {
  height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
  background: var(--pws-selected);
}
.pws-initial {
  width: 40px; height: 40px; border-radius: 11px; color: #fff; font-size: 19px; font-weight: 650;
  display: flex; align-items: center; justify-content: center;
}
.pws-placeholder-text { color: var(--pws-muted); font-size: 12px; max-width: 80%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pws-number {
  position: absolute; top: 6px; left: 6px; min-width: 18px; height: 18px; padding: 0 5px; box-sizing: border-box;
  border-radius: 6px; background: var(--pws-chip); color: var(--pws-muted); border: 1px solid var(--pws-border);
  font-size: 11px; font-weight: 600; line-height: 16px; text-align: center; font-variant-numeric: tabular-nums;
}
.pws-title { display: flex; align-items: center; gap: 7px; margin: 10px 2px 0; min-width: 0; }
.pws-name {
  color: var(--pws-fg); font-size: 14px; font-weight: 600; letter-spacing: -0.01em;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.pws-meta { display: flex; align-items: baseline; gap: 8px; margin: 3px 2px 0; font-size: 12px; min-width: 0; }
.pws-where { color: var(--pws-muted); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pws-diff { display: flex; gap: 4px; font-variant-numeric: tabular-nums; flex: 0 0 auto; }
.pws-add { color: #16a34a; }
.pws-del { color: #dc2626; }
.pws-dark .pws-add { color: #4ade80; }
.pws-dark .pws-del { color: #f87171; }
.pws-dot { flex: 0 0 auto; width: 8px; height: 8px; border-radius: 50%; }
.pws-running { background: #3b82f6; animation: pws-pulse 1.4s ease-in-out infinite; }
.pws-needs_input, .pws-attention { background: #f59e0b; }
.pws-failed { background: #ef4444; }
.pws-hint {
  color: var(--pws-fg); opacity: 0.75; font-size: 12px; padding: 5px 12px; border-radius: 999px;
  background: var(--pws-panel); border: 1px solid var(--pws-border);
}
.pws-empty-panel { color: var(--pws-muted); font-size: 13px; padding: 28px 40px; }
.pws-list .pws-panel {
  flex-direction: column; gap: 2px; padding: 6px; width: min(680px, calc(100vw - 32px)); max-width: none;
  max-height: calc(100vh - 140px); overflow-x: hidden; overflow-y: auto; border-radius: 18px;
}
.pws-row {
  display: grid; grid-template-columns: auto auto minmax(0, 1fr) auto; align-items: start; column-gap: 12px;
  width: auto; padding: 10px 12px; border-radius: 12px;
}
.pws-list .pws-number { position: static; margin-top: 1px; }
.pws-badge {
  width: 22px; height: 22px; border-radius: 7px; color: #fff; font-size: 12px; font-weight: 650;
  display: flex; align-items: center; justify-content: center;
}
.pws-main { min-width: 0; }
.pws-list .pws-name {
  display: block; font-size: 14px; line-height: 20px; white-space: normal; overflow: visible; text-overflow: clip; overflow-wrap: anywhere;
}
.pws-list .pws-meta { flex-wrap: wrap; gap: 2px 12px; margin: 3px 0 0; color: var(--pws-muted); line-height: 17px; }
.pws-part { white-space: nowrap; }
.pws-branch { white-space: normal; overflow-wrap: anywhere; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11.5px; }
.pws-pr { color: var(--pws-fg); }
.pws-pr-merged { color: #7c3aed; }
.pws-pr-closed { color: var(--pws-muted); }
.pws-dark .pws-pr-merged { color: #a78bfa; }
.pws-checks-success, .pws-approved { color: #16a34a; }
.pws-checks-failure, .pws-changes { color: #dc2626; }
.pws-checks-pending { color: #d97706; font-size: 9px; vertical-align: 1px; }
.pws-dark .pws-checks-success, .pws-dark .pws-approved { color: #4ade80; }
.pws-dark .pws-checks-failure, .pws-dark .pws-changes { color: #f87171; }
.pws-dark .pws-checks-pending { color: #fbbf24; }
.pws-list .pws-diff { display: inline-flex; }
.pws-side { text-align: right; font-size: 12px; line-height: 20px; white-space: nowrap; }
.pws-status { display: flex; align-items: center; justify-content: flex-end; gap: 6px; font-weight: 550; color: var(--pws-fg); }
.pws-status-needs_input, .pws-status-attention { color: #b45309; }
.pws-status-failed { color: #dc2626; }
.pws-dark .pws-status-needs_input, .pws-dark .pws-status-attention { color: #fbbf24; }
.pws-dark .pws-status-failed { color: #f87171; }
.pws-time { color: var(--pws-muted); font-variant-numeric: tabular-nums; line-height: 17px; margin-top: 3px; }
.pws-status + .pws-time { margin-top: 0; }
@media (max-width: 520px) {
  .pws-row { grid-template-columns: auto minmax(0, 1fr) auto; }
  .pws-badge { display: none; }
}
@keyframes pws-fade { from { opacity: 0; } }
@keyframes pws-pulse { 50% { opacity: 0.35; } }
@media (prefers-reduced-motion: reduce) {
  .pws-root, .pws-running { animation: none; }
}
`;
