import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL  as string;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!SUPABASE_URL || !SUPABASE_ANON) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  realtime: { params: { eventsPerSecond: 10 } },
});

// ── Shared types ──────────────────────────────────────────────

export interface Project {
  id:                 string;
  name:               string;
  slug:               string;
  category:           string;
  ecosystem?:         string[];
  logo_url?:          string;
  significance_score: number;
  tvl_usd?:           number;
}

export interface Event {
  id:              string;
  project_id:      string;
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
  // Joined from projects
  project?:        Project;
}

export type EventFilter = {
  project_id?:     string;
  event_category?: 'planned' | 'unplanned' | 'all';
  event_type?:     string;
  min_severity?:   number;
  search?:         string;
};
