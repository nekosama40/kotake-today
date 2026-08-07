import fs from "node:fs/promises";
import { validatePayload } from "./validate-events.mjs";

const [pendingPath, outputPath, targetDate] = process.argv.slice(2);
if (!pendingPath || !outputPath || !targetDate) {
  console.error("Usage: node scripts/prepare-publish.mjs <pending> <output> <YYYY-MM-DD>");
  process.exit(2);
}

const raw = await fs.readFile(pendingPath, "utf8");
const payload = JSON.parse(raw.replace(/^\uFEFF/, ""));
const pendingErrors = validatePayload(payload, targetDate);
if (pendingErrors.length) {
  throw new Error(`Pending data is invalid:\n${pendingErrors.join("\n")}`);
}

payload.publishedAt = new Date().toISOString();
const serialized = `${JSON.stringify(payload, null, 2)}\n`;
const finalPayload = JSON.parse(serialized);
const finalErrors = validatePayload(finalPayload, targetDate);
if (finalErrors.length) {
  throw new Error(`Final data is invalid:\n${finalErrors.join("\n")}`);
}

await fs.writeFile(outputPath, serialized, "utf8");
console.log(`Prepared ${payload.events.length} events for publication.`);
