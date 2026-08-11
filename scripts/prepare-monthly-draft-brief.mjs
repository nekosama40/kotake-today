import fs from "node:fs/promises";
import path from "node:path";

const [workDir, targetDatesCsv, passName, priorPayloadPath, outputPath] = process.argv.slice(2);
if (!workDir || !targetDatesCsv || !passName || !priorPayloadPath || !outputPath) {
  console.error("Usage: node scripts/prepare-monthly-draft-brief.mjs <work-dir> <dates-csv> <pass-name> <prior-payload-or-> <output>");
  process.exit(2);
}

const targetDates = targetDatesCsv.split(",").map((value) => value.trim()).filter(Boolean);
const laneAssignments = new Map([
  ["official-and-major", new Set(["monthly-official-major", "monthly-art-music-special", "monthly-tech-games"])],
  ["local-and-long-tail", new Set(["monthly-social-local"])],
  ["anime-character-and-food", new Set(["monthly-anime-character", "monthly-food"])],
  ["next-days-official-and-major", new Set(["monthly-official-major", "monthly-art-music-special", "monthly-tech-games"])],
  ["next-days-local-and-special", new Set(["monthly-social-local", "monthly-anime-character", "monthly-food"])],
  ["quality-and-gap", new Set(["monthly-official-major", "monthly-art-music-special", "monthly-tech-games", "monthly-social-local", "monthly-anime-character", "monthly-food"])],
]);

if (targetDates.length < 1 || targetDates.length > 3 || !laneAssignments.has(passName)) {
  throw new Error("Invalid target dates or research pass name.");
}

const lunaDraftPattern = /^monthly-research-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.json$/;
const allowedLanes = laneAssignments.get(passName);

function normalize(value) {
  return String(value ?? "").normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
}

function eventDate(event) {
  return typeof event?.startAt === "string" && event.startAt.length >= 10
    ? event.startAt.slice(0, 10)
    : "";
}

function eventKeys(event) {
  const date = eventDate(event);
  return [
    `content:${normalize(event?.title)}:${normalize(event?.venueName)}:${date}`,
    `url:${String(event?.sourceUrl ?? "").toLowerCase()}:${normalize(event?.title)}:${date}`,
  ];
}

function sourceDateKey(event) {
  const sourceUrl = String(event?.sourceUrl ?? "").toLowerCase();
  return sourceUrl ? `${sourceUrl}:${eventDate(event)}` : "";
}

function levenshteinDistance(left, right) {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length];
}

function longestCommonSubsequenceLength(left, right) {
  let previous = Array(right.length + 1).fill(0);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = Array(right.length + 1).fill(0);
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = left[leftIndex - 1] === right[rightIndex - 1]
        ? previous[rightIndex - 1] + 1
        : Math.max(current[rightIndex - 1], previous[rightIndex]);
    }
    previous = current;
  }
  return previous[right.length];
}

function titlesLikelyMatch(leftTitle, rightTitle) {
  const left = normalize(leftTitle);
  const right = normalize(rightTitle);
  if (!left || !right) return false;
  if (left === right) return true;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length > right.length ? left : right;
  if (shorter.length >= 6 && longer.includes(shorter)) return true;
  if (shorter.length >= 8
    && shorter.length / longer.length >= 0.4
    && longestCommonSubsequenceLength(shorter, longer) / shorter.length >= 0.85) return true;
  if (longer.length < 6) return false;
  return 1 - (levenshteinDistance(left, right) / longer.length) >= 0.78;
}

function confidenceWeight(value) {
  return value === "high" ? 3 : value === "medium" ? 2 : 1;
}

function shouldReplace(current, candidate) {
  return confidenceWeight(candidate.confidence) > confidenceWeight(current.confidence)
    || Number(candidate.recommendationScore ?? 0) > Number(current.recommendationScore ?? 0);
}

async function readJson(filePath) {
  return JSON.parse((await fs.readFile(filePath, "utf8")).replace(/^\uFEFF/, ""));
}

