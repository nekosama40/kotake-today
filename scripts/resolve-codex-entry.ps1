$ErrorActionPreference = 'Stop'

$codexPaths = @(
  Get-Command codex.exe -All -ErrorAction Stop |
    ForEach-Object { $_.Source } |
    Where-Object { $_ } |
    Sort-Object -Unique
)

$codexVersions = @(
  foreach ($codexPath in $codexPaths) {
    if (-not (Test-Path -LiteralPath $codexPath)) { continue }
    $versionOutput = @(& $codexPath --version 2>$null)
    $versionExitCode = $LASTEXITCODE
    if ($versionExitCode -ne 0 -or $versionOutput.Count -eq 0) { continue }
    $versionMatch = [regex]::Match([string]$versionOutput[0], 'codex-cli\s+(\d+(?:\.\d+){1,3})')
    if (-not $versionMatch.Success) { continue }
    [pscustomobject]@{
      Path = $codexPath
      Version = [version]$versionMatch.Groups[1].Value
    }
  }
)

if ($codexVersions.Count -eq 0) {
  throw 'Unable to find an installed Codex CLI executable with a readable version.'
}

$selectedCodex = $codexVersions | Sort-Object -Property Version -Descending | Select-Object -First 1
Write-Output $selectedCodex.Path
