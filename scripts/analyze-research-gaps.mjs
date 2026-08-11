import fs from "node:fs/promises";

const argumentsList = process.argv.slice(2);
const outputPath = argumentsList.at(-1);
const passPaths = argumentsList.slice(0, -1);
if (passPaths.length < 1 || !outputPath) {
  console.error("Usage: node scripts/analyze-research-gaps.mjs <research-pass...> <output>");
  process.exit(2);
}

const passes = await Promise.all(passPaths.map(async (passPath) => (
  JSON.parse((await fs.readFile(passPath, "utf8")).replace(/^\uFEFF/, ""))
)));
const payload = {
  coveredDates: [...new Set(passes.flatMap((pass) => pass.targetDates ?? [pass.generatedFor]))].sort(),
  events: passes.flatMap((pass) => pass.events ?? []),
};
const tokyoWards = new Set([
  "千代田区", "中央区", "港区", "新宿区", "文京区", "台東区", "墨田区", "江東区",
  "品川区", "目黒区", "大田区", "世田谷区", "渋谷区", "中野区", "杉並区", "豊島区",
  "北区", "荒川区", "板橋区", "練馬区", "足立区", "葛飾区", "江戸川区",
]);
function normalize(value) {
  return String(value ?? "").normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
}
function canonicalUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) if (/^(?:utm_|fbclid|gclid|stt_lang)/i.test(key)) url.searchParams.delete(key);
    url.pathname = url.pathname.replace(/\/$/, "");
    return url.href;
  } catch {
    return String(value ?? "");
  }
}
function likelyDuplicate(left, right) {
  const leftTitle = normalize(left.title);
  const rightTitle = normalize(right.title);
  if (!leftTitle || !rightTitle || left.startAt.slice(0, 10) !== right.startAt.slice(0, 10)) return false;
  const exactTitle = leftTitle === rightTitle;
  const shorter = leftTitle.length <= rightTitle.length ? leftTitle : rightTitle;
  const longer = leftTitle.length > rightTitle.length ? leftTitle : rightTitle;
  if (!exactTitle && !(shorter.length >= 8 && longer.includes(shorter))) return false;
  const sameSource = canonicalUrl(left.sourceUrl) === canonicalUrl(right.sourceUrl);
  const leftVenue = normalize(left.venueName);
  const rightVenue = normalize(right.venueName);
  const compatibleVenue = leftVenue === rightVenue
    || (Math.min(leftVenue.length, rightVenue.length) >= 4 && (leftVenue.includes(rightVenue) || rightVenue.includes(leftVenue)));
  const sameArea = left.ward === right.ward || normalize(left.nearestStation) === normalize(right.nearestStation);
  const sameStart = left.startAt === right.startAt;
  const bothAllDay = /^\d{4}-\d{2}-\d{2}$/.test(left.startAt) && /^\d{4}-\d{2}-\d{2}$/.test(right.startAt);
  const timeCompatible = sameStart || bothAllDay;
  return exactTitle
    ? timeCompatible && (sameSource || compatibleVenue || (leftTitle.length >= 8 && sameArea))
    : timeCompatible && sameSource;
}
const uniqueEvents = [];
for (const event of payload.events) {
  if (!tokyoWards.has(event.ward) || !Number.isInteger(event.kotakeMinutes) || event.kotakeMinutes > 60
    || (Number.isInteger(event.transferCount) && event.transferCount > 1)) continue;
  if (!uniqueEvents.some((candidate) => likelyDuplicate(candidate, event))) uniqueEvents.push(event);
}
const groups = new Map([
  ["展示・カルチャー", /展示|アート|美術|写真|アニメ|キャラクター|マンガ|ポップアップ/iu],
  ["音楽・ゲーム", /音楽|ライブ|コンサート|DJ|ゲーム|eスポーツ|IT|AI/iu],
  ["体験・交流", /体験|ワークショップ|祭|地域|交流|図書館|商店街/iu],
  ["フード・買い物", /フード|食|酒|ビール|マルシェ|グルメ|物産/iu],
]);
const nearWards = new Set(["板橋区", "練馬区", "豊島区", "中野区"]);
const countsByDate = Object.fromEntries((payload.coveredDates ?? []).map((date) => [date, 0]));
const groupCounts = Object.fromEntries([...groups.keys()].map((name) => [name, 0]));
let nearWardCount = 0;

for (const event of uniqueEvents) {
  const date = event.startAt?.slice(0, 10);
  if (date in countsByDate) countsByDate[date] += 1;
  if (nearWards.has(event.ward)) nearWardCount += 1;
  const text = [event.title, event.summary, ...(event.tags ?? [])].join(" ");
  for (const [name, pattern] of groups) if (pattern.test(text)) groupCounts[name] += 1;
}

const gaps = [];
for (const [date, count] of Object.entries(countsByDate)) if (count < 10) gaps.push(`${date}の候補が${count}件`);
for (const [name, count] of Object.entries(groupCounts)) if (count < 2) gaps.push(`${name}が${count}件`);
if (nearWardCount < 4) gaps.push(`近隣4区が${nearWardCount}件`);

const result = {
  shouldRunGapPass: gaps.length > 0,
  gaps,
  countsByDate,
  groupCounts,
  nearWardCount,
  events: uniqueEvents
    .sort((a, b) => Number(b.recommendationScore ?? 0) - Number(a.recommendationScore ?? 0))
    .slice(0, 160),
};
await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(result.shouldRunGapPass ? `Gap pass requested: ${gaps.join("、")}` : "Coverage is sufficient; gap pass skipped.");
