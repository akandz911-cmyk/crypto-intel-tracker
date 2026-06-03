/**
 * Channel Discovery AI — uses Google Gemini (FREE tier)
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import fetch from 'node-fetch';
import { supabase } from '../db/client';
import { config } from '../config';
import { logger } from '../utils/logger';

const genAI = new GoogleGenerativeAI(config.gemini.apiKey);
const model  = genAI.getGenerativeModel({ model: config.gemini.model });

interface ProjectStub {
  id:       string;
  name:     string;
  slug:     string;
  website?: string;
  category: string;
}

interface DiscoveredChannel {
  channel_type:       string;
  channel_identifier: string;
  channel_url:        string;
  discovery_method:   string;
}

const SYSTEM_PROMPT = `You are a crypto intelligence analyst. Given a crypto project name, return ONLY valid JSON with the project's official public communication channels.

Return exactly this JSON shape (omit any field you are not confident about):
{
  "twitter":  { "handle": "@example", "url": "https://twitter.com/example" },
  "github":   { "org": "example",     "url": "https://github.com/example" },
  "rss_blog": { "identifier": "url",  "url": "https://example.com/blog/feed" },
  "telegram": { "identifier": "@ex",  "url": "https://t.me/example" },
  "discord":  { "identifier": "ex",   "url": "https://discord.gg/example" },
  "medium":   { "identifier": "@ex",  "url": "https://medium.com/@example" }
}

Rules:
- Only include channels you are highly confident are OFFICIAL
- For RSS, prefer /feed or /rss.xml paths
- Return ONLY the JSON object, no prose, no markdown fences
- If unsure about a channel, omit it`;

async function askGeminiForChannels(project: ProjectStub): Promise<DiscoveredChannel[]> {
  const prompt = `${SYSTEM_PROMPT}

Project: ${project.name}
Category: ${project.category}
Known website: ${project.website ?? 'unknown'}

Return the official channels JSON.`;

  try {
    const result = await model.generateContent(prompt);
    const text   = result.response.text().replace(/```[a-z]*\n?/g, '').trim();

    const parsed = JSON.parse(text) as Record<string, {
      handle?: string; org?: string; identifier?: string; url: string;
    }>;

    return Object.entries(parsed)
      .filter(([, data]) => !!data?.url)
      .map(([type, data]) => ({
        channel_type:       type,
        channel_identifier: data.handle ?? data.org ?? data.identifier ?? data.url,
        channel_url:        data.url,
        discovery_method:   'ai_inferred',
      }));
  } catch (err) {
    logger.warn(`Channel discovery parse failed for ${project.name}`, String(err).slice(0, 120));
    return [];
  }
}

async function isReachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    return res.status < 400;
  } catch {
    return false;
  }
}

async function saveChannels(projectId: string, channels: DiscoveredChannel[]): Promise<void> {
  if (channels.length === 0) return;
  const rows = channels.map(ch => ({
    project_id:         projectId,
    channel_type:       ch.channel_type,
    channel_identifier: ch.channel_identifier,
    channel_url:        ch.channel_url,
    discovery_method:   ch.discovery_method,
    is_official:        true,
    is_active:          true,
  }));
  const { error } = await supabase
    .from('monitoring_channels')
    .upsert(rows, { onConflict: 'project_id,channel_type,channel_identifier', ignoreDuplicates: false });
  if (error) throw new Error(`Channel save failed: ${error.message}`);
}

export async function discoverChannelsForProject(project: ProjectStub): Promise<void> {
  logger.info(`Discovering channels: ${project.name}`);
  const channels = await askGeminiForChannels(project);

  const verified: DiscoveredChannel[] = [];
  for (const ch of channels) {
    if (['rss_blog', 'substack', 'medium', 'website'].includes(ch.channel_type)) {
      if (!(await isReachable(ch.channel_url))) continue;
    }
    verified.push(ch);
  }

  logger.info(`Saving ${verified.length} verified channels for ${project.name}`);
  await saveChannels(project.id, verified);
}

export async function refreshAllChannels(): Promise<void> {
  logger.info('=== Weekly channel refresh started ===');
  const { data: projects, error } = await supabase
    .from('projects')
    .select('id, name, slug, website, category')
    .eq('is_active', true)
    .eq('monitoring_enabled', true);

  if (error || !projects) { logger.error('Failed to fetch projects', error); return; }

  let success = 0, failed = 0;
  for (const project of projects) {
    try {
      await discoverChannelsForProject(project);
      success++;
      await new Promise(r => setTimeout(r, 800)); // stay within free tier limits
    } catch (err) {
      failed++;
      logger.warn(`Channel refresh failed for ${project.name}`, err);
    }
  }
  logger.info(`=== Channel refresh done: ${success} ok, ${failed} failed ===`);
}
