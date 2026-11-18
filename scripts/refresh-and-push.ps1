# Polls pcbuilders.lk every 5 min via Task Scheduler.
# Always pushes so live "Last check" stays fresh.
$ErrorActionPreference = 'Stop'
Set-Location 'C:\Users\PentiumCity\.cursor\projects\c-Users-PentiumCity-cursor\agent-tools\pcbuilders-stock-tracker'

Write-Host "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') Scraping..."
node .\scripts\scrape.mjs

$metaPath = '.\data\poll-meta.json'
$changed = $false
$changeCount = 0
if (Test-Path $metaPath) {
  $meta = Get-Content $metaPath -Raw | ConvertFrom-Json
  $changed = [bool]$meta.changed
  $changeCount = [int]$meta.change_count
}

git add data index.html scripts
$status = git status --porcelain
if (-not $status) {
  Write-Host 'No file changes.'
  exit 0
}

$msg = if ($changed) {
  "chore: stock movement $(Get-Date -Format 'yyyy-MM-dd HH:mm') ($changeCount changes)"
} else {
  "chore: poll $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
}

git -c user.email='peoeyeshashika@users.noreply.github.com' -c user.name='peoeyeshashika' commit -m $msg
git push origin main
Write-Host "Pushed live update (changed=$changed). https://peoeyeshashika.github.io/pcbuilders-stock-tracker/"
