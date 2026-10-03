import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { isIP } from "node:net";

const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".txt": "text/plain; charset=utf-8", ".pdf": "application/pdf", ".apk": "application/vnd.android.package-archive", ".wasm": "application/wasm", ".mp4": "video/mp4" };
export function staticAssets(directory) {
  const root = resolve(directory);
  return { async fetch(request) {
    if (!["GET", "HEAD"].includes(request.method)) return new Response(null, { status: 405 });
    let filename;
    try {
      const path = decodeURIComponent(new URL(request.url).pathname);
      if (path.includes("\0") || path.split(/[\\/]/).some((p) => p.startsWith("."))) throw new Error();
      filename = resolve(root, "." + path);
      if (!filename.startsWith(root + sep)) throw new Error();
      const info = await stat(filename);
      if (!info.isFile()) throw new Error();
      return new Response(request.method === "HEAD" ? null : Readable.toWeb(createReadStream(filename)), {
        headers: { "Content-Type": types[extname(filename)] || "application/octet-stream", "Content-Length": String(info.size), "X-Content-Type-Options": "nosniff", "Cache-Control": "public, max-age=0, must-revalidate" },
      });
    } catch { return new Response(null, { status: 404 }); }
  } };
}

export function roomEntryLimit(now = Date.now) {
  const windows = new Map();
  return { async limit({ key }) {
    const time = now();
    for (const [k, value] of windows) if (value.expires <= time) windows.delete(k);
    if (!windows.has(key)) {
      if (windows.size >= 10000) return { success: false };
      windows.set(key, { hits: 0, expires: time + 60000 });
    }
    return { success: ++windows.get(key).hits <= 60 };
  } };
}

export function incomingRequest(incoming, origin, render = false) {
  // Never accept a caller's cf-connecting-ip. On Render trust only the nearest
  // appended XFF hop; this can conservatively group visitors behind a proxy.
  const forwarded = String(incoming.headers["x-forwarded-for"] || "").split(",").at(-1).trim();
  const ip = render && isIP(forwarded) ? forwarded : incoming.socket.remoteAddress;
  const headers = new Headers();
  for (const [key, value] of Object.entries(incoming.headers)) {
    if (value !== undefined && !["host", "connection", "transfer-encoding", "cf-connecting-ip", "x-forwarded-host", "x-forwarded-proto", "x-forwarded-for", "forwarded"].includes(key)) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  headers.set("cf-connecting-ip", ip || "unknown");
  // Fix the authority to the configured origin, even for // or absolute targets.
  if (!incoming.url?.startsWith("/") || incoming.url.startsWith("//")) throw new Error("Invalid request target");
  return new Request(origin + incoming.url, {
    method: incoming.method, headers,
    ...(!["GET", "HEAD"].includes(incoming.method) ? { body: Readable.toWeb(incoming), duplex: "half" } : {}),
  });
}

export async function sendResponse(response, outgoing) {
  outgoing.statusCode = response.status;
  for (const [key, value] of response.headers) if (key !== "set-cookie") outgoing.setHeader(key, value);
  const cookies = response.headers.getSetCookie();
  if (cookies.length) outgoing.setHeader("set-cookie", cookies);
  if (response.body) await pipeline(Readable.fromWeb(response.body), outgoing);
  else outgoing.end();
}
