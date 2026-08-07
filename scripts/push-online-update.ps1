param(
  [string]$TargetDate = (Get-Date).ToString('yyyy-MM-dd')
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$logFile = Join-Path $projectRoot "logs\online-$TargetDate.log"
$publicFile = Join-Path $projectRoot 'public\data\events.json'
$publishLock = Join-Path $projectRoot 'work\publish.lock'
Set-Location -LiteralPath $projectRoot

function Write-OnlineLog {
  param([string]$Message)
  "[$((Get-Date).ToString('o'))] $Message" | Tee-Object -FilePath $logFile -Append
}

function Invoke-LoggedGit {
  param([string[]]$GitArguments)
  $savedErrorPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & git @GitArguments 2>&1 | Tee-Object -FilePath $logFile -Append
  $gitExitCode = $LASTEXITCODE
  $ErrorActionPreference = $savedErrorPreference
  if ($gitExitCode -ne 0) {
    throw "git $($GitArguments -join ' ') failed with exit code $gitExitCode."
  }
}

function Assert-NoStagedChanges {
  $savedErrorPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & git diff --cached --quiet
  $stagedExitCode = $LASTEXITCODE
  $ErrorActionPreference = $savedErrorPreference
  if ($stagedExitCode -eq 1) {
    throw 'Online update stopped because unrelated staged changes already exist.'
  }
  if ($stagedExitCode -ne 0) {
    throw "Unable to inspect staged changes (exit $stagedExitCode)."
  }
}

function Assert-SyncedMain {
  Invoke-LoggedGit -GitArguments @('fetch', '--quiet', 'origin', 'main')
  $localHead = (& git rev-parse HEAD).Trim()
  $remoteHead = (& git rev-parse origin/main).Trim()
  if ($LASTEXITCODE -ne 0 -or $localHead -ne $remoteHead) {
    throw 'Online update stopped because local main and origin/main are not identical.'
  }
}

$branch = (& git branch --show-current).Trim()
if ($LASTEXITCODE -ne 0 -or $branch -ne 'main') {
  throw "Online update requires the main branch; current branch is '$branch'."
}

$remote = (& git remote get-url origin).Trim()
if ($LASTEXITCODE -ne 0 -or $remote -notmatch 'github\.com[:/]nekosama40/kotake-today(?:\.git)?$') {
  throw "Unexpected origin remote: $remote"
}

Assert-NoStagedChanges
Assert-SyncedMain

$readyDeadline = (Get-Date).AddMinutes(10)
$publicationReady = $false
do {
  if (-not (Test-Path -LiteralPath $publishLock)) {
    $savedErrorPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & node (Join-Path $PSScriptRoot 'validate-events.mjs') $publicFile $TargetDate *> $null
    $validationExitCode = $LASTEXITCODE
    $ErrorActionPreference = $savedErrorPreference
    if ($validationExitCode -eq 0) {
      $publicationReady = $true
    }
  }
  if (-not $publicationReady) {
    Start-Sleep -Seconds 15
  }
} while (-not $publicationReady -and (Get-Date) -lt $readyDeadline)

if (-not $publicationReady) {
  throw "Validated public data for $TargetDate was not ready within 10 minutes."
}

Assert-NoStagedChanges
Assert-SyncedMain
Invoke-LoggedGit -GitArguments @('add', '-A', '--', 'public/data/events.json', 'public/images/events')

$unexpectedStaged = @(& git diff --cached --name-only) | Where-Object {
  $_ -notmatch '^(public/data/events\.json|public/images/events/)'
}
if ($unexpectedStaged.Count -gt 0) {
  throw "Online update stopped because unexpected paths were staged: $($unexpectedStaged -join ', ')"
}

$savedErrorPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& git diff --cached --quiet -- public/data/events.json public/images/events
$diffExitCode = $LASTEXITCODE
$ErrorActionPreference = $savedErrorPreference

if ($diffExitCode -eq 0) {
  Write-OnlineLog 'No event data changes to publish online.'
  exit 0
}
if ($diffExitCode -ne 1) {
  throw "Unable to inspect staged online changes (exit $diffExitCode)."
}

Invoke-LoggedGit -GitArguments @('commit', '-m', "Daily events $TargetDate")
Invoke-LoggedGit -GitArguments @('push', '--quiet', 'origin', 'main')
Write-OnlineLog "Online update pushed for $TargetDate."
