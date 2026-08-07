param(
  [string]$TargetDate = (Get-Date).ToString('yyyy-MM-dd')
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$logFile = Join-Path $projectRoot "logs\online-$TargetDate.log"
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

$branch = (& git branch --show-current).Trim()
if ($LASTEXITCODE -ne 0 -or $branch -ne 'main') {
  throw "Online update requires the main branch; current branch is '$branch'."
}

$remote = (& git remote get-url origin).Trim()
if ($LASTEXITCODE -ne 0 -or $remote -notmatch 'github\.com[:/]nekosama40/kotake-today(?:\.git)?$') {
  throw "Unexpected origin remote: $remote"
}

Invoke-LoggedGit -GitArguments @('add', '-A', '--', 'public/data/events.json', 'public/images/events')

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
Invoke-LoggedGit -GitArguments @('push', 'origin', 'main')
Write-OnlineLog "Online update pushed for $TargetDate."
