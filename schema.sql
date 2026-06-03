-- ============================================================
-- Crypto Intelligence Tracker — Supabase Schema
-- Run this in the Supabase SQL editor
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── PROJECTS ────────────────────────────────────────────────
-- Dynamically maintained list of significant crypto projects.
-- Updated daily by the project-discovery service.
CREATE TABLE projects (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT NOT NULL,
  slug               TEXT UNIQUE NOT NULL,
  website            TEXT,
  category           TEXT NOT NULL CHECK (category IN (
                       'L1','L2','DEX','AMM','Lending','Bridge','Oracle',
                       'Wallet','Explorer','Launchpad','Staking','DeFi','CEX','Other'
                     )),
  ecosystem          TEXT[],          -- ['Ethereum','Solana','BNB Chain',…]
  token_symbol       TEXT,
  logo_url           TEXT,
  description        TEXT,

  -- Significance metrics, refreshed every 24h
  tvl_usd            NUMERIC,
  daily_volume_usd   NUMERIC,
  market_cap_usd     NUMERIC,
  significance_score NUMERIC NOT NULL DEFAULT 0,

  -- State
  is_active          BOOLEAN NOT NULL DEFAULT true,
  monitoring_enabled BOOLEAN NOT NULL DEFAULT true,

  metrics_updated_at TIMESTAMPTZ,
  first_seen_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_updated       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── MONITORING CHANNELS ─────────────────────────────────────
-- One row per (project, channel) pair.
-- Discovered automatically by the channel-discovery AI.
CREATE TABLE monitoring_channels (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id              UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  channel_type            TEXT NOT NULL CHECK (channel_type IN (
                            'twitter','github','rss_blog','rss_news',
                            'telegram','discord','medium','substack','website'
                          )),
  channel_identifier      TEXT NOT NULL,  -- @handle, org name, URL, etc.
  channel_url             TEXT NOT NULL,
  discovery_method        TEXT,           -- 'ai_inferred' | 'verified'
  is_official             BOOLEAN NOT NULL DEFAULT true,
  is_active               BOOLEAN NOT NULL DEFAULT true,
  last_checked_at         TIMESTAMPTZ,
  last_successful_fetch_at TIMESTAMPTZ,
  consecutive_errors      INT NOT NULL DEFAULT 0,
  total_items_fetched     INT NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, channel_type, channel_identifier)
);

-- ── RAW CONTENT ─────────────────────────────────────────────
-- Every piece of ingested content before AI processing.
-- Acts as a deduplication buffer and audit trail.
CREATE TABLE raw_content (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id           UUID REFERENCES projects(id) ON DELETE SET NULL,
  channel_id           UUID REFERENCES monitoring_channels(id) ON DELETE SET NULL,

  source_type          TEXT NOT NULL,   -- 'twitter'|'github_release'|'rss'|'news_article'
  source_platform      TEXT NOT NULL,   -- 'Twitter/X'|'GitHub'|'CoinDesk'|…
  source_url           TEXT NOT NULL,
  content_published_at TIMESTAMPTZ,
  raw_text             TEXT NOT NULL,
  raw_metadata         JSONB NOT NULL DEFAULT '{}',

  -- SHA-256 of (source_url + raw_text) — prevents reprocessing identical content
  content_hash         TEXT UNIQUE NOT NULL,

  -- Processing state machine
  processing_status    TEXT NOT NULL DEFAULT 'pending'
                         CHECK (processing_status IN
                           ('pending','processing','done','skipped','error')),
  processing_attempts  INT NOT NULL DEFAULT 0,
  processing_error     TEXT,
  processed_at         TIMESTAMPTZ,
  is_significant       BOOLEAN,

  fetched_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── EVENTS ──────────────────────────────────────────────────
-- Structured, AI-classified events. The source_url field is
-- NON-NEGOTIABLE — every event must trace to an original source.
CREATE TABLE events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  raw_content_id  UUID REFERENCES raw_content(id) ON DELETE SET NULL,

  -- Classification
  event_category  TEXT NOT NULL CHECK (event_category IN ('planned','unplanned')),
  event_type      TEXT NOT NULL CHECK (event_type IN (
                    -- Planned
                    'upgrade','migration','airdrop','token_burn','listing',
                    'partnership','governance','mainnet_launch','testnet',
                    'vesting_unlock','relaunch','hardware_update','product_launch',
                    -- Unplanned
                    'security_breach','exploit','downtime','regulatory_action',
                    'controversy','delisting','emergency_patch','community_revolt',
                    'rug_pull','incident','market_anomaly'
                  )),
  -- 1=informational, 2=minor, 3=moderate, 4=major, 5=critical
  severity        INT NOT NULL CHECK (severity BETWEEN 1 AND 5),

  -- Content
  title           TEXT NOT NULL,
  description     TEXT NOT NULL,

  -- Source — never null, never omitted
  source_platform TEXT NOT NULL,
  source_url      TEXT NOT NULL,
  original_author TEXT,

  -- Timing
  event_date      TIMESTAMPTZ,         -- when the event itself happens/happened
  detected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Metadata
  tags            TEXT[] NOT NULL DEFAULT '{}',
  ai_confidence   NUMERIC CHECK (ai_confidence BETWEEN 0 AND 1),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── SYSTEM JOBS ─────────────────────────────────────────────
-- Tracks every scheduled job run for observability.
CREATE TABLE system_jobs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name         TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('running','completed','failed')),
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at     TIMESTAMPTZ,
  items_processed  INT NOT NULL DEFAULT 0,
  error_message    TEXT,
  metadata         JSONB NOT NULL DEFAULT '{}'
);

-- ── INDEXES ─────────────────────────────────────────────────
CREATE INDEX idx_events_project_id   ON events(project_id);
CREATE INDEX idx_events_detected_at  ON events(detected_at DESC);
CREATE INDEX idx_events_category     ON events(event_category);
CREATE INDEX idx_events_type         ON events(event_type);
CREATE INDEX idx_events_severity     ON events(severity DESC);

CREATE INDEX idx_raw_pending         ON raw_content(processing_status, fetched_at)
  WHERE processing_status = 'pending';
CREATE INDEX idx_raw_hash            ON raw_content(content_hash);

CREATE INDEX idx_channels_project    ON monitoring_channels(project_id);
CREATE INDEX idx_channels_active     ON monitoring_channels(is_active, channel_type)
  WHERE is_active = true;

CREATE INDEX idx_projects_score      ON projects(significance_score DESC)
  WHERE is_active = true;

-- ── ROW LEVEL SECURITY ──────────────────────────────────────
ALTER TABLE projects            ENABLE ROW LEVEL SECURITY;
ALTER TABLE events              ENABLE ROW LEVEL SECURITY;
ALTER TABLE monitoring_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_content         ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_jobs         ENABLE ROW LEVEL SECURITY;

-- Dashboard reads projects and events anonymously
CREATE POLICY "public_read_projects" ON projects  FOR SELECT USING (true);
CREATE POLICY "public_read_events"   ON events    FOR SELECT USING (true);

-- Backend service role bypasses RLS (uses SUPABASE_SERVICE_ROLE_KEY)

-- ── REALTIME ────────────────────────────────────────────────
-- Enable Supabase Realtime on the tables the dashboard subscribes to
ALTER PUBLICATION supabase_realtime ADD TABLE events;
ALTER PUBLICATION supabase_realtime ADD TABLE projects;
