# Crypto Intelligence Tracker

Fully automated crypto project intelligence system. Zero manual input required
once deployed. Monitors 250+ significant projects across the ecosystem and detects,
classifies, and surfaces both planned activities and unplanned situations in real time.

## What it does

- **Discovers** which projects to monitor by scoring TVL, volume, and market cap
  from DeFiLlama, CoinGecko, and CoinMarketCap — updated daily, self-maintaining
- **Finds** official channels (Twitter/X, GitHub, blogs, Telegram) for each project
  using Claude AI — no manual channel mapping needed
- **Ingests** content every 15 minutes from RSS feeds, GitHub releases and security
  advisories, Twitter timelines and search, and 6 major crypto news outlets
- **Classifies** every piece of raw content through Claude Sonnet — filters noise,
  classifies as planned/unplanned, assigns severity 1–5, and extracts the original
  source URL (non-negotiable field on every event)
- **Streams** structured events to a React dashboard via Supabase Realtime

## Architecture

```
Registry Sources          Monitoring Sources
(DeFiLlama/CoinGecko/CMC)   (Twitter/GitHub/RSS/News)
         │                           │
         ▼                           ▼
  Project Discovery           Ingestion Layer
         │                           │
         ▼                           ▼
  Channel Discovery AI  ──►  Raw Content Queue
         │                           │
         └──────────┬────────────────┘
                    ▼
           AI Processing (Claude Sonnet)
           Significance │ Classification │ Extraction
                    │
                    ▼
           Supabase PostgreSQL
           (projects / monitoring_channels / raw_content / events)
                    │
                    ▼
           Supabase Realtime
                    │
                    ▼
           React Dashboard
```

## Prerequisites

| Service | Plan | Cost |
|---------|------|------|
| Supabase | Free tier | $0 |
| Anthropic API | Pay-per-use | ~$5–20/mo at scale |
| CoinGecko | Free Demo API | $0 |
| CoinMarketCap | Basic Free | $0 |
| GitHub Token | Fine-grained PAT | $0 |
| Twitter/X API | Basic ($100/mo) | Optional |

Twitter is optional — the system works without it, it just won't monitor
Twitter timelines. RSS, GitHub, and news outlets work with zero paid APIs.

## Setup

### 1. Supabase

1. Create a project at supabase.com
2. Run `schema.sql` in the SQL editor
3. Copy the project URL, anon key, and service role key

### 2. Backend

```bash
cd crypto-intel-tracker
cp .env.example .env
# Edit .env with your credentials

npm install
npm run dev        # Development (runs scheduler immediately)
npm run build      # Production build
npm start          # Production
```

### 3. Dashboard

```bash
cd dashboard
cp .env.example .env
# Edit .env with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY

npm install
npm run dev        # http://localhost:5173
npm run build      # Static files in dist/
```

Deploy the dashboard anywhere that serves static files: Vercel, Netlify, Cloudflare Pages.

### 4. Deploying the backend (production)

The scheduler must run continuously. Options:

**Railway / Render / Fly.io** (recommended):
```
Start command: npm start
```

**Docker:**
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json .
RUN npm ci --production
COPY dist ./dist
CMD ["node", "dist/scheduler.js"]
```

**VPS (PM2):**
```bash
npm install -g pm2
npm run build
pm2 start dist/scheduler.js --name crypto-intel
pm2 save
```

## Cron schedule

| Job | Schedule | Purpose |
|-----|----------|---------|
| AI Processing | Every 5 min | raw_content → events |
| Ingestion | Every 15 min | All sources → raw_content |
| Project Discovery | Daily 02:00 UTC | Re-score + update project list |
| Channel Refresh | Weekly Sun 03:00 UTC | Re-discover official channels |

## Data model

### `projects`
Dynamically maintained list of the top 250 significant crypto projects.
`significance_score` = 40% TVL + 30% daily volume + 30% market cap (log-normalised).

### `monitoring_channels`
One row per project-channel pair. Discovered automatically by Claude AI.
Supports: twitter, github, rss_blog, rss_news, telegram, discord, medium, substack.

### `raw_content`
Every ingested item, deduped by SHA-256 hash of (url + text). 
Processing state machine: pending → processing → done | skipped | error.

### `events`
Every significant event, classified and structured by Claude.
`source_url` is a required field — events without a traceable source are discarded.
Severity: 1=informational, 2=minor, 3=moderate, 4=major, 5=critical.

## Event types

**Planned:** upgrade, migration, airdrop, token_burn, listing, partnership,
governance, mainnet_launch, testnet, vesting_unlock, relaunch, hardware_update, product_launch

**Unplanned:** security_breach, exploit, downtime, regulatory_action, controversy,
delisting, emergency_patch, community_revolt, rug_pull, incident, market_anomaly

## Extending

**Add a new ingester:** Create a new file in `src/services/ingestion/`, implement
the fetcher, save to `raw_content`, then add it to `src/services/ingestion/index.ts`.

**Add a new event type:** Add the value to the `event_type` CHECK constraint in
`schema.sql`, add it to the AI system prompt in `ai-processor.ts`, and add a label
in `EventCard.tsx`.

**Change the project scoring formula:** Edit `computeSignificance()` in
`project-discovery.ts`. The current weights are TVL 40%, volume 30%, market cap 30%.

**Adjust what counts as significant:** Edit the significance rules in the system
prompt inside `ai-processor.ts`. The AI makes the final call on every item.

## Observability

All job runs are logged to the `system_jobs` table with start/end times,
item counts, and error messages. Query it directly in Supabase for debugging.

```sql
SELECT job_name, status, items_processed, elapsed_seconds, started_at
FROM system_jobs
ORDER BY started_at DESC
LIMIT 50;
```
