$ErrorActionPreference = 'Stop'

$dailyTask = Get-ScheduledTask -TaskName 'KotakeEvents-Daily' -ErrorAction SilentlyContinue
if ($dailyTask) {
  if ($dailyTask.State -eq 'Running') {
    Stop-ScheduledTask -TaskName 'KotakeEvents-Daily'
  }
  Disable-ScheduledTask -TaskName 'KotakeEvents-Daily' | Out-Null
  Get-ScheduledTask -TaskName 'KotakeEvents-Daily' | Select-Object TaskName, State, TaskPath
}

Write-Output '毎日のAI自動調査は廃止されています。必要なときだけ scripts\run-monthly-update.ps1 を実行してください。'
