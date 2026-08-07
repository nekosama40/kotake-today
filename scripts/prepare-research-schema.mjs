import fs from "node:fs/promises";

const [templatePath, passName, outputPath] = process.argv.slice(2);
const passConfigs = new Map([
  ["official-and-major", { dateCount: 1, searchMin: 16, searchMax: 24, dedicated: false }],
  ["local-and-long-tail", { dateCount: 1, searchMin: 16, searchMax: 24, dedicated: false }],
  ["anime-character-and-food", { dateCount: 1, searchMin: 16, searchMax: 24, dedicated: true }],
  ["next-days-official-and-major", { dateCount: 2, searchMin: 12, searchMax: 18, dedicated: false }],
  ["next-days-local-and-special", { dateCount: 2, searchMin: 12, searchMax: 18, dedicated: false }],
]);

if (!templatePath || !passName || !outputPath) {
  console.error("Usage: node scripts/prepare-research-schema.mjs <template> <pass-name> <output>");
  process.exit(2);
}
const config = passConfigs.get(passName);
if (!config) {
  throw new Error(`Unsupported research pass: ${passName}`);
}

const schema = JSON.parse(await fs.readFile(templatePath, "utf8"));
schema.properties.passName.enum = [passName];
schema.properties.targetDates.minItems = config.dateCount;
schema.properties.targetDates.maxItems = config.dateCount;
schema.properties.searchActions.minimum = config.searchMin;
schema.properties.searchActions.maximum = config.searchMax;
schema.properties.searchBreakdown = config.dedicated
  ? { ...schema.properties.searchBreakdown, type: "object" }
  : { type: "null" };

await fs.writeFile(outputPath, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
console.log(`Prepared strict research schema for ${passName}.`);
