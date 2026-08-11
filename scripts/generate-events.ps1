param(
  [string]$TargetDate = (Get-Date).ToString('yyyy-MM-dd'),
  [int]$PassTimeoutMinutes = 90,
  [string]$ResearchScriptPath = ''
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$workDir = Join-Path $projectRoot 'work'
$logDir = Join-Path $projectRoot 'logs'
$lockFile = Join-Path $workDir 'generate.lock'
$passAFile = Join-Path $workDir "research-$TargetDate-official.json"
$passBFile = Join-Path $workDir "research-$TargetDate-long-tail.json"
$passCFile = Join-Path $workDir "research-$TargetDate-anime-food.json"
$passDFile = Join-Path $workDir "research-$TargetDate-next-official.json"
$passEFile = Join-Path $workDir "research-$TargetDate-next-local-special.json"
$passFFile = Join-Path $workDir "research-$TargetDate-quality-gap.json"
$gapAnalysisFile = Join-Path $workDir "research-$TargetDate-gap-analysis.json"
$usageSummaryFile = Join-Path $workDir "research-usage-$TargetDate.json"
$pendingFile = Join-Path $workDir "pending-$TargetDate.json"
$publicFile = Join-Path $projectRoot 'public\data\events.json'
$logFile = Join-Path $logDir "generate-$TargetDate.log"
$passALog = Join-Path $logDir "research-$TargetDate-official.log"
$passBLog = Join-Path $logDir "research-$TargetDate-long-tail.log"
$passCLog = Join-Path $logDir "research-$TargetDate-anime-food.log"
$passDLog = Join-Path $logDir "research-$TargetDate-next-official.log"
$passELog = Join-Path $logDir "research-$TargetDate-next-local-special.log"
$passFLog = Join-Path $logDir "research-$TargetDate-quality-gap.log"
$researchScript = if ($ResearchScriptPath) { $ResearchScriptPath } else { Join-Path $PSScriptRoot 'research-pass.ps1' }
$baseDate = [DateTime]::ParseExact($TargetDate, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)
$nextDate = $baseDate.AddDays(1).ToString('yyyy-MM-dd')
$followingDate = $baseDate.AddDays(2).ToString('yyyy-MM-dd')
$todayDatesCsv = $TargetDate
$nextDatesCsv = "$nextDate,$followingDate"
$allDatesCsv = "$TargetDate,$nextDate,$followingDate"

if (-not (Test-Path -LiteralPath $researchScript)) {
  throw "Research script does not exist: $researchScript"
}

New-Item -ItemType Directory -Path $workDir, $logDir -Force | Out-Null

if (Test-Path -LiteralPath $lockFile) {
  $age = (Get-Date) - (Get-Item -LiteralPath $lockFile).LastWriteTime
  if ($age.TotalMinutes -lt 120) {
    throw "Another event generation run is active ($([math]::Round($age.TotalMinutes)) minutes old)."
  }
  Remove-Item -LiteralPath $lockFile -Force
}

Set-Content -LiteralPath $lockFile -Value (Get-Date).ToString('o') -Encoding utf8

$jobs = @()
try {
  $focusA = 'Search official organizers, Tokyo wards, public facilities, commercial venues, official event sites, and major event services. Balance exhibitions, music, hands-on activities, food, local events, IT, and games.'
  $focusB = 'Run the dedicated same-day social discovery lane. Check marked event-curation accounts first, then broaden through public X and Instagram searches, organizers, venues, performers, vendors, hashtags, independent communities, stores, schools, libraries, civic facilities, game bars, live houses, and shopping streets. Keep account checks selective and spend the saved effort verifying promising events.'
  $focusC = 'Run a dedicated split investigation for anime/character events and food events. Spend 8 to 12 distinct searches on each side, 16 to 24 searches total. Use the marked themed accounts as discovery leads. For anime and characters, check official franchise and publisher sites, public X and Instagram announcements, commercial facilities, character shops, pop-up stores, exhibitions, stamp rallies, screenings, voice actor and anisong appearances, manga/game IP events, VTuber events, and collaboration cafes. For food, check food festivals, markets, tasting events, limited menus, restaurant and cafe events, department stores, station buildings, hotels, breweries, sake and beer events, local shops, shopping streets, parks, and public social announcements. Keep the same same-day participation and availability rules; do not include sold-out or reservation-closed events merely to fill either category.'
  $focusD = 'Research tomorrow and the following day together through official organizers, Tokyo wards, public facilities, museums, commercial venues, official franchise sites, ticket pages, and major event calendars. Reuse multi-day calendars efficiently, but create a separate event record for each target date. Recheck every relevant prior candidate before keeping it.'
  $focusE = 'Run the dedicated advance social discovery lane for tomorrow and the following day. Check marked event-curation accounts efficiently, then branch into public X and Instagram posts from organizers, venues, performers, vendors, stores, schools, libraries, shopping streets, live houses, game spaces, anime and character pop-ups, collaboration cafes, food events, markets, and unusual local plans. Search both dates together and recheck relevant prior candidates.'

  foreach ($researchOutput in $passAFile, $passBFile, $passCFile, $passDFile, $passEFile, $passFFile) {
    Remove-Item -LiteralPath $researchOutput -Force -ErrorAction SilentlyContinue
  }
  "[$((Get-Date).ToString('o'))] Starting five Luna max research passes in parallel for $TargetDate through $followingDate" | Set-Content -LiteralPath $logFile -Encoding utf8
  $jobs = @(
    Start-Job -Name "kotake-official-$TargetDate" -FilePath $researchScript -ArgumentList $TargetDate, $todayDatesCsv, 'official-and-major', $focusA, $passAFile, $passALog, $publicFile, $projectRoot
    Start-Job -Name "kotake-long-tail-$TargetDate" -FilePath $researchScript -ArgumentList $TargetDate, $todayDatesCsv, 'local-and-long-tail', $focusB, $passBFile, $passBLog, $publicFile, $projectRoot
    Start-Job -Name "kotake-anime-food-$TargetDate" -FilePath $researchScript -ArgumentList $TargetDate, $todayDatesCsv, 'anime-character-and-food', $focusC, $passCFile, $passCLog, $publicFile, $projectRoot
    Start-Job -Name "kotake-next-official-$TargetDate" -FilePath $researchScript -ArgumentList $TargetDate, $nextDatesCsv, 'next-days-official-and-major', $focusD, $passDFile, $passDLog, $publicFile, $projectRoot
    Start-Job -Name "kotake-next-local-special-$TargetDate" -FilePath $researchScript -ArgumentList $TargetDate, $nextDatesCsv, 'next-days-local-and-special', $focusE, $passEFile, $passELog, $publicFile, $projectRoot
  )

  $null = Wait-Job -Job $jobs -Timeout ($PassTimeoutMinutes * 60)
  $unfinished = @($jobs | Where-Object State -NotIn 'Completed', 'Failed', 'Stopped')
  if ($unfinished.Count -gt 0) {
    $unfinished | Stop-Job
    throw "Research exceeded the $PassTimeoutMinutes minute limit. Previous public data was preserved."
  }

  foreach ($job in $jobs) {
    "[$((Get-Date).ToString('o'))] $($job.Name): $($job.State)" | Tee-Object -FilePath $logFile -Append
    Receive-Job -Job $job 2>&1 | Tee-Object -FilePath $logFile -Append
    if ($job.State -ne 'Completed') {
      throw "Research job $($job.Name) ended in state $($job.State)."
    }
  }

  $researchOutputs = @($passAFile, $passBFile, $passCFile, $passDFile, $passEFile)
  $completedOutputs = @($researchOutputs | Where-Object { Test-Path -LiteralPath $_ })
  if ($completedOutputs.Count -ne 5) {
    throw 'All five research passes must finish before merge. Previous public data was preserved.'
  }

  & node (Join-Path $PSScriptRoot 'analyze-research-gaps.mjs') $passAFile $passBFile $passCFile $passDFile $passEFile $gapAnalysisFile 2>&1 | Tee-Object -FilePath $logFile -Append
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $gapAnalysisFile)) { throw 'Coverage analysis failed.' }
  $gapAnalysis = Get-Content -LiteralPath $gapAnalysisFile -Raw -Encoding utf8 | ConvertFrom-Json
  if ($gapAnalysis.shouldRunGapPass) {
    $gapDeadline = $baseDate.Date.AddHours(5).AddMinutes(45)
    $gapTimeoutSeconds = [math]::Min(2700, [math]::Floor(($gapDeadline - (Get-Date)).TotalSeconds))
    if ($gapTimeoutSeconds -ge 300) {
      $gapFocus = "Fill only these measured gaps after the five standard passes: $(@($gapAnalysis.gaps) -join '; '). Search all three dates together, prioritize missing genres and nearby wards, and avoid repeating candidates in the prior payload."
      "[$((Get-Date).ToString('o'))] Starting conditional Luna max quality-and-gap pass with a hard deadline of $($gapDeadline.ToString('HH:mm'))" | Tee-Object -FilePath $logFile -Append
      $gapJob = Start-Job -Name "kotake-quality-gap-$TargetDate" -FilePath $researchScript -ArgumentList $TargetDate, $allDatesCsv, 'quality-and-gap', $gapFocus, $passFFile, $passFLog, $gapAnalysisFile, $projectRoot
      $jobs += $gapJob
      $null = Wait-Job -Job $gapJob -Timeout $gapTimeoutSeconds
      if ($gapJob.State -notin 'Completed', 'Failed', 'Stopped') {
        Stop-Job -Job $gapJob
        "[$((Get-Date).ToString('o'))] Conditional gap pass reached its deadline; publishing the five complete standard passes." | Tee-Object -FilePath $logFile -Append
      }
      else {
        $savedGapErrorPreference = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        Receive-Job -Job $gapJob 2>&1 | Tee-Object -FilePath $logFile -Append
        $ErrorActionPreference = $savedGapErrorPreference
        if ($gapJob.State -eq 'Completed' -and (Test-Path -LiteralPath $passFFile)) {
          $researchOutputs += $passFFile
        }
        else {
          "[$((Get-Date).ToString('o'))] Conditional gap pass failed; publishing the five complete standard passes." | Tee-Object -FilePath $logFile -Append
        }
      }
    }
    else {
      "[$((Get-Date).ToString('o'))] Coverage gaps were found too close to the publication deadline; gap pass skipped." | Tee-Object -FilePath $logFile -Append
    }
  }

  $expectedTracePasses = @('official-and-major', 'local-and-long-tail', 'anime-character-and-food', 'next-days-official-and-major', 'next-days-local-and-special')
  if ($researchOutputs.Count -eq 6) { $expectedTracePasses += 'quality-and-gap' }
  & node (Join-Path $PSScriptRoot 'summarize-research-traces.mjs') $workDir $TargetDate $usageSummaryFile ($expectedTracePasses -join ',') 2>&1 | Tee-Object -FilePath $logFile -Append
  if ($LASTEXITCODE -ne 0) { throw 'Research trace summary failed.' }

  & node (Join-Path $PSScriptRoot 'merge-events.mjs') @researchOutputs $pendingFile $TargetDate $publicFile 2>&1 | Tee-Object -FilePath $logFile -Append
  if ($LASTEXITCODE -ne 0) { throw 'Merge failed.' }
  & node (Join-Path $PSScriptRoot 'validate-events.mjs') $pendingFile $TargetDate 2>&1 | Tee-Object -FilePath $logFile -Append
  if ($LASTEXITCODE -ne 0) { throw 'Validation failed.' }
  "[$((Get-Date).ToString('o'))] Generation completed: $pendingFile" | Tee-Object -FilePath $logFile -Append
}
finally {
  if ($jobs.Count -gt 0) {
    $jobs | Where-Object State -EQ 'Running' | Stop-Job
    $jobs | Remove-Job -Force -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
}
