# Run daily on this PC (Task Scheduler). Scrapes stock, diffs vs previous day, pushes to GitHub Pages.
$ErrorActionPreference = 'Stop'
Set-Location 'C:\Users\PentiumCity\.cursor\projects\c-Users-PentiumCity-cursor\agent-tools\pcbuilders-stock-tracker'

Write-Host 'Scraping pcbuilders.lk ...'
node .\scripts\scrape.mjs

git add data
$status = git status --porcelain
if (-not $status) {
  Write-Host 'No changes to push.'
  exit 0
}

git -c user.email='peoeyeshashika@users.noreply.github.com' -c user.name='peoeyeshashika' commit -m ("chore: stock snapshot " + (Get-Date -Format 'yyyy-MM-dd HH:mm'))
git push origin main
Write-Host 'Pushed. Live site updates via GitHub Pages.'
Write-Host 'https://peoeyeshashika.github.io/pcbuilders-stock-tracker/'
