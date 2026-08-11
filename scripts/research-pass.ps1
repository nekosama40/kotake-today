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
$sourceConfig = Join-Path $projectRoot 'config\research-sources.json'
$promptFile = Join-Path $workDir "prompt-$TargetDate-$PassName.md"
$passSchemaFile = Join-Path $workDir "schema-$TargetDate-$PassName.json"
$socialBriefFile = Join-Path $workDir "social-brief-$TargetDate-$PassName.md"
$monthlyDraftBriefFile = Join-Path $workDir "monthly-draft-brief-$TargetDate-$PassName.json"
$priorBriefFile = Join-Path $workDir "prior-brief-$TargetDate-$PassName.json"
$traceFile = Join-Path $workDir "research-$TargetDate-$PassName.trace.jsonl"
$stderrFile = Join-Path $workDir "research-$TargetDate-$PassName.stderr.log"
$targetDates = @($TargetDatesCsv.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ })

if ($targetDates.Count -lt 1 -or $targetDates.Count -gt 3) {
  throw "TargetDatesCsv must contain one to three dates for $PassName."
}

$isAdvancePass = $PassName.StartsWith('next-days-')
$isGapPass = $PassName -eq 'quality-and-gap'
$isSocialPass = $PassName -in @('local-and-long-tail', 'next-days-local-and-special')
$searchMin = switch ($PassName) {
  'local-and-long-tail' { 20 }
  'next-days-local-and-special' { 16 }
  'quality-and-gap' { 12 }
  default { if ($isAdvancePass) { 12 } else { 16 } }
}
$searchMax = switch ($PassName) {
  'local-and-long-tail' { 28 }
  'next-days-local-and-special' { 24 }
  'quality-and-gap' { 20 }
  default { if ($isAdvancePass) { 18 } else { 24 } }
}
$scopeGuidance = if ($isGapPass) {
  '先行5パスで不足した日付・ジャンル・近隣区だけを補完してください。前回候補を一覧として把握し、同じイベントの再出力より新しい候補の発見を優先してください。3日分を横断し、12〜20回で調査を終えてください。'
}
elseif ($isAdvancePass) {
  '明日と明後日を1つの調査で横断してください。同じ施設の予定表や開催カレンダーは両日分をまとめて確認し、日付ごとに同じ検索を繰り返さないでください。新着の発見と前回候補の再確認を両立してください。'
}
else {
  '今日の選択肢を最優先で深く調査してください。通常調査の約2倍の探索量を確保し、現在時刻から参加できるイベントを幅広く確認してください。'
}

$searchPlaybook = if ($isSocialPass) {
  @'
1. 監視リストから優先度の高いアカウントを選び、対象日を示す直近投稿・固定投稿・プロフィールリンクを確認する。
2. Xは `site:x.com` と「日付表記（M/D、M月D日、今日、明日、土曜、日曜）× 東京・区・駅・会場 × ジャンル」を組み替える。
3. Instagramは `site:instagram.com` と「日付・開催中・本日・今週末・当日参加・入場無料・予約不要」を組み替え、投稿・リール・プロフィールの公開情報を確認する。
4. 同じ企画でも、まとめアカウント→主催者→会場または出演者・出店者の順で最大2段階まで辿る。無関係なアカウント巡回はしない。
5. SNS以外では、まとめサイト、自治体、施設カレンダー、Peatix、connpass、Doorkeeper、TwiPla、Meetupをジャンルごとに使い分ける。
6. 候補を発見したら新規探索を一度止め、公式ページまたはチケットページで日付・場所・料金・当日参加・完売状況を確認してから次へ進む。
7. 総合、アニメ・キャラクター、ゲーム、アート、音楽、フード、祭り、IT・AI、交流会、店舗・学校・地域、小規模企画の各群が一度は検索されるようにする。
'@
}
else {
  'このパスの重点情報源を中心に、日付表記、区・駅・会場、ジャンル、予約不要・当日券などの条件を組み替えて検索してください。候補発見後は公式情報の確認を優先してください。'
}

