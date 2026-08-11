import fs from "node:fs/promises";

const [templatePath, passName, outputPath] = process.argv.slice(2);
const passConfigs = new Map([
  ["official-and-major", { dateCount: 1, searchMin: 16, searchMax: 24, breakdown: null }],
  ["local-and-long-tail", { dateCount: 1, searchMin: 20, searchMax: 28, breakdown: "social-today" }],
  ["anime-character-and-food", { dateCount: 1, searchMin: 16, searchMax: 24, breakdown: "anime-food" }],
  ["next-days-official-and-major", { dateCount: 2, searchMin: 12, searchMax: 18, breakdown: null }],
  ["next-days-local-and-special", { dateCount: 2, searchMin: 16, searchMax: 24, breakdown: "social-next" }],
  ["quality-and-gap", { dateCount: 3, searchMin: 12, searchMax: 20, breakdown: null }],
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
if (config.breakdown === "anime-food") {
  schema.properties.searchBreakdown = { ...schema.properties.searchBreakdown, type: "object" };
} else if (config.breakdown?.startsWith("social-")) {
  const today = config.breakdown === "social-today";
  schema.properties.searchBreakdown = {
    type: "object",
    properties: {
      watchlistChecks: { type: "integer", minimum: today ? 6 : 4, maximum: today ? 10 : 8 },
      xDiscovery: { type: "integer", minimum: today ? 4 : 3, maximum: today ? 7 : 6 },
      instagramDiscovery: { type: "integer", minimum: today ? 4 : 3, maximum: today ? 7 : 6 },
      openWebVerification: { type: "integer", minimum: 6, maximum: 10 },
    },
    required: ["watchlistChecks", "xDiscovery", "instagramDiscovery", "openWebVerification"],
    additionalProperties: false,
  };
} else {
  schema.properties.searchBreakdown = { type: "null" };
}

await fs.writeFile(outputPath, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
console.log(`Prepared strict research schema for ${passName}.`);
