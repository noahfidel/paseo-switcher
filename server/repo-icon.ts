// Finds a repository's icon on the daemon machine: an icon file in the repo, else the avatar of the
// GitHub account that owns its `origin` remote. Never throws; every failure is "no icon".
import { execFile } from "node:child_process";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, join, relative } from "node:path";

export interface RepoIcon {
  mimeType: "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/svg+xml" | "image/x-icon";
  dataBase64: string;
}

/** Icon files are refused above this, and so are avatars. */
export const MAX_REPO_ICON_BYTES = 64 * 1024;
/** How long an answer (including a definite "none") is kept, per project root and per GitHub owner. */
export const ICON_CACHE_MS = 24 * 60 * 60 * 1000;
/** How long a "none" from a passing failure (timeout, network, GitHub 5xx or rate limit) is kept. */
export const TRANSIENT_CACHE_MS = 5 * 60 * 1000;
export const AVATAR_TIMEOUT_MS = 3000;
/** Project roots kept in memory; the least recently asked goes first. */
export const MAX_CACHED_ROOTS = 200;

/*
 * The same search Paseo 0.15 runs for its own sidebar project icons (`getProjectIcon` in the daemon):
 * these names in priority order, priority directories first, then monorepo packages, then the root.
 */
export const ICON_PATTERNS = [
  "favicon.svg",
  "favicon.png",
  "favicon-*.svg",
  "favicon-*.png",
  "favico.svg",
  "favico.png",
  "icon.svg",
  "icon.png",
  "app-icon.svg",
  "app-icon.png",
  "apple-touch-icon.png",
  "apple-touch-icon-*.png",
  "icon-*.png",
  "android-chrome-*.png",
  "safari-pinned-tab.svg",
  "mstile-*.png",
  "logo.svg",
  "logo.png",
  "favicon.ico",
  "favico.ico",
];
const PRIORITY_DIRS = ["public", "static", "priv/static", "assets", "images", "img"];
const MONOREPO_DIRS = ["packages", "apps"];
const IGNORED_DIRS = new Set([".git", "node_modules", "dist", "build", ".next", ".nuxt", ".output", "coverage", ".cache", "vendor", "src", "lib", "test", "tests", "__tests__"]);
const MAX_DEPTH = 3;

async function list(dir: string): Promise<string[] | null> {
  try {
    return await readdir(dir);
  } catch {
    // Missing, not a directory, or not readable (macOS can refuse ~/Documents with EPERM).
    return null;
  }
}

async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function matches(name: string, pattern: string): boolean {
  if (!pattern.includes("*")) return name === pattern;
  const [head, tail] = pattern.split("*");
  return name.length > head.length + tail.length && name.startsWith(head) && name.endsWith(tail);
}

async function iconInDir(dir: string): Promise<string | null> {
  const entries = await list(dir);
  if (!entries) return null;
  for (const pattern of ICON_PATTERNS) {
    for (const entry of entries.filter((e) => matches(e, pattern)).sort()) {
      if (await isFile(join(dir, entry))) return join(dir, entry);
    }
  }
  return null;
}

/** This directory, then its subdirectories breadth-first in name order, down to `depth` more levels. */
async function searchDown(dir: string, depth: number): Promise<string | null> {
  const found = await iconInDir(dir);
  if (found || depth <= 0) return found;
  const entries = (await list(dir)) ?? [];
  for (const entry of entries.filter((e) => !IGNORED_DIRS.has(e)).sort()) {
    const path = join(dir, entry);
    if (!(await isDir(path))) continue;
    const hit = await searchDown(path, depth - 1);
    if (hit) return hit;
  }
  return null;
}

async function searchPriorityDirs(base: string): Promise<string | null> {
  for (const name of PRIORITY_DIRS) {
    const path = join(base, name);
    if (!(await isDir(path))) continue;
    const hit = await searchDown(path, MAX_DEPTH - 1);
    if (hit) return hit;
  }
  return null;
}

/** The path of the repo's icon file, or null. */
export async function findRepoIcon(root: string): Promise<string | null> {
  const priority = await searchPriorityDirs(root);
  if (priority) return priority;
  for (const mono of MONOREPO_DIRS) {
    const entries = await list(join(root, mono));
    for (const pkg of (entries ?? []).sort()) {
      const path = join(root, mono, pkg);
      if (!(await isDir(path))) continue;
      const hit = (await searchPriorityDirs(path)) ?? (await iconInDir(path));
      if (hit) return hit;
    }
  }
  return iconInDir(root);
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The image type from the bytes; extensions lie (many favicon.ico files are PNGs). */
function sniff(bytes: Buffer, path: string): RepoIcon["mimeType"] | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG)) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && bytes.toString("ascii", 0, 3) === "GIF") return "image/gif";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (bytes.length >= 6 && bytes.readUInt16LE(0) === 0 && bytes.readUInt16LE(2) === 1 && bytes.readUInt16LE(4) > 0) return "image/x-icon";
  if (extname(path).toLowerCase() === ".svg" && /<svg[\s>]/i.test(bytes.toString("utf8", 0, Math.min(bytes.length, 4096)))) return "image/svg+xml";
  return null;
}

