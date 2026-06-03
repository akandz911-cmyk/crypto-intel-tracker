# Deployment Guide — 100% Free Stack

## Platforms Used (All Free)

| What           | Platform              | Free Limit                          |
|----------------|-----------------------|-------------------------------------|
| Database       | Supabase              | 500MB, 2 projects, Realtime included|
| AI Processing  | Google Gemini API     | 1,500 requests/day, 15 req/min      |
| Scheduler      | GitHub Actions        | Unlimited on public repos           |
| Dashboard host | Vercel                | Unlimited hobby deployments         |
| Project data   | DeFiLlama             | No key needed, fully public         |
| Market data    | CoinGecko             | 30 calls/min on demo key            |
| Market data    | CoinMarketCap         | 500 calls/day on basic key          |
| GitHub data    | GitHub PAT            | 5,000 API requests/hour             |
| Twitter/X      | SKIP                  | API requires $100/mo — not free     |

Total monthly cost: $0.00

---

## Step 1 — Create All Your Accounts First (Do This Before Anything Else)

Open each of these in a new tab and create a free account:

1. **GitHub** → https://github.com/signup
2. **Supabase** → https://supabase.com (click "Start your project")
3. **Google AI Studio** → https://aistudio.google.com (sign in with Google account)
4. **CoinGecko** → https://www.coingecko.com/en/api (click "Get Free API Key")
5. **CoinMarketCap** → https://coinmarketcap.com/api (click "Get Your API Key Now" — choose Basic/Free)
6. **Vercel** → https://vercel.com/signup (sign up with your GitHub account)

---

## Step 2 — Set Up Supabase (Your Database)

**Platform: Supabase — https://supabase.com**

1. Log in to Supabase and click **"New project"**
2. Name it anything (e.g. `crypto-intel`)
3. Choose a strong database password — **save it somewhere, you'll need it**
4. Choose the **free region closest to you**
5. Click **"Create new project"** — wait 2 minutes for it to spin up

**Run the database schema:**

6. In the left sidebar click **"SQL Editor"**
7. Click **"New query"**
8. Open the file `schema.sql` from this project
9. Copy the entire contents and paste it into the SQL editor
10. Click **"Run"** (or press Ctrl+Enter)
11. You should see "Success. No rows returned" — that means it worked

**Copy your credentials:**

12. In the left sidebar click **"Project Settings"** (gear icon at the bottom)
13. Click **"API"**
14. Copy and save these three values — you will need all three:
    - **Project URL** — looks like `https://abcdefgh.supabase.co`
    - **anon public** key — long string starting with `eyJ...`
    - **service_role** key — another long string starting with `eyJ...` (keep this secret)

15. To verify Realtime is enabled: left sidebar → **"Database"** → **"Replication"**
    → confirm the `events` and `projects` tables show as "Enabled"

---

## Step 3 — Get Your Google Gemini API Key (Free AI)

**Platform: Google AI Studio — https://aistudio.google.com**

1. Go to https://aistudio.google.com
2. Sign in with your Google account
3. Click **"Get API key"** in the top left
4. Click **"Create API key"**
5. Choose **"Create API key in new project"**
6. Copy the key — it looks like `AIzaSy...`
7. **Save it** — this is your `GEMINI_API_KEY`

Free limits: 1,500 requests per day, 15 requests per minute — more than enough.

---

## Step 4 — Get Your CoinGecko API Key (Free)

**Platform: CoinGecko — https://www.coingecko.com/en/api**

1. Go to https://www.coingecko.com/en/api
2. Click **"Get Free API Key"**
3. Create a free account or log in
4. Go to the **"Developer Dashboard"**
5. Click **"Add New Key"**
6. Name it anything (e.g. `crypto-intel`)
7. Copy the key
8. **Save it** — this is your `COINGECKO_API_KEY`

---

## Step 5 — Get Your CoinMarketCap API Key (Free)

**Platform: CoinMarketCap — https://coinmarketcap.com/api**

