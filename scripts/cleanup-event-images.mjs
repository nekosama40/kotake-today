import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [payloadPath] = process.argv.slice(2);
if (!payloadPath) {
  console.error("Usage: node scripts/cleanup-event-images.mjs <published-events.json>");
  process.exit(2);
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const eventImageDir = path.join(projectRoot, "public", "images", "events");
const payload = JSON.parse((await fs.readFile(payloadPath, "utf8")).replace(/^\uFEFF/, ""));
const keep = new Set((payload.events ?? [])
  .map((event) => event.image?.url?.match(/^\/images\/events\/([^/]+)$/)?.[1])
  .filter(Boolean));

if (keep.size === 0) {
  console.log("No cached image references; existing generated images were preserved.");
  process.exit(0);
}

await fs.mkdir(eventImageDir, { recursive: true });
const generatedName = /^event-[a-f0-9]{10}\.(?:jpg|png|webp|gif|avif)$/;
const stale = (await fs.readdir(eventImageDir))
  .filter((fileName) => generatedName.test(fileName) && !keep.has(fileName));
await Promise.all(stale.map((fileName) => fs.unlink(path.join(eventImageDir, fileName))));
console.log(`Removed ${stale.length} unreferenced event images after publication.`);
