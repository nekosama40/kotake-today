import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { validatePayload } from "./validate-events.mjs";

const [passAPath, passBPath, outputPath, targetDate] = process.argv.slice(2);
if (!passAPath || !passBPath || !outputPath || !targetDate) {
  console.error("Usage: node scripts/merge-events.mjs <pass-a> <pass-b> <output> <YYYY-MM-DD>");
  process.exit(2);
}

const tokyoWards = new Set([
  "千代田区", "中央区", "港区", "新宿区", "文京区", "台東区", "墨田区", "江東区",
  "品川区", "目黒区", "大田区", "世田谷区", "渋谷区", "中野区", "杉並区", "豊島区",
  "北区", "荒川区", "板橋区", "練馬区", "足立区", "葛飾区", "江戸川区",
]);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const eventImageDir = path.join(projectRoot, "public", "images", "events");

const [passA, passB] = await Promise.all([
  fs.readFile(passAPath, "utf8").then(JSON.parse),
  fs.readFile(passBPath, "utf8").then(JSON.parse),
]);

if (passA.generatedFor !== targetDate || passB.generatedFor !== targetDate) {
  throw new Error("Research output date does not match target date.");
}

function normalize(value) {
  return value.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
}

function dedupeKey(event) {
  return `${normalize(event.title)}:${normalize(event.venueName)}:${event.startAt.slice(0, 10)}`;
}

function confidenceWeight(value) {
  return value === "high" ? 3 : value === "medium" ? 2 : 1;
}

function recomputeScore(event) {
  let score = Math.min(70, Math.max(0, event.recommendationScore));
  if (event.availability === "walk_in") score += 12;
  if (event.availability === "same_day_ticket") score += 7;
  if (event.reservation === "not_required") score += 8;
  if (event.kotakeMinutes <= 30) score += 8;
  else if (event.kotakeMinutes <= 45) score += 5;
  else score += 2;
  if (event.confidence === "high") score += 6;
  if (event.image?.url) score += 2;
  return Math.min(100, score);
}

function stableId(event) {
  const digest = crypto.createHash("sha1").update(dedupeKey(event)).digest("hex").slice(0, 10);
  return `event-${digest}`;
}

async function discoverPreviewImage(event) {
  if (event.image?.url || !event.sourceUrl.startsWith("https://")) return event;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(event.sourceUrl, {
      signal: controller.signal,
      headers: { "user-agent": "KotakeToday/0.1 (+local event preview)" },
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

const supportedImageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);

async function cacheEventImage(event) {
  if (!event.image?.url?.startsWith("https://")) return event;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(event.image.url, {
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; KotakeToday/0.1; event image cache)",
        referer: event.image.sourceUrl || event.sourceUrl,
      },
    });
    if (!response.ok) throw new Error(`image response ${response.status}`);
    const contentType = (response.headers.get("content-type") ?? "").split(";")[0].toLowerCase();
    if (!supportedImageTypes.has(contentType)) throw new Error(`unsupported image type ${contentType}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > 8_000_000) throw new Error("image size is outside limits");

    await fs.mkdir(eventImageDir, { recursive: true });
    const fileName = `${stableId(event)}.webp`;
    const optimized = await sharp(bytes, { animated: false })
      .rotate()
      .resize({ width: 1000, withoutEnlargement: true })
      .webp({ quality: 78, effort: 4 })
      .toBuffer();
    await fs.writeFile(path.join(eventImageDir, fileName), optimized);
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

const deduped = new Map();
for (const rawEvent of [...passA.events, ...passB.events]) {
  const event = {
    ...rawEvent,
    endAt: rawEvent.endAt !== null && Date.parse(rawEvent.endAt) > Date.parse(rawEvent.startAt)
      ? rawEvent.endAt
      : null,
  };
  if (event.startAt.slice(0, 10) !== targetDate) continue;
  if (!tokyoWards.has(event.ward)) continue;
  if (event.kotakeMinutes > 60) continue;
  const key = dedupeKey(event);
  const current = deduped.get(key);
  if (!current || confidenceWeight(event.confidence) > confidenceWeight(current.confidence) || event.recommendationScore > current.recommendationScore) {
    deduped.set(key, event);
  } else {
    current.tags = [...new Set([...current.tags, ...event.tags])].slice(0, 8);
  }
}

const enriched = await Promise.all([...deduped.values()].map(discoverPreviewImage));
const cached = await Promise.all(enriched.map(cacheEventImage));
const events = cached
  .map((event) => ({ ...event, id: stableId(event), recommendationScore: recomputeScore(event) }))
  .sort((a, b) => b.recommendationScore - a.recommendationScore || a.kotakeMinutes - b.kotakeMinutes);

const sources = new Set([...passA.sourcesConsulted, ...passB.sourcesConsulted].map((url) => {
  try { return new URL(url).hostname; } catch { return url; }
}));

const now = new Date().toISOString();
const payload = {
  generatedFor: targetDate,
  generatedAt: now,
  publishedAt: now,
  searchPasses: 2,
  sourceCount: sources.size,
  events,
};

const errors = validatePayload(payload, targetDate);
if (errors.length) throw new Error(`Merged payload is invalid:\n${errors.join("\n")}`);
await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`Merged ${passA.events.length} + ${passB.events.length} candidates into ${events.length} events.`);