1. Go to https://coinmarketcap.com/api
2. Click **"Get Your API Key Now"**
3. Create a free account
4. After signup you are automatically given a **Basic plan** (free)
5. Go to your dashboard at https://pro.coinmarketcap.com/account
6. Copy the API key shown on the dashboard
7. **Save it** — this is your `CMC_API_KEY`

---

## Step 6 — Get Your GitHub Personal Access Token (Free)

**Platform: GitHub — https://github.com**

1. Log in to GitHub
2. Click your profile picture (top right) → **"Settings"**
3. Scroll down the left sidebar → click **"Developer settings"**
4. Click **"Personal access tokens"** → **"Fine-grained tokens"**
5. Click **"Generate new token"**
6. Set:
   - **Token name:** `crypto-intel-tracker`
   - **Expiration:** `No expiration` (or 1 year)
   - **Repository access:** `Public repositories (read-only)`
   - **Permissions:** Under "Repository permissions" find **"Contents"** → set to **"Read-only"**
7. Click **"Generate token"**
8. Copy the token — it starts with `github_pat_...`
9. **Save it immediately** — you cannot see it again after leaving the page
10. This is your `GH_TOKEN`

---

## Step 7 — Create Your GitHub Repository

**Platform: GitHub — https://github.com**

1. Go to https://github.com/new
2. Set:
   - **Repository name:** `crypto-intel-tracker`
   - **Visibility:** **Public** (required for unlimited free GitHub Actions minutes)
   - Do NOT check "Add a README file"
3. Click **"Create repository"**
4. GitHub will show you a page with setup instructions — **leave this tab open**

---

## Step 8 — Push All Code to GitHub

Do this on your computer in Terminal (Mac/Linux) or Command Prompt (Windows):

```bash
# Navigate to where you saved the downloaded project folder
cd path/to/crypto-intel-tracker

# Initialize git (if not already done)
git init

# Add all files
git add .

# First commit
git commit -m "Initial commit"

# Connect to your GitHub repo (replace YOUR_USERNAME with your GitHub username)
git remote add origin https://github.com/YOUR_USERNAME/crypto-intel-tracker.git

# Push to GitHub
git branch -M main
git push -u origin main
```

Refresh your GitHub repository page — you should see all the files listed.

**Important:** Make sure the `.github/` folder is visible in your repo.
If not, run `git add .github -f` then commit and push again.

---

## Step 9 — Add Secrets to GitHub Actions

This is where you give GitHub Actions all your API keys securely.

1. Go to your repository on GitHub
2. Click the **"Settings"** tab (top of the repo page)
3. In the left sidebar click **"Secrets and variables"** → **"Actions"**
4. Click **"New repository secret"** for EACH of the following:

Add these one by one — Name exactly as shown, then paste the value:

| Secret Name                | Value                                    |
|----------------------------|------------------------------------------|
| `SUPABASE_URL`             | Your Supabase Project URL                |
| `SUPABASE_SERVICE_ROLE_KEY`| Your Supabase service_role key           |
| `SUPABASE_ANON_KEY`        | Your Supabase anon public key            |
| `GEMINI_API_KEY`           | Your Google Gemini API key               |
| `CMC_API_KEY`              | Your CoinMarketCap API key               |
| `COINGECKO_API_KEY`        | Your CoinGecko API key                   |
| `GH_TOKEN`                 | Your GitHub Personal Access Token        |

After adding all 7 secrets, you should see them listed under "Repository secrets".
The values are hidden — that's correct and expected.

---

## Step 10 — Test That GitHub Actions Works

1. In your GitHub repo click the **"Actions"** tab
2. You should see 4 workflows listed on the left:
   - AI Processing
   - Content Ingestion
   - Project Discovery
   - Channel Refresh

3. Click **"Project Discovery"** in the left sidebar
4. Click **"Run workflow"** button (top right of the workflow list)
5. Click the green **"Run workflow"** button in the dropdown
6. Wait 30–60 seconds then click the running job to see logs
7. It should show green checkmarks when done

If you see errors, click the failed step to see the error message.
The most common issue is a wrong secret value — double-check Step 9.

**After Project Discovery succeeds, run Ingestion:**