$breakdownGuidance = switch ($PassName) {
  'local-and-long-tail' {
    '`searchBreakdown` は `watchlistChecks` 6〜10、`xDiscovery` 4〜7、`instagramDiscovery` 4〜7、`openWebVerification` 6〜10を入れ、4値の合計を `searchActions`（20〜28）と一致させてください。'
  }
  'next-days-local-and-special' {
    '`searchBreakdown` は `watchlistChecks` 4〜8、`xDiscovery` 3〜6、`instagramDiscovery` 3〜6、`openWebVerification` 6〜10を入れ、4値の合計を `searchActions`（16〜24）と一致させてください。'
  }
  'anime-character-and-food' {
    '`searchBreakdown` は `animeCharacter` と `food` を各8〜12入れ、2値の合計を `searchActions`（16〜24）と一致させてください。'
  }
  default {
    '`searchBreakdown` は `null` にしてください。'
  }
}

$priorCandidates = @()
if ($PriorPayloadFile -and (Test-Path -LiteralPath $PriorPayloadFile)) {
  Remove-Item -LiteralPath $priorBriefFile -Force -ErrorAction SilentlyContinue
  & node (Join-Path $scriptDir 'prepare-prior-brief.mjs') $PriorPayloadFile $TargetDatesCsv $PassName $priorBriefFile
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $priorBriefFile)) {
    throw "Unable to prepare the prior candidate brief for $PassName."
  }
  $priorBrief = Get-Content -LiteralPath $priorBriefFile -Raw -Encoding utf8 | ConvertFrom-Json
  $priorCandidates = @($priorBrief.candidates)
}
$priorCandidatesJson = if ($priorCandidates.Count -eq 0) { '[]' } else { ConvertTo-Json -InputObject $priorCandidates -Depth 4 -Compress }

$monthlyDraftCandidatesJson = '[]'
$monthlyDraftCandidateCount = 0
$monthlyDraftSummary = '対象日を含むLuna月間下書きはありません。通常の新規探索を続けてください。'
$monthlyDraftCommandOutput = @()
$priorPayloadArgument = if ($PriorPayloadFile) { $PriorPayloadFile } else { '-' }
Remove-Item -LiteralPath $monthlyDraftBriefFile -Force -ErrorAction SilentlyContinue
$savedDraftErrorPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$monthlyDraftCommandOutput = @(& node (Join-Path $scriptDir 'prepare-monthly-draft-brief.mjs') $workDir $TargetDatesCsv $PassName $priorPayloadArgument $monthlyDraftBriefFile 2>&1)
$monthlyDraftExitCode = $LASTEXITCODE
$ErrorActionPreference = $savedDraftErrorPreference
if ($monthlyDraftExitCode -eq 0 -and (Test-Path -LiteralPath $monthlyDraftBriefFile)) {
  try {
    $monthlyDraftBrief = Get-Content -LiteralPath $monthlyDraftBriefFile -Raw -Encoding utf8 | ConvertFrom-Json
    $monthlyDraftCandidates = @($monthlyDraftBrief.candidates)
    $monthlyDraftCandidateCount = $monthlyDraftCandidates.Count
    if ($monthlyDraftCandidateCount -gt 0) {
      $monthlyDraftCandidatesJson = ConvertTo-Json -InputObject $monthlyDraftCandidates -Depth 5 -Compress
    }
    if ($monthlyDraftBrief.draftFile) {
      $monthlyDraftSummary = "使用下書き: $($monthlyDraftBrief.draftFile)（作成 $($monthlyDraftBrief.draftGeneratedAt)）。このパスでは$monthlyDraftCandidateCount件を再確認してください。"
    }
  }
  catch {
    $monthlyDraftSummary = '月間下書き候補の読み込みに失敗しました。下書きに依存せず通常の新規探索を続けてください。'
    $monthlyDraftCandidatesJson = '[]'
    $monthlyDraftCandidateCount = 0
  }
}
elseif ($monthlyDraftExitCode -ne 0) {
  $monthlyDraftSummary = '月間下書き候補の準備に失敗しました。下書きに依存せず通常の新規探索を続けてください。'
}

