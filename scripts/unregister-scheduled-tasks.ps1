$ErrorActionPreference = 'Stop'
foreach ($taskName in 'KotakeEvents-Daily','KotakeEvents-Generate','KotakeEvents-Publish','KotakeEvents-Online','KotakeEvents-Recovery','KotakeEvents-Site') {
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($task) {
    if ($task.State -eq 'Running') {
      Stop-ScheduledTask -TaskName $taskName
    }
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  }
}