5. Go back to Actions tab → click **"Content Ingestion"** → **"Run workflow"**
6. Wait for it to finish

**After Ingestion succeeds, run AI Processing:**

7. Click **"AI Processing"** → **"Run workflow"**
8. Wait for it to finish

**Verify data in Supabase:**

9. Go to your Supabase project → left sidebar → **"Table Editor"**
10. Click the **"projects"** table — you should see hundreds of rows
11. Click the **"events"** table — you should see classified events
    (may be empty until content has been ingested and processed)

---

## Step 11 — Deploy the Dashboard to Vercel

**Platform: Vercel — https://vercel.com**

**Prepare the dashboard folder:**

The dashboard is a separate app inside the `dashboard/` folder.
You need to push it as a separate repo OR deploy it from the subfolder.

**Option A — Deploy from subfolder (easiest):**

1. Log in to Vercel at https://vercel.com
2. Click **"Add New"** → **"Project"**
3. Click **"Import Git Repository"**
4. Find and select your `crypto-intel-tracker` repository
5. Vercel will show project settings — IMPORTANT: change the **"Root Directory"**:
   - Click **"Edit"** next to Root Directory
   - Type `dashboard`
   - Click **"Continue"**
6. Framework preset should auto-detect as **"Vite"**
7. Under **"Environment Variables"** add these two:

| Name                    | Value                          |
|-------------------------|--------------------------------|
| `VITE_SUPABASE_URL`     | Your Supabase Project URL      |
| `VITE_SUPABASE_ANON_KEY`| Your Supabase anon public key  |

8. Click **"Deploy"**
9. Wait 1–2 minutes for the build
10. Vercel gives you a URL like `https://crypto-intel-XXXXX.vercel.app` — open it

Your dashboard is now live and publicly accessible.

---

## Step 12 — Verify Everything Is Working End-to-End

1. Open your Vercel dashboard URL
2. You should see the Crypto Intelligence interface with a dark background
3. If events exist in Supabase, they will appear in the timeline
4. Open Supabase → Table Editor → events table in one tab
5. Open your dashboard in another tab
6. In Supabase, manually insert a test event:
   ```sql
   -- Run this in the SQL Editor to test Realtime
   INSERT INTO events (
     project_id, event_category, event_type, severity,
     title, description, source_platform, source_url, detected_at
   )
   SELECT
     id, 'unplanned', 'exploit', 5,
     'TEST: This is a realtime test event',
     'This is a test to verify Supabase Realtime is working correctly.',
     'Manual Test',
     'https://example.com',
     NOW()
   FROM projects LIMIT 1;
   ```
7. Watch your dashboard — the event should appear within 1–2 seconds without refreshing

If it appears instantly → Realtime is working. Delete the test event if you want.

---

## Step 13 — Confirm Automatic Scheduling Is Active

GitHub Actions scheduled workflows activate automatically.

1. Go to your repo → **"Actions"** tab
2. Wait until the next 5-minute mark on the clock — you should see
   "AI Processing" start running automatically
3. At every 15-minute mark you should see "Content Ingestion" run

**Important note about GitHub Actions scheduling:**
GitHub's free cron runners can sometimes be delayed by 5–15 minutes during peak
times — this is normal. Your jobs will still run, just occasionally a bit late.

---

## What Runs When (Full Schedule)

| Job               | Frequency      | What it does                                      |
|-------------------|----------------|---------------------------------------------------|
| AI Processing     | Every 5 min    | Takes queued raw content → classifies → writes events |
| Content Ingestion | Every 15 min   | Fetches RSS, GitHub releases, news → raw_content  |
| Project Discovery | Daily 02:00 UTC| Re-scores projects, adds new ones, drops stale    |
| Channel Refresh   | Sunday 03:00 UTC| Re-discovers official channels for all projects  |

---

## Monitoring Your System

**Check GitHub Actions history:**
Repo → Actions tab → click any workflow → see all past runs with logs

