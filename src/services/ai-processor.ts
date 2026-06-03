/**
 * AI Processing Layer — uses Google Gemini 1.5 Flash (FREE tier)
 * Free quota: 1,500 requests/day, 15 requests/minute
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { supabase } from '../db/client';
import { config } from '../config';
import { logger } from '../utils/logger';
import type { RawContent } from '../db/client';

const genAI = new GoogleGenerativeAI(config.gemini.apiKey);
const model  = genAI.getGenerativeModel({ model: config.gemini.model });

const SYSTEM_PROMPT = `You are a crypto intelligence analyst. You receive raw content (tweets, GitHub releases, news articles, blog posts) about crypto projects.

For each item decide if it is SIGNIFICANT and if so extract structured data.

Return ONLY valid JSON — an array, one object per input item (same order):

[
  {
    "index": 0,
    "significant": true,
    "event_category": "planned",
    "event_type": "upgrade",
    "severity": 3,
    "title": "Concise event title under 100 chars",
    "description": "2-3 sentence factual description",
    "source_url": "EXACT source_url from the input — do not change it",
    "original_author": "@handle or name if identifiable, else null",
    "event_date": "ISO8601 date if specific, else null",
    "tags": ["defi","security"],
    "ai_confidence": 0.92
  },
  {
    "index": 1,
    "significant": false
  }
]

event_category: "planned" | "unplanned"

event_type options:
  Planned:   upgrade | migration | airdrop | token_burn | listing | partnership | governance | mainnet_launch | testnet | vesting_unlock | relaunch | hardware_update | product_launch
  Unplanned: security_breach | exploit | downtime | regulatory_action | controversy | delisting | emergency_patch | community_revolt | rug_pull | incident | market_anomaly

severity: 1=informational 2=minor 3=moderate 4=major 5=critical

Mark SIGNIFICANT if:
- Security incident, exploit, or hack of any size
- Network outage or major downtime
- Major protocol upgrade or mainnet launch
- Large airdrop or token burn
- Regulatory action or legal issue
- Major partnership or exchange listing
- Governance vote changing protocol parameters
- Founder controversy or team departure

NOT significant: generic marketing tweets, minor price commentary, reposts of old news, social engagement posts.

source_url MUST be the exact URL from input. Never fabricate URLs.
Return ONLY the JSON array. No prose, no markdown.`;

interface AIResult {
  index:           number;
  significant:     boolean;
  event_category?: 'planned' | 'unplanned';
  event_type?:     string;
  severity?:       number;
  title?:          string;
  description?:    string;
  source_url?:     string;
  original_author?: string;
  event_date?:     string | null;
  tags?:           string[];
  ai_confidence?:  number;
}

async function classifyBatch(items: RawContent[]): Promise<AIResult[]> {
  const inputText = items.map((item, i) =>
    `--- ITEM ${i} ---\nSource platform: ${item.source_platform}\nSource URL: ${item.source_url}\nPublished: ${item.content_published_at ?? 'unknown'}\nContent:\n${item.raw_text.slice(0, 1000)}`
  ).join('\n\n');

  const result = await model.generateContent(SYSTEM_PROMPT + '\n\n' + inputText);
  const text   = result.response.text().replace(/```[a-z]*\n?/g, '').trim();

  try {
    const parsed = JSON.parse(text) as AIResult[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    logger.warn('AI batch parse failed', text.slice(0, 300));
    return [];
  }
}

async function resolveProjectId(rawItem: RawContent): Promise<string | null> {
  if (rawItem.project_id) return rawItem.project_id;

  const { data: projects } = await supabase
    .from('projects')
    .select('id, name')
    .eq('is_active', true)
    .order('significance_score', { ascending: false })
    .limit(200);

  if (!projects) return null;
  const text = rawItem.raw_text.toLowerCase();
  for (const p of projects) {
    if (text.includes(p.name.toLowerCase())) return p.id;
  }
  return null;
}

async function writeEvent(rawItem: RawContent, result: AIResult, projectId: string): Promise<void> {
  const sourceUrl = result.source_url ?? rawItem.source_url;
  if (!sourceUrl) {
    logger.warn(`Event discarded — no source_url for raw_content ${rawItem.id}`);
    return;
  }
  const { error } = await supabase.from('events').insert({
    project_id:      projectId,
    raw_content_id:  rawItem.id,
    event_category:  result.event_category!,
    event_type:      result.event_type!,
    severity:        Math.min(5, Math.max(1, result.severity ?? 3)),
    title:           (result.title ?? '').slice(0, 300),
    description:     (result.description ?? '').slice(0, 2000),
    source_platform: rawItem.source_platform,
    source_url:      sourceUrl,
    original_author: result.original_author ?? null,
    event_date:      result.event_date ?? null,
    detected_at:     new Date().toISOString(),
    tags:            result.tags ?? [],
    ai_confidence:   result.ai_confidence ?? null,
  });
  if (error) logger.warn(`Event insert failed for raw ${rawItem.id}`, error.message);
}

async function markProcessed(id: string, significant: boolean, error?: string): Promise<void> {
  await supabase.from('raw_content').update({
    processing_status:   error ? 'error' : (significant ? 'done' : 'skipped'),
    processing_error:    error ?? null,
    processed_at:        new Date().toISOString(),
    is_significant:      significant,
    processing_attempts: 1,
  }).eq('id', id);
}

export async function runAiProcessing(): Promise<void> {
  logger.info('=== AI processing cycle started ===');
  const start = Date.now();

  const { data: jobRow } = await supabase
    .from('system_jobs').insert({ job_name: 'ai_processing', status: 'running' })
    .select('id').single();
  const jobId = jobRow?.id;

  let processed = 0, events = 0, errors = 0;

  try {
    const { data: pending } = await supabase
      .from('raw_content')
      .select('*')
      .eq('processing_status', 'pending')
      .lt('processing_attempts', config.ingestion.maxRetries)
      .order('fetched_at', { ascending: true })
      .limit(config.processing.batchSize);

    if (!pending?.length) { logger.info('No pending items'); return; }

    logger.info(`Processing ${pending.length} items`);

    await supabase.from('raw_content')
      .update({ processing_status: 'processing' })
      .in('id', pending.map((r: any) => r.id));

    const CHUNK = 8; // smaller chunks to stay within Gemini token limits
    for (let i = 0; i < pending.length; i += CHUNK) {
      const chunk = pending.slice(i, i + CHUNK);

      let results: AIResult[] = [];
      try {
        results = await classifyBatch(chunk as RawContent[]);
      } catch (err) {
        logger.warn('Gemini batch call failed', String(err).slice(0, 200));
        for (const item of chunk) { await markProcessed(item.id, false, 'AI call failed'); errors++; }
        await new Promise(r => setTimeout(r, 4000)); // back off on error
        continue;
      }

      for (let j = 0; j < chunk.length; j++) {
        const item   = chunk[j] as RawContent;
        const result = results.find(r => r.index === j);
        processed++;

        if (!result) { await markProcessed(item.id, false, 'No AI result'); errors++; continue; }
        if (!result.significant) { await markProcessed(item.id, false); continue; }
        if (!result.event_category || !result.event_type || !result.title) {
          await markProcessed(item.id, false, 'Missing required fields'); continue;
        }

        const projectId = await resolveProjectId(item);
        if (!projectId) { await markProcessed(item.id, false, 'No project match'); continue; }

        await writeEvent(item, result, projectId);
        await markProcessed(item.id, true);
        events++;
      }

      // 4 seconds between batches — Gemini free: 15 RPM = 1 req/4sec
      await new Promise(r => setTimeout(r, 4000));
    }
  } finally {
    const elapsed = Math.round((Date.now() - start) / 1000);
    logger.info(`=== Done: ${processed} processed, ${events} events, ${errors} errors in ${elapsed}s ===`);
    if (jobId) {
      await supabase.from('system_jobs').update({
        status:          errors > processed * 0.5 ? 'failed' : 'completed',
        completed_at:    new Date().toISOString(),
        items_processed: events,
        metadata:        { processed, events, errors, elapsed_seconds: elapsed },
      }).eq('id', jobId);
    }
  }
}

if (require.main === module) {
  runAiProcessing().catch(err => { logger.error(String(err)); process.exit(1); });
}
