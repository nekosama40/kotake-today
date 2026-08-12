param(
  [bool]$WakeComputer = $true
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$powerShell = (Get-Command powershell.exe).Source
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

$dailyScript = Join-Path $PSScriptRoot 'run-daily-update.ps1'
$dailyAction = New-ScheduledTaskAction -Execute $powerShell -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$dailyScript`"" -WorkingDirectory $projectRoot
$primaryTrigger = New-ScheduledTaskTrigger -Daily -At '02:30'
$retryTrigger = New-ScheduledTaskTrigger -Daily -At '04:30'
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$dailySettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun:$WakeComputer -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 240) -RestartCount 1 -RestartInterval (New-TimeSpan -Minutes 15)

Register-ScheduledTask -TaskName 'KotakeEvents-Daily' -Action $dailyAction -Trigger @($primaryTrigger, $retryTrigger, $logonTrigger) -Principal $principal -Settings $dailySettings -Description 'Research, validate, publish, and deploy daily events sequentially by 07:00 with a safe retry' -Force | Out-Null

foreach ($oldTaskName in 'KotakeEvents-Generate','KotakeEvents-Publish','KotakeEvents-Online','KotakeEvents-Recovery','KotakeEvents-Site') {
  $oldTask = Get-ScheduledTask -TaskName $oldTaskName -ErrorAction SilentlyContinue
  if ($oldTask) {
    if ($oldTask.State -eq 'Running') { Stop-ScheduledTask -TaskName $oldTaskName }
    Unregister-ScheduledTask -TaskName $oldTaskName -Confirm:$false
  }
}

Get-ScheduledTask -TaskName 'KotakeEvents-Daily' | Select-Object TaskName, State, TaskPath
