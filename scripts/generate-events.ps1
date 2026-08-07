param(
  [string]$TargetDate = (Get-Date).ToString('yyyy-MM-dd'),
  [int]$PassTimeoutMinutes = 75,
  [string]$ResearchScriptPath = ''
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$workDir = Join-Path $projectRoot 'work'
$logDir = Join-Path $projectRoot 'logs'
$lockFile = Join-Path $workDir 'generate.lock'
$passAFile = Join-Path $workDir "research-$TargetDate-official.json"
$passBFile = Join-Path $workDir "research-$TargetDate-long-tail.json"
$pendingFile = Join-Path $workDir "pending-$TargetDate.json"
$logFile = Join-Path $logDir "generate-$TargetDate.log"
$passALog = Join-Path $logDir "research-$TargetDate-official.log"
$passBLog = Join-Path $logDir "research-$TargetDate-long-tail.log"
$researchScript = if ($ResearchScriptPath) { $ResearchScriptPath } else { Join-Path $PSScriptRoot 'research-pass.ps1' }

if (-not (Test-Path -LiteralPath $researchScript)) {
  throw "Research script does not exist: $researchScript"
}

New-Item -ItemType Directory -Path $workDir, $logDir -Force | Out-Null

if (Test-Path -LiteralPath $lockFile) {
  $age = (Get-Date) - (Get-Item -LiteralPath $lockFile).LastWriteTime
  if ($age.TotalMinutes -lt 55) {
    throw "Another event generation run is active ($([math]::Round($age.TotalMinutes)) minutes old)."
  }
  Remove-Item -LiteralPath $lockFile -Force
}

Set-Content -LiteralPath $lockFile -Value (Get-Date).ToString('o') -Encoding utf8

$jobs = @()
try {
  $focusA = 'Search official organizers, Tokyo wards, public facilities, commercial venues, official event sites, and major event services. Balance exhibitions, music, hands-on activities, food, local events, IT, and games.'
  $focusB = 'Use different queries and sources from the official pass. Focus on public X/social posts, independent organizers, small communities, stores, schools, libraries, civic facilities, game bars, live houses, and shopping streets.'

  foreach ($researchOutput in $passAFile, $passBFile) {
    Remove-Item -LiteralPath $researchOutput -Force -ErrorAction SilentlyContinue
  }
  "[$((Get-Date).ToString('o'))] Starting two Luna max research passes in parallel" | Set-Content -LiteralPath $logFile -Encoding utf8
  $jobs = @(
    Start-Job -Name "kotake-official-$TargetDate" -FilePath $researchScript -ArgumentList $TargetDate, 'official-and-major', $focusA, $passAFile, $passALog
    Start-Job -Name "kotake-long-tail-$TargetDate" -FilePath $researchScript -ArgumentList $TargetDate, 'local-and-long-tail', $focusB, $passBFile, $passBLog
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

  if (-not (Test-Path -LiteralPath $passAFile) -or -not (Test-Path -LiteralPath $passBFile)) {
    throw 'Both research passes must finish before merge. Previous public data was preserved.'
  }

  & node (Join-Path $PSScriptRoot 'merge-events.mjs') $passAFile $passBFile $pendingFile $TargetDate 2>&1 | Tee-Object -FilePath $logFile -Append
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
