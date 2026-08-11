import fs from "node:fs/promises";
import path from "node:path";

const [workDir, targetDate, outputPath, expectedPassNamesCsv] = process.argv.slice(2);
if (!workDir || !targetDate || !outputPath) {
  console.error("Usage: node scripts/summarize-research-traces.mjs <work-dir> <YYYY-MM-DD> <output>");
  process.exit(2);
}

const filePattern = new RegExp(`^research-${targetDate}-(.+)\\.trace\\.jsonl$`);
const expectedPassNames = expectedPassNamesCsv?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
const allFiles = (await fs.readdir(workDir)).filter((name) => filePattern.test(name));
const files = expectedPassNames.length === 0
  ? allFiles
  : allFiles.filter((name) => expectedPassNames.includes(name.match(filePattern)?.[1] ?? ""));
const passes = [];
for (const name of files) {
  const lines = (await fs.readFile(path.join(workDir, name), "utf8")).split(/\r?\n/).filter(Boolean);
  let usage = null;
  let webActions = 0;
  let turnCompleted = false;
  let malformedRecords = 0;
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      const itemType = entry.item?.type ?? entry.type ?? "";
      if (/web|search|browser/i.test(itemType)) webActions += 1;
      if (entry.type === "turn.completed") {
        turnCompleted = true;
        if (entry.usage) usage = entry.usage;
      }
    } catch {
      malformedRecords += 1;
    }
  }
  passes.push({ passName: name.match(filePattern)?.[1], turnCompleted, webActions, malformedRecords, usage });
}

if (expectedPassNames.length > 0 && files.length !== expectedPassNames.length
  || passes.some((pass) => !pass.turnCompleted || pass.webActions < 1 || pass.malformedRecords > 0)) {
  throw new Error("Research JSONL traces are incomplete, malformed, or missing verified Web actions.");
}

const numericUsageKeys = new Set(passes.flatMap((pass) => Object.keys(pass.usage ?? {}))
  .filter((key) => Number.isFinite(passes.find((item) => Number.isFinite(item.usage?.[key]))?.usage?.[key])));
const totals = Object.fromEntries([...numericUsageKeys].map((key) => [
  key,
  passes.reduce((sum, pass) => sum + Number(pass.usage?.[key] ?? 0), 0),
]));
const summary = {
  targetDate,
  generatedAt: new Date().toISOString(),
  passCount: passes.length,
  webActions: passes.reduce((sum, pass) => sum + pass.webActions, 0),
  usage: totals,
  passes: passes.sort((a, b) => a.passName.localeCompare(b.passName)),
};
await fs.writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(`Summarized ${passes.length} JSONL research traces.`);
