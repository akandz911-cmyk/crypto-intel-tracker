/**
 * Project Discovery Engine v2
 *
 * Two tiers of projects:
 * 1. Dynamic tier — top 250 by TVL/volume/market cap from DeFiLlama, CoinGecko, CMC
 * 2. Infrastructure tier — hardcoded high-exposure projects that are ALWAYS monitored
 *    regardless of TVL (wallets, explorers, dashboards, bridges, RPC providers)
 */

import fetch from 'node-fetch';
import { supabase } from '../db/client';
import { config } from '../config';
import { logger } from '../utils/logger';
import { slugify } from '../utils/hash';
import { discoverChannelsForProject } from './channel-discovery';

// ── External API types ────────────────────────────────────────

interface DeFiLlamaProtocol {
  name: string; symbol: string; category: string; tvl: number;
  url: string; twitter?: string; github?: string[]; chains: string[];
  description: string; logo: string; slug: string;
}

interface CoinGeckoCoin {
  id: string; symbol: string; name: string; image: string;
  market_cap: number; total_volume: number;
}

interface CMCCoin {
  name: string; symbol: string; cmc_rank: number;
  quote: { USD: { market_cap: number; volume_24h: number } };
}

// ── Category mapping ──────────────────────────────────────────

const CATEGORY_MAP: Record<string, string> = {
  'Dexes': 'DEX', 'Dex': 'DEX', 'Lending': 'Lending', 'Bridge': 'Bridge',
  'Chain': 'L1', 'L2': 'L2', 'Yield': 'DeFi', 'Liquid Staking': 'Staking',
  'CDP': 'Lending', 'Derivatives': 'DeFi', 'Launchpad': 'Launchpad',
  'Oracle': 'Oracle', 'Algo-Stables': 'Stablecoin', 'Indexes': 'DeFi',
  'RWA': 'DeFi', 'Payments': 'DeFi', 'CEX': 'CEX', 'Wallet': 'Wallet',
};
const mapCategory = (raw: string): string => CATEGORY_MAP[raw] ?? 'DeFi';

// ── Fetch helpers ─────────────────────────────────────────────

