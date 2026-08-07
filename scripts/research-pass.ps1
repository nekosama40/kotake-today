param(
  [Parameter(Mandatory = $true)][string]$TargetDate,
  [Parameter(Mandatory = $true)][string]$TargetDatesCsv,
  [Parameter(Mandatory = $true)][string]$PassName,
  [Parameter(Mandatory = $true)][string]$Focus,
  [Parameter(Mandatory = $true)][string]$OutputFile,
  [Parameter(Mandatory = $true)][string]$PassLogFile,
  [string]$PriorPayloadFile = '',
  [Parameter(Mandatory = $true)][string]$RepositoryRoot
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath $RepositoryRoot).Path
$scriptDir = Join-Path $projectRoot 'scripts'
$workDir = Join-Path $projectRoot 'work'
$schemaFile = Join-Path $projectRoot 'schemas\research-output.schema.json'
$promptTemplate = Join-Path $projectRoot 'prompts\daily-update.md'
$promptFile = Join-Path $workDir "prompt-$TargetDate-$PassName.md"
$passSchemaFile = Join-Path $workDir "schema-$TargetDate-$PassName.json"
$targetDates = @($TargetDatesCsv.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ })

if ($targetDates.Count -lt 1 -or $targetDates.Count -gt 2) {
  throw "TargetDatesCsv must contain one or two dates for $PassName."
}

$isAdvancePass = $PassName.StartsWith('next-days-')
$searchMin = if ($isAdvancePass) { 12 } else { 16 }
$searchMax = if ($isAdvancePass) { 18 } else { 24 }
$scopeGuidance = if ($isAdvancePass) {
  '明日と明後日を1つの調査で横断してください。同じ施設の予定表や開催カレンダーは両日分をまとめて確認し、日付ごとに同じ検索を繰り返さないでください。新着の発見と前回候補の再確認を両立してください。'
}
else {
  '今日の選択肢を最優先で深く調査してください。通常調査の約2倍の探索量を確保し、現在時刻から参加できるイベントを幅広く確認してください。'
}

$priorCandidates = @()
if ($PriorPayloadFile -and (Test-Path -LiteralPath $PriorPayloadFile)) {
  $priorPayload = Get-Content -LiteralPath $PriorPayloadFile -Raw -Encoding utf8 | ConvertFrom-Json
  $priorCandidates = @($priorPayload.events | Where-Object {
    $candidateDate = [string]$_.startAt
    $candidateDate.Length -ge 10 -and $targetDates -contains $candidateDate.Substring(0, 10)
  } | ForEach-Object {
    [ordered]@{
      title = $_.title
      startAt = $_.startAt
      endAt = $_.endAt
      venueName = $_.venueName
      ward = $_.ward
      sourceUrl = $_.sourceUrl
      availability = $_.availability
      reservation = $_.reservation
      sameDayNote = $_.sameDayNote
    }
  })
}
$priorCandidatesJson = if ($priorCandidates.Count -eq 0) { '[]' } else { ConvertTo-Json -InputObject $priorCandidates -Depth 4 -Compress }

$template = Get-Content -LiteralPath $promptTemplate -Raw -Encoding utf8
$prompt = $template.Replace('{{TARGET_DATE}}', $TargetDate)
$prompt = $prompt.Replace('{{TARGET_DATES}}', ($targetDates -join ', '))
$prompt = $prompt.Replace('{{PASS_NAME}}', $PassName)
$prompt = $prompt.Replace('{{STARTED_AT}}', (Get-Date).ToString('o'))
$prompt = $prompt.Replace('{{PASS_FOCUS}}', $Focus)
$prompt = $prompt.Replace('{{SCOPE_GUIDANCE}}', $scopeGuidance)
$prompt = $prompt.Replace('{{SEARCH_MIN}}', [string]$searchMin)
$prompt = $prompt.Replace('{{SEARCH_MAX}}', [string]$searchMax)
$prompt = $prompt.Replace('{{PRIOR_CANDIDATES}}', $priorCandidatesJson)
Set-Content -LiteralPath $promptFile -Value $prompt -Encoding utf8
& node (Join-Path $scriptDir 'prepare-research-schema.mjs') $schemaFile $PassName $passSchemaFile
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

$utf8Encoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = $utf8Encoding
[Console]::InputEncoding = $utf8Encoding
[Console]::OutputEncoding = $utf8Encoding
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'

"[$((Get-Date).ToString('o'))] Starting $PassName" | Set-Content -LiteralPath $PassLogFile -Encoding utf8
Get-Content -LiteralPath $promptFile -Raw -Encoding utf8 | & codex @codexArgs 2>&1 | Tee-Object -FilePath $PassLogFile -Append
if ($LASTEXITCODE -ne 0) {
  throw "Codex research pass $PassName failed with exit code $LASTEXITCODE."
}
if (-not (Test-Path -LiteralPath $OutputFile)) {
  throw "Codex did not create $OutputFile."
}
