import crypto from "node:crypto";
import fs from "node:fs/promises";

const argumentsList = process.argv.slice(2);
const outputPath = argumentsList.at(-1);
const inputPaths = argumentsList.slice(0, -1);
if (inputPaths.length < 1 || !outputPath) {
  throw new Error("Usage: node scripts/merge-monthly-research.mjs <pass-1> [pass-2 ...] <output>");
}

const passes = await Promise.all(inputPaths.map(async (file) => JSON.parse((await fs.readFile(file, "utf8")).replace(/^\uFEFF/, ""))));
const generatedFor = passes[0]?.generatedFor;
if (!/^\d{4}-\d{2}-\d{2}$/.test(generatedFor ?? "")) throw new Error("Invalid generatedFor.");
if (passes.some((pass) => pass.generatedFor !== generatedFor)) throw new Error("All monthly passes must share generatedFor.");

const coveredDates = [...new Set(passes.flatMap((pass) => pass.targetDates ?? []))].sort();
if (coveredDates.length < 1 || coveredDates.length > 31) throw new Error("Monthly research must cover one to 31 dates.");

const wards = new Set([
  "千代田区", "中央区", "港区", "新宿区", "文京区", "台東区", "墨田区", "江東区",
  "品川区", "目黒区", "大田区", "世田谷区", "渋谷区", "中野区", "杉並区", "豊島区",
  "北区", "荒川区", "板橋区", "練馬区", "足立区", "葛飾区", "江戸川区",
]);
const normalize = (value) => String(value ?? "").normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
const dedupeKey = (event) => `${normalize(event.title)}:${normalize(event.venueName)}:${event.startAt.slice(0, 10)}`;
const stableId = (event) => `monthly-${crypto.createHash("sha1").update(dedupeKey(event)).digest("hex").slice(0, 10)}`;
const confidenceWeight = (value) => value === "high" ? 3 : value === "medium" ? 2 : 1;
const eventMap = new Map();
const laneSummaries = [];

for (const pass of passes) {
  laneSummaries.push({
    passName: pass.passName,
    searchActions: pass.searchActions,
    candidateCount: Array.isArray(pass.events) ? pass.events.length : 0,
    sourceCount: Array.isArray(pass.sourcesConsulted) ? pass.sourcesConsulted.length : 0,
  });
  for (const rawEvent of pass.events ?? []) {
    if (!rawEvent?.startAt || !coveredDates.includes(rawEvent.startAt.slice(0, 10))) continue;
    if (!wards.has(rawEvent.ward) || rawEvent.kotakeMinutes > 60 || rawEvent.transferCount > 1) continue;
    const event = { ...rawEvent, id: stableId(rawEvent), researchPass: pass.passName };
    const key = dedupeKey(event);
    const current = eventMap.get(key);
    if (!current || confidenceWeight(event.confidence) > confidenceWeight(current.confidence)
      || event.recommendationScore > current.recommendationScore) {
      eventMap.set(key, event);
    } else {
      current.tags = [...new Set([...current.tags, ...event.tags])].slice(0, 8);
      current.discoveredVia = [...new Map([...(current.discoveredVia ?? []), ...(event.discoveredVia ?? [])]
        .map((source) => [`${source.type}:${source.url}`, source])).values()];
    }
  }
}

const events = [...eventMap.values()].sort((left, right) =>
  left.startAt.localeCompare(right.startAt)
  || right.recommendationScore - left.recommendationScore
  || left.kotakeMinutes - right.kotakeMinutes,
);
const sourceUrls = [...new Set(passes.flatMap((pass) => pass.sourcesConsulted ?? []))].sort();
const sourceHosts = new Set(sourceUrls.map((url) => {
  try { return new URL(url).hostname; } catch { return url; }
}));
const countsByDate = Object.fromEntries(coveredDates.map((date) => [
  date,
  events.filter((event) => event.startAt.slice(0, 10) === date).length,
]));
const now = new Date().toISOString();
const payload = {
  generatedFor,
  coveredDates,
  coveredThrough: coveredDates.at(-1),
  generatedAt: now,
  publishedAt: now,
  searchPasses: passes.length,
  sourceCount: sourceHosts.size,
  sourceUrls,
  laneSummaries,
  countsByDate,
  events,
};
await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`Merged ${passes.length} monthly passes into ${events.length} deduped events across ${coveredDates.length} dates from ${sourceHosts.size} source hosts.`);