/** The largest PNG frame of an ICO container, which every client can decode. */
function icoPngFrame(bytes: Buffer): Buffer | null {
  const count = bytes.readUInt16LE(4);
  let best: Buffer | null = null;
  let bestWidth = -1;
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 16;
    if (at + 16 > bytes.length) break;
    const width = bytes[at] === 0 ? 256 : bytes[at];
    const size = bytes.readUInt32LE(at + 8);
    const offset = bytes.readUInt32LE(at + 12);
    if (offset + size > bytes.length) continue;
    const frame = bytes.subarray(offset, offset + size);
    if (frame.length >= 8 && frame.subarray(0, 8).equals(PNG) && width > bestWidth) {
      best = frame;
      bestWidth = width;
    }
  }
  return best;
}

/** Width and height where the format says them cheaply; svg and ico are trusted to be square. */
function isSquare(bytes: Buffer, type: RepoIcon["mimeType"]): boolean {
  let size: [number, number] | null = null;
  if (type === "image/svg+xml" || type === "image/x-icon") return true;
  if (type === "image/png" && bytes.length >= 24) size = [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  if (type === "image/gif" && bytes.length >= 10) size = [bytes.readUInt16LE(6), bytes.readUInt16LE(8)];
  if (type === "image/jpeg") size = jpegSize(bytes);
  if (type === "image/webp" && bytes.length >= 30) {
    const chunk = bytes.toString("ascii", 12, 16);
    if (chunk === "VP8 ") size = [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff];
    if (chunk === "VP8L") {
      const bits = bytes.readUInt32LE(21);
      size = [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1];
    }
  }
  return Boolean(size && size[0] > 0 && size[0] === size[1]);
}

function jpegSize(bytes: Buffer): [number, number] | null {
  let at = 2;
  while (at < bytes.length - 8) {
    if (bytes[at] !== 0xff) {
      at++;
      continue;
    }
    const marker = bytes[at + 1];
    if (marker >= 0xc0 && marker <= 0xc2) return [bytes.readUInt16BE(at + 7), bytes.readUInt16BE(at + 5)];
    at += 2 + bytes.readUInt16BE(at + 2);
  }
  return null;
}

/** `path` is `root` or below it. Both are real paths. */
function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * Reads the repo's icon file: square, at most MAX_REPO_ICON_BYTES, with an ICO turned into its PNG frame.
 * The file's real path must stay inside the repo's, so a symlink cannot lead the read anywhere else.
 */
export async function readRepoIcon(root: string): Promise<RepoIcon | null> {
  try {
    const found = await findRepoIcon(root);
    if (!found) return null;
    const [realRoot, path] = await Promise.all([realpath(root), realpath(found)]);
    if (!isInside(realRoot, path) || (await stat(path)).size > MAX_REPO_ICON_BYTES) return null;
    let bytes: Buffer = await readFile(path);
    let type = sniff(bytes, path);
    if (type === "image/x-icon") {
      const frame = icoPngFrame(bytes);
      if (frame) {
        bytes = frame;
        type = "image/png";
      }
    }
    if (!type || !isSquare(bytes, type)) return null;
    return { mimeType: type, dataBase64: bytes.toString("base64") };
  } catch {
    return null;
  }
}

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

/** The GitHub account in an `origin` URL (https, ssh or scp form), or null for any other host. */
export function githubOwnerFromRemote(remote: string | null | undefined): string | null {
  const url = remote?.trim();
  if (!url) return null;
  const match = /^(?:https?:\/\/(?:[^@/\s]+@)?|ssh:\/\/(?:[^@/\s]+@)?|git@)github\.com[:/]([^/\s]+)\/[^/\s]+$/i.exec(url);
  const owner = match?.[1];
  return owner && OWNER.test(owner) ? owner : null;
}

/** `git config --get remote.origin.url` in the repo, or null. */
export function readOriginRemote(root: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("git", ["-C", root, "config", "--get", "remote.origin.url"], { timeout: AVATAR_TIMEOUT_MS }, (error, stdout) => {
      resolve(error ? null : String(stdout).trim() || null);
    });
  });
}

