import { readFile } from "node:fs/promises";
import http from "node:http";
import { extname, join, normalize } from "node:path";

const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";
const root = process.cwd();
const serverEntry = join(root, ".netlify/functions-internal/server/main.mjs");

const { default: handler } = await import(serverEntry);

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

async function maybeServeStatic(pathname, res) {
  if (!pathname.startsWith("/assets/") && pathname !== "/favicon.svg") {
    return false;
  }

  const safePath = normalize(pathname).replace(/^\/+/, "");
  const filePath = join(root, "dist", safePath);
  const body = await readFile(filePath);

  res.writeHead(200, {
    "content-type": contentTypes[extname(filePath)] || "application/octet-stream",
  });
  res.end(body);
  return true;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${host}:${port}`);

    if (await maybeServeStatic(url.pathname, res)) {
      return;
    }

    const request = new Request(url, {
      method: req.method,
      headers: req.headers,
    });
    const response = await handler(request);

    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error(error);
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(error instanceof Error ? error.stack : String(error));
  }
});

server.listen(port, host, () => {
  console.log(`Production artifact server: http://${host}:${port}`);
});
