#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

git config user.name "${GIT_USER_NAME:-pcb-stock-bot}"
git config user.email "${GIT_USER_EMAIL:-bot@users.noreply.github.com}"

git add data
if git diff --staged --quiet; then
  echo "No data changes"
  exit 0
fi

git commit -m "chore: server poll $(date -u +'%Y-%m-%d %H:%M')"

if [[ -n "${GITHUB_TOKEN:-}" ]]; then
  git push "https://x-access-token:${GITHUB_TOKEN}@github.com/peoeyeshashika/pcbuilders-stock-tracker.git" HEAD:main
else
  git push origin main
fi

echo "Pushed OK"