type Fetch = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;
const AVATAR_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** An icon, or none; `retry` when "none" may be a passing failure (a timeout, the network, GitHub's 5xx or rate limit). */
export interface IconAnswer {
  icon: RepoIcon | null;
  retry: boolean;
}

const NONE: IconAnswer = { icon: null, retry: false };
const TRY_LATER: IconAnswer = { icon: null, retry: true };

async function fetchAvatar(owner: string, fetch: Fetch, timeoutMs: number): Promise<IconAnswer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // No token: the public avatar of the account, which redirects to avatars.githubusercontent.com.
    const response = await fetch(`https://github.com/${owner}.png?size=64`, { signal: controller.signal });
    // A 404 (no such account) or a 4xx other than a rate limit is definite; the rest may pass.
    if (!response.ok) return response.status >= 500 || response.status === 429 || response.status === 408 ? TRY_LATER : NONE;
    const type = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
    if (!AVATAR_TYPES.has(type)) return NONE;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_REPO_ICON_BYTES) return NONE;
    return { icon: { mimeType: type as RepoIcon["mimeType"], dataBase64: bytes.toString("base64") }, retry: false };
  } catch {
    return TRY_LATER;
  } finally {
    clearTimeout(timer);
  }
}

export interface ProjectIconResolver {
  /** The icon and whether "none" is worth asking again soon. A root `isKnownRoot` does not vouch for gets none, to retry. */
  resolve(root: string, options?: { isKnownRoot?: (root: string) => Promise<boolean> }): Promise<IconAnswer>;
  /** The icon alone. */
  get(root: string, options?: { isKnownRoot?: (root: string) => Promise<boolean> }): Promise<RepoIcon | null>;
}

/**
 * Icons per project root and avatars per GitHub owner, each kept in memory for ICON_CACHE_MS (answers of
 * "none" too), with one lookup in flight per root and per owner. At most `maxRoots` roots are kept.
 */
export function createProjectIconResolver(options: {
  fetch?: Fetch;
  readRemote?: (root: string) => Promise<string | null>;
  now?: () => number;
  timeoutMs?: number;
  maxRoots?: number;
} = {}): ProjectIconResolver {
  const fetch = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const readRemote = options.readRemote ?? readOriginRemote;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? AVATAR_TIMEOUT_MS;
  const maxRoots = options.maxRoots ?? MAX_CACHED_ROOTS;
  type Entry = { at: number; ttl: number; value: Promise<IconAnswer> };
  const roots = new Map<string, Entry>();
  const owners = new Map<string, Entry>();

  function cached(map: Map<string, Entry>, key: string, load: () => Promise<IconAnswer>, max = Infinity): Promise<IconAnswer> {
    const hit = map.get(key);
    if (hit && now() - hit.at <= hit.ttl) {
      // Most recently asked last, so the first key is the one to drop.
      map.delete(key);
      map.set(key, hit);
      return hit.value;
    }
    const entry: Entry = { at: now(), ttl: ICON_CACHE_MS, value: Promise.resolve(TRY_LATER) };
    entry.value = load()
      .catch(() => TRY_LATER)
      .then((answer) => {
        // A passing failure is kept only briefly.
        if (answer.retry) entry.ttl = TRANSIENT_CACHE_MS;
        return answer;
      });
    map.delete(key);
    map.set(key, entry);
    while (map.size > max) map.delete(map.keys().next().value as string);
    return entry.value;
  }

  async function lookup(root: string): Promise<IconAnswer> {
    const own = await readRepoIcon(root);
    if (own) return { icon: own, retry: false };
    let remote: string | null = null;
    try {
      remote = await readRemote(root);
    } catch {
      return TRY_LATER;
    }
    const owner = githubOwnerFromRemote(remote);
    return owner ? cached(owners, owner.toLowerCase(), () => fetchAvatar(owner, fetch, timeoutMs)) : NONE;
  }

  async function resolve(root: string, { isKnownRoot }: { isKnownRoot?: (root: string) => Promise<boolean> } = {}): Promise<IconAnswer> {
    if (typeof root !== "string" || !isAbsolute(root)) return NONE;
    // Not listed yet (a project added a moment ago, say): nothing is read or cached, and the client asks again.
    if (isKnownRoot && !(await isKnownRoot(root).catch(() => false))) return TRY_LATER;
    return cached(roots, root, () => lookup(root), maxRoots);
  }

  return {
    resolve,
    async get(root, options) {
      return (await resolve(root, options)).icon;
    },
  };
}
