$ErrorActionPreference = 'Stop'
$taskName = 'PCBuildersStockTrackerDaily'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -ExecutionPolicy Bypass -File "C:\Users\PentiumCity\.cursor\projects\c-Users-PentiumCity-cursor\agent-tools\pcbuilders-stock-tracker\scripts\refresh-and-push.ps1"'
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description 'Poll pcbuilders.lk stock every 5 minutes and always push live site' | Out-Null
Get-ScheduledTaskInfo -TaskName $taskName | Format-List TaskName, NextRunTime, LastRunTime, LastTaskResult
Write-Host 'Scheduled: every 5 minutes + always push'
