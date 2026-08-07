import fs from "node:fs/promises";

const [templatePath, passName, outputPath] = process.argv.slice(2);
const standardPasses = new Set(["official-and-major", "local-and-long-tail"]);
const dedicatedPass = "anime-character-and-food";

if (!templatePath || !passName || !outputPath) {
  console.error("Usage: node scripts/prepare-research-schema.mjs <template> <pass-name> <output>");
  process.exit(2);
}
if (!standardPasses.has(passName) && passName !== dedicatedPass) {
  throw new Error(`Unsupported research pass: ${passName}`);
}

const schema = JSON.parse(await fs.readFile(templatePath, "utf8"));
schema.properties.passName.enum = [passName];
schema.properties.searchBreakdown = passName === dedicatedPass
  ? { ...schema.properties.searchBreakdown, type: "object" }
  : { type: "null" };

await fs.writeFile(outputPath, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
console.log(`Prepared strict research schema for ${passName}.`);
