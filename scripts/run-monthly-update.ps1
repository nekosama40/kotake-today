param(
  [string]$TargetDate = (Get-Date).ToString('yyyy-MM-dd'),
  [string]$EndDate = '',
  [switch]$ReuseExistingDraft,
  [switch]$NoPush
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$workDir = Join-Path $projectRoot 'work'
$logDir = Join-Path $projectRoot 'logs'
$baseDate = [DateTime]::ParseExact($TargetDate, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)
if (-not $EndDate) { $EndDate = $baseDate.AddDays(30).ToString('yyyy-MM-dd') }
$lastDate = [DateTime]::ParseExact($EndDate, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)
if ($lastDate -lt $baseDate -or ($lastDate - $baseDate).Days -gt 30) {
  throw 'The monthly update range must contain one to 31 consecutive dates.'
}
$expectedDateCount = ($lastDate - $baseDate).Days + 1
$draftFile = Join-Path $workDir "monthly-research-$TargetDate-to-$EndDate.json"
$pendingFile = Join-Path $workDir "pending-$TargetDate.json"
$publicFile = Join-Path $projectRoot 'public\data\events.json'
$logFile = Join-Path $logDir "monthly-update-$TargetDate.log"
$monthlyMutex = [System.Threading.Mutex]::new($false, 'Local\KotakeEventsMonthly')
$monthlyMutexAcquired = $false

function Write-MonthlyLog {
  param([string]$Message)
  "[$((Get-Date).ToString('o'))] $Message" | Tee-Object -FilePath $logFile -Append
}

function Test-ValidatedMonthlyPayload {
  param([string]$PayloadPath)
  if (-not (Test-Path -LiteralPath $PayloadPath)) { return $false }
  $savedErrorPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & node (Join-Path $PSScriptRoot 'validate-events.mjs') $PayloadPath $TargetDate *> $null
  $validationExitCode = $LASTEXITCODE
  $ErrorActionPreference = $savedErrorPreference
  if ($validationExitCode -ne 0) { return $false }
  $payload = Get-Content -LiteralPath $PayloadPath -Raw -Encoding utf8 | ConvertFrom-Json
  return @($payload.coveredDates).Count -eq $expectedDateCount -and $payload.coveredDates[-1] -eq $EndDate
}

New-Item -ItemType Directory -Path $workDir -Force | Out-Null
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

try {
  try {
    $monthlyMutexAcquired = $monthlyMutex.WaitOne([TimeSpan]::Zero)
  }
  catch [System.Threading.AbandonedMutexException] {
    $monthlyMutexAcquired = $true
  }
  if (-not $monthlyMutexAcquired) {
    Write-MonthlyLog 'Another monthly update is already running; duplicate execution was skipped.'
    return
  }

  $dailyTask = Get-ScheduledTask -TaskName 'KotakeEvents-Daily' -ErrorAction SilentlyContinue
  if ($dailyTask -and $dailyTask.Settings.Enabled) {
    throw 'KotakeEvents-Daily is enabled. Disable the legacy daily AI task before running an on-demand monthly update.'
  }

  Write-MonthlyLog "On-demand monthly update started for $TargetDate through $EndDate with GPT-6 Luna max."
  if ($ReuseExistingDraft -and (Test-Path -LiteralPath $draftFile)) {
    Write-MonthlyLog "Reusing the existing monthly draft: $draftFile"
  }
  else {
    & (Join-Path $PSScriptRoot 'run-monthly-research.ps1') -TargetDate $TargetDate -EndDate $EndDate 2>&1 | Tee-Object -FilePath $logFile -Append
    if (-not (Test-Path -LiteralPath $draftFile)) {
      throw 'Monthly Luna research did not produce a complete draft. Current public data was preserved.'
    }
  }

  & node (Join-Path $PSScriptRoot 'prepare-monthly-publication.mjs') $draftFile $pendingFile $TargetDate 2>&1 | Tee-Object -FilePath $logFile -Append
  if ($LASTEXITCODE -ne 0 -or -not (Test-ValidatedMonthlyPayload -PayloadPath $pendingFile)) {
    throw 'Monthly publication preparation failed validation. Current public data was preserved.'
  }

  & (Join-Path $PSScriptRoot 'publish-events.ps1') -TargetDate $TargetDate 2>&1 | Tee-Object -FilePath $logFile -Append
  if (-not (Test-ValidatedMonthlyPayload -PayloadPath $publicFile)) {
    throw 'Monthly publication did not produce the expected date range.'
  }

  if ($NoPush) {
    Write-MonthlyLog 'Monthly data was published locally; online push was skipped by request.'
  }
  else {
    & (Join-Path $PSScriptRoot 'push-online-update.ps1') -TargetDate $TargetDate -UpdateMode Monthly 2>&1 | Tee-Object -FilePath $logFile -Append
    Write-MonthlyLog 'Monthly data was pushed for GitHub Pages deployment.'
  }
  Write-MonthlyLog 'On-demand monthly update completed successfully.'
}
finally {
  if ($monthlyMutexAcquired) { $monthlyMutex.ReleaseMutex() }
  $monthlyMutex.Dispose()
}
