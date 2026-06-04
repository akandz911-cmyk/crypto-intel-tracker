import { GoogleGenerativeAI } from '@google/generative-ai';
import { supabase } from '../db/client';
import { config } from '../config';
import { logger } from '../utils/logger';

const genAI = new GoogleGenerativeAI(config.gemini.apiKey);

async function classifyOne(rawText: string, sourceUrl: string, platform: string): Promise<any> {
  const model = genAI.getGenerativeModel({ model: config.gemini.model });
  const prompt = `You are a crypto analyst. Is this news significant?

SIGNIFICANT: hack, exploit, security breach, protocol upgrade, mainnet launch, exchange listing, delisting, regulatory action, major partnership, airdrop, token burn, governance vote, outage, rug pull.
NOT significant: price commentary, market analysis, opinions, general roundups.

Source: ${platform}
URL: ${sourceUrl}
Text: ${rawText.slice(0, 500)}

Reply with ONLY JSON:
If not significant: {"significant":false}
If significant: {"significant":true,"event_category":"planned or unplanned","event_type":"exploit or upgrade or listing or regulatory_action or partnership or airdrop or token_burn or governance or downtime or rug_pull or incident or product_launch","severity":3,"title":"short title","description":"2 sentence summary","source_url":"${sourceUrl}"}`;

  try {
    const result = await model.generateContent(prompt);
    let text: string;
    try { text = result.response.text(); } catch { return { significant: false }; }
    const match = text.match(/\{[\s\S]*?\}/);
    if (!match) return { significant: false };
    return JSON.parse(match[0]);
  } catch (err) {
    logger.warn('Gemini call error', String(err).slice(0, 150));
    throw err;
  }
}

async function findProjectId(rawText: string, projectId?: string): Promise<string | null> {
  if (projectId) return projectId;
  const { data: projects } = await supabase
    .from('projects').select('id, name, slug, token_symbol')
    .eq('is_active', true).order('significance_score', { ascending: false }).limit(250);
  if (!projects) return null;
  const text = rawText.toLowerCase();
  for (const p of projects) {
    if ((p.name?.toLowerCase().length ?? 0) > 2 && text.includes(p.name.toLowerCase())) return p.id;
    if ((p.token_symbol?.toLowerCase().length ?? 0) > 2 && text.includes(p.token_symbol!.toLowerCase())) return p.id;
  }
  const { data: fallback } = await supabase.from('projects').select('id').eq('slug', 'general-crypto-news').single();
  return fallback?.id ?? null;
}

export async function runAiProcessing(): Promise<void> {
  logger.info('AI processing started');
  const { data: jobRow } = await supabase
    .from('system_jobs').insert({ job_name: 'ai_processing', status: 'running' }).select('id').single();
  const jobId = jobRow?.id;
  let processed = 0, events = 0, errors = 0;

  try {
    const { data: items } = await supabase
      .from('raw_content').select('*')
      .in('processing_status', ['pending', 'error'])
      .lt('processing_attempts', 3)
      .order('fetched_at', { ascending: true }).limit(20);

    if (!items?.length) { logger.info('Nothing to process'); return; }
    logger.info(`Processing ${items.length} items`);

    await supabase.from('raw_content').update({ processing_status: 'processing' }).in('id', items.map((r: any) => r.id));

    for (const item of items as any[]) {
      processed++;
      let result: any;
      try {
        result = await classifyOne(item.raw_text, item.source_url, item.source_platform);
        logger.info(`Item ${processed}: significant=${result.significant} type=${result.event_type ?? 'n/a'}`);
      } catch (err) {
        await supabase.from('raw_content').update({ processing_status: 'error', processing_error: 'Gemini error', processing_attempts: 1 }).eq('id', item.id);
        errors++;
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }

      if (!result.significant || !result.event_type || !result.title) {
        await supabase.from('raw_content').update({ processing_status: 'skipped', processing_attempts: 1 }).eq('id', item.id);
        await new Promise(r => setTimeout(r, 4500));
        continue;
      }

      const projectId = await findProjectId(item.raw_text, item.project_id);
      if (!projectId) {
        await supabase.from('raw_content').update({ processing_status: 'skipped', processing_attempts: 1 }).eq('id', item.id);
        await new Promise(r => setTimeout(r, 4500));
        continue;
      }

      const { error: insertErr } = await supabase.from('events').insert({
        project_id: projectId, raw_content_id: item.id,
        event_category: result.event_category ?? 'unplanned',
        event_type: result.event_type,
        severity: Math.min(5, Math.max(1, result.severity ?? 3)),
        title: String(result.title).slice(0, 300),
        description: String(result.description ?? '').slice(0, 2000),
        source_platform: item.source_platform,
        source_url: result.source_url ?? item.source_url,
        detected_at: new Date().toISOString(),
        tags: result.tags ?? [],
      });

      await supabase.from('raw_content').update({
        processing_status: insertErr ? 'error' : 'done',
        is_significant: !insertErr,
        processed_at: new Date().toISOString(),
        processing_attempts: 1,
      }).eq('id', item.id);

      if (!insertErr) { events++; logger.info(`Event saved: ${result.title}`); }
      await new Promise(r => setTimeout(r, 4500));
    }
  } finally {
    logger.info(`Done: ${processed} processed, ${events} events, ${errors} errors`);
    if (jobId) await supabase.from('system_jobs').update({
      status: 'completed', completed_at: new Date().toISOString(),
      items_processed: events, metadata: { processed, events, errors },
    }).eq('id', jobId);
  }
}
