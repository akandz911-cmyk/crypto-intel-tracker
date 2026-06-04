/**
 * AI Processing Layer v2 — Actionable Intelligence Extraction
 *
 * Fundamental shift: we are no longer classifying "is this significant news?"
 * We are answering: "Does this require a crypto user to take action or know something
 * that changes what they should do with their assets, apps, or keys?"
 *
 * Uses Groq (Llama 3.3 70B) — free tier, 14,400 requests/day.
 */

import fetch from 'node-fetch';
import { supabase } from '../db/client';
import { config } from '../config';
import { logger } from '../utils/logger';
import type { RawContent } from '../db/client';

// ── Groq API call ─────────────────────────────────────────────

async function callGroq(prompt: string): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY not set');

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model:       config.groq.model,
      messages:    [{ role: 'user', content: prompt }],
      max_tokens:  1024,
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

// ── Actionable intelligence classifier ───────────────────────

const CLASSIFICATION_PROMPT = `You are a crypto intelligence analyst. Your ONLY job is to identify events that require crypto users to take action or change their behavior — not to report news.

INCLUDE only if it meets at least one of these criteria:
- Requires users to update software, firmware, or browser extensions
- Requires users to move, migrate, or withdraw funds
- Requires users to revoke token approvals
- Requires users to rotate private keys or seed phrases
- Requires users to take action before a deadline
- Involves an active exploit, hack, or phishing campaign affecting users RIGHT NOW
- Involves a network upgrade that changes how users interact with a chain
- Involves a bridge, wallet, or protocol shutting down (exit required)
- Involves a stablecoin depegging (users need to assess exposure)
- Involves regulatory action requiring user compliance
- Involves a governance vote with a deadline (for token holders)
- Involves a DeFi contract migration requiring user action
- Involves a security vulnerability disclosure for any widely used wallet, explorer, DEX, or dashboard

EXCLUDE all of the following — do NOT report these:
- Price movements, market analysis, or trading commentary
- New product launches with no action required
- Partnership announcements with no user impact
- General crypto industry news or opinions
- Fundraising rounds or token sales (unless users must take action)
- Minor protocol parameter changes that don't affect users
- Social media drama with no on-chain consequence
- "Coming soon" announcements

SOURCE TEXT:
Platform: PLATFORM_NAME
URL: SOURCE_URL
TEXT: ARTICLE_TEXT

Reply with ONLY valid JSON, nothing else:

If NOT actionable or must-know: {"actionable": false}

If actionable:
{
  "actionable": true,
  "action_required": true,
  "urgency": "immediate OR days OR weeks OR informational",
  "action_type": "update OR migrate OR withdraw OR revoke OR claim OR vote OR exit OR verify OR monitor OR rotate_keys OR pause_usage",
  "affected_users": "all OR wallet_users OR defi_users OR bridge_users OR developers OR stablecoin_holders OR l2_users",
  "event_category": "planned OR unplanned",
  "event_type": "security_patch OR key_rotation OR approval_revocation OR fund_migration OR contract_upgrade OR network_upgrade OR service_shutdown OR compliance_deadline OR exploit_active OR phishing_active OR depeg OR rpc_change OR api_deprecation OR firmware_update OR wallet_update OR bridge_pause OR liquidity_migration OR security_breach OR exploit OR downtime OR governance OR vesting_unlock OR other",
  "severity": 3,
  "title": "Specific title naming the project and the action — max 80 chars",
  "description": "2-3 sentence factual description of what happened and why users must act",
  "action_steps": [
    "Step 1: specific action",
    "Step 2: specific action",
    "Step 3: specific action"
  ],
  "action_deadline": "ISO8601 datetime string if there is a hard deadline, otherwise null",
  "source_url": "EXACT source URL from input — do not change"
}

Urgency guide:
- immediate: Act within hours. Active exploit, funds at risk, phishing campaign live.
- days: Act within a week. Security patch available, migration deadline approaching.
- weeks: Act within a month. Planned upgrade, optional but recommended migration.
- informational: No action required but users should be aware. Network upgrade that requires no user action, governance result, general must-know.

Severity guide (1-5):
5 = Critical: funds directly at risk right now, private keys may be compromised
4 = Major: significant security patch required, funds could be at risk if ignored
3 = Moderate: required update or migration with a clear deadline
2 = Minor: recommended action, low urgency
1 = Informational: awareness only, no consequence if ignored`;

interface ActionResult {
  actionable:       boolean;
  action_required?: boolean;
  urgency?:         string;
  action_type?:     string;
  affected_users?:  string;
  event_category?:  string;
  event_type?:      string;
  severity?:        number;
  title?:           string;
  description?:     string;
  action_steps?:    string[];
  action_deadline?: string | null;
  source_url?:      string;
}

async function classifyOne(item: RawContent): Promise<ActionResult> {
  const prompt = CLASSIFICATION_PROMPT
    .replace('PLATFORM_NAME', item.source_platform)
    .replace('SOURCE_URL',    item.source_url)
    .replace('ARTICLE_TEXT',  item.raw_text.slice(0, 700));

  const text  = await callGroq(prompt);
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { actionable: false };

  try {
    return JSON.parse(match[0]) as ActionResult;
  } catch {
    return { actionable: false };
  }
}

