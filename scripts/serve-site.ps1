$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
& node (Join-Path $PSScriptRoot 'serve-site.mjs')
if ($LASTEXITCODE -ne 0) { throw "Site server stopped with exit code $LASTEXITCODE." }
