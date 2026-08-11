import fs from "node:fs/promises";
import path from "node:path";

const [configPath, targetDate, passName, outputPath] = process.argv.slice(2);
const socialPasses = new Set(["local-and-long-tail", "next-days-local-and-special"]);
const themedPasses = new Set(["anime-character-and-food"]);

if (!configPath || !targetDate || !passName || !outputPath) {
  console.error("Usage: node scripts/prepare-social-brief.mjs <config> <YYYY-MM-DD> <pass-name> <output>");
  process.exit(2);
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
  throw new Error(`Invalid target date: ${targetDate}`);
}

const config = JSON.parse(await fs.readFile(configPath, "utf8"));
let performance = { sources: [] };
try {
  performance = JSON.parse(await fs.readFile(path.resolve(path.dirname(configPath), "..", "work", "source-performance.json"), "utf8"));
} catch {
  // The first run has no source-yield history yet.
}
const accounts = Array.isArray(config.accounts) ? config.accounts : [];
const directories = Array.isArray(config.directories) ? config.directories : [];
const ids = new Set();
const urls = new Set();

for (const account of accounts) {
  if (!account.id || ids.has(account.id)) throw new Error(`Duplicate or missing account id: ${account.id ?? "(missing)"}`);
  if (!account.url?.startsWith("https://") || urls.has(account.url)) throw new Error(`Duplicate or invalid account URL: ${account.url ?? "(missing)"}`);
  if (!Array.isArray(account.genres) || account.genres.length === 0) throw new Error(`Account ${account.id} must have genres.`);
  ids.add(account.id);
  urls.add(account.url);
}
for (const directory of directories) {
  if (!directory.url?.startsWith("https://")) throw new Error(`Invalid directory URL: ${directory.url ?? "(missing)"}`);
}

const date = new Date(`${targetDate}T00:00:00Z`);
const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
const dayOfYear = Math.floor((date - yearStart) / 86_400_000) + 1;
const rotation = dayOfYear % 2 === 0 ? "rotation-a" : "rotation-b";
const themedGenres = new Set(["アニメ", "キャラクター", "ゲーム", "コラボカフェ", "ポップアップ", "フード", "期間限定"]);

let selectedAccounts = [];
let selectedDirectories = [];
if (socialPasses.has(passName)) {
  selectedAccounts = accounts.filter((account) => account.cadence === "core" || account.cadence === rotation);
  selectedDirectories = directories;
} else if (themedPasses.has(passName)) {
  selectedAccounts = accounts.filter((account) => account.genres.some((genre) => themedGenres.has(genre)));
  selectedDirectories = directories.filter((directory) => directory.genres.some((genre) => themedGenres.has(genre)));
}

function accountYield(account) {
  const handle = String(account.handle ?? "").replace(/^@/, "").toLowerCase();
  const accountUrl = account.url.toLowerCase().replace(/\/$/, "");
  return (performance.sources ?? []).reduce((total, source) => {
    const sourceUrl = String(source.url ?? "").toLowerCase();
    return total + (sourceUrl.startsWith(accountUrl) || (handle && sourceUrl.includes(handle)) ? Number(source.eventYield ?? 0) : 0);
  }, 0);
}

selectedAccounts.sort((left, right) => accountYield(right) - accountYield(left)
  || left.rank - right.rank || left.name.localeCompare(right.name, "ja"));
const cadenceLabel = (cadence) => cadence === "core" ? "毎日優先" : "交互確認";
const accountLines = selectedAccounts.length === 0
  ? ["- このパスでは監視アカウントの個別確認は必須ではありません。"]
  : selectedAccounts.map((account) => {
    const yieldCount = accountYield(account);
    const performanceLabel = yieldCount > 0 ? `／前回採用${yieldCount}件` : "";
    return `- [${cadenceLabel(account.cadence)}／${account.platform}${performanceLabel}] ${account.name} ${account.handle}: ${account.url} — ${account.genres.join("・")}。${account.note}`;
  });
const directoryLines = selectedDirectories.length === 0
  ? ["- このパスではSNS以外のまとめ先リストは使用しません。"]
  : selectedDirectories.map((directory) => `- ${directory.name}: ${directory.url} — ${directory.genres.join("・")}`);

const markdown = [
  `監視リスト更新日: ${config.updatedAt ?? "不明"}`,
  `今回の交互確認グループ: ${rotation === "rotation-a" ? "A" : "B"}`,
  "",
  "### マーク済み公開アカウント",
  ...accountLines,
  "",
  "### まとめサイト・コミュニティ一覧",
  ...directoryLines,
  "",
  "アカウントやまとめサイトは発見用です。候補ごとに投稿日時、対象日、会場、受付状況を確認し、可能なら主催者・会場・チケットの公式ページで裏取りしてください。",
  "公開投稿を取得できない場合はログイン回避を試みず、同じハンドルを site:x.com または site:instagram.com で検索してください。",
  "",
].join("\n");

await fs.writeFile(outputPath, markdown, "utf8");
console.log(`Prepared ${selectedAccounts.length} marked accounts and ${selectedDirectories.length} directories for ${passName} (${rotation}).`);