async function fetchDeFiLlama(): Promise<DeFiLlamaProtocol[]> {
  logger.info('Fetching DeFiLlama protocols…');
  const res = await fetch('https://api.llama.fi/protocols', { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`DeFiLlama error: ${res.status}`);
  const data = await res.json() as DeFiLlamaProtocol[];
  return data.filter(p => p.tvl > 0);
}

async function fetchCoinGecko(): Promise<CoinGeckoCoin[]> {
  logger.info('Fetching CoinGecko markets…');
  const results: CoinGeckoCoin[] = [];
  const headers: Record<string, string> = { 'Accept': 'application/json' };
  if (config.apis.coinGeckoKey) headers['x-cg-demo-api-key'] = config.apis.coinGeckoKey;
  for (let page = 1; page <= 5; page++) {
    const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=${page}&sparkline=false`;
    const res = await fetch(url, { headers });
    if (!res.ok) break;
    results.push(...(await res.json() as CoinGeckoCoin[]));
    await sleep(300);
  }
  return results;
}

async function fetchCoinMarketCap(): Promise<CMCCoin[]> {
  if (!config.apis.coinMarketCapKey) return [];
  const res = await fetch('https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest?limit=500&sort=market_cap', {
    headers: { 'X-CMC_PRO_API_KEY': config.apis.coinMarketCapKey, 'Accept': 'application/json' },
  });
  if (!res.ok) return [];
  const data = await res.json() as { data: CMCCoin[] };
  return data.data ?? [];
}

// ── Scoring ───────────────────────────────────────────────────

function logNorm(v: number, max: number): number {
  if (v <= 0 || max <= 0) return 0;
  return Math.min(100, (Math.log10(v + 1) / Math.log10(max + 1)) * 100);
}

interface ScoredProject {
  name: string; slug: string; category: string; ecosystem: string[];
  tvl_usd: number; daily_volume_usd: number; market_cap_usd: number;
  significance_score: number; logo_url: string; website: string;
}

function mergeAndScore(
  defi: DeFiLlamaProtocol[],
  gecko: CoinGeckoCoin[],
  cmc: CMCCoin[],
): ScoredProject[] {
  const geckoByName = new Map(gecko.map(c => [c.name.toLowerCase(), c]));
  const merged = new Map<string, {
    name: string; category: string; ecosystem: string[];
    tvl: number; volume: number; mcap: number; logo: string; website: string;
  }>();

  for (const p of defi) {
    const key = p.name.toLowerCase();
    const g = geckoByName.get(key);
    const cmcRow = cmc.find(c => c.name.toLowerCase() === key);
    merged.set(key, {
      name: p.name, category: mapCategory(p.category), ecosystem: p.chains ?? [],
      tvl: p.tvl, volume: g?.total_volume ?? cmcRow?.quote.USD.volume_24h ?? 0,
      mcap: g?.market_cap ?? cmcRow?.quote.USD.market_cap ?? 0,
      logo: p.logo ?? g?.image ?? '', website: p.url ?? '',
    });
  }

  for (const c of gecko) {
    const key = c.name.toLowerCase();
    if (!merged.has(key)) {
      merged.set(key, {
        name: c.name, category: 'Other', ecosystem: [],
        tvl: 0, volume: c.total_volume, mcap: c.market_cap,
        logo: c.image, website: '',
      });
    }
  }

  const all = [...merged.values()];
  const maxTvl  = Math.max(...all.map(p => p.tvl));
  const maxVol  = Math.max(...all.map(p => p.volume));
  const maxMcap = Math.max(...all.map(p => p.mcap));

  return all.map(p => ({
    name: p.name, slug: slugify(p.name), category: p.category,
    ecosystem: p.ecosystem, tvl_usd: p.tvl, daily_volume_usd: p.volume,
    market_cap_usd: p.mcap, logo_url: p.logo, website: p.website,
    significance_score: Math.round(
      logNorm(p.tvl, maxTvl) * 0.40 +
      logNorm(p.volume, maxVol) * 0.30 +
      logNorm(p.mcap, maxMcap) * 0.30
    ),
  }));
}

// ── Infrastructure tier seeding ───────────────────────────────
// These projects are always monitored regardless of market metrics.
// significance_score = 999 prevents them from ever being deactivated.

async function seedInfrastructureProjects(): Promise<string[]> {
  logger.info('Seeding infrastructure project tier…');
  const now = new Date().toISOString();
  const rows = (config.infrastructureProjects as any[]).map(p => ({
    name:               p.name,
    slug:               p.slug,
    website:            p.website,
    category:           p.category,
    ecosystem:          [],
    significance_score: 999,  // never deactivated
    is_active:          true,
    monitoring_enabled: true,
    metrics_updated_at: now,
    last_updated:       now,
  }));

  const { data: existing } = await supabase.from('projects').select('slug');
  const existingSlugs = new Set((existing ?? []).map(r => r.slug));

  const { error } = await supabase
    .from('projects')
    .upsert(rows, { onConflict: 'slug', ignoreDuplicates: false });

  if (error) logger.warn('Infrastructure seed error', error.message);

  return rows
    .filter(r => !existingSlugs.has(r.slug))
    .map(r => r.slug);
}

// ── Database write ────────────────────────────────────────────

async function upsertProjects(projects: ScoredProject[]): Promise<string[]> {
  const now = new Date().toISOString();
  const { data: existing } = await supabase.from('projects').select('slug');
  const existingSlugs = new Set((existing ?? []).map(r => r.slug));

  const rows = projects.map(p => ({
    name: p.name, slug: p.slug, website: p.website || null,
    category: p.category, ecosystem: p.ecosystem, logo_url: p.logo_url || null,
    tvl_usd: p.tvl_usd, daily_volume_usd: p.daily_volume_usd,
    market_cap_usd: p.market_cap_usd, significance_score: p.significance_score,
    is_active: p.significance_score >= config.discovery.minSignificanceScore,
    metrics_updated_at: now, last_updated: now,
  }));

  const { error } = await supabase
    .from('projects')
    .upsert(rows, { onConflict: 'slug', ignoreDuplicates: false });

  if (error) throw new Error(`Project upsert failed: ${error.message}`);

  return projects.filter(p => !existingSlugs.has(p.slug)).map(p => p.slug);
}

async function deactivateStaleProjects(keepSlugs: string[]): Promise<void> {
  // Never deactivate infrastructure projects (significance_score = 999)
  await supabase
    .from('projects')
    .update({ is_active: false, last_updated: new Date().toISOString() })
    .not('slug', 'in', `(${keepSlugs.map(s => `'${s}'`).join(',')})`)
    .eq('is_active', true)
    .lt('significance_score', 999);
}

// ── Main export ───────────────────────────────────────────────

export async function runProjectDiscovery(): Promise<void> {
  logger.info('=== Project discovery v2 started ===');
  const start = Date.now();

  try {
    // Always seed infrastructure tier first
    const newInfraSlugs = await seedInfrastructureProjects();

    // Fetch market data
    const [defi, gecko, cmc] = await Promise.all([
      fetchDeFiLlama(),
      fetchCoinGecko(),
      fetchCoinMarketCap(),
    ]);

    const scored = mergeAndScore(defi, gecko, cmc)
      .sort((a, b) => b.significance_score - a.significance_score)
      .slice(0, config.discovery.maxProjects);

    const newMarketSlugs = await upsertProjects(scored);

    const allActiveSlugs = [
      ...scored.map(p => p.slug),
      ...(config.infrastructureProjects as any[]).map(p => p.slug),
    ];
    await deactivateStaleProjects(allActiveSlugs);

    // Discover channels for brand new projects
    const allNewSlugs = [...newInfraSlugs, ...newMarketSlugs];
    if (allNewSlugs.length > 0) {
      const { data: newProjects } = await supabase
        .from('projects')
        .select('id, name, slug, website, category')
        .in('slug', allNewSlugs);

      for (const project of newProjects ?? []) {
        await discoverChannelsForProject(project).catch(err =>
          logger.warn(`Channel discovery failed for ${project.name}`, err)
        );
        await sleep(800);
      }
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    logger.info(`=== Project discovery done in ${elapsed}s ===`);
  } catch (err) {
    logger.error('Project discovery failed', err);
    throw err;
  }
}

function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

if (require.main === module) {
  runProjectDiscovery().catch(err => { logger.error(String(err)); process.exit(1); });
}
