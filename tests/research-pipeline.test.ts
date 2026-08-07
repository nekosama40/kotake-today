import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mergeScript = path.join(projectRoot, "scripts", "merge-events.mjs");
const prepareSchemaScript = path.join(projectRoot, "scripts", "prepare-research-schema.mjs");
const schemaTemplate = path.join(projectRoot, "schemas", "research-output.schema.json");
const targetDate = "2099-01-01";

type PassName = "official-and-major" | "local-and-long-tail" | "anime-character-and-food";

function researchPass(passName: PassName, breakdown?: { animeCharacter: number; food: number }) {
  return {
    generatedFor: targetDate,
    passName,
    generatedAt: "2099-01-01T00:00:00+09:00",
    searchActions: breakdown ? breakdown.animeCharacter + breakdown.food : 16,
    searchBreakdown: breakdown ?? null,
    sourcesConsulted: [`https://example.com/${passName}`],
    events: [],
  };
}

function legacyResearchPass(passName: Exclude<PassName, "anime-character-and-food">) {
  const pass = { ...researchPass(passName) } as Record<string, unknown>;
  delete pass.searchBreakdown;
  return pass;
}

async function runMerge(passes: Array<Record<string, unknown>>, existingOutput?: string) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "kotake-merge-"));
  const passPaths = await Promise.all(passes.map(async (pass, index) => {
    const passPath = path.join(tempDir, `pass-${index}.json`);
    await writeFile(passPath, JSON.stringify(pass), "utf8");
    return passPath;
  }));
  const outputPath = path.join(tempDir, "events.json");
  if (existingOutput !== undefined) await writeFile(outputPath, existingOutput, "utf8");
  const result = spawnSync(process.execPath, [mergeScript, ...passPaths, outputPath, targetDate], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  return { tempDir, outputPath, result };
}

async function prepareSchema(passName: PassName) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "kotake-schema-"));
  const outputPath = path.join(tempDir, "schema.json");
  const result = spawnSync(process.execPath, [prepareSchemaScript, schemaTemplate, passName, outputPath], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  return { tempDir, outputPath, result };
}

describe("research pipeline", () => {
  it("prepares a strict output schema for each research-pass kind", async () => {
    const [standard, dedicated] = await Promise.all([
      prepareSchema("official-and-major"),
      prepareSchema("anime-character-and-food"),
    ]);
    try {
      expect(standard.result.status, standard.result.stderr).toBe(0);
      expect(dedicated.result.status, dedicated.result.stderr).toBe(0);
      const standardSchema = JSON.parse(await readFile(standard.outputPath, "utf8"));
      const dedicatedSchema = JSON.parse(await readFile(dedicated.outputPath, "utf8"));
      expect(standardSchema.properties.passName.enum).toEqual(["official-and-major"]);
      expect(standardSchema.properties.searchBreakdown).toEqual({ type: "null" });
      expect(dedicatedSchema.properties.passName.enum).toEqual(["anime-character-and-food"]);
      expect(dedicatedSchema.properties.searchBreakdown.type).toBe("object");
    } finally {
      await Promise.all([
        rm(standard.tempDir, { recursive: true, force: true }),
        rm(dedicated.tempDir, { recursive: true, force: true }),
      ]);
    }
  });

  it("merges all three distinct research passes", async () => {
    const execution = await runMerge([
      researchPass("official-and-major"),
      researchPass("local-and-long-tail"),
      researchPass("anime-character-and-food", { animeCharacter: 8, food: 8 }),
    ]);
    try {
      expect(execution.result.status, execution.result.stderr).toBe(0);
      const output = JSON.parse(await readFile(execution.outputPath, "utf8"));
      expect(output.searchPasses).toBe(3);
    } finally {
      await rm(execution.tempDir, { recursive: true, force: true });
    }
  });

  it("keeps compatibility with the original two-pass merge", async () => {
    const execution = await runMerge([
      legacyResearchPass("official-and-major"),
      legacyResearchPass("local-and-long-tail"),
    ]);
    try {
      expect(execution.result.status, execution.result.stderr).toBe(0);
      const output = JSON.parse(await readFile(execution.outputPath, "utf8"));
      expect(output.searchPasses).toBe(2);
    } finally {
      await rm(execution.tempDir, { recursive: true, force: true });
    }
  });

  it("requires an explicit null breakdown from standard passes in a three-pass run", async () => {
    const existingOutput = "preserve-three-pass-output\n";
    const execution = await runMerge([
      legacyResearchPass("official-and-major"),
      researchPass("local-and-long-tail"),
      researchPass("anime-character-and-food", { animeCharacter: 8, food: 8 }),
    ], existingOutput);
    try {
      expect(execution.result.status).not.toBe(0);
      expect(await readFile(execution.outputPath, "utf8")).toBe(existingOutput);
    } finally {
      await rm(execution.tempDir, { recursive: true, force: true });
    }
  });

  it("rejects an invalid dedicated-search breakdown without replacing existing output", async () => {
    const existingOutput = "preserve-this-output\n";
    const execution = await runMerge([
      researchPass("official-and-major"),
      researchPass("local-and-long-tail"),
      researchPass("anime-character-and-food", { animeCharacter: 7, food: 9 }),
    ], existingOutput);
    try {
      expect(execution.result.status).not.toBe(0);
      expect(await readFile(execution.outputPath, "utf8")).toBe(existingOutput);
    } finally {
      await rm(execution.tempDir, { recursive: true, force: true });
    }
  });

  it("keeps three jobs, the dedicated split, and the before-seven schedule configured", async () => {
    const generationScript = await readFile(path.join(projectRoot, "scripts", "generate-events.ps1"), "utf8");
    const researchScript = await readFile(path.join(projectRoot, "scripts", "research-pass.ps1"), "utf8");
    const taskScript = await readFile(path.join(projectRoot, "scripts", "register-scheduled-tasks.ps1"), "utf8");
    expect(generationScript.match(/Start-Job -Name/g)).toHaveLength(3);
    expect(generationScript).toContain("'anime-character-and-food'");
    expect(generationScript).toContain("Spend 8 to 12 distinct searches on each side");
    expect(researchScript).toContain("prepare-research-schema.mjs");
    expect(researchScript).toContain("'--output-schema', $passSchemaFile");
    expect(taskScript).toContain("-At '04:45'");
    expect(taskScript).toContain("-At '06:25'");
    expect(taskScript).toContain("-At '06:35'");
  });
});
