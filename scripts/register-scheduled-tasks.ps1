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
$serveScript = Join-Path $PSScriptRoot 'serve-site.ps1'
$generateAction = New-ScheduledTaskAction -Execute $powerShell -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$generateScript`"" -WorkingDirectory $projectRoot
$publishAction = New-ScheduledTaskAction -Execute $powerShell -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$publishScript`"" -WorkingDirectory $projectRoot
$onlineAction = New-ScheduledTaskAction -Execute $powerShell -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$onlineScript`"" -WorkingDirectory $projectRoot
$serveAction = New-ScheduledTaskAction -Execute $powerShell -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$serveScript`"" -WorkingDirectory $projectRoot
$generateTrigger = New-ScheduledTaskTrigger -Daily -At '04:45'
$publishTrigger = New-ScheduledTaskTrigger -Daily -At '06:25'
$onlineTrigger = New-ScheduledTaskTrigger -Daily -At '06:35'
$serveTrigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$generateSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun:$WakeComputer -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 85)
$publishSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun:$WakeComputer -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
$onlineSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun:$WakeComputer -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
$serveSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask -TaskName 'KotakeEvents-Generate' -Action $generateAction -Trigger $generateTrigger -Principal $principal -Settings $generateSettings -Description 'Research Tokyo events with two parallel Luna max passes at 04:45' -Force | Out-Null
Register-ScheduledTask -TaskName 'KotakeEvents-Publish' -Action $publishAction -Trigger $publishTrigger -Principal $principal -Settings $publishSettings -Description 'Publish validated event data locally at 06:25' -Force | Out-Null
Register-ScheduledTask -TaskName 'KotakeEvents-Online' -Action $onlineAction -Trigger $onlineTrigger -Principal $principal -Settings $onlineSettings -Description 'Push validated event data to GitHub Pages at 06:35 for completion before 07:00' -Force | Out-Null
Register-ScheduledTask -TaskName 'KotakeEvents-Site' -Action $serveAction -Trigger $serveTrigger -Principal $principal -Settings $serveSettings -Description 'Serve the local event site while the user is logged on' -Force | Out-Null

Get-ScheduledTask -TaskName 'KotakeEvents-Generate','KotakeEvents-Publish','KotakeEvents-Online','KotakeEvents-Site' | Select-Object TaskName, State, TaskPath
