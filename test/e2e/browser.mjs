// Shared setup for the browser scripts: serve Paseo's web UI locally and log a fresh browser in.

import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";

export const PORT = Number(process.env.E2E_PORT ?? 8787);
/**
 * Set E2E_ORIGIN to a daemon that serves its own web UI (an isolated test daemon with the web UI
 * enabled, say) to use it directly instead of serving the installed CLI's copy on PORT.
 */
export const ORIGIN = process.env.E2E_ORIGIN ?? `http://127.0.0.1:${PORT}`;
/** Written by the running daemon; local clients can authenticate with it instead of the password. */
const CREDENTIAL = join(process.env.PASEO_HOME ?? join(homedir(), ".paseo"), "local-credential");

// ---- the web UI, served from the installed Paseo CLI -------------------------------------------

export function findWebUi() {
  if (process.env.PASEO_WEB_UI) return process.env.PASEO_WEB_UI;
  const bin = realpathSync(execFileSync("which", ["paseo"]).toString().trim());
  const dir = resolve(dirname(bin), "../node_modules/@getpaseo/server/dist/server/web-ui");
  if (!existsSync(join(dir, "index.html"))) throw new Error(`Paseo web UI not found at ${dir}; set PASEO_WEB_UI`);
  return dir;
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".ico": "image/x-icon", ".svg": "image/svg+xml", ".ttf": "font/ttf", ".woff2": "font/woff2" };
/** Serves the web UI on PORT, unless E2E_ORIGIN points at a daemon that serves it. Resolves to a closable server. */
export async function startWebUi() {
  if (process.env.E2E_ORIGIN) return { close() {} };
  return serve(findWebUi());
}

/** `paseo` arguments for the daemon under test: PASEO_HOME selects an isolated one. */
export function paseoArgs(...args) {
  return process.env.PASEO_HOME ? ["--home", process.env.PASEO_HOME, ...args] : args;
}

export function serve(root) {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, ORIGIN).pathname);
    let file = join(root, path);
    if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) file = join(root, "index.html");
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok, fail) => server.once("error", fail).listen(PORT, "127.0.0.1", () => ok(server)));
}

// ---- connecting a fresh browser to the daemon ------------------------------------------------------

/**
 * The web UI greets the daemon with a hello message, and a password-protected daemon rejects a
 * fresh browser's hello. The desktop app avoids that by sending the daemon's local credential, a
 * token the daemon writes to ~/.paseo/local-credential at startup. Do the same here: patch
 * WebSocket.send in the page to add that token to hello messages sent to a local daemon. It runs
 * in the page, not through a proxy, so it adds no latency to the performance checks.
 */
export async function authenticate(context) {
  if (!existsSync(CREDENTIAL)) throw new Error(`No daemon credential at ${CREDENTIAL}. Is the Paseo daemon running?`);
  const token = readFileSync(CREDENTIAL, "utf8").trim();
  await context.addInitScript((token) => {
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      if (typeof data === "string" && data.startsWith('{"type":"hello"') && /^wss?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(this.url)) {
        const hello = JSON.parse(data);
        if (!hello.auth) data = JSON.stringify({ ...hello, auth: { kind: "localCredential", token } });
      }
      return send.call(this, data);
    };
  }, token);
}
