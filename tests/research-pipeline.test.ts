import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mergeScript = path.join(projectRoot, "scripts", "merge-events.mjs");
const prepareSchemaScript = path.join(projectRoot, "scripts", "prepare-research-schema.mjs");
const prepareSocialBriefScript = path.join(projectRoot, "scripts", "prepare-social-brief.mjs");
const schemaTemplate = path.join(projectRoot, "schemas", "research-output.schema.json");
const researchSourcesConfig = path.join(projectRoot, "config", "research-sources.json");
const targetDate = "2099-01-01";

type PassName =
  | "official-and-major"
  | "local-and-long-tail"
  | "anime-character-and-food"
  | "next-days-official-and-major"
  | "next-days-local-and-special";

type SearchBreakdown =
  | { animeCharacter: number; food: number }
  | { watchlistChecks: number; xDiscovery: number; instagramDiscovery: number; openWebVerification: number }
  | null;

function eventFor(date: string, title: string) {
  return {
    id: "candidate",
    title,
    summary: "説明",
    startAt: `${date}T10:00:00+09:00`,
    endAt: `${date}T18:00:00+09:00`,
    venueName: "会場",
    ward: "豊島区",
    nearestStation: "池袋駅",
    kotakeMinutes: 20,
    priceLabel: "無料",
    minPriceYen: 0,
    isFree: true,
    availability: "walk_in",
    reservation: "not_required",
    sameDayNote: "自由入場",
    tags: ["展示"],
    sourceLabel: "公式",
    sourceUrl: `https://example.com/${date}/${encodeURIComponent(title)}`,
    lastCheckedAt: `${date}T06:00:00+09:00`,
    image: { url: null, alt: `${title}の画像`, attribution: null, sourceUrl: null },
    confidence: "high",
    recommendationScore: 80,
  };
}

function defaultBreakdown(passName: PassName): SearchBreakdown {
  if (passName === "anime-character-and-food") return { animeCharacter: 8, food: 8 };
  if (passName === "local-and-long-tail") {
    return { watchlistChecks: 6, xDiscovery: 4, instagramDiscovery: 4, openWebVerification: 6 };
  }
  if (passName === "next-days-local-and-special") {
    return { watchlistChecks: 4, xDiscovery: 3, instagramDiscovery: 3, openWebVerification: 6 };
  }
  return null;
}

function researchPass(passName: PassName, breakdown?: SearchBreakdown, events: Array<Record<string, unknown>> = []) {
  const isAdvance = passName.startsWith("next-days-");
  const resolvedBreakdown = breakdown === undefined ? defaultBreakdown(passName) : breakdown;
  const searchActions = resolvedBreakdown
    ? Object.values(resolvedBreakdown).reduce((total, value) => total + value, 0)
    : isAdvance ? 12 : 16;
  return {
    generatedFor: targetDate,
    targetDates: isAdvance ? ["2099-01-02", "2099-01-03"] : [targetDate],
    passName,
    generatedAt: "2099-01-01T00:00:00+09:00",
    searchActions,
    searchBreakdown: resolvedBreakdown,
    sourcesConsulted: [`https://example.com/${passName}`],
    events,
  };
}

function legacyResearchPass(passName: Exclude<PassName, "anime-character-and-food">) {
  const pass = { ...researchPass(passName) } as Record<string, unknown>;
  delete pass.searchBreakdown;
  delete pass.targetDates;
  return pass;
}

