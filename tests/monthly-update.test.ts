import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");
const validator = path.join(projectRoot, "scripts", "validate-events.mjs");
const monthlyMerge = path.join(projectRoot, "scripts", "merge-monthly-research.mjs");
const monthlyPublication = path.join(projectRoot, "scripts", "prepare-monthly-publication.mjs");

function dates(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date("2099-01-01T00:00:00Z");
    date.setUTCDate(date.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
}

function payload(coveredDates: string[]) {
  return {
    generatedFor: coveredDates[0],
    coveredDates,
    generatedAt: "2098-12-31T15:00:00.000Z",
    publishedAt: "2098-12-31T15:00:00.000Z",
    searchPasses: 6,
    sourceCount: 0,
    events: [],
  };
}

describe("on-demand monthly updates", () => {
  it("accepts 31 consecutive covered dates and rejects 32", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "kotake-monthly-validator-"));
    try {
      const validPath = path.join(tempDir, "valid.json");
      const invalidPath = path.join(tempDir, "invalid.json");
      await writeFile(validPath, JSON.stringify(payload(dates(31))), "utf8");
      await writeFile(invalidPath, JSON.stringify(payload(dates(32))), "utf8");
      const valid = spawnSync(process.execPath, [validator, validPath, "2099-01-01"], { encoding: "utf8" });
      const invalid = spawnSync(process.execPath, [validator, invalidPath, "2099-01-01"], { encoding: "utf8" });
      expect(valid.status, valid.stderr).toBe(0);
      expect(invalid.status).toBe(1);
      expect(invalid.stderr).toContain("one to 31 dates");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("merges month lanes into one 31-day payload", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "kotake-monthly-merge-"));
    try {
      const targetDates = dates(31);
      const pass = {
        generatedFor: targetDates[0],
        targetDates,
        passName: "monthly-official-major",
        generatedAt: "2098-12-31T15:00:00.000Z",
        searchActions: 22,
        searchBreakdown: null,
        sourcesConsulted: ["https://example.com/event"],
        events: [],
      };
      const passPath = path.join(tempDir, "pass.json");
      const outputPath = path.join(tempDir, "merged.json");
      const publicationPath = path.join(tempDir, "publication.json");
      await writeFile(passPath, JSON.stringify(pass), "utf8");
      const result = spawnSync(process.execPath, [monthlyMerge, passPath, outputPath], { encoding: "utf8" });
      expect(result.status, result.stderr).toBe(0);
      const output = JSON.parse(await readFile(outputPath, "utf8"));
      expect(output.coveredDates).toEqual(targetDates);
      expect(output.searchPasses).toBe(1);
      expect(Object.keys(output.countsByDate)).toHaveLength(31);
      const publication = spawnSync(process.execPath, [monthlyPublication, outputPath, publicationPath, "2099-01-01"], { encoding: "utf8" });
      expect(publication.status, publication.stderr).toBe(0);
      const publishable = JSON.parse(await readFile(publicationPath, "utf8"));
      expect(publishable.coveredDates).toEqual(targetDates);
      expect(publishable.events).toEqual([]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("keeps the monthly runner manual and Luna max", async () => {
    const monthlyUpdate = await readFile(path.join(projectRoot, "scripts", "run-monthly-update.ps1"), "utf8");
    const monthlyResearch = await readFile(path.join(projectRoot, "scripts", "run-monthly-research.ps1"), "utf8");
    const codexRunner = await readFile(path.join(projectRoot, "scripts", "run-codex-research.mjs"), "utf8");
    expect(monthlyUpdate).toContain("KotakeEvents-Daily is enabled");
    expect(monthlyUpdate).toContain("-UpdateMode Monthly");
    expect(monthlyResearch).toContain("monthly-quality-gap");
    expect(codexRunner).toContain('"gpt-6-luna"');
    expect(codexRunner).toContain('model_reasoning_effort="max"');
    expect(codexRunner).toContain("isJavaScriptEntry");
    expect(codexRunner).toContain("spawn(command, args");
  });
});
