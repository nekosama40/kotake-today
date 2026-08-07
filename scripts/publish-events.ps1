param(
  [string]$TargetDate = (Get-Date).ToString('yyyy-MM-dd')
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pendingFile = Join-Path $projectRoot "work\pending-$TargetDate.json"
$publicFile = Join-Path $projectRoot 'public\data\events.json'
$tempFile = Join-Path $projectRoot 'public\data\events.next.json'
$distFile = Join-Path $projectRoot 'dist\data\events.json'
$logFile = Join-Path $projectRoot "logs\publish-$TargetDate.log"
$publishMutex = [System.Threading.Mutex]::new($false, 'Local\KotakeEventsPublish')
$publishMutexAcquired = $false

if (-not (Test-Path -LiteralPath $pendingFile)) {
  throw "No validated pending data exists for $TargetDate. Previous public data was preserved."
}

try {
  try {
    $publishMutexAcquired = $publishMutex.WaitOne([TimeSpan]::FromMinutes(5))
  }
  catch [System.Threading.AbandonedMutexException] {
    $publishMutexAcquired = $true
  }
  if (-not $publishMutexAcquired) {
    throw 'Another publication or online update run did not finish within 5 minutes.'
  }

  & node (Join-Path $PSScriptRoot 'prepare-publish.mjs') $pendingFile $tempFile $TargetDate 2>&1 | Tee-Object -FilePath $logFile -Append
  if ($LASTEXITCODE -ne 0) { throw 'Publication preparation failed. Previous public data was preserved.' }

  Move-Item -LiteralPath $tempFile -Destination $publicFile -Force
  if (Test-Path -LiteralPath (Split-Path -Parent $distFile)) {
    Copy-Item -LiteralPath $publicFile -Destination $distFile -Force
  }

  $payload = Get-Content -LiteralPath $publicFile -Raw -Encoding utf8 | ConvertFrom-Json
  "[$((Get-Date).ToString('o'))] Published $TargetDate with $($payload.events.Count) events." | Tee-Object -FilePath $logFile -Append

  $savedErrorPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & node (Join-Path $PSScriptRoot 'cleanup-event-images.mjs') $publicFile 2>&1 | Tee-Object -FilePath $logFile -Append
  $cleanupExitCode = $LASTEXITCODE
  $ErrorActionPreference = $savedErrorPreference
  if ($cleanupExitCode -ne 0) {
    "[$((Get-Date).ToString('o'))] Warning: stale image cleanup failed; published data remains valid." | Tee-Object -FilePath $logFile -Append
  }
}
finally {
  Remove-Item -LiteralPath $tempFile -Force -ErrorAction SilentlyContinue
  if ($publishMutexAcquired) {
    $publishMutex.ReleaseMutex()
  }
  $publishMutex.Dispose()
}
