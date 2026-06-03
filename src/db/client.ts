import { createClient } from '@supabase/supabase-js';
import { config } from '../config';

// Service-role client bypasses RLS — used by all backend services
export const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  }
);

// Anon client — safe for frontend use, respects RLS
export const supabaseAnon = createClient(
  config.supabase.url,
  config.supabase.anonKey
);

// ── Type definitions matching the schema ──────────────────────

export interface Project {
  id:                 string;
  name:               string;
  slug:               string;
  website?:           string;
  category:           string;
  ecosystem?:         string[];
  token_symbol?:      string;
  logo_url?:          string;
  description?:       string;
  tvl_usd?:           number;
  daily_volume_usd?:  number;
  market_cap_usd?:    number;
  significance_score: number;
  is_active:          boolean;
  monitoring_enabled: boolean;
  metrics_updated_at?: string;
  first_seen_at:      string;
  last_updated:       string;
}

export interface MonitoringChannel {
  id:                       string;
  project_id:               string;
  channel_type:             string;
  channel_identifier:       string;
  channel_url:              string;
  discovery_method?:        string;
  is_official:              boolean;
  is_active:                boolean;
  last_checked_at?:         string;
  last_successful_fetch_at?: string;
  consecutive_errors:       number;
  total_items_fetched:      number;
}

export interface RawContent {
  id:                   string;
  project_id?:          string;
  channel_id?:          string;
  source_type:          string;
  source_platform:      string;
  source_url:           string;
  content_published_at?: string;
  raw_text:             string;
  raw_metadata:         Record<string, unknown>;
  content_hash:         string;
  processing_status:    'pending' | 'processing' | 'done' | 'skipped' | 'error';
  processing_attempts:  number;
  fetched_at:           string;
}

export interface Event {
  id:              string;
  project_id:      string;
  raw_content_id?: string;
  event_category:  'planned' | 'unplanned';
  event_type:      string;
  severity:        1 | 2 | 3 | 4 | 5;
  title:           string;
  description:     string;
  source_platform: string;
  source_url:      string;
  original_author?: string;
  event_date?:     string;
  detected_at:     string;
  tags:            string[];
  ai_confidence?:  number;
  created_at:      string;
}
