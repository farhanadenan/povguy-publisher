# povguy-publisher

Daily publisher for POV Guy social drops. Reads a staged content folder produced by `povguy-content-engine` and pushes to:

| Platform | Status | Notes |
|---|---|---|
| Telegram (`@povguysg`) | ✅ live | sendMediaGroup album, supports captions |
| Telegram staging (`@povguy-staging`) | ✅ live | preview channel for silent-veto |
| Facebook Page | ⏳ token needed | Graph API `/{page-id}/photos` |
| Threads | ⏳ token needed | Threads Graph API |
| Instagram | ⏳ App Review pending | Will queue Creator Studio drafts in interim |
| TikTok | ⏳ phase 2 | Content Posting API approval needed |

## How it runs

GitHub Actions cron, daily at:
- **06:00 SGT** — preview drop posted to `@povguy-staging` (silent-veto window)
- **08:00 SGT** — if no kill action, publishes to all live platforms

## Silent-veto kill switch

Each preview message in `@povguy-staging` carries a unique `drop_id`. To kill a drop before 08:00:

1. Reply to the preview message in `@povguy-staging` with `KILL`
2. The 08:00 publish job will detect the kill marker and abort that day

## Local dev

```bash
npm install
cp .env.example .env   # fill in tokens
node src/index.js --dry-run --date 2026-04-22
```

## GitHub Actions secrets required

See `.env.example` for the full list. Set these in **Settings → Secrets and variables → Actions**.
