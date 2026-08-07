import fs from "node:fs";
import path from "node:path";

const wards = new Set([
  "千代田区", "中央区", "港区", "新宿区", "文京区", "台東区", "墨田区", "江東区",
  "品川区", "目黒区", "大田区", "世田谷区", "渋谷区", "中野区", "杉並区", "豊島区",
  "北区", "荒川区", "板橋区", "練馬区", "足立区", "葛飾区", "江戸川区",
]);

const availability = new Set(["walk_in", "same_day_ticket", "registration_open", "unknown"]);
const reservations = new Set(["not_required", "recommended", "required", "unknown"]);
const confidence = new Set(["high", "medium", "low"]);

export function validatePayload(payload, expectedDate) {
  const errors = [];
  if (!payload || typeof payload !== "object") return ["payload must be an object"];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.generatedFor ?? "")) errors.push("generatedFor must be YYYY-MM-DD");
  if (expectedDate && payload.generatedFor !== expectedDate) errors.push(`generatedFor must be ${expectedDate}`);
  const coveredDates = payload.coveredDates ?? [payload.generatedFor];
  const validCoveredDates = Array.isArray(coveredDates) ? coveredDates : [];
  if (!Array.isArray(coveredDates) || coveredDates.length < 1 || coveredDates.length > 3) {
    errors.push("coveredDates must contain one to three dates");
  } else {
    if (new Set(coveredDates).size !== coveredDates.length) errors.push("coveredDates must be unique");
    if (coveredDates[0] !== payload.generatedFor) errors.push("coveredDates must start with generatedFor");
    for (const [index, date] of coveredDates.entries()) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) {
        errors.push(`coveredDates[${index}] must be YYYY-MM-DD`);
        continue;
      }
      const expectedCoveredDate = new Date(`${payload.generatedFor}T00:00:00Z`);
      expectedCoveredDate.setUTCDate(expectedCoveredDate.getUTCDate() + index);
      if (date !== expectedCoveredDate.toISOString().slice(0, 10)) errors.push("coveredDates must be consecutive");
    }
  }
  if (!Array.isArray(payload.events)) errors.push("events must be an array");
  if (!Number.isInteger(payload.searchPasses) || payload.searchPasses < 1) errors.push("searchPasses must be a positive integer");
  if (!Number.isInteger(payload.sourceCount) || payload.sourceCount < 0) errors.push("sourceCount must be a non-negative integer");
  if (Number.isNaN(Date.parse(payload.generatedAt))) errors.push("generatedAt must be a date-time");
  if (Number.isNaN(Date.parse(payload.publishedAt))) errors.push("publishedAt must be a date-time");

  for (const [index, event] of (payload.events ?? []).entries()) {
    const prefix = `events[${index}]`;
    const requiredStrings = ["id", "title", "summary", "startAt", "venueName", "ward", "nearestStation", "priceLabel", "sameDayNote", "sourceLabel", "sourceUrl", "lastCheckedAt"];
    for (const key of requiredStrings) {
      if (typeof event[key] !== "string" || !event[key].trim()) errors.push(`${prefix}.${key} is required`);
    }
    if (!wards.has(event.ward)) errors.push(`${prefix}.ward is not a Tokyo special ward`);
    if (!Number.isInteger(event.kotakeMinutes) || event.kotakeMinutes < 1 || event.kotakeMinutes > 60) errors.push(`${prefix}.kotakeMinutes must be 1..60`);
    if (!availability.has(event.availability)) errors.push(`${prefix}.availability is invalid`);
    if (!reservations.has(event.reservation)) errors.push(`${prefix}.reservation is invalid`);
    if (!confidence.has(event.confidence)) errors.push(`${prefix}.confidence is invalid`);
    if (!Number.isInteger(event.recommendationScore) || event.recommendationScore < 0 || event.recommendationScore > 100) errors.push(`${prefix}.recommendationScore must be 0..100`);
    if (!Array.isArray(event.tags) || event.tags.length === 0) errors.push(`${prefix}.tags must not be empty`);
    if (!/^https:\/\//i.test(event.sourceUrl ?? "")) errors.push(`${prefix}.sourceUrl must use https`);
    if (Number.isNaN(Date.parse(event.startAt)) || (event.endAt !== null && Number.isNaN(Date.parse(event.endAt)))) errors.push(`${prefix} has invalid times`);
    if (!validCoveredDates.includes((event.startAt ?? "").slice(0, 10))) errors.push(`${prefix}.startAt is outside coveredDates`);
    if (event.endAt !== null && Date.parse(event.endAt) <= Date.parse(event.startAt)) errors.push(`${prefix}.endAt must be after startAt or null`);
    if (!event.image || typeof event.image !== "object") errors.push(`${prefix}.image is required`);
    if (event.image?.url !== null && !/^(?:https:\/\/|\/images\/events\/)/i.test(event.image?.url ?? "")) errors.push(`${prefix}.image.url must be a cached event image, https, or null`);
  }
  const ids = (payload.events ?? []).map((event) => event.id);
  if (new Set(ids).size !== ids.length) errors.push("event ids must be unique");
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1)))) {
  const file = process.argv[2];
  const expectedDate = process.argv[3];
  if (!file) {
    console.error("Usage: node scripts/validate-events.mjs <file> [YYYY-MM-DD]");
    process.exit(2);
  }
  const payload = JSON.parse(fs.readFileSync(file, "utf8"));
  const errors = validatePayload(payload, expectedDate);
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
  console.log(`Validated ${payload.events.length} events for ${payload.generatedFor}.`);
}