async function runMerge(
  passes: Array<Record<string, unknown>>,
  existingOutput?: string,
  previousPayload?: Record<string, unknown>,
) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "kotake-merge-"));
  const passPaths = await Promise.all(passes.map(async (pass, index) => {
    const passPath = path.join(tempDir, `pass-${index}.json`);
    await writeFile(passPath, JSON.stringify(pass), "utf8");
    return passPath;
  }));
  const outputPath = path.join(tempDir, "events.json");
  const previousPath = path.join(tempDir, "previous.json");
  if (existingOutput !== undefined) await writeFile(outputPath, existingOutput, "utf8");
  if (previousPayload) await writeFile(previousPath, JSON.stringify(previousPayload), "utf8");
  const result = spawnSync(process.execPath, [mergeScript, ...passPaths, outputPath, targetDate, previousPayload ? previousPath : "-"], {
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
    const [standard, dedicated, social, advance] = await Promise.all([
      prepareSchema("official-and-major"),
      prepareSchema("anime-character-and-food"),
      prepareSchema("local-and-long-tail"),
      prepareSchema("next-days-official-and-major"),
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
      const socialSchema = JSON.parse(await readFile(social.outputPath, "utf8"));
      expect(socialSchema.properties.searchActions.minimum).toBe(20);
      expect(socialSchema.properties.searchActions.maximum).toBe(28);
      expect(socialSchema.properties.searchBreakdown.required).toEqual([
        "watchlistChecks", "xDiscovery", "instagramDiscovery", "openWebVerification",
      ]);
      const advanceSchema = JSON.parse(await readFile(advance.outputPath, "utf8"));
      expect(advanceSchema.properties.targetDates.minItems).toBe(2);
      expect(advanceSchema.properties.targetDates.maxItems).toBe(2);
      expect(advanceSchema.properties.searchActions.minimum).toBe(12);
      expect(advanceSchema.properties.searchActions.maximum).toBe(18);
    } finally {
      await Promise.all([
        rm(standard.tempDir, { recursive: true, force: true }),
        rm(dedicated.tempDir, { recursive: true, force: true }),
        rm(social.tempDir, { recursive: true, force: true }),
        rm(advance.tempDir, { recursive: true, force: true }),
      ]);
    }
  });

  it("merges all five distinct research passes across three days", async () => {
    const execution = await runMerge([
      researchPass("official-and-major"),
      researchPass("local-and-long-tail"),
      researchPass("anime-character-and-food", { animeCharacter: 8, food: 8 }),
      researchPass("next-days-official-and-major", undefined, [eventFor("2099-01-02", "明日のイベント")]),
      researchPass("next-days-local-and-special", undefined, [eventFor("2099-01-03", "明後日のイベント")]),
    ]);
    try {
      expect(execution.result.status, execution.result.stderr).toBe(0);
      const output = JSON.parse(await readFile(execution.outputPath, "utf8"));
      expect(output.searchPasses).toBe(5);
      expect(output.coveredDates).toEqual(["2099-01-01", "2099-01-02", "2099-01-03"]);
      expect(output.events.map((event: { startAt: string }) => event.startAt.slice(0, 10))).toEqual(["2099-01-02", "2099-01-03"]);
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

  it("preserves already-published same-day events on a later rerun", async () => {
    const passes = [
      researchPass("official-and-major"),
      researchPass("local-and-long-tail"),
      researchPass("anime-character-and-food", { animeCharacter: 8, food: 8 }),
      researchPass("next-days-official-and-major"),
      researchPass("next-days-local-and-special"),
    ];
    const previousPayload = {
      generatedFor: targetDate,
      coveredDates: [targetDate],
      generatedAt: "2099-01-01T00:00:00+09:00",
      publishedAt: "2099-01-01T07:00:00+09:00",
      searchPasses: 3,
      sourceCount: 1,
      events: [eventFor(targetDate, "朝に掲載済みのイベント")],
    };
    const execution = await runMerge(passes, undefined, previousPayload);
    try {
      expect(execution.result.status, execution.result.stderr).toBe(0);
      const output = JSON.parse(await readFile(execution.outputPath, "utf8"));
      expect(output.events.map((event: { title: string }) => event.title)).toContain("朝に掲載済みのイベント");
    } finally {
      await rm(execution.tempDir, { recursive: true, force: true });
    }
  });

  it("requires a measured social-search breakdown in a five-pass run", async () => {
    const existingOutput = "preserve-five-pass-output\n";
    const invalidSocialPass = researchPass("local-and-long-tail", null);
    invalidSocialPass.searchActions = 20;
    const execution = await runMerge([
      researchPass("official-and-major"),
      invalidSocialPass,
      researchPass("anime-character-and-food"),
      researchPass("next-days-official-and-major"),
      researchPass("next-days-local-and-special"),
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

  it("builds a marked social-account brief with daily and rotating sources", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "kotake-social-brief-"));
    const outputPath = path.join(tempDir, "social-brief.md");
    const result = spawnSync(process.execPath, [
      prepareSocialBriefScript,
      researchSourcesConfig,
      targetDate,
      "local-and-long-tail",
      outputPath,
    ], { cwd: projectRoot, encoding: "utf8" });
    try {
      expect(result.status, result.stderr).toBe(0);
      const brief = await readFile(outputPath, "utf8");
      expect(brief).toContain("@event_checker");
      expect(brief).toContain("毎日優先");
      expect(brief).toContain("交互確認");
      expect(brief).toContain("Peatix 東京検索");
      expect(brief).toContain("site:x.com");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("keeps five jobs, the efficient next-days passes, and the before-seven schedule configured", async () => {
    const generationScript = await readFile(path.join(projectRoot, "scripts", "generate-events.ps1"), "utf8");
    const researchScript = await readFile(path.join(projectRoot, "scripts", "research-pass.ps1"), "utf8");
    const taskScript = await readFile(path.join(projectRoot, "scripts", "register-scheduled-tasks.ps1"), "utf8");
    expect(generationScript.match(/Start-Job -Name/g)).toHaveLength(5);
    expect(generationScript).toContain("'anime-character-and-food'");
    expect(generationScript).toContain("'next-days-official-and-major'");
    expect(generationScript).toContain("'next-days-local-and-special'");
    expect(generationScript).toContain("Spend 8 to 12 distinct searches on each side");
    expect(researchScript).toContain("prepare-research-schema.mjs");
    expect(researchScript).toContain("prepare-social-brief.mjs");
    expect(researchScript).toContain("watchlistChecks");
    expect(researchScript).toContain("$ErrorActionPreference = 'Continue'");
    expect(researchScript).toContain("$codexExitCode = $LASTEXITCODE");
    expect(researchScript).toContain("'--output-schema', $passSchemaFile");
    expect(taskScript).toContain("-At '04:30'");
    expect(taskScript).toContain("-At '06:25'");
    expect(taskScript).toContain("-At '06:35'");
  });
});
