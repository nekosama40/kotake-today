import fs from "node:fs";
import { spawn } from "node:child_process";

const [codexJs, promptPath, schemaPath, outputPath, tracePath, stderrPath, projectRoot] = process.argv.slice(2);
if (!codexJs || !promptPath || !schemaPath || !outputPath || !tracePath || !stderrPath || !projectRoot) {
  console.error("Usage: node scripts/run-codex-research.mjs <codex-js> <prompt> <schema> <output> <trace> <stderr> <project-root>");
  process.exit(2);
}

const args = [
  codexJs,
  "exec", "--ephemeral", "--color", "never", "--json",
  "--sandbox", "read-only",
  "--model", "gpt-5.6-luna",
  "--config", 'model_reasoning_effort="max"',
  "--enable", "browser_use",
  "--output-schema", schemaPath,
  "--output-last-message", outputPath,
  "--cd", projectRoot,
  "-",
];

fs.rmSync(outputPath, { force: true });
const trace = fs.createWriteStream(tracePath, { encoding: "utf8" });
const stderr = fs.createWriteStream(stderrPath, { encoding: "utf8" });
const child = spawn(process.execPath, args, { cwd: projectRoot, stdio: ["pipe", "pipe", "pipe"] });
fs.createReadStream(promptPath).pipe(child.stdin);
child.stdout.pipe(trace);
child.stderr.pipe(stderr);

let buffered = "";
let webActions = 0;
let usage = null;
let turnCompleted = false;
let malformedRecords = 0;
function inspectRecord(line) {
  if (!line.trim()) return;
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
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buffered += chunk;
  const lines = buffered.split(/\r?\n/);
  buffered = lines.pop() ?? "";
  for (const line of lines) inspectRecord(line);
});

child.on("error", (error) => {
  stderr.write(`${error.stack ?? error.message}\n`);
});

child.on("close", (code) => {
  inspectRecord(buffered);
  trace.end();
  stderr.end();
  const traceIsValid = turnCompleted && webActions > 0 && malformedRecords === 0 && fs.existsSync(outputPath);
  const exitCode = code === 0 && !traceIsValid ? 3 : code ?? 1;
  console.log(JSON.stringify({ exitCode, turnCompleted, webActions, malformedRecords, usage }));
  process.exitCode = exitCode;
});
