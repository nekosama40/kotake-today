import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { validatePayload } from "./validate-events.mjs";

const [draftPath, outputPath, targetDate] = process.argv.slice(2);
if (!draftPath || !outputPath || !targetDate) {
  console.error("Usage: node scripts/prepare-monthly-publication.mjs <draft> <output> <YYYY-MM-DD>");
  process.exit(2);
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const eventImageDir = path.join(projectRoot, "public", "images", "events");
const draft = JSON.parse((await fs.readFile(draftPath, "utf8")).replace(/^\uFEFF/, ""));
const supportedImageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);

async function discoverPreviewImage(event) {
  if (event.image?.url || !event.sourceUrl?.startsWith("https://")) return event;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(event.sourceUrl, {
      signal: controller.signal,
      headers: { "user-agent": "KotakeToday/0.1 (+monthly event preview)" },
    });
    if (!response.ok) return event;
    const html = await response.text();
    const match = html.match(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]+content=["']([^"']+)["']/i)
      ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image)["']/i);
    if (!match) return event;
    const imageUrl = new URL(match[1].replace(/&amp;/g, "&"), event.sourceUrl).href;
    if (!imageUrl.startsWith("https://")) return event;
    return {
      ...event,
      image: {
        url: imageUrl,
        alt: event.image?.alt || `${event.title}の公式告知画像`,
        attribution: event.image?.attribution || event.sourceLabel,
        sourceUrl: event.sourceUrl,
      },
    };
  } catch {
    return event;
  } finally {
    clearTimeout(timeout);
  }
}

async function cacheEventImage(event) {
  if (!event.image?.url?.startsWith("https://")) return event;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(event.image.url, {
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; KotakeToday/0.1; monthly image cache)",
        referer: event.image.sourceUrl || event.sourceUrl,
      },
    });
    if (!response.ok) throw new Error(`image response ${response.status}`);
    const contentType = (response.headers.get("content-type") ?? "").split(";")[0].toLowerCase();
    if (!supportedImageTypes.has(contentType)) throw new Error(`unsupported image type ${contentType}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > 8_000_000) throw new Error("image size is outside limits");
    const optimized = await sharp(bytes, { animated: false })
      .rotate()
      .resize({ width: 1000, withoutEnlargement: true })
      .webp({ quality: 78, effort: 4 })
      .toBuffer();
    const contentDigest = crypto.createHash("sha256").update(optimized).digest("hex").slice(0, 16);
    const fileName = `image-${contentDigest}.webp`;
    await fs.mkdir(eventImageDir, { recursive: true });
    try {
      await fs.access(path.join(eventImageDir, fileName));
    } catch {
      await fs.writeFile(path.join(eventImageDir, fileName), optimized);
    }
    return {
      ...event,
      image: {
        ...event.image,
        url: `/images/events/${fileName}`,
        alt: event.image.alt || `${event.title}の公式告知画像`,
        attribution: event.image.attribution || event.sourceLabel,
        sourceUrl: event.image.sourceUrl || event.sourceUrl,
      },
    };
  } catch {
    return { ...event, image: { ...event.image, url: null } };
  } finally {
    clearTimeout(timeout);
  }
}

async function mapInBatches(items, batchSize, mapper) {
  const results = [];
  for (let index = 0; index < items.length; index += batchSize) {
    results.push(...await Promise.all(items.slice(index, index + batchSize).map(mapper)));
  }
  return results;
}

const discovered = await mapInBatches(draft.events ?? [], 10, discoverPreviewImage);
const cached = await mapInBatches(discovered, 10, cacheEventImage);
const events = cached.map(({ researchPass: _researchPass, ...event }) => event);
const now = new Date().toISOString();
const payload = {
  generatedFor: draft.generatedFor,
  coveredDates: draft.coveredDates,
  generatedAt: draft.generatedAt || now,
  publishedAt: now,
  searchPasses: draft.searchPasses,
  sourceCount: draft.sourceCount,
  events,
};
const errors = validatePayload(payload, targetDate);
if (errors.length) throw new Error(`Monthly publication is invalid:\n${errors.join("\n")}`);
await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
const imageCount = events.filter((event) => event.image?.url?.startsWith("/images/events/")).length;
console.log(`Prepared ${events.length} monthly events with ${imageCount} cached official images.`);
