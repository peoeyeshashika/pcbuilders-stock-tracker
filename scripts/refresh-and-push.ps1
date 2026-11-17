# Polls pcbuilders.lk every ~10 min via Task Scheduler.
# Pushes to GitHub Pages when qty changes are detected (or FORCE_PUSH=1).
$ErrorActionPreference = 'Stop'
Set-Location 'C:\Users\PentiumCity\.cursor\projects\c-Users-PentiumCity-cursor\agent-tools\pcbuilders-stock-tracker'

Write-Host "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') Scraping..."
node .\scripts\scrape.mjs

$metaPath = '.\data\poll-meta.json'
$changed = $false
if (Test-Path $metaPath) {
  $meta = Get-Content $metaPath -Raw | ConvertFrom-Json
  $changed = [bool]$meta.changed
}

$force = $env:FORCE_PUSH -eq '1'
git add data
$status = git status --porcelain -- data
if (-not $status) {
  Write-Host 'No file changes.'
  exit 0
}

if (-not $changed -and -not $force) {
  # Still commit locally? Keep working tree clean by committing data always so last.json stays,
  # but only push to remote when stock moved (saves GitHub Actions noise).
  git -c user.email='peoeyeshashika@users.noreply.github.com' -c user.name='peoeyeshashika' commit -m ("chore: poll $(Get-Date -Format 'yyyy-MM-dd HH:mm') (no qty change)")
  Write-Host 'Polled OK — no qty change, skip remote push.'
  exit 0
}

git -c user.email='peoeyeshashika@users.noreply.github.com' -c user.name='peoeyeshashika' commit -m ("chore: stock movement $(Get-Date -Format 'yyyy-MM-dd HH:mm')")
git push origin main
Write-Host 'Pushed live update: https://peoeyeshashika.github.io/pcbuilders-stock-tracker/'
