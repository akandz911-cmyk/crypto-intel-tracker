import fetch from 'node-fetch';
import { supabase } from '../db/client';
import { logger } from '../utils/logger';

async function callGroq(prompt: string): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY not set');

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 512,
      temperature: 0,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Groq HTTP ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json() as any;
  return data?.choices?.[0]?.message?.content ?? '';
}

async function classifyOne(rawText: string, sourceUrl: string, platform: string): Promise<any> {
  const prompt = `You are a crypto analyst. Is this news significant?

SIGNIFICANT: hack, exploit, security breach, protocol upgrade, mainnet launch, exchange listing, delisting, regulatory action, major partnership, airdrop, token burn, governance vote, outage, rug pull, project shutdown.
NOT SIGNIFICANT: price commentary, market analysis, opinion pieces, general news roundups.

Source: ${platform}
Text: ${rawText.slice(0, 600)}

Reply with ONLY valid JSON and nothing else:
Not significant: {"significant":false}
Significant: {"significant":true,"event_category":"planned or unplanned","event_type":"exploit or upgrade or listing or delisting or regulatory_action or partnership or airdrop or token_burn or governance or downtime or rug_pull or incident or product_launch","severity":3,"title":"short title under 80 chars","description":"2 sentence factual summary","source_url":"${sourceUrl}"}`;

  const text = await callGroq(prompt);
  const match = text.match(/\{[\s\S]*?\}/);
  if (!match) return { significant: false };
  try { return JSON.parse(match[0]); } catch { return { significant: false }; }
}

async function findProjectId(rawText: string, existingId?: string): Promise<string | null> {
  if (existingId) return existingId;
  const { data: projects } = await supabase
    .from('projects').select('id, name, slug, token_symbol')
    .eq('is_active', true).order('significance_score', { ascending: false }).limit(250);
  if (!projects) return null;
  const text = rawText.toLowerCase();
  for (const p of projects) {
    if ((p.name?.length ?? 0) > 2 && text.includes(p.name.toLowerCase())) return p.id;
    if ((p.token_symbol?.length ?? 0) > 2 && text.includes(p.token_symbol!.toLowerCase())) return p.id;
  }
  const { data: fb } = await supabase.from('projects').select('id').eq('slug', 'general-crypto-news').single();
  return fb?.id ?? null;
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
      .order('fetched_at', { ascending: true })
      .limit(30);

    if (!items?.length) { logger.info('Nothing to process'); return; }
    logger.info(`Processing ${items.length} items`);

    await supabase.from('raw_content')
      .update({ processing_status: 'processing' })
      .in('id', items.map((r: any) => r.id));

    for (const item of items as any[]) {
      processed++;
      let result: any;

      try {
        result = await classifyOne(item.raw_text, item.source_url, item.source_platform);
        logger.info(`Item ${processed}: significant=${result.significant} type=${result.event_type ?? '-'}`);
      } catch (err) {
        logger.warn(`Item ${processed} failed: ${String(err).slice(0, 200)}`);
        await supabase.from('raw_content').update({
          processing_status: 'error',
          processing_error: String(err).slice(0, 200),
          processing_attempts: 1,
        }).eq('id', item.id);
        errors++;
        await sleep(2000);
        continue;
      }

      if (!result.significant || !result.event_type || !result.title) {
        await supabase.from('raw_content').update({ processing_status: 'skipped', processing_attempts: 1 }).eq('id', item.id);
        await sleep(1000);
        continue;
      }

      const projectId = await findProjectId(item.raw_text, item.project_id);
      if (!projectId) {
        await supabase.from('raw_content').update({ processing_status: 'skipped', processing_attempts: 1 }).eq('id', item.id);
        await sleep(1000);
        continue;
      }

      const { error: ie } = await supabase.from('events').insert({
        project_id: projectId,
        raw_content_id: item.id,
        event_category: result.event_category ?? 'unplanned',
        event_type: result.event_type,
        severity: Math.min(5, Math.max(1, Number(result.severity) || 3)),
        title: String(result.title).slice(0, 300),
        description: String(result.description ?? '').slice(0, 2000),
        source_platform: item.source_platform,
        source_url: result.source_url ?? item.source_url,
        detected_at: new Date().toISOString(),
        tags: Array.isArray(result.tags) ? result.tags : [],
      });

      await supabase.from('raw_content').update({
        processing_status: ie ? 'error' : 'done',
        is_significant: !ie,
        processed_at: new Date().toISOString(),
        processing_attempts: 1,
      }).eq('id', item.id);

      if (!ie) { events++; logger.info(`✓ Event: ${result.title}`); }
      else logger.warn(`Insert error: ${ie.message}`);
      await sleep(1000);
    }
  } finally {
    logger.info(`Done: ${processed} processed, ${events} events, ${errors} errors`);
    if (jobId) await supabase.from('system_jobs').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      items_processed: events,
      metadata: { processed, events, errors },
    }).eq('id', jobId);
  }
}

function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

if (require.main === module) {
  runAiProcessing().catch(err => { console.error(String(err)); process.exit(1); });
}
