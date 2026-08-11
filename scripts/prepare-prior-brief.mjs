import fs from "node:fs/promises";
import path from "node:path";

const [priorPayloadPath, targetDatesCsv, passName, outputPath] = process.argv.slice(2);
if (!priorPayloadPath || !targetDatesCsv || !passName || !outputPath) {
  console.error("Usage: node scripts/prepare-prior-brief.mjs <prior-payload> <dates-csv> <pass-name> <output>");
  process.exit(2);
}

const targetDates = targetDatesCsv.split(",").map((value) => value.trim()).filter(Boolean);
const validPasses = new Set([
  "official-and-major",
  "local-and-long-tail",
  "anime-character-and-food",
  "next-days-official-and-major",
  "next-days-local-and-special",
  "quality-and-gap",
]);
if (!validPasses.has(passName) || targetDates.length < 1 || targetDates.length > 3) {
  throw new Error("Invalid research pass or target dates.");
}

const themedPattern = /アニメ|キャラクター|マンガ|コミック|コラボ|ポップアップ|ゲーム|フード|グルメ|食|カフェ|酒|ビール|マルシェ|物産/iu;
const localPattern = /地域|商店街|自治体|区立|図書館|学校|大学|町会|祭|盆踊り|交流|コミュニティ|ワークショップ|店舗|銭湯/iu;

function assignedPass(event) {
  if (passName === "quality-and-gap") return "quality-and-gap";
  const text = [event.title, event.summary, event.venueName, event.sourceLabel, ...(event.tags ?? [])].join(" ");
  const isAdvance = event.startAt.slice(0, 10) !== targetDates[0] || targetDates.length > 1;
  if (isAdvance) return themedPattern.test(text) || localPattern.test(text)
    ? "next-days-local-and-special"
    : "next-days-official-and-major";
  if (themedPattern.test(text)) return "anime-character-and-food";
  if (localPattern.test(text)) return "local-and-long-tail";
  return "official-and-major";
}

const payload = JSON.parse((await fs.readFile(priorPayloadPath, "utf8")).replace(/^\uFEFF/, ""));
const candidates = (payload.events ?? [])
  .filter((event) => typeof event.startAt === "string" && targetDates.includes(event.startAt.slice(0, 10)))
  .filter((event) => assignedPass(event) === passName)
  .sort((a, b) => Number(b.recommendationScore ?? 0) - Number(a.recommendationScore ?? 0))
  .slice(0, 60)
  .map((event) => ({
    title: event.title,
    startAt: event.startAt,
    endAt: event.endAt,
    venueName: event.venueName,
    ward: event.ward,
    sourceUrl: event.sourceUrl,
    availability: event.availability,
    reservation: event.reservation,
    sameDayNote: event.sameDayNote,
  }));

await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify({ passName, targetDates, candidates }, null, 2)}\n`, "utf8");
console.log(`Prepared ${candidates.length} prior candidates assigned only to ${passName}.`);