if (-not (Test-Path -LiteralPath $sourceConfig)) {
  throw "Research source config does not exist: $sourceConfig"
}
& node (Join-Path $scriptDir 'prepare-social-brief.mjs') $sourceConfig $TargetDate $PassName $socialBriefFile
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $socialBriefFile)) {
  throw "Unable to prepare the social source brief for $PassName."
}
$socialWatchlist = Get-Content -LiteralPath $socialBriefFile -Raw -Encoding utf8

$template = Get-Content -LiteralPath $promptTemplate -Raw -Encoding utf8
$prompt = $template.Replace('{{TARGET_DATE}}', $TargetDate)
$prompt = $prompt.Replace('{{TARGET_DATES}}', ($targetDates -join ', '))
$prompt = $prompt.Replace('{{PASS_NAME}}', $PassName)
$prompt = $prompt.Replace('{{STARTED_AT}}', (Get-Date).ToString('o'))
$prompt = $prompt.Replace('{{PASS_FOCUS}}', $Focus)
$prompt = $prompt.Replace('{{SCOPE_GUIDANCE}}', $scopeGuidance)
$prompt = $prompt.Replace('{{SOCIAL_WATCHLIST}}', $socialWatchlist)
$prompt = $prompt.Replace('{{SEARCH_PLAYBOOK}}', $searchPlaybook)
$prompt = $prompt.Replace('{{SEARCH_MIN}}', [string]$searchMin)
$prompt = $prompt.Replace('{{SEARCH_MAX}}', [string]$searchMax)
$prompt = $prompt.Replace('{{BREAKDOWN_GUIDANCE}}', $breakdownGuidance)
$prompt = $prompt.Replace('{{PRIOR_CANDIDATES}}', $priorCandidatesJson)
$prompt = $prompt.Replace('{{MONTHLY_DRAFT_SUMMARY}}', $monthlyDraftSummary)
$prompt = $prompt.Replace('{{MONTHLY_DRAFT_CANDIDATES}}', $monthlyDraftCandidatesJson)
Set-Content -LiteralPath $promptFile -Value $prompt -Encoding utf8
& node (Join-Path $scriptDir 'prepare-research-schema.mjs') $schemaFile $PassName $passSchemaFile
if ($LASTEXITCODE -ne 0) {
  throw "Unable to prepare the output schema for $PassName."
}

$utf8Encoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = $utf8Encoding
[Console]::InputEncoding = $utf8Encoding
[Console]::OutputEncoding = $utf8Encoding
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'

$passStartLine = "[$((Get-Date).ToString('o'))] Starting $PassName"
$monthlyDraftLogLine = "[$((Get-Date).ToString('o'))] $PassName monthly draft recheck candidates: $monthlyDraftCandidateCount. $monthlyDraftSummary"
$passStartLine | Set-Content -LiteralPath $PassLogFile -Encoding utf8
$monthlyDraftCommandOutput | Add-Content -LiteralPath $PassLogFile -Encoding utf8
$monthlyDraftLogLine | Tee-Object -FilePath $PassLogFile -Append
$savedErrorPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$codexCommand = Get-Command codex -ErrorAction Stop
$codexBinDir = Split-Path -Parent $codexCommand.Source
$codexJs = Join-Path $codexBinDir 'node_modules\@openai\codex\bin\codex.js'
if (-not (Test-Path -LiteralPath $codexJs)) {
  throw "Unable to locate the installed Codex CLI JavaScript entry point."
}
& node (Join-Path $scriptDir 'run-codex-research.mjs') $codexJs $promptFile $passSchemaFile $OutputFile $traceFile $stderrFile $projectRoot 2>&1 | Add-Content -LiteralPath $PassLogFile -Encoding utf8
$codexExitCode = $LASTEXITCODE
$ErrorActionPreference = $savedErrorPreference
if ($codexExitCode -ne 0) {
  throw "Codex research pass $PassName failed with exit code $codexExitCode."
}
if (-not (Test-Path -LiteralPath $OutputFile)) {
  throw "Codex did not create $OutputFile."
}