**Check database activity in Supabase:**
```sql
-- Recent job history
SELECT job_name, status, items_processed, started_at,
       (metadata->>'elapsed_seconds')::int as seconds
FROM system_jobs
ORDER BY started_at DESC
LIMIT 20;

-- Raw content queue health
SELECT processing_status, COUNT(*) 
FROM raw_content 
GROUP BY processing_status;

-- Recent events
SELECT p.name, e.event_type, e.severity, e.title, e.detected_at
FROM events e
JOIN projects p ON p.id = e.project_id
ORDER BY e.detected_at DESC
LIMIT 20;

-- Projects being monitored
SELECT name, category, significance_score, 
       (SELECT COUNT(*) FROM monitoring_channels WHERE project_id = p.id) as channels
FROM projects p
WHERE is_active = true
ORDER BY significance_score DESC
LIMIT 20;
```

---

## Common Problems and Fixes

**"No events appearing on dashboard"**
→ Run Project Discovery first, then Ingestion, then AI Processing (in that order).
   The pipeline must run in sequence at least once before events appear.

**"GitHub Actions failing with authentication error"**
→ Double-check your SUPABASE_SERVICE_ROLE_KEY secret. It's different from
   the anon key — it's the longer one labeled "service_role" in Supabase settings.

**"AI Processing job failing"**
→ Check your GEMINI_API_KEY secret. Go to Google AI Studio and verify the key
   is active. Also check you haven't hit the 1,500/day free limit.

**"Gemini rate limit error (429)"**
→ This is normal — the code already handles it with 4-second delays between
   batches. If it keeps failing, your ingestion is producing too many items
   for the free tier. Reduce config.processing.batchSize to 10 in config.ts.

**"Dashboard shows blank / connection error"**
→ Check your Vercel environment variables. VITE_SUPABASE_URL must NOT have a
   trailing slash. VITE_SUPABASE_ANON_KEY must be the anon key, NOT service_role.

**"Project Discovery taking too long and timing out"**
→ This is fine on first run — it's fetching 250+ projects from 3 APIs.
   Later runs are faster because most projects already exist (upsert, not insert).

**"GitHub Actions scheduled jobs stopped running"**
→ GitHub disables scheduled workflows in repos with no recent activity (60 days).
   To prevent this, make any small commit every few weeks, or go to
   Actions → click the workflow → click "Enable workflow".

---

## Free Tier Limits Reference

| Service       | Daily Limit             | Monthly Limit           | Hard Reset |
|---------------|-------------------------|-------------------------|------------|
| Gemini API    | 1,500 requests          | ~45,000 requests        | Daily      |
| CoinGecko     | ~30 calls/min           | No hard monthly limit   | Per minute |
| CoinMarketCap | 500 calls               | 10,000 calls            | Daily      |
| GitHub API    | 5,000 req/hr (with PAT) | No monthly limit        | Per hour   |
| GitHub Actions| Unlimited (public repo) | Unlimited (public repo) | N/A        |
| Supabase DB   | 500MB storage           | 5GB bandwidth           | Monthly    |
| Vercel        | Unlimited deployments   | 100GB bandwidth         | Monthly    |

At normal operation this system uses approximately:
- ~300 Gemini requests/day (well within the 1,500 limit)
- ~20 CoinMarketCap calls/day (well within the 500 limit)
- ~100 CoinGecko calls/day (well within limits)
- ~50MB Supabase storage per month

You have significant room to grow before hitting any limits.

---

## Summary — The 13 Steps

1. Create accounts: GitHub, Supabase, Google AI Studio, CoinGecko, CoinMarketCap, Vercel
2. Create Supabase project, run schema.sql, copy 3 credentials
3. Get Gemini API key from Google AI Studio
4. Get CoinGecko Demo API key
5. Get CoinMarketCap Basic API key
6. Create GitHub Personal Access Token
7. Create public GitHub repository
8. Push all code to the repository
9. Add 7 secrets to GitHub Actions (Settings → Secrets → Actions)
10. Manually trigger each workflow once in order: Discovery → Ingestion → AI Processing
11. Deploy dashboard to Vercel, add 2 environment variables
12. Verify end-to-end with the SQL test event
13. Confirm scheduled jobs are running automatically

After step 13, no further human input is required.
The system runs itself completely.
