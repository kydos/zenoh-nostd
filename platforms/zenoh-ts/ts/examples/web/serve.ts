#!/usr/bin/env -S deno run --allow-net --allow-read --allow-env
//
// Minimal static file server for the Zenoh web demo.
//
// Usage (from ts/):
//   deno run --allow-net --allow-read --allow-env examples/web/serve.ts
//
// Custom port:
//   PORT=9090 deno run --allow-net --allow-read --allow-env examples/web/serve.ts
//
// Public address (e.g. zenoh.corsaro.me):
//   HOST=0.0.0.0 PORT=8000 deno run --allow-net --allow-read --allow-env examples/web/serve.ts
//   Then point DNS for zenoh.corsaro.me to this machine and open the firewall on PORT.
//   The page auto-detects window.location.hostname and defaults the router locator to
//   ws/zenoh.corsaro.me:7447 — make sure zenohd is also listening on ws/0.0.0.0:7447.
//

const PORT     = parseInt(Deno.env.get("PORT") ?? "8000");
// Bind address: set HOST=0.0.0.0 to accept on all interfaces (default),
// or HOST=zenoh.corsaro.me / a specific IP to restrict to one interface.
const HOST     = Deno.env.get("HOST") ?? "0.0.0.0";
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

async function handler(req: Request): Promise<Response> {
    const url  = new URL(req.url);
    let   path = decodeURIComponent(url.pathname);

    // Serve index.html for directory-style requests.
    if (path.endsWith("/")) path += "index.html";

    const filePath = ROOT + path.replace(/^\//, "");

    try {
        const data = await Deno.readFile(filePath);
        const mime = MIME[extOf(filePath)] ?? "application/octet-stream";
        return new Response(data, {
            headers: { "Content-Type": mime },
        });
    } catch {
        return new Response(`404 Not Found: ${path}`, { status: 404 });
    }
}

// onListen fires only after the socket is successfully bound, so the URL
// printed here is always reachable.
Deno.serve(
    {
        port: PORT,
        hostname: HOST,
        onListen({ hostname, port }) {
            const displayHost = hostname === "0.0.0.0" ? "localhost" : hostname;
            console.log(`Serving  ${ROOT}`);
            console.log(`Open  →  http://${displayHost}:${port}/examples/web/`);
            console.log(`Router   ws/${displayHost}:7447  must be reachable`);
        },
    },
    handler,
);
