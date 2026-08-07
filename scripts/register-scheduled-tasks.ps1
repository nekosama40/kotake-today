param(
  [bool]$WakeComputer = $true
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$powerShell = (Get-Command powershell.exe).Source
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

$generateScript = Join-Path $PSScriptRoot 'generate-events.ps1'
$publishScript = Join-Path $PSScriptRoot 'publish-events.ps1'
$onlineScript = Join-Path $PSScriptRoot 'push-online-update.ps1'
$generateAction = New-ScheduledTaskAction -Execute $powerShell -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$generateScript`"" -WorkingDirectory $projectRoot
$publishAction = New-ScheduledTaskAction -Execute $powerShell -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$publishScript`"" -WorkingDirectory $projectRoot
$onlineAction = New-ScheduledTaskAction -Execute $powerShell -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$onlineScript`"" -WorkingDirectory $projectRoot
$generateTrigger = New-ScheduledTaskTrigger -Daily -At '04:30'
$publishTrigger = New-ScheduledTaskTrigger -Daily -At '06:25'
$onlineTrigger = New-ScheduledTaskTrigger -Daily -At '06:35'
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$generateSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun:$WakeComputer -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 110)
$publishSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun:$WakeComputer -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
$onlineSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun:$WakeComputer -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 15)

Unregister-ScheduledTask -TaskName 'KotakeEvents-Site' -Confirm:$false -ErrorAction SilentlyContinue

Register-ScheduledTask -TaskName 'KotakeEvents-Generate' -Action $generateAction -Trigger $generateTrigger -Principal $principal -Settings $generateSettings -Description 'Research three days of Tokyo events with five parallel Luna max passes at 04:30' -Force | Out-Null
Register-ScheduledTask -TaskName 'KotakeEvents-Publish' -Action $publishAction -Trigger $publishTrigger -Principal $principal -Settings $publishSettings -Description 'Publish validated event data locally at 06:25' -Force | Out-Null
Register-ScheduledTask -TaskName 'KotakeEvents-Online' -Action $onlineAction -Trigger $onlineTrigger -Principal $principal -Settings $onlineSettings -Description 'Push validated event data to GitHub Pages at 06:35 for completion before 07:00' -Force | Out-Null

Get-ScheduledTask -TaskName 'KotakeEvents-Generate','KotakeEvents-Publish','KotakeEvents-Online' | Select-Object TaskName, State, TaskPath
