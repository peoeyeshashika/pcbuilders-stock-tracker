Set-Location 'C:\Users\PentiumCity\.cursor\projects\c-Users-PentiumCity-cursor\agent-tools\pcbuilders-stock-tracker'

if (-not (Test-Path .git)) {
  git init -b main
}

git add -A
git -c user.email='peoeyeshashika@users.noreply.github.com' -c user.name='peoeyeshashika' commit -m 'Initial PCBuilders stock tracker with daily change tabs'

$remote = git remote 2>$null
if (-not $remote) {
  gh repo create pcbuilders-stock-tracker --public --source=. --remote=origin --push --description 'PCBuilders.lk stock qty + daily decrease/increase value tracker'
} else {
  git push -u origin main
}

gh api -X POST "repos/peoeyeshashika/pcbuilders-stock-tracker/pages" -f build_type=workflow 2>$null
Write-Host 'Repo: https://github.com/peoeyeshashika/pcbuilders-stock-tracker'
Write-Host 'Pages (after Actions): https://peoeyeshashika.github.io/pcbuilders-stock-tracker/'
