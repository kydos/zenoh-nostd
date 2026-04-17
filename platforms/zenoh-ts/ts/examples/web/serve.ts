#!/usr/bin/env -S deno run --allow-net --allow-read --allow-env
//
// Static file server + WebSocket proxy for the Zenoh web demo.
//
// Local usage (from ts/):
//   deno run --allow-net --allow-read --allow-env examples/web/serve.ts
//   Opens http://localhost:8000/examples/web/  — connects directly to
//   a Zenoh router at ws/127.0.0.1:7447.
//
// Public address (e.g. zenoh.mysite.me) — single open port:
//   HOST=zenoh.mysite.me PORT=8000 \
//     deno run --allow-net --allow-read --allow-env examples/web/serve.ts
//
//   The server proxies incoming WebSocket connections to 127.0.0.1:7447
//   so only port 8000 needs to be open in the firewall.  zenohd must be
//   listening on ws/127.0.0.1:7447 (its default).  The default router
//   locator shown in index.html is rewritten to ws/HOST:PORT automatically.
//

const PORT = parseInt(Deno.env.get("PORT") ?? "8000");
// When HOST is set the server activates the WebSocket proxy and patches
// index.html to use ws/HOST:PORT as the default router locator.
const HOST = Deno.env.get("HOST") ?? "";

// Serve from the ts/ root so that the relative import ../../pkg/ inside
// index.html resolves correctly at http://localhost:<PORT>/pkg/…
const ROOT = new URL("../../", import.meta.url).pathname;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".ts":   "application/javascript; charset=utf-8",
  ".wasm": "application/wasm",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json",
  ".map":  "application/json",
};

function extOf(path: string): string {
  const i = path.lastIndexOf(".");
  return i >= 0 ? path.slice(i) : "";
}

// ── WebSocket proxy ───────────────────────────────────────────────────────────
//
// When HOST is set, WebSocket upgrade requests are proxied transparently to
// the local Zenoh router at 127.0.0.1:7447.  This avoids opening a second
// firewall port: the browser connects to ws/HOST:PORT and the server relays
// binary frames to/from zenohd on localhost.

function proxyWebSocket(req: Request): Response {
  const { socket: client, response } = Deno.upgradeWebSocket(req);
  const router = new WebSocket("ws://127.0.0.1:7447");
  router.binaryType = "arraybuffer";

  client.onmessage = (e) => { if (router.readyState === WebSocket.OPEN) router.send(e.data); };
  router.onmessage = (e) => { if (client.readyState === WebSocket.OPEN) client.send(e.data); };
  client.onclose   = () => { try { router.close(); } catch { /* ignore */ } };
  router.onclose   = () => { try { client.close(); } catch { /* ignore */ } };
  client.onerror   = () => { try { router.close(); } catch { /* ignore */ } };
  router.onerror   = () => { try { client.close(); } catch { /* ignore */ } };

  return response;
}

// ── HTTP handler ──────────────────────────────────────────────────────────────

async function handler(req: Request): Promise<Response> {
  // Proxy WebSocket upgrades to the local Zenoh router when HOST is set.
  if (HOST && req.headers.get("upgrade") === "websocket") {
    return proxyWebSocket(req);
  }

  const url  = new URL(req.url);
  let   path = decodeURIComponent(url.pathname);

  // Serve index.html for directory-style requests.
  if (path.endsWith("/")) path += "index.html";

  const filePath = ROOT + path.replace(/^\//, "");

  try {
    const mime = MIME[extOf(filePath)] ?? "application/octet-stream";

    // When HOST is set, patch the default router locator so the browser
    // connects to the WS proxy on the same host/port as the static files.
    if (HOST && filePath.endsWith("index.html")) {
      let html = await Deno.readTextFile(filePath);
      html = html.replace(
        'value="ws/127.0.0.1:7447"',
        `value="ws/${HOST}:${PORT}"`,
      );
      return new Response(html, { headers: { "Content-Type": mime } });
    }

    const data = await Deno.readFile(filePath);
    return new Response(data, { headers: { "Content-Type": mime } });
  } catch {
    return new Response(`404 Not Found: ${path}`, { status: 404 });
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────

Deno.serve(
  {
    port: PORT,
    hostname: "0.0.0.0",
    onListen({ port }) {
      const displayHost = HOST || "localhost";
      const locator     = HOST
        ? `ws/${HOST}:${port}  (proxied → 127.0.0.1:7447)`
        : `ws/127.0.0.1:7447  (direct)`;
      console.log(`Serving  ${ROOT}`);
      console.log(`Open  →  http://${displayHost}:${port}/examples/web/`);
      console.log(`Router   ${locator}`);
    },
  },
  handler,
);