const ignoredFiles = [];
const draftFiles = (await fs.readdir(workDir, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && lunaDraftPattern.test(entry.name));
const usableDrafts = [];

for (const entry of draftFiles) {
  const filePath = path.join(workDir, entry.name);
  try {
    const [payload, stat] = await Promise.all([readJson(filePath), fs.stat(filePath)]);
    const coveredDates = Array.isArray(payload.coveredDates) ? payload.coveredDates : [];
    const matchingDates = targetDates.filter((date) => coveredDates.includes(date));
    if (matchingDates.length === 0 || !Array.isArray(payload.events)) continue;
    const generatedAtMs = Date.parse(payload.generatedAt);
    usableDrafts.push({
      name: entry.name,
      payload,
      matchingDates,
      freshness: Number.isNaN(generatedAtMs) ? stat.mtimeMs : generatedAtMs,
    });
  } catch {
    ignoredFiles.push(entry.name);
  }
}

usableDrafts.sort((a, b) => b.freshness - a.freshness || b.name.localeCompare(a.name));
const selectedDraft = usableDrafts[0] ?? null;

const priorKeys = new Set();
const priorEventsBySourceDate = new Map();
if (priorPayloadPath !== "-") {
  try {
    const priorPayload = await readJson(priorPayloadPath);
    for (const event of priorPayload.events ?? []) {
      if (!targetDates.includes(eventDate(event))) continue;
      for (const key of eventKeys(event)) priorKeys.add(key);
      const key = sourceDateKey(event);
      if (!key) continue;
      const events = priorEventsBySourceDate.get(key) ?? [];
      events.push(event);
      priorEventsBySourceDate.set(key, events);
    }
  } catch (error) {
    if (error.code !== "ENOENT") ignoredFiles.push(path.basename(priorPayloadPath));
  }
}

const candidatesByKey = new Map();
if (selectedDraft) {
  for (const event of selectedDraft.payload.events) {
    const date = eventDate(event);
    if (!targetDates.includes(date) || !allowedLanes.has(event.researchPass)) continue;
    if (typeof event.title !== "string" || typeof event.venueName !== "string" || !/^https:\/\//i.test(event.sourceUrl ?? "")) continue;
    const keys = eventKeys(event);
    if (keys.some((key) => priorKeys.has(key))) continue;
    const priorEvents = priorEventsBySourceDate.get(sourceDateKey(event)) ?? [];
    if (priorEvents.some((priorEvent) => titlesLikelyMatch(priorEvent.title, event.title))) continue;
    const primaryKey = keys[0];
    const current = candidatesByKey.get(primaryKey);
    if (!current || shouldReplace(current, event)) candidatesByKey.set(primaryKey, event);
  }
}

const allCandidates = [...candidatesByKey.values()].sort((a, b) => (
  Number(b.recommendationScore ?? 0) - Number(a.recommendationScore ?? 0)
  || Number(a.kotakeMinutes ?? 60) - Number(b.kotakeMinutes ?? 60)
  || String(a.startAt).localeCompare(String(b.startAt))
));
const selectedCandidates = allCandidates.slice(0, 60).map((event) => ({
  origin: "monthly_draft",
  draftLane: event.researchPass,
  title: event.title,
  summary: event.summary,
  startAt: event.startAt,
  endAt: event.endAt,
  venueName: event.venueName,
  ward: event.ward,
  nearestStation: event.nearestStation,
  sourceUrl: event.sourceUrl,
  availability: event.availability,
  reservation: event.reservation,
  sameDayNote: event.sameDayNote,
  lastCheckedAt: event.lastCheckedAt,
  tags: event.tags,
  recommendationScore: event.recommendationScore,
}));

const brief = {
  draftFile: selectedDraft?.name ?? null,
  draftGeneratedAt: selectedDraft?.payload.generatedAt ?? null,
  targetDates,
  matchingDates: selectedDraft?.matchingDates ?? [],
  candidateCount: selectedCandidates.length,
  omittedCandidateCount: Math.max(0, allCandidates.length - selectedCandidates.length),
  ignoredFileCount: ignoredFiles.length,
  candidates: selectedCandidates,
};

await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(brief, null, 2)}\n`, "utf8");
console.log(selectedDraft
  ? `Prepared ${selectedCandidates.length} monthly Luna draft candidates from ${selectedDraft.name} for ${passName}.`
  : `No monthly Luna draft covers ${targetDates.join(", ")} for ${passName}.`);
