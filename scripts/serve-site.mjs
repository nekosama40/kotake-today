import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(projectRoot, "dist");
const publicRoot = path.join(projectRoot, "public");
const host = process.env.KOTAKE_SITE_HOST || "127.0.0.1";
const port = Number(process.env.KOTAKE_SITE_PORT || 4173);

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".avif", "image/avif"],
]);

function safePath(root, urlPath) {
  const relative = decodeURIComponent(urlPath).replace(/^\/+/, "");
  const resolved = path.resolve(root, relative);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`) ? resolved : null;
}

async function readAsset(urlPath) {
  const isLiveData = urlPath === "/data/events.json" || urlPath.startsWith("/images/events/");
  const root = isLiveData ? publicRoot : distRoot;
  const filePath = safePath(root, urlPath === "/" ? "index.html" : urlPath);
  if (!filePath) return null;
  try {
    return { filePath, body: await fs.readFile(filePath), isLiveData };
  } catch (error) {
    if (error.code !== "ENOENT" && error.code !== "EISDIR") throw error;
    if (isLiveData || path.extname(urlPath)) return null;
    return { filePath: path.join(distRoot, "index.html"), body: await fs.readFile(path.join(distRoot, "index.html")), isLiveData: false };
  }
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || host}`);
    const asset = await readAsset(url.pathname);
    if (!asset) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    response.writeHead(200, {
      "content-type": contentTypes.get(path.extname(asset.filePath).toLowerCase()) || "application/octet-stream",
      "cache-control": asset.isLiveData ? "no-store" : "public, max-age=3600",
      "x-content-type-options": "nosniff",
    });
    response.end(asset.body);
  } catch (error) {
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end("Internal server error");
    console.error(error);
  }
});

server.listen(port, host, () => {
  console.log(`Kotake Today is available at http://${host}:${port}`);
});
