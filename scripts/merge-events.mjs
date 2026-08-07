import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { validatePayload } from "./validate-events.mjs";

const argumentsList = process.argv.slice(2);
const outputPath = argumentsList.at(-3);
const targetDate = argumentsList.at(-2);
const previousPayloadPath = argumentsList.at(-1);
const passPaths = argumentsList.slice(0, -3);
if (passPaths.length < 2 || !outputPath || !targetDate || !previousPayloadPath) {
  console.error("Usage: node scripts/merge-events.mjs <pass-1> <pass-2> [pass-3 ...] <output> <YYYY-MM-DD> <previous-payload-or->");
  process.exit(2);
}

const tokyoWards = new Set([
  "千代田区", "中央区", "港区", "新宿区", "文京区", "台東区", "墨田区", "江東区",
  "品川区", "目黒区", "大田区", "世田谷区", "渋谷区", "中野区", "杉並区", "豊島区",
  "北区", "荒川区", "板橋区", "練馬区", "足立区", "葛飾区", "江戸川区",
]);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const eventImageDir = path.join(projectRoot, "public", "images", "events");

function addIsoDays(value, days) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const todayPasses = new Set(["official-and-major", "local-and-long-tail", "anime-character-and-food"]);
const advancePasses = new Set(["next-days-official-and-major", "next-days-local-and-special"]);
const socialPasses = new Set(["local-and-long-tail", "next-days-local-and-special"]);
const passRules = new Map([
  ["official-and-major", { searchMin: 16, searchMax: 24 }],
  ["local-and-long-tail", { searchMin: 20, searchMax: 28 }],
  ["anime-character-and-food", { searchMin: 16, searchMax: 24 }],
  ["next-days-official-and-major", { searchMin: 12, searchMax: 18 }],
  ["next-days-local-and-special", { searchMin: 16, searchMax: 24 }],
]);
const expectedTodayDates = [targetDate];
const expectedAdvanceDates = [addIsoDays(targetDate, 1), addIsoDays(targetDate, 2)];
const expectedFivePasses = new Set([...todayPasses, ...advancePasses]);

const researchPasses = await Promise.all(passPaths.map((passPath) => fs.readFile(passPath, "utf8").then(JSON.parse)));

