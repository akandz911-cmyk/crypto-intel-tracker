import { GoogleGenerativeAI } from '@google/generative-ai';
import { supabase } from '../db/client';
import { config } from '../config';
import { logger } from '../utils/logger';
import type { RawContent } from '../db/client';

const genAI = new GoogleGenerativeAI(config.gemini.apiKey);

const SYSTEM_PROMPT = `You are a crypto intelligence analyst. Classify raw content about crypto projects.

Return ONLY a valid JSON array, one object per input item (same order):
[
  {
    "index": 0,
    "significant": true,
    "event_category": "unplanned",
    "event_type": "exploit",
    "severity": 5,
    "title": "Short title under 100 chars",
    "description": "2-3 sentence factual summary",
    "source_url": "copy exact source_url from input",
    "original_author": null,
    "event_date": null,
    "tags": ["defi","security"],
    "ai_confidence": 0.9
  },
  { "index": 1, "significant": false }
]

event_category: "planned" or "unplanned"
event_type (planned): upgrade|migration|airdrop|token_burn|listing|partnership|governance|mainnet_launch|testnet|vesting_unlock|relaunch|product_launch
event_type (unplanned): security_breach|exploit|downtime|regulatory_action|controversy|delisting|emergency_patch|community_revolt|rug_pull|incident|market_anomaly
severity: 1=info 2=minor 3=moderate 4=major 5=critical

Mark significant ONLY for: security incidents, exploits, hacks, outages, major upgrades, mainnet launches, large airdrops, regulatory actions, major partnerships, exchange listings, governance votes changing parameters, founder controversies.

NOT significant: price commentary, general market news, opinion pieces, marketing posts, AMAs with no new info.

source_url must be the exact URL from input. Return ONLY the JSON array.`;

interface AIResult {
  index: number; significant: boolean;
  event_category?: 'planned' | 'unplanned'; event_type?: string;
  severity?: number; title?: string; description?: string;
  source_url?: string; original_author?: string;
  event_date?: string | null; tags?: string[]; ai_confidence?: number;
}

async function classifyBatch(items: RawContent[]): Promise<AIResult[]> {
  const inputText = items.map((item, i) =>
    `--- ITEM ${i} ---\nSource: ${item.source_platform}\nURL: ${item.source_url}\n${item.raw_text.slice(0, 800)}`
  ).join('\n\n');

  try {
    const model = genAI.getGenerativeModel({
      model: config.gemini.model,
      generationConfig: { maxOutputTokens: 2048, temperature: 0.1 },
    });

    const result = await model.generateContent(SYSTEM_PROMPT + '\n\n' + inputText);

    let text: string;
    try {
      text = result.response.text();
    } catch {
      // Response blocked by safety filters — return all as not significant
      logger.warn('Gemini response blocked by safety filters — skipping batch');
      return items.map((_, i) => ({ index: i, significant: false }));
    }

    const clean = text.replace(/```[a-z]*\n?/g, '').trim();
    const parsed = JSON.parse(clean) as AIResult[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    const msg = String(err);
    if (msg.includes('safety') || msg.includes('blocked') || msg.includes('SAFETY')) {
      logger.warn('Gemini safety block — skipping batch');
      return items.map((_, i) => ({ index: i, significant: false }));
    }
    throw err;
  }
}

async function resolveProjectId(rawItem: RawContent): Promise<string | null> {
  if (rawItem.project_id) return rawItem.project_id;
  const { data: projects } = await supabase
    .from('projects').select('id, name')
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
  if (!sourceUrl) { logger.warn(`No source_url for ${rawItem.id}`); return; }
  const { error } = await supabase.from('events').insert({
    project_id: projectId, raw_content_id: rawItem.id,
    event_category: result.event_category!, event_type: result.event_type!,
    severity: Math.min(5, Math.max(1, result.severity ?? 3)),
    title: (result.title ?? '').slice(0, 300),
    description: (result.description ?? '').slice(0, 2000),
    source_platform: rawItem.source_platform, source_url: sourceUrl,
    original_author: result.original_author ?? null,
    event_date: result.event_date ?? null,
    detected_at: new Date().toISOString(),
    tags: result.tags ?? [], ai_confidence: result.ai_confidence ?? null,
  });
  if (error) logger.warn(`Event insert failed`, error.message);
}

async function markProcessed(id: string, significant: boolean, errorMsg?: string): Promise<void> {
  await supabase.from('raw_content').update({
    processing_status: errorMsg ? 'error' : (significant ? 'done' : 'skipped'),
    processing_error: errorMsg ?? null,
    processed_at: new Date().toISOString(),
    is_significant: significant,
    processing_attempts: 1,
  }).eq('id', id);
}

export async function runAiProcessing(): Promise<void> {
  logger.info('=== AI processing started ===');
  const start = Date.now();
  const { data: jobRow } = await supabase
    .from('system_jobs').insert({ job_name: 'ai_processing', status: 'running' })
    .select('id').single();
  const jobId = jobRow?.id;

  let processed = 0, events = 0, errors = 0;

  try {
    // Pick up both 'pending' AND previously errored items for retry
    const { data: pending } = await supabase
      .from('raw_content').select('*')
      .in('processing_status', ['pending', 'error'])
      .lt('processing_attempts', config.ingestion.maxRetries)
      .order('fetched_at', { ascending: true })
      .limit(config.processing.batchSize);

    if (!pending?.length) { logger.info('No items to process'); return; }
    logger.info(`Processing ${pending.length} items`);

    // Mark as processing to prevent duplicate work
    await supabase.from('raw_content')
      .update({ processing_status: 'processing' })
      .in('id', pending.map((r: any) => r.id));

    const CHUNK = 5; // small batches to avoid safety blocks
    for (let i = 0; i < pending.length; i += CHUNK) {
      const chunk = pending.slice(i, i + CHUNK);
      let results: AIResult[] = [];

      try {
        results = await classifyBatch(chunk as RawContent[]);
      } catch (err) {
        logger.warn('Gemini call failed', String(err).slice(0, 200));
        for (const item of chunk) {
          await markProcessed(item.id, false, 'Gemini error');
          errors++;
        }
        await sleep(5000);
        continue;
      }

      for (let j = 0; j < chunk.length; j++) {
        const item = chunk[j] as RawContent;
        const result = results.find(r => r.index === j);
        processed++;

        if (!result) { await markProcessed(item.id, false, 'No AI result'); errors++; continue; }
        if (!result.significant) { await markProcessed(item.id, false); continue; }
        if (!result.event_category || !result.event_type || !result.title) {
          await markProcessed(item.id, false, 'Missing fields'); continue;
        }

        const projectId = await resolveProjectId(item);
        if (!projectId) { await markProcessed(item.id, false, 'No project match'); continue; }

        await writeEvent(item, result, projectId);
        await markProcessed(item.id, true);
        events++;
      }

      // 5 seconds between batches — respects Gemini 15 RPM free limit
      await sleep(5000);
    }
  } finally {
    const elapsed = Math.round((Date.now() - start) / 1000);
    logger.info(`=== Done: ${processed} processed, ${events} events, ${errors} errors in ${elapsed}s ===`);
    if (jobId) {
      await supabase.from('system_jobs').update({
        status: 'completed', completed_at: new Date().toISOString(),
        items_processed: events,
        metadata: { processed, events, errors, elapsed_seconds: elapsed },
      }).eq('id', jobId);
    }
  }
}

function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

if (require.main === module) {
  runAiProcessing().catch(err => { logger.error(String(err)); process.exit(1); });
}
