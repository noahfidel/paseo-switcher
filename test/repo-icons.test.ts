import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { createKnownRoots, paseoRoots } from "../server/known-roots.ts";
import {
  ICON_CACHE_MS,
  ICON_PATTERNS,
  MAX_CACHED_ROOTS,
  TRANSIENT_CACHE_MS,
  MAX_REPO_ICON_BYTES,
  createProjectIconResolver,
  findRepoIcon,
  githubOwnerFromRemote,
  readRepoIcon,
} from "../server/repo-icon.ts";
import * as contracts from "../shared/icons.ts";
import { projectIcon } from "../shared/icons.ts";
import {
  DEFAULT_REPO_ICONS,
  REPO_ICON_RETRY_MS,
  REPO_ICON_TTL_MS,
  parseRepoIcons,
  repoIconKey,
  repoIconRoots,
  repoIconTtl,
  repoIconUrl,
  safeImageUrl,
  type Card,
} from "../client/model.ts";

const dirs: string[] = [];
async function repo(files: Record<string, string | Buffer>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pws-repo-"));
  dirs.push(dir);
  for (const [path, body] of Object.entries(files)) {
    await mkdir(join(dir, path, ".."), { recursive: true });
    await writeFile(join(dir, path), body);
  }
  return dir;
}
after(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

function png(width: number, height: number, extra = 0): Buffer {
  const b = Buffer.alloc(33 + extra);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>';

// ---- the RPC contract ------------------------------------------------------------------------

test("every RPC contract in shared/ has a valid name and round-trips its schemas", () => {
  const all = Object.values(contracts).filter((c): c is typeof projectIcon => Boolean(c && typeof c === "object" && "name" in c && "input" in c));
  assert.ok(all.length >= 1);
  for (const c of all) assert.match(c.name, /^[a-z][a-z0-9._-]*$/);
  assert.equal(projectIcon.name, "icons.project");
  assert.deepEqual(projectIcon.input.parse({ rootPath: "/a" }), { rootPath: "/a" });
  assert.deepEqual(projectIcon.output.parse({ icon: null }), { icon: null });
  assert.deepEqual(projectIcon.output.parse({ icon: { mimeType: "image/png", dataBase64: "AAAA" } }), { icon: { mimeType: "image/png", dataBase64: "AAAA" } });
  assert.throws(() => projectIcon.output.parse({ icon: { mimeType: "text/html", dataBase64: "AAAA" } }));
});

// ---- icon files in the repo ------------------------------------------------------------------

test("the candidate list matches Paseo's own, svg and png before ico", () => {
  assert.equal(ICON_PATTERNS[0], "favicon.svg");
  assert.ok(ICON_PATTERNS.indexOf("logo.png") < ICON_PATTERNS.indexOf("favicon.ico"));
  assert.equal(ICON_PATTERNS[ICON_PATTERNS.length - 1], "favico.ico");
});

test("findRepoIcon searches the priority directories before the root", async () => {
  const dir = await repo({ "logo.svg": SVG, "public/favicon.png": png(32, 32) });
  assert.equal(await findRepoIcon(dir), join(dir, "public/favicon.png"));
});

test("findRepoIcon finds a monorepo package's icon and skips ignored directories", async () => {
  const dir = await repo({ "node_modules/x/favicon.svg": SVG, "apps/web/public/icon.svg": SVG });
  assert.equal(await findRepoIcon(dir), join(dir, "apps/web/public/icon.svg"));
});

test("findRepoIcon returns null for a missing or empty directory", async () => {
  assert.equal(await findRepoIcon(join(tmpdir(), "pws-does-not-exist-123")), null);
  assert.equal(await findRepoIcon(await repo({ "README.md": "hi" })), null);
});

test("readRepoIcon reads a square png and an svg, with their types", async () => {
  const a = await repo({ "favicon.png": png(16, 16) });
  assert.deepEqual(await readRepoIcon(a), { mimeType: "image/png", dataBase64: png(16, 16).toString("base64") });
  const b = await repo({ "icon.svg": SVG });
  assert.deepEqual(await readRepoIcon(b), { mimeType: "image/svg+xml", dataBase64: Buffer.from(SVG).toString("base64") });
});

test("readRepoIcon refuses non-square images, files over the cap, and svg that is not svg", async () => {
  assert.equal(await readRepoIcon(await repo({ "favicon.png": png(32, 16) })), null);
  assert.equal(await readRepoIcon(await repo({ "favicon.png": png(16, 16, MAX_REPO_ICON_BYTES) })), null);
  assert.equal(await readRepoIcon(await repo({ "favicon.svg": "<html>nope</html>" })), null);
  assert.equal(MAX_REPO_ICON_BYTES, 64 * 1024);
});

test("readRepoIcon serves an ico's largest png frame as png", async () => {
  const frame = png(32, 32);
  const ico = Buffer.alloc(6 + 16 + frame.length);
  ico.writeUInt16LE(0, 0);
  ico.writeUInt16LE(1, 2);
  ico.writeUInt16LE(1, 4);
  ico[6] = 32;
  ico[7] = 32;
  ico.writeUInt32LE(frame.length, 6 + 8);
  ico.writeUInt32LE(22, 6 + 12);
  frame.copy(ico, 22);
  assert.deepEqual(await readRepoIcon(await repo({ "favicon.ico": ico })), { mimeType: "image/png", dataBase64: frame.toString("base64") });
});

// ---- GitHub owners -----------------------------------------------------------------------------

test("githubOwnerFromRemote reads the owner from GitHub remotes only", () => {
  assert.equal(githubOwnerFromRemote("git@github.com:tomgrin10/paseo-switcher.git"), "tomgrin10");
  assert.equal(githubOwnerFromRemote("https://github.com/getpaseo/paseo"), "getpaseo");
  assert.equal(githubOwnerFromRemote("https://user:tok@github.com/Acme-Co/repo.git\n"), "Acme-Co");
  assert.equal(githubOwnerFromRemote("ssh://git@github.com/acme/repo.git"), "acme");
  assert.equal(githubOwnerFromRemote("git@gitlab.com:acme/repo.git"), null);
  assert.equal(githubOwnerFromRemote("https://github.com.evil.com/acme/repo"), null);
  assert.equal(githubOwnerFromRemote("https://evil.com/github.com/acme/repo"), null);
  assert.equal(githubOwnerFromRemote("https://github.com/-bad/repo"), null);
  assert.equal(githubOwnerFromRemote(""), null);
});

// ---- the resolver: order, caching, failures --------------------------------------------------------

function fakeFetch(body: Buffer | null, type = "image/png") {
  const calls: string[] = [];
  const fetch = async (url: string, init?: { signal?: AbortSignal }) => {
    calls.push(url);
    if (!body) throw new Error("offline");
    void init;
    return new Response(new Uint8Array(body), { status: 200, headers: { "content-type": type } });
  };
  return { fetch, calls };
}

test("the resolver prefers a repo icon and never asks GitHub then", async () => {
  const dir = await repo({ "favicon.svg": SVG });
  const { fetch, calls } = fakeFetch(png(64, 64));
  const r = createProjectIconResolver({ fetch, readRemote: async () => "git@github.com:acme/x.git" });
  assert.equal((await r.get(dir))?.mimeType, "image/svg+xml");
  assert.deepEqual(calls, []);
});

test("the resolver falls back to the GitHub owner avatar, once per owner per day", async () => {
  const a = await repo({});
  const b = await repo({});
  const { fetch, calls } = fakeFetch(png(64, 64));
  let now = 1_000;
  const r = createProjectIconResolver({ fetch, readRemote: async () => "https://github.com/acme/x", now: () => now });
  assert.deepEqual(await r.get(a), { mimeType: "image/png", dataBase64: png(64, 64).toString("base64") });
  await r.get(b);
  await r.get(a);
  assert.deepEqual(calls, ["https://github.com/acme.png?size=64"]);
  now += 24 * 60 * 60 * 1000 + 1;
  await r.get(b);
  assert.equal(calls.length, 2);
});

test("the resolver shares one lookup between concurrent requests for a root", async () => {
  const dir = await repo({});
  const { fetch, calls } = fakeFetch(png(64, 64));
  let remotes = 0;
  const r = createProjectIconResolver({ fetch, readRemote: async () => (remotes++, "https://github.com/acme/x") });
  await Promise.all([r.get(dir), r.get(dir), r.get(dir)]);
  assert.equal(remotes, 1);
  assert.equal(calls.length, 1);
});

test("the resolver returns null, without throwing, for non-GitHub remotes, failures and refusals", async () => {
  const dir = await repo({});
  const gitlab = fakeFetch(png(64, 64));
  assert.equal(await createProjectIconResolver({ fetch: gitlab.fetch, readRemote: async () => "git@gitlab.com:a/b.git" }).get(dir), null);
  assert.deepEqual(gitlab.calls, []);
  const offline = fakeFetch(null);
  assert.equal(await createProjectIconResolver({ fetch: offline.fetch, readRemote: async () => "git@github.com:a/b.git" }).get(dir), null);
  const html = fakeFetch(Buffer.from("<html>"), "text/html");
  assert.equal(await createProjectIconResolver({ fetch: html.fetch, readRemote: async () => "git@github.com:a/b.git" }).get(dir), null);
  const huge = fakeFetch(Buffer.alloc(MAX_REPO_ICON_BYTES + 1));
  assert.equal(await createProjectIconResolver({ fetch: huge.fetch, readRemote: async () => "git@github.com:a/b.git" }).get(dir), null);
  const throwsRemote = createProjectIconResolver({ fetch: gitlab.fetch, readRemote: async () => { throw Object.assign(new Error("EPERM"), { code: "EPERM" }); } });
  assert.equal(await throwsRemote.get(dir), null);
  assert.equal(await createProjectIconResolver({ fetch: gitlab.fetch, readRemote: async () => null }).get("relative/path"), null);
});

test("the resolver gives up on a slow avatar after its timeout", async () => {
  const dir = await repo({});
  const fetch = (_url: string, init?: { signal?: AbortSignal }) =>
    new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
  const r = createProjectIconResolver({ fetch, readRemote: async () => "git@github.com:a/b.git", timeoutMs: 20 });
  assert.equal(await r.get(dir), null);
});

// ---- transient failures are retried soon, definite answers kept a day ---------------------------------

function statusFetch(status: number) {
  const calls: string[] = [];
  const fetch = async (url: string) => {
    calls.push(url);
    return new Response(status === 200 ? new Uint8Array(png(64, 64)) : "nope", { status, headers: { "content-type": status === 200 ? "image/png" : "text/plain" } });
  };
  return { fetch, calls };
}

test("a definite 'no icon' (no GitHub remote, a 404, not an image) is kept for a day and not marked for retry", async () => {
  for (const [remote, fetcher] of [
    [null, statusFetch(200)],
    ["git@gitlab.com:a/b.git", statusFetch(200)],
    ["git@github.com:a/b.git", statusFetch(404)],
    ["git@github.com:a/b.git", fakeFetch(Buffer.from("<html>"), "text/html")],
  ] as const) {
    const dir = await repo({});
    let now = 0;
    let remotes = 0;
    const r = createProjectIconResolver({ fetch: fetcher.fetch, readRemote: async () => (remotes++, remote), now: () => now });
    assert.deepEqual(await r.resolve(dir), { icon: null, retry: false });
    now += ICON_CACHE_MS - 1;
    await r.resolve(dir);
    assert.equal(remotes, 1, String(remote));
  }
});

test("a timeout, network error, 5xx or rate limit is retried after a few minutes, not a day", async () => {
  const offline = fakeFetch(null);
  const slow = (_url: string, init?: { signal?: AbortSignal }) =>
    new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
  for (const fetch of [statusFetch(500).fetch, statusFetch(503).fetch, statusFetch(429).fetch, offline.fetch, slow]) {
    const dir = await repo({});
    let now = 0;
    let remotes = 0;
    const r = createProjectIconResolver({ fetch, readRemote: async () => (remotes++, "git@github.com:a/b.git"), now: () => now, timeoutMs: 20 });
    assert.deepEqual(await r.resolve(dir), { icon: null, retry: true });
    now += TRANSIENT_CACHE_MS - 1;
    await r.resolve(dir);
    assert.equal(remotes, 1);
    now += 2;
    await r.resolve(dir);
    assert.equal(remotes, 2);
  }
  assert.ok(TRANSIENT_CACHE_MS <= 5 * 60 * 1000);
});

test("a git error reading the remote, or a root Paseo does not list, is marked for retry", async () => {
  const dir = await repo({});
  const failing = createProjectIconResolver({ readRemote: async () => { throw new Error("timeout"); } });
  assert.deepEqual(await failing.resolve(dir), { icon: null, retry: true });
  const r = createProjectIconResolver({ readRemote: async () => null });
  assert.deepEqual(await r.resolve(dir, { isKnownRoot: async () => false }), { icon: null, retry: true });
});

test("the RPC output may say to ask again soon", () => {
  assert.deepEqual(projectIcon.output.parse({ icon: null, retry: true }), { icon: null, retry: true });
});

// ---- only Paseo's own project roots, and nothing outside them ----------------------------------------

test("readRepoIcon refuses an icon that is a symlink, or sits in a symlinked directory, pointing out of the repo", async () => {
  const outside = await repo({ "favicon.svg": SVG, "public/icon.svg": SVG });
  const file = await repo({});
  await symlink(join(outside, "favicon.svg"), join(file, "favicon.svg"));
  assert.equal(await readRepoIcon(file), null);
  const dir = await repo({});
  await symlink(join(outside, "public"), join(dir, "public"));
  assert.equal(await readRepoIcon(dir), null);
  // A link that stays inside the repo is fine, and so is a root reached through a symlink (macOS's /var).
  const inside = await repo({ "assets/logo.svg": SVG });
  await symlink(join(inside, "assets/logo.svg"), join(inside, "favicon.svg"));
  assert.equal((await readRepoIcon(inside))?.mimeType, "image/svg+xml");
  const linkedRoot = join(await repo({}), "link");
  await symlink(inside, linkedRoot);
  assert.equal((await readRepoIcon(linkedRoot))?.mimeType, "image/svg+xml");
});

test("the resolver answers only for roots Paseo knows, and does not cache the others", async () => {
  const dir = await repo({ "favicon.svg": SVG });
  let remotes = 0;
  let asked = 0;
  const r = createProjectIconResolver({ readRemote: async () => (remotes++, null) });
  const unknown = async () => (asked++, false);
  assert.equal(await r.get(dir, { isKnownRoot: unknown }), null);
  assert.equal(await r.get(dir, { isKnownRoot: unknown }), null);
  assert.equal(asked, 2);
  assert.equal(remotes, 0);
  assert.equal((await r.get(dir, { isKnownRoot: async () => true }))?.mimeType, "image/svg+xml");
  // A check that throws counts as unknown.
  assert.equal(await r.get(await repo({ "favicon.svg": SVG }), { isKnownRoot: async () => { throw new Error("down"); } }), null);
});

test("the resolver keeps at most maxRoots roots, dropping the least recently asked", async () => {
  const [a, b, c] = [await repo({}), await repo({}), await repo({})];
  const seen: string[] = [];
  const r = createProjectIconResolver({ readRemote: async (root) => (seen.push(root), null), maxRoots: 2 });
  await r.get(a);
  await r.get(b);
  await r.get(a);
  await r.get(c);
  await r.get(a);
  await r.get(b);
  assert.deepEqual(seen, [a, b, c, b]);
  assert.equal(MAX_CACHED_ROOTS, 200);
});

test("known roots are Paseo's project roots and workspace directories, listed at most every few seconds", async () => {
  let lists = 0;
  let roots = ["/p/one", "/w/two"];
  let now = 0;
  const known = createKnownRoots({ now: () => now, minIntervalMs: 10_000 });
  const list = async () => (lists++, roots);
  assert.equal(await known.has("/p/one", list), true);
  assert.equal(await known.has("/w/two", list), true);
  assert.equal(lists, 1);
  // A miss lists again, but not more often than the interval.
  roots = [...roots, "/p/new"];
  assert.equal(await known.has("/p/new", list), false);
  assert.equal(lists, 1);
  now += 10_001;
  assert.equal(await known.has("/p/new", list), true);
  assert.equal(lists, 2);
  // A failed listing keeps the previous roots.
  now += 10_001;
  assert.equal(await known.has("/p/other", async () => { throw new Error("down"); }), false);
  assert.equal(await known.has("/p/one", list), true);
});

test("paseoRoots collects project roots and workspace directories, and survives a failing call", async () => {
  const paseo = {
    projects: { list: async () => ({ projects: [{ projectRootPath: "/p/a" }, { projectRootPath: "" }] }) },
    workspaces: { list: async () => ({ entries: [{ projectRootPath: "/p/a", directory: "/w/a-wt" }, { projectRootPath: "/p/b", directory: "/p/b" }] }) },
  };
  assert.deepEqual((await paseoRoots(paseo)).sort(), ["/p/a", "/p/b", "/w/a-wt"]);
  const broken = { projects: { list: async () => { throw new Error("x"); } }, workspaces: paseo.workspaces };
  assert.deepEqual((await paseoRoots(broken)).sort(), ["/p/a", "/p/b", "/w/a-wt"]);
});

// ---- client side ---------------------------------------------------------------------------------

test("repoIconUrl builds a data URL only for allowed image types", () => {
  assert.equal(repoIconUrl({ mimeType: "image/png", dataBase64: "iVBO" }), "data:image/png;base64,iVBO");
  assert.equal(repoIconUrl({ mimeType: "image/svg+xml", dataBase64: "PHN2Zz4=" }), "data:image/svg+xml;base64,PHN2Zz4=");
  assert.equal(repoIconUrl({ mimeType: "image/x-icon", dataBase64: "AAAB" }), "data:image/x-icon;base64,AAAB");
  assert.equal(repoIconUrl({ mimeType: "text/html", dataBase64: "AAAA" }), null);
  assert.equal(repoIconUrl({ mimeType: "image/png", dataBase64: "not base64!" }), null);
  assert.equal(repoIconUrl(null), null);
  // svg and ico data URLs are allowed only where asked for (an img), never by default.
  assert.equal(safeImageUrl("data:image/svg+xml;base64,PHN2Zz4="), null);
  assert.equal(safeImageUrl("data:image/svg+xml;base64,PHN2Zz4=", { svg: true }), "data:image/svg+xml;base64,PHN2Zz4=");
});

const ws = (id: string, projectRoot?: string): Card => ({
  key: `s:${id}`,
  serverId: "s",
  workspaceId: id,
  info: { id, name: id, project: "p", branch: null, status: "done", additions: 0, deletions: 0, activityAt: 0, projectRoot },
});

test("repoIconRoots asks once per project root for what is on show and not cached or pending", () => {
  const cards: Card[] = [ws("a", "/r1"), ws("b", "/r1"), ws("c", "/r2"), ws("d"), ws("e", "/r3"), { key: "plugin-screen|x|y|z", serverId: "x", workspaceId: "", info: null }];
  const cache = new Map([[repoIconKey("s", "/r3"), { url: null, at: 100 }]]);
  assert.deepEqual(repoIconRoots(cards, cache, new Set([repoIconKey("s", "/r2")]), 200, "s"), ["/r1"]);
  // A cached answer is asked again after a day.
  assert.deepEqual(repoIconRoots([ws("e", "/r3")], cache, new Set(), 100 + 24 * 60 * 60 * 1000 + 1, "s"), ["/r3"]);
});

test("repo icons are kept per host, and asked only of the host this window shows", () => {
  assert.notEqual(repoIconKey("s", "/r"), repoIconKey("t", "/r"));
  assert.notEqual(repoIconKey("a:b", "c"), repoIconKey("a", "b:c"));
  const other: Card = { ...ws("x", "/r1"), key: "t:x", serverId: "t" };
  // The same path on another host is a different project and is not asked of this one.
  const cache = new Map([[repoIconKey("t", "/r1"), { url: "data:image/png;base64,iVBO", at: 100 }]]);
  assert.deepEqual(repoIconRoots([ws("a", "/r1"), other], cache, new Set(), 200, "s"), ["/r1"]);
  assert.deepEqual(repoIconRoots([other], new Map(), new Set(), 200, "s"), []);
  assert.deepEqual(repoIconRoots([ws("a", "/r1")], new Map(), new Set(), 200, null), []);
});

test("repoIconRoots asks again after a minute when the last answer failed or said to retry", () => {
  const cache = new Map([[repoIconKey("s", "/r3"), { url: null, at: 100, ttl: REPO_ICON_RETRY_MS }]]);
  assert.deepEqual(repoIconRoots([ws("e", "/r3")], cache, new Set(), 100 + REPO_ICON_RETRY_MS, "s"), []);
  assert.deepEqual(repoIconRoots([ws("e", "/r3")], cache, new Set(), 100 + REPO_ICON_RETRY_MS + 1, "s"), ["/r3"]);
  assert.equal(REPO_ICON_RETRY_MS, 60_000);
});

test("repoIconTtl keeps an answer a day, and a failure or a retry answer a minute", () => {
  assert.equal(repoIconTtl({ icon: null }), REPO_ICON_TTL_MS);
  assert.equal(repoIconTtl({ icon: { mimeType: "image/png", dataBase64: "iVBO" } }), REPO_ICON_TTL_MS);
  assert.equal(repoIconTtl({ icon: null, retry: true }), REPO_ICON_RETRY_MS);
  assert.equal(repoIconTtl(null), REPO_ICON_RETRY_MS);
});

test("the Repo icons setting is on by default", () => {
  assert.equal(DEFAULT_REPO_ICONS, true);
  assert.equal(parseRepoIcons(undefined), true);
  assert.equal(parseRepoIcons(false), false);
  assert.equal(parseRepoIcons("no"), true);
});