// ── Project matching ──────────────────────────────────────────

async function findProjectId(rawText: string, existingId?: string): Promise<string | null> {
  if (existingId) return existingId;

  const { data: projects } = await supabase
    .from('projects')
    .select('id, name, slug, token_symbol')
    .eq('is_active', true)
    .order('significance_score', { ascending: false })
    .limit(250);

  if (!projects) return null;
  const text = rawText.toLowerCase();

  for (const p of projects) {
    const name   = (p.name ?? '').toLowerCase();
    const symbol = (p.token_symbol ?? '').toLowerCase();
    const slug   = (p.slug ?? '').toLowerCase();
    if (name.length   > 2 && text.includes(name))   return p.id;
    if (symbol.length > 2 && text.includes(symbol)) return p.id;
    if (slug.length   > 3 && text.includes(slug))   return p.id;
  }

  // Fallback: link to general crypto news project
  const { data: fb } = await supabase
    .from('projects').select('id').eq('slug', 'general-crypto-news').single();
  return fb?.id ?? null;
}

// ── Mark item processed ───────────────────────────────────────

async function markProcessed(id: string, actionable: boolean, errorMsg?: string): Promise<void> {
  await supabase.from('raw_content').update({
    processing_status:   errorMsg ? 'error' : (actionable ? 'done' : 'skipped'),
    processing_error:    errorMsg ?? null,
    processed_at:        new Date().toISOString(),
    is_significant:      actionable,
    processing_attempts: 1,
  }).eq('id', id);
}

// ── Main export ───────────────────────────────────────────────

export async function runAiProcessing(): Promise<void> {
  logger.info('AI processing v2 started');

  const { data: jobRow } = await supabase
    .from('system_jobs').insert({ job_name: 'ai_processing', status: 'running' })
    .select('id').single();
  const jobId = jobRow?.id;

  let processed = 0, events = 0, errors = 0;

  try {
    const { data: items } = await supabase
      .from('raw_content').select('*')
      .in('processing_status', ['pending', 'error'])
      .lt('processing_attempts', 3)
      .order('fetched_at', { ascending: true })
      .limit(20);

    if (!items?.length) { logger.info('Nothing to process'); return; }
    logger.info(`Processing ${items.length} items`);

    await supabase.from('raw_content')
      .update({ processing_status: 'processing' })
      .in('id', items.map((r: any) => r.id));

    for (const item of items as RawContent[]) {
      processed++;
      let result: ActionResult;

      try {
        result = await classifyOne(item);
        logger.info(`Item ${processed}: actionable=${result.actionable} urgency=${result.urgency ?? '-'} type=${result.action_type ?? '-'}`);
      } catch (err) {
        logger.warn(`Item ${processed} failed: ${String(err).slice(0, 200)}`);
        await markProcessed(item.id, false, String(err).slice(0, 200));
        errors++;
        await sleep(2000);
        continue;
      }

      if (!result.actionable || !result.event_type || !result.title) {
        await markProcessed(item.id, false);
        await sleep(1500);
        continue;
      }

      const projectId = await findProjectId(item.raw_text, item.project_id);
      if (!projectId) {
        await markProcessed(item.id, false, 'No project match');
        await sleep(1500);
        continue;
      }

      const { error: ie } = await supabase.from('events').insert({
        project_id:      projectId,
        raw_content_id:  item.id,
        event_category:  result.event_category ?? 'unplanned',
        event_type:      result.event_type,
        severity:        Math.min(5, Math.max(1, Number(result.severity) || 3)),
        title:           String(result.title).slice(0, 300),
        description:     String(result.description ?? '').slice(0, 2000),
        source_platform: item.source_platform,
        source_url:      result.source_url ?? item.source_url,
        detected_at:     new Date().toISOString(),
        tags:            [],
        // New actionable intelligence fields
        action_required: result.action_required ?? true,
        action_type:     result.action_type ?? null,
        action_steps:    result.action_steps ?? [],
        action_deadline: result.action_deadline ?? null,
        affected_users:  result.affected_users ?? 'all',
        urgency:         result.urgency ?? 'informational',
      });

      await markProcessed(item.id, !ie, ie?.message);
      if (!ie) {
        events++;
        logger.info(`✓ Intel saved [${result.urgency}/${result.action_type}]: ${result.title}`);
      } else {
        logger.warn(`Insert error: ${ie.message}`);
      }

      await sleep(1500);
    }
  } finally {
    logger.info(`Done: ${processed} processed, ${events} events created, ${errors} errors`);
    if (jobId) {
      await supabase.from('system_jobs').update({
        status:          'completed',
        completed_at:    new Date().toISOString(),
        items_processed: events,
        metadata:        { processed, events, errors },
      }).eq('id', jobId);
    }
  }
}

function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

if (require.main === module) {
  runAiProcessing().catch(err => { console.error(String(err)); process.exit(1); });
}
