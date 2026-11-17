$ErrorActionPreference = 'Stop'
Set-Location 'C:\Users\PentiumCity\.cursor\projects\c-Users-PentiumCity-cursor\agent-tools\pcbuilders-stock-tracker'

git add -A
$pending = git status --porcelain
if ($pending) {
  git -c user.email='peoeyeshashika@users.noreply.github.com' -c user.name='peoeyeshashika' commit -m 'fix: deploy pages from committed data; local daily scrape'
  git push origin main
} else {
  Write-Host 'Nothing to commit'
}

# Schedule daily scrape at 08:00 local time
$taskName = 'PCBuildersStockTrackerDaily'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -ExecutionPolicy Bypass -File "C:\Users\PentiumCity\.cursor\projects\c-Users-PentiumCity-cursor\agent-tools\pcbuilders-stock-tracker\scripts\refresh-and-push.ps1"'
$trigger = New-ScheduledTaskTrigger -Daily -At 8:00am
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description 'Scrape pcbuilders.lk stock and push daily changes to GitHub Pages' | Out-Null
Write-Host "Scheduled task registered: $taskName (daily 8:00 AM)"
Write-Host 'Live URL: https://peoeyeshashika.github.io/pcbuilders-stock-tracker/'
