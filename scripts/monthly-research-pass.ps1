param(
  [Parameter(Mandatory = $true)][string]$TargetDate,
  [Parameter(Mandatory = $true)][string]$TargetDatesCsv,
  [Parameter(Mandatory = $true)][string]$PassName,
  [Parameter(Mandatory = $true)][string]$Focus,
  [Parameter(Mandatory = $true)][string]$OutputFile,
  [Parameter(Mandatory = $true)][string]$PassLogFile,
  [Parameter(Mandatory = $true)][string]$SchemaFile,
  [Parameter(Mandatory = $true)][string]$RepositoryRoot
)

$ErrorActionPreference = 'Stop'
$targetDates = @($TargetDatesCsv.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if ($targetDates.Count -lt 1 -or $targetDates.Count -gt 31) {
  throw 'Monthly research must receive one to 31 target dates.'
}

$projectRoot = (Resolve-Path -LiteralPath $RepositoryRoot).Path
$scriptDir = Join-Path $projectRoot 'scripts'
$configFile = Join-Path $projectRoot 'config\research-sources.json'
$outputDirectory = [IO.Path]::GetDirectoryName($OutputFile)
$briefFile = Join-Path $outputDirectory "social-brief-$PassName.md"
$promptFile = Join-Path $outputDirectory "prompt-$PassName.md"
$traceFile = Join-Path $outputDirectory "$PassName.trace.jsonl"
$stderrFile = Join-Path $outputDirectory "$PassName.stderr.log"
$isSocialPass = $PassName -in @('monthly-social-local', 'monthly-anime-character', 'monthly-food', 'monthly-quality-gap')
$briefPassName = if ($PassName -in @('monthly-anime-character', 'monthly-food')) {
  'anime-character-and-food'
}
elseif ($isSocialPass) {
  'local-and-long-tail'
}
else {
  $null
}

New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
if ($briefPassName) {
  & node (Join-Path $scriptDir 'prepare-social-brief.mjs') $configFile $TargetDate $briefPassName $briefFile | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Unable to prepare the social brief for $PassName." }
  $socialWatchlist = Get-Content -LiteralPath $briefFile -Raw -Encoding utf8
}
else {
  $socialWatchlist = 'This lane does not require individual watchlist checks.'
}

$targetDatesText = $targetDates -join ', '
$prompt = @"
# Tokyo 23 Wards - On-demand Monthly Event Research

Research base date: $TargetDate (Japan time)
Target dates: $targetDatesText
Research lane: $PassName
Started at: $((Get-Date).ToString('o'))

You are the long-range event researcher for the Japanese site "こたけから、きょう。". Use public Web search and page browsing to collect events held on one or more target dates in Tokyo's 23 special wards, with normal public-transit travel of about 60 minutes or less and no more than one transfer from Kotake-mukaihara Station. Do not invent events from memory or assumptions.

For this run, use Web search and Web page browsing only. Do not use shells, local file reads, file edits, or command execution. The JSON Schema is already supplied by the CLI; do not read it from a local file.

## Lane focus

$Focus

## Marked discovery sources

$socialWatchlist

## Search volume

Perform 22 to 36 distinct searches or meaningful site checks in this lane. Vary Japanese and English queries, Japanese date formats, week and weekend wording, ward names, stations, venues, genres, and source types so the full target period is covered. After finding candidates, prioritize official verification. Do not add uncertain candidates just to increase the count.

## Required rules

- The venue must be in one of Tokyo's 23 special wards. Exclude candidates without a verifiable address or ward.
- Put exactly one official Japanese ward name in ward.
- targetDates must exactly equal all target dates in this prompt, in the same order.
- generatedFor must exactly equal the research base date.
- The event must be an in-person event at the venue; exclude online-only events.
- For multi-day exhibitions, pop-ups, and store programs, create date-specific records for eligible dates so each day can be displayed independently.
- kotakeMinutes must be a reasonable estimate from Kotake-mukaihara Station and no more than 60.
- transferCount is required and must be 0 or 1. Exclude events needing two or more transfers.
- Exclude sold-out, full, registration-closed, cancelled, postponed, or already-ended events.
- Exclude paid capacity-limited events when current availability cannot be verified.
- Prioritize walk-in, free-entry, same-day ticket, on-site reception, and events that allow joining partway through.
- Search broadly across exhibitions, anime, characters, manga, games, music, live shows, talks, workshops, IT, AI, food, markets, community events, schools, stores, local events, seasonal plans, and unusual projects.
- Treat esports as one ordinary genre; do not create an esports-only quota.
- Prefer official organizer, venue, facility, ticket, or municipality URLs. If discovery starts on X or Instagram, verify the candidate through official information when possible.
- Use only public X and Instagram posts. Do not bypass login restrictions or collect personal information.
- Do not infer the event date from the post date alone; verify the body, image date, profile links, and organizer or venue page.
- Use curation accounts for discovery only, then follow the organizer, venue, performer, or vendor up to two useful steps for verification.
- Put all useful discovery and verification sources in discoveredVia, including the public social post when it materially led to the event.
- Set an image URL only when an official page exposes it, and include attribution. Otherwise use null; the publication step will try the official page's preview image.
- If the official page has no closing time, set endAt to null rather than guessing.
- lastCheckedAt must record the actual time checked during this run.

## Output

Follow the supplied JSON Schema exactly. Set searchBreakdown to null. Do not include uncertain events. Put every actually checked URL, without duplicates, in sourcesConsulted.
"@
Set-Content -LiteralPath $promptFile -Value $prompt -Encoding utf8

$utf8Encoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = $utf8Encoding
[Console]::InputEncoding = $utf8Encoding
[Console]::OutputEncoding = $utf8Encoding
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'

"[$((Get-Date).ToString('o'))] Starting $PassName with Luna max" | Set-Content -LiteralPath $PassLogFile -Encoding utf8
$codexCommand = Get-Command codex -ErrorAction Stop
$codexBinDir = Split-Path -Parent $codexCommand.Source
$codexJs = Join-Path $codexBinDir 'node_modules\@openai\codex\bin\codex.js'
if (-not (Test-Path -LiteralPath $codexJs)) {
  throw 'Unable to locate the installed Codex CLI JavaScript entry point.'
}

$savedErrorPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& node (Join-Path $scriptDir 'run-codex-research.mjs') $codexJs $promptFile $SchemaFile $OutputFile $traceFile $stderrFile $projectRoot 2>&1 | Add-Content -LiteralPath $PassLogFile -Encoding utf8
$codexExitCode = $LASTEXITCODE
$ErrorActionPreference = $savedErrorPreference
if ($codexExitCode -ne 0) {
  throw "Codex monthly research pass $PassName failed with exit code $codexExitCode."
}
if (-not (Test-Path -LiteralPath $OutputFile)) {
  throw "Codex did not create $OutputFile."
}
