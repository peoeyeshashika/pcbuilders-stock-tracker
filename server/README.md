# Run stock poll on a real server (not laptop)

GitHub Actions cannot scrape `pcbuilders.lk` (API returns **403** from cloud IPs).
Your laptop works, but if it sleeps/off, polling stops.

## Best option: cron on the same hosting as pcbuilders.lk

Because the poll runs from the store’s own network/IP, the API usually works.

### Requirements
- SSH or cPanel Terminal on the hosting
- Node.js 18+ **or** use the PHP fallback
- A GitHub Personal Access Token with `repo` scope (to push updates)

### Setup (Node)

```bash
# on the server
cd /home/YOURUSER/
git clone https://github.com/peoeyeshashika/pcbuilders-stock-tracker.git
cd pcbuilders-stock-tracker
npm i   # none required, but ok

# put token in env (do NOT commit the token)
export GITHUB_TOKEN=ghp_xxxxxxxx
export GIT_USER_NAME=server-bot
export GIT_USER_EMAIL=bot@pcbuilders.lk
```

Crontab (every 5 minutes):

```cron
*/5 * * * * cd /home/YOURUSER/pcbuilders-stock-tracker && /usr/bin/node scripts/scrape.mjs && /bin/bash server/push.sh >> /tmp/pcb-stock.log 2>&1
```

### After this works
You can disable the Windows Task Scheduler task on the laptop:
`PCBuildersStockTrackerDaily`