if (researchPasses.some((researchPass) => researchPass.generatedFor !== targetDate)) {
  throw new Error("Research output date does not match target date.");
}
const passNames = new Set(researchPasses.map((researchPass) => researchPass.passName));
if (passNames.size !== researchPasses.length) throw new Error("Research pass names must be unique.");
if (researchPasses.length === 5
  && (passNames.size !== expectedFivePasses.size || [...expectedFivePasses].some((passName) => !passNames.has(passName)))) {
  throw new Error("A five-pass run must contain the three today passes and both next-days passes.");
}
for (const researchPass of researchPasses) {
  const isTodayPass = todayPasses.has(researchPass.passName);
  const isAdvancePass = advancePasses.has(researchPass.passName);
  if (!isTodayPass && !isAdvancePass) throw new Error(`Unsupported research pass: ${researchPass.passName}`);

  const targetDates = researchPass.targetDates ?? [researchPass.generatedFor];
  const expectedDates = isAdvancePass ? expectedAdvanceDates : expectedTodayDates;
  if (JSON.stringify(targetDates) !== JSON.stringify(expectedDates)) {
    throw new Error(`Research pass ${researchPass.passName} has invalid targetDates.`);
  }
  researchPass.targetDates = targetDates;

  const legacyTwoPassRun = researchPasses.length === 2;
  const configuredRule = passRules.get(researchPass.passName);
  const searchMin = legacyTwoPassRun ? (isAdvancePass ? 12 : 16) : configuredRule.searchMin;
  const searchMax = legacyTwoPassRun ? (isAdvancePass ? 18 : 24) : configuredRule.searchMax;
  if (!Number.isInteger(researchPass.searchActions) || researchPass.searchActions < searchMin || researchPass.searchActions > searchMax) {
    throw new Error(`Research pass ${researchPass.passName} must report ${searchMin} to ${searchMax} search actions.`);
  }
  if (researchPass.passName === "anime-character-and-food") {
    const animeCharacter = researchPass.searchBreakdown?.animeCharacter;
    const food = researchPass.searchBreakdown?.food;
    if (!Number.isInteger(animeCharacter) || animeCharacter < 8 || animeCharacter > 12
      || !Number.isInteger(food) || food < 8 || food > 12) {
      throw new Error("Anime/character and food research must each report 8 to 12 search actions.");
    }
    if (animeCharacter + food !== researchPass.searchActions) {
      throw new Error("Anime/character and food search breakdown must equal searchActions.");
    }
  } else if (socialPasses.has(researchPass.passName)
    && !(legacyTwoPassRun && researchPass.searchBreakdown === undefined)) {
    const breakdown = researchPass.searchBreakdown;
    const todaySocial = researchPass.passName === "local-and-long-tail";
    const fields = [
      ["watchlistChecks", todaySocial ? 6 : 4, todaySocial ? 10 : 8],
      ["xDiscovery", todaySocial ? 4 : 3, todaySocial ? 7 : 6],
      ["instagramDiscovery", todaySocial ? 4 : 3, todaySocial ? 7 : 6],
      ["openWebVerification", 6, 10],
    ];
    for (const [field, minimum, maximum] of fields) {
      if (!Number.isInteger(breakdown?.[field]) || breakdown[field] < minimum || breakdown[field] > maximum) {
        throw new Error(`Social research ${researchPass.passName} has an invalid ${field} count.`);
      }
    }
    const breakdownTotal = fields.reduce((total, [field]) => total + breakdown[field], 0);
    if (breakdownTotal !== researchPass.searchActions) {
      throw new Error(`Social research ${researchPass.passName} breakdown must equal searchActions.`);
    }
  } else if (researchPass.searchBreakdown !== null
    && !(researchPasses.length === 2 && researchPass.searchBreakdown === undefined)) {
    throw new Error(`Research pass ${researchPass.passName} must set searchBreakdown to null.`);
  }
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

function addResearchEvent(rawEvent) {
  const event = {
    ...rawEvent,
    endAt: rawEvent.endAt !== null && Date.parse(rawEvent.endAt) > Date.parse(rawEvent.startAt)
      ? rawEvent.endAt
      : null,
  };
  if (!tokyoWards.has(event.ward)) return;
  if (event.kotakeMinutes > 60) return;
  const key = dedupeKey(event);
  const current = deduped.get(key);
  if (!current || confidenceWeight(event.confidence) > confidenceWeight(current.confidence) || event.recommendationScore > current.recommendationScore) {
    deduped.set(key, event);
  } else {
    current.tags = [...new Set([...current.tags, ...event.tags])].slice(0, 8);
  }
}

for (const researchPass of researchPasses) {
  for (const rawEvent of researchPass.events) {
    if (!researchPass.targetDates.includes(rawEvent.startAt.slice(0, 10))) continue;
    addResearchEvent(rawEvent);
  }
}

let previousPayload = null;
if (previousPayloadPath !== "-") {
  try {
    previousPayload = JSON.parse((await fs.readFile(previousPayloadPath, "utf8")).replace(/^\uFEFF/, ""));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

let carriedEndedCount = 0;
if (previousPayload?.generatedFor === targetDate) {
  for (const previousEvent of previousPayload.events ?? []) {
    if (previousEvent.startAt.slice(0, 10) !== targetDate) continue;
    const key = dedupeKey(previousEvent);
    if (deduped.has(key)) continue;
    addResearchEvent(previousEvent);
    carriedEndedCount += 1;
  }
}

const enriched = await Promise.all([...deduped.values()].map(discoverPreviewImage));
const cached = await Promise.all(enriched.map(cacheEventImage));
const events = cached
  .map((event) => ({ ...event, id: stableId(event), recommendationScore: recomputeScore(event) }))
  .sort((a, b) => b.recommendationScore - a.recommendationScore || a.kotakeMinutes - b.kotakeMinutes);

const sources = new Set(researchPasses.flatMap((researchPass) => researchPass.sourcesConsulted).map((url) => {
  try { return new URL(url).hostname; } catch { return url; }
}));

const now = new Date().toISOString();
const coveredDates = [...new Set(researchPasses.flatMap((researchPass) => researchPass.targetDates))].sort();
const payload = {
  generatedFor: targetDate,
  coveredDates,
  generatedAt: now,
  publishedAt: now,
  searchPasses: researchPasses.length,
  sourceCount: sources.size,
  events,
};

const errors = validatePayload(payload, targetDate);
if (errors.length) throw new Error(`Merged payload is invalid:\n${errors.join("\n")}`);
await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`Merged ${researchPasses.map((researchPass) => researchPass.events.length).join(" + ")} candidates from ${researchPasses.length} passes into ${events.length} events across ${coveredDates.length} days; preserved ${carriedEndedCount} same-day events from the earlier publication.`);
