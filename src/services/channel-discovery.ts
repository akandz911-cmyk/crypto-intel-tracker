import fetch from 'node-fetch';
import { supabase } from '../db/client';
import { config } from '../config';
import { logger } from '../utils/logger';

async function callGroq(prompt: string): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY not set');
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 600,
      temperature: 0,
    }),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}`);
  const data = await res.json() as any;
  return data?.choices?.[0]?.message?.content ?? '';
}

interface ProjectStub {
  id: string; name: string; slug: string; website?: string; category: string;
}

interface DiscoveredChannel {
  channel_type: string; channel_identifier: string;
  channel_url: string; discovery_method: string;
}

async function findChannels(project: ProjectStub): Promise<DiscoveredChannel[]> {
  const prompt = `You are a crypto researcher. Return the official public channels for this project.

Project: ${project.name}
Category: ${project.category}
Website: ${project.website ?? 'unknown'}

Return ONLY valid JSON, nothing else:
{
  "twitter":  { "handle": "@example", "url": "https://twitter.com/example" },
  "github":   { "org": "example",     "url": "https://github.com/example" },
  "rss_blog": { "identifier": "url",  "url": "https://example.com/blog/feed" },
  "telegram": { "identifier": "@ex",  "url": "https://t.me/example" },
  "discord":  { "identifier": "ex",   "url": "https://discord.gg/example" }
}

Only include channels you are highly confident are OFFICIAL. Omit any you are unsure about.`;

  try {
    const text   = await callGroq(prompt);
    const match  = text.match(/\{[\s\S]*\}/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]) as Record<string, { handle?: string; org?: string; identifier?: string; url: string }>;
    return Object.entries(parsed)
      .filter(([, d]) => !!d?.url)
      .map(([type, d]) => ({
        channel_type:       type,
        channel_identifier: d.handle ?? d.org ?? d.identifier ?? d.url,
        channel_url:        d.url,
        discovery_method:   'ai_inferred',
      }));
  } catch (err) {
    logger.warn(`Channel discovery failed for ${project.name}`, String(err).slice(0, 100));
    return [];
  }
}

async function isReachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    return res.status < 400;
  } catch { return false; }
}

async function saveChannels(projectId: string, channels: DiscoveredChannel[]): Promise<void> {
  if (!channels.length) return;
  const { error } = await supabase
    .from('monitoring_channels')
    .upsert(
      channels.map(ch => ({
        project_id: projectId, channel_type: ch.channel_type,
        channel_identifier: ch.channel_identifier, channel_url: ch.channel_url,
        discovery_method: ch.discovery_method, is_official: true, is_active: true,
      })),
      { onConflict: 'project_id,channel_type,channel_identifier', ignoreDuplicates: false }
    );
  if (error) logger.warn(`Channel save failed: ${error.message}`);
}

export async function discoverChannelsForProject(project: ProjectStub): Promise<void> {
  logger.info(`Discovering channels: ${project.name}`);
  const channels =
