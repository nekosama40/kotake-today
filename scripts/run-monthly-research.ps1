param(
  [string]$TargetDate = (Get-Date).ToString('yyyy-MM-dd'),
  [string]$EndDate = '',
  [int]$PassTimeoutMinutes = 150
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$workDir = Join-Path $projectRoot 'work'
$baseDate = [DateTime]::ParseExact($TargetDate, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)
if (-not $EndDate) { $EndDate = $baseDate.AddDays(30).ToString('yyyy-MM-dd') }
$lastDate = [DateTime]::ParseExact($EndDate, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)
if ($lastDate -lt $baseDate) { throw 'EndDate must not be before TargetDate.' }

$targetDates = @()
for ($cursor = $baseDate; $cursor -le $lastDate; $cursor = $cursor.AddDays(1)) {
  $targetDates += $cursor.ToString('yyyy-MM-dd')
}
if ($targetDates.Count -gt 31) { throw 'Monthly research is limited to 31 dates.' }

$runStamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
$rangeDir = Join-Path $workDir "monthly-$TargetDate-to-$EndDate-$runStamp"
$finalFile = Join-Path $workDir "monthly-research-$TargetDate-to-$EndDate.json"
$candidateFile = Join-Path $rangeDir 'monthly-research.candidate.json'
$interimFile = Join-Path $rangeDir 'monthly-research.interim.json'
$schemaFile = Join-Path $rangeDir 'monthly-research.schema.json'
$logFile = Join-Path $rangeDir 'monthly-research.log'
$lockFile = Join-Path $workDir 'monthly-research.lock'
$passScript = Join-Path $PSScriptRoot 'monthly-research-pass.ps1'
$mergeScript = Join-Path $PSScriptRoot 'merge-monthly-research.mjs'
$standardPassNames = @(
  'monthly-official-major',
  'monthly-social-local',
  'monthly-anime-character',
  'monthly-food',
  'monthly-tech-games',
  'monthly-art-music-special'
)
$allPassNames = @($standardPassNames + 'monthly-quality-gap')

if (Test-Path -LiteralPath $lockFile) { throw "Monthly research is already running: $lockFile" }
if (-not (Test-Path -LiteralPath $passScript)) { throw "Missing monthly pass script: $passScript" }
New-Item -ItemType Directory -Path $rangeDir -Force | Out-Null
Set-Content -LiteralPath $lockFile -Value (Get-Date).ToString('o') -Encoding utf8

$schema = Get-Content -LiteralPath (Join-Path $projectRoot 'schemas\research-output.schema.json') -Raw -Encoding utf8 | ConvertFrom-Json
$schema.properties.passName.enum = $allPassNames
$schema.properties.targetDates.minItems = $targetDates.Count
$schema.properties.targetDates.maxItems = $targetDates.Count
$schema.properties.searchActions.minimum = 22
$schema.properties.searchActions.maximum = 36
$schema.properties.searchBreakdown = @{ type = 'null' }
$schema.properties.events.maxItems = 160
$schemaJson = ($schema | ConvertTo-Json -Depth 100) + [Environment]::NewLine
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($schemaFile, $schemaJson, $utf8NoBom)

$targetDatesCsv = $targetDates -join ','
$focuses = @{
  'monthly-official-major' = 'Search official organizers, Tokyo wards, public facilities, museums, galleries, commercial venues, hotels, live venues, and major event calendars. Balance exhibitions, seasonal programs, music, festivals, hands-on activities, food, and limited-time plans across the whole month.'
  'monthly-social-local' = 'Run a social-first long-tail search. Start with the marked public X and Instagram accounts and event directories, then follow public announcements from organizers, venues, performers, vendors, stores, schools, libraries, shopping streets, live houses, game bars, and local groups. Prioritize small, independent, walk-in-friendly plans and verify them with official pages.'
  'monthly-anime-character' = 'Run an anime and character focused lane. Search official IP, publisher and anime company pages, collaboration cafes, pop-ups, exhibitions, original-art shows, merchandise, stamp rallies, screenings, voice-actor and anisong appearances, manga and game IP, VTubers, commercial facilities, and Tokyo Anime Center. Verify visual social announcements through organizer or venue pages.'
  'monthly-food' = 'Run a food focused lane. Search food festivals, markets, local products, tastings, limited menus, restaurant and cafe programs, department stores, station buildings, hotels, breweries, sake and beer events, shopping streets, parks, and municipal announcements. Include small restaurant events and verify dates and participation rules.'
  'monthly-tech-games' = 'Run an IT, AI, games, board games, esports, and community lane. Search connpass, Doorkeeper, Peatix, TwiPla, Meetup, game facilities, esports venues, game bars, universities, companies, hackathons, study groups, hands-on sessions, and meetups. Do not force an esports quota; favor interesting small events too.'
  'monthly-art-music-special' = 'Search exhibitions, individual shows, galleries, live music, talks, workshops, international exchange, night events, unusual projects, seasonal plans, and local, school, or store programs. Use Tokyo Art Beat, Metropolis, facility calendars, public social announcements, and independent organizer pages.'
}

$jobs = @()
try {
  "[$((Get-Date).ToString('o'))] Starting on-demand monthly Luna max research for $TargetDate through $EndDate across $($standardPassNames.Count) lanes" | Set-Content -LiteralPath $logFile -Encoding utf8
  foreach ($passName in $standardPassNames) {
    $outputFile = Join-Path $rangeDir "$passName.json"
    $passLogFile = Join-Path $rangeDir "$passName.log"
    $jobs += Start-Job -Name "kotake-$passName-$TargetDate" -FilePath $passScript -ArgumentList @(
      $TargetDate, $targetDatesCsv, $passName, $focuses[$passName], $outputFile, $passLogFile, $schemaFile, $projectRoot
    )
  }

  $null = Wait-Job -Job $jobs -Timeout ($PassTimeoutMinutes * 60)
  $unfinished = @($jobs | Where-Object { $_.State -notin @('Completed', 'Failed', 'Stopped') })
  if ($unfinished.Count -gt 0) {
    $unfinished | Stop-Job
    throw "Monthly research exceeded the $PassTimeoutMinutes minute limit. No site data was changed."
  }
  foreach ($job in $jobs) {
    "[$((Get-Date).ToString('o'))] $($job.Name): $($job.State)" | Tee-Object -FilePath $logFile -Append
    Receive-Job -Job $job 2>&1 | Tee-Object -FilePath $logFile -Append
    if ($job.State -ne 'Completed') { throw "Monthly research job $($job.Name) ended in state $($job.State)." }
  }

  $passFiles = @($standardPassNames | ForEach-Object { Join-Path $rangeDir "$_.json" } | Where-Object { Test-Path -LiteralPath $_ })
  if ($passFiles.Count -ne $standardPassNames.Count) { throw 'All standard monthly research lanes must finish before merge.' }
  & node $mergeScript @passFiles $interimFile 2>&1 | Tee-Object -FilePath $logFile -Append
  if ($LASTEXITCODE -ne 0) { throw 'Interim monthly merge failed.' }

  $interim = Get-Content -LiteralPath $interimFile -Raw -Encoding utf8 | ConvertFrom-Json
  $sparseDates = @($targetDates | Where-Object { [int]$interim.countsByDate.PSObject.Properties[$_].Value -lt 4 })
  if ($sparseDates.Count -gt 0) {
    $gapName = 'monthly-quality-gap'
    $gapFile = Join-Path $rangeDir "$gapName.json"
    $gapLogFile = Join-Path $rangeDir "$gapName.log"
    $gapFocus = "Run a verification and quality-gap pass. Search especially hard for these sparse dates: $($sparseDates -join ', '). Fill real gaps across official calendars, public X and Instagram announcements, neighborhood venues, anime and character, food, technology and games, arts and unusual events. Recheck availability and do not invent filler."
    "[$((Get-Date).ToString('o'))] Starting conditional quality-gap lane for $($sparseDates.Count) sparse dates" | Tee-Object -FilePath $logFile -Append
    & $passScript $TargetDate $targetDatesCsv $gapName $gapFocus $gapFile $gapLogFile $schemaFile $projectRoot
    if (-not (Test-Path -LiteralPath $gapFile)) { throw 'The monthly quality-gap lane did not produce output.' }
    $passFiles += $gapFile
  }
  else {
    "[$((Get-Date).ToString('o'))] No date had fewer than four candidates; the conditional quality-gap lane was skipped." | Tee-Object -FilePath $logFile -Append
  }

  & node $mergeScript @passFiles $candidateFile 2>&1 | Tee-Object -FilePath $logFile -Append
  if ($LASTEXITCODE -ne 0) { throw 'Final monthly merge failed.' }
  Move-Item -LiteralPath $candidateFile -Destination $finalFile -Force
  "[$((Get-Date).ToString('o'))] Monthly draft completed: $finalFile" | Tee-Object -FilePath $logFile -Append
  Write-Output $finalFile
}
finally {
  if ($jobs.Count -gt 0) {
    $jobs | Where-Object State -EQ 'Running' | Stop-Job
    $jobs | Remove-Job -Force -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
}
