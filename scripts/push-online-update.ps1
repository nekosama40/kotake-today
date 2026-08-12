param(
  [string]$TargetDate = (Get-Date).ToString('yyyy-MM-dd')
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$logFile = Join-Path $projectRoot "logs\online-$TargetDate.log"
$publicFile = Join-Path $projectRoot 'public\data\events.json'
$publicPaths = @('public/data/events.json', 'public/images/events')
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

function Assert-NoUnrelatedStagedChanges {
  $unexpectedStaged = @(@(& git diff --cached --name-only) | Where-Object {
    $_ -notmatch '^(?:public/data/events\.json|public/images/events/.+)$'
  })
  if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect staged changes.' }
  if ($unexpectedStaged.Count -gt 0) {
    throw "Online update stopped because unrelated staged paths already exist: $($unexpectedStaged -join ', ')"
  }
}

function Sync-MainAndResumeDailyCommit {
  Invoke-LoggedGit -GitArguments @('fetch', '--quiet', 'origin', 'main')
  $localHead = (& git rev-parse HEAD).Trim()
  $remoteHead = (& git rev-parse origin/main).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'Unable to compare local main with origin/main.' }
  if ($localHead -eq $remoteHead) { return $localHead }

  $savedErrorPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & git merge-base --is-ancestor origin/main HEAD
  $ancestorExitCode = $LASTEXITCODE
  $ErrorActionPreference = $savedErrorPreference
  $aheadCount = (& git rev-list --count origin/main..HEAD).Trim()
  $commitSubject = (& git log -1 --pretty=%s HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or $ancestorExitCode -ne 0 -or $aheadCount -ne '1' -or $commitSubject -notmatch '^Daily events \d{4}-\d{2}-\d{2}$') {
    throw 'Online update stopped because local main contains changes other than one unpushed daily event commit.'
  }

  $unexpectedCommitted = @(@(& git diff-tree --no-commit-id --name-only -r HEAD) | Where-Object {
    $_ -notmatch '^(?:public/data/events\.json|public/images/events/.+)$'
  })
  if ($LASTEXITCODE -ne 0 -or $unexpectedCommitted.Count -gt 0) {
    throw 'Online update stopped because the unpushed commit contains unexpected paths.'
  }

  $resumeRefSpec = '{0}:refs/heads/main' -f $localHead
  Invoke-LoggedGit -GitArguments @('push', '--quiet', 'origin', $resumeRefSpec)
  Write-OnlineLog "Resumed and pushed the previously committed daily update $localHead."
  return $localHead
}

$branch = (& git branch --show-current).Trim()
if ($LASTEXITCODE -ne 0 -or $branch -ne 'main') {
  throw "Online update requires the main branch; current branch is '$branch'."
}

$remote = (& git remote get-url origin).Trim()
if ($LASTEXITCODE -ne 0 -or $remote -notmatch 'github\.com[:/]nekosama40/kotake-today(?:\.git)?$') {
  throw "Unexpected origin remote: $remote"
}

Assert-NoUnrelatedStagedChanges
$initialHead = Sync-MainAndResumeDailyCommit
$publishMutex = [System.Threading.Mutex]::new($false, 'Local\KotakeEventsPublish')
$publishMutexAcquired = $false

try {
  $readyDeadline = (Get-Date).AddMinutes(10)
  $publicationReady = $false
  do {
    try {
      $publishMutexAcquired = $publishMutex.WaitOne([TimeSpan]::FromSeconds(15))
    }
    catch [System.Threading.AbandonedMutexException] {
      $publishMutexAcquired = $true
    }

    if ($publishMutexAcquired) {
      $savedErrorPreference = $ErrorActionPreference
      $ErrorActionPreference = 'Continue'
      & node (Join-Path $PSScriptRoot 'validate-events.mjs') $publicFile $TargetDate *> $null
      $validationExitCode = $LASTEXITCODE
      $ErrorActionPreference = $savedErrorPreference
      if ($validationExitCode -eq 0) {
        $publicationReady = $true
      }
      else {
        $publishMutex.ReleaseMutex()
        $publishMutexAcquired = $false
      }
    }

    if (-not $publicationReady -and (Get-Date) -lt $readyDeadline) {
      Start-Sleep -Seconds 15
    }
  } while (-not $publicationReady -and (Get-Date) -lt $readyDeadline)

  if (-not $publicationReady) {
    throw "Validated public data for $TargetDate was not ready within 10 minutes."
  }

  Assert-NoUnrelatedStagedChanges
  $baseHead = Sync-MainAndResumeDailyCommit
  Invoke-LoggedGit -GitArguments (@('add', '-A', '--') + $publicPaths)

  $unexpectedStaged = @(@(& git diff --cached --name-only) | Where-Object {
    $_ -notmatch '^(?:public/data/events\.json|public/images/events/.+)$'
  })
  if ($unexpectedStaged.Count -gt 0) {
    throw "Online update stopped because unexpected paths were staged: $($unexpectedStaged -join ', ')"
  }

  $savedErrorPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & git diff --cached --quiet -- @publicPaths
  $diffExitCode = $LASTEXITCODE
  $ErrorActionPreference = $savedErrorPreference

  if ($diffExitCode -eq 0) {
    Write-OnlineLog 'No event data changes to publish online.'
    return
  }
  if ($diffExitCode -ne 1) {
    throw "Unable to inspect staged online changes (exit $diffExitCode)."
  }

  Invoke-LoggedGit -GitArguments (@('commit', '--only', '-m', "Daily events $TargetDate", '--') + $publicPaths)
  $createdHead = (& git rev-parse HEAD).Trim()
  $createdParent = (& git rev-parse "$createdHead^").Trim()
  if ($LASTEXITCODE -ne 0 -or $createdParent -ne $baseHead) {
    throw 'Online update stopped because the generated commit did not have the expected parent.'
  }

  $unexpectedCommitted = @(@(& git diff-tree --no-commit-id --name-only -r $createdHead) | Where-Object {
    $_ -notmatch '^(?:public/data/events\.json|public/images/events/.+)$'
  })
  if ($unexpectedCommitted.Count -gt 0) {
    throw "Online update stopped because the generated commit contains unexpected paths: $($unexpectedCommitted -join ', ')"
  }

  $createdRefSpec = '{0}:refs/heads/main' -f $createdHead
  Invoke-LoggedGit -GitArguments @('push', '--quiet', 'origin', $createdRefSpec)
  Write-OnlineLog "Online update pushed for $TargetDate as $createdHead."
}
finally {
  if ($publishMutexAcquired) {
    $publishMutex.ReleaseMutex()
  }
  $publishMutex.Dispose()
}
