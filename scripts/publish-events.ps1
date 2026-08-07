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
$lockFile = Join-Path $projectRoot 'work\publish.lock'

if (-not (Test-Path -LiteralPath $pendingFile)) {
  throw "No validated pending data exists for $TargetDate. Previous public data was preserved."
}

if (Test-Path -LiteralPath $lockFile) {
  $lockAge = (Get-Date) - (Get-Item -LiteralPath $lockFile).LastWriteTime
  if ($lockAge.TotalMinutes -lt 20) {
    throw 'Another publication run is active.'
  }
  Remove-Item -LiteralPath $lockFile -Force
}
Set-Content -LiteralPath $lockFile -Value (Get-Date).ToString('o') -Encoding utf8

try {
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
  Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
}
