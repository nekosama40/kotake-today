param(
  [Parameter(Mandatory = $true)][string]$TargetDate,
  [Parameter(Mandatory = $true)][string]$PassName,
  [Parameter(Mandatory = $true)][string]$Focus,
  [Parameter(Mandatory = $true)][string]$OutputFile,
  [Parameter(Mandatory = $true)][string]$PassLogFile
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$workDir = Join-Path $projectRoot 'work'
$schemaFile = Join-Path $projectRoot 'schemas\research-output.schema.json'
$promptTemplate = Join-Path $projectRoot 'prompts\daily-update.md'
$promptFile = Join-Path $workDir "prompt-$TargetDate-$PassName.md"
$passSchemaFile = Join-Path $workDir "schema-$TargetDate-$PassName.json"

$template = Get-Content -LiteralPath $promptTemplate -Raw -Encoding utf8
$prompt = $template.Replace('{{TARGET_DATE}}', $TargetDate).Replace('{{PASS_NAME}}', $PassName).Replace('{{STARTED_AT}}', (Get-Date).ToString('o')).Replace('{{PASS_FOCUS}}', $Focus)
Set-Content -LiteralPath $promptFile -Value $prompt -Encoding utf8
& node (Join-Path $PSScriptRoot 'prepare-research-schema.mjs') $schemaFile $PassName $passSchemaFile
if ($LASTEXITCODE -ne 0) {
  throw "Unable to prepare the output schema for $PassName."
}

$codexArgs = @(
  'exec', '--ephemeral', '--color', 'never',
  '--sandbox', 'read-only',
  '--model', 'gpt-5.6-luna',
  '--config', 'model_reasoning_effort="max"',
  '--enable', 'browser_use',
  '--output-schema', $passSchemaFile,
  '--output-last-message', $OutputFile,
  '--cd', $projectRoot,
  '-'
)

"[$((Get-Date).ToString('o'))] Starting $PassName" | Set-Content -LiteralPath $PassLogFile -Encoding utf8
Get-Content -LiteralPath $promptFile -Raw -Encoding utf8 | & codex @codexArgs 2>&1 | Tee-Object -FilePath $PassLogFile -Append
if ($LASTEXITCODE -ne 0) {
  throw "Codex research pass $PassName failed with exit code $LASTEXITCODE."
}
if (-not (Test-Path -LiteralPath $OutputFile)) {
  throw "Codex did not create $OutputFile."
}
