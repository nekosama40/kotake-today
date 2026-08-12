param(
  [string]$TargetDate = (Get-Date).ToString('yyyy-MM-dd')
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pendingFile = Join-Path $projectRoot "work\pending-$TargetDate.json"
$publicFile = Join-Path $projectRoot 'public\data\events.json'
$logFile = Join-Path $projectRoot "logs\daily-$TargetDate.log"
$dailyMutex = [System.Threading.Mutex]::new($false, 'Local\KotakeEventsDaily')
$dailyMutexAcquired = $false

function Write-DailyLog {
  param([string]$Message)
  "[$((Get-Date).ToString('o'))] $Message" | Add-Content -LiteralPath $logFile -Encoding utf8
}

function Test-ValidatedPayload {
  param([string]$PayloadPath)
  if (-not (Test-Path -LiteralPath $PayloadPath)) { return $false }
  $savedErrorPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & node (Join-Path $PSScriptRoot 'validate-events.mjs') $PayloadPath $TargetDate *> $null
  $validationExitCode = $LASTEXITCODE
  $ErrorActionPreference = $savedErrorPreference
  return $validationExitCode -eq 0
}

New-Item -ItemType Directory -Path (Split-Path -Parent $logFile) -Force | Out-Null

try {
  try {
    $dailyMutexAcquired = $dailyMutex.WaitOne([TimeSpan]::Zero)
  }
  catch [System.Threading.AbandonedMutexException] {
    $dailyMutexAcquired = $true
  }
  if (-not $dailyMutexAcquired) {
    Write-DailyLog 'Another daily update is already running; duplicate execution was skipped.'
    return
  }

  Write-DailyLog "Daily update started for $TargetDate."
  $publicIsCurrent = Test-ValidatedPayload -PayloadPath $publicFile
  $pendingIsCurrent = Test-ValidatedPayload -PayloadPath $pendingFile

  if (-not $publicIsCurrent -and -not $pendingIsCurrent) {
    Write-DailyLog 'Validated current data is missing; starting Luna research.'
    & (Join-Path $PSScriptRoot 'generate-events.ps1') -TargetDate $TargetDate
    $pendingIsCurrent = Test-ValidatedPayload -PayloadPath $pendingFile
    if (-not $pendingIsCurrent) { throw 'Luna research did not produce validated pending data.' }
  }
  elseif ($pendingIsCurrent) {
    Write-DailyLog 'Validated pending data already exists; duplicate Luna research was skipped.'
  }
  else {
    Write-DailyLog 'Current public data already exists; duplicate Luna research was skipped.'
  }

  if (-not $publicIsCurrent) {
    Write-DailyLog 'Publishing validated current data.'
    & (Join-Path $PSScriptRoot 'publish-events.ps1') -TargetDate $TargetDate
    $publicIsCurrent = Test-ValidatedPayload -PayloadPath $publicFile
    if (-not $publicIsCurrent) { throw 'Publication did not produce validated current data.' }
  }

  & (Join-Path $PSScriptRoot 'push-online-update.ps1') -TargetDate $TargetDate
  Write-DailyLog 'Daily update completed successfully.'
}
finally {
  if ($dailyMutexAcquired) { $dailyMutex.ReleaseMutex() }
  $dailyMutex.Dispose()
}
