/**
 * Project Discovery Engine
 *
 * Runs every 24 hours. Queries DeFiLlama, CoinGecko, and CoinMarketCap,
 * computes a composite significance score for each project, and upserts
 * the top N into the `projects` table. Returns new project IDs so the
 * channel-discovery service can immediately find their official channels.
 */

import fetch from 'node-fetch';
import { supabase } from '../db/client';
import { config } from '../config';
import { logger } from '../utils/logger';
import { slugify } from '../utils/hash';
import { discoverChannelsForProject } from './channel-discovery';

// ── External API types ────────────────────────────────────────

interface DeFiLlamaProtocol {
  name:        string;
  symbol:      string;
  category:    string;
  tvl:         number;
  url:         string;
  twitter?:    string;
  github?:     string[];
  chains:      string[];
  description: string;
  logo:        string;
  slug:        string;
}

interface CoinGeckoCoin {
  id:           string;
  symbol:       string;
  name:         string;
  image:        string;
  market_cap:   number;
  total_volume: number;
  current_price: number;
}

interface CMCCoin {
  name:     string;
  symbol:   string;
  cmc_rank: number;
  quote: { USD: { market_cap: number; volume_24h: number } };
}

// ── Category normalisation ────────────────────────────────────

const CATEGORY_MAP: Record<string, string> = {
  'Dexes':          'DEX',
  'Dex':            'DEX',
  'Lending':        'Lending',
  'Bridge':         'Bridge',
  'Chain':          'L1',
  'L2':             'L2',
  'Yield':          'DeFi',
  'Liquid Staking': 'Staking',
  'CDP':            'Lending',
  'Derivatives':    'DeFi',
  'Launchpad':      'Launchpad',
  'Oracle':         'Oracle',
  'Algo-Stables':   'DeFi',
  'Indexes':        'DeFi',
  'RWA':            'DeFi',
  'Payments':       'DeFi',
  'CEX':            'CEX',
  'Wallet':         'Wallet',
};

function mapCategory(raw: string): string {
  return CATEGORY_MAP[raw] ?? 'DeFi';
}

// ── Fetch helpers ─────────────────────────────────────────────

async function fetchDeFiLlama(): Promise<DeFiLlamaProtocol[]> {
  logger.info('Fetching DeFiLlama protocols…');
  const res = await fetch('https://api.llama.fi/protocols', {
    headers: { 'Accept': 'application/json' },
    // @ts-ignore — node-fetch timeout
    timeout: config.ingestion.fetchTimeoutMs,
  });
  if (!res.ok) throw new Error(`DeFiLlama API error: ${res.status}`);
  const data = await res.json() as DeFiLlamaProtocol[];
  return data.filter(p => p.tvl > 0);
}

async function fetchCoinGecko(): Promise<CoinGeckoCoin[]> {
  logger.info('Fetching CoinGecko markets…');
  const results: CoinGeckoCoin[] = [];
  const headers: Record<string, string> = { 'Accept': 'application/json' };
  if (config.apis.coinGeckoKey) {
    headers['x-cg-demo-api-key'] = config.apis.coinGeckoKey;
  }
  for (let page = 1; page <= 5; page++) {
    const url = `https://api.coingecko.com/api/v3/coins/markets`
      + `?vs_currency=usd&order=market_cap_desc&per_page=100&page=${page}&sparkline=false`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      logger.warn(`CoinGecko page ${page} failed: ${res.status}`);
      break;
    }
    const data = await res.json() as CoinGeckoCoin[];
    results.push(...data);
    await sleep(300); // respect rate limits
  }
  return results;
}

async function fetchCoinMarketCap(): Promise<CMCCoin[]> {
  if (!config.apis.coinMarketCapKey) {
    logger.warn('No CMC_API_KEY — skipping CoinMarketCap');
    return [];
  }
  logger.info('Fetching CoinMarketCap listings…');
  const res = await fetch(
    'https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest?limit=500&sort=market_cap',
    { headers: { 'X-CMC_PRO_API_KEY': config.apis.coinMarketCapKey, 'Accept': 'application/json' } }
  );
  if (!res.ok) {
    logger.warn(`CoinMarketCap error: ${res.status}`);
    return [];
  }
  const data = await res.json() as { data: CMCCoin[] };
  return data.data ?? [];
}

// ── Scoring ───────────────────────────────────────────────────

interface ScoredProject {
  name:              string;
  slug:              string;
  category:          string;
  ecosystem:         string[];
  tvl_usd:           number;
  daily_volume_usd:  number;
  market_cap_usd:    number;
  significance_score: number;
  logo_url:          string;
  website:           string;
}

/**
 * Normalise a raw metric value to 0-100 using log scale,
 * making scores comparable across orders-of-magnitude differences.
 */
function logNorm(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;
  return Math.min(100, (Math.log10(value + 1) / Math.log10(max + 1)) * 100);
}

function computeSignificance(
  tvl:     number,
  volume:  number,
  mcap:    number,
  maxTvl:  number,
  maxVol:  number,
  maxMcap: number,
): number {
  const tvlScore  = logNorm(tvl,    maxTvl)  * 0.40;
  const volScore  = logNorm(volume, maxVol)  * 0.30;
  const mcapScore = logNorm(mcap,   maxMcap) * 0.30;
  return Math.round(tvlScore + volScore + mcapScore);
}

function mergeAndScore(
  defi:     DeFiLlamaProtocol[],
  gecko:    CoinGeckoCoin[],
  cmc:      CMCCoin[],
): ScoredProject[] {
  // Build lookup maps
  const geckoByName = new Map(gecko.map(c => [c.name.toLowerCase(), c]));
  const cmcByName   = new Map(cmc.map(c => [c.name.toLowerCase(), c]));

  // Aggregate metrics per project
  const merged = new Map<string, {
    name: string; category: string; ecosystem: string[];
    tvl: number; volume: number; mcap: number;
    logo: string; website: string;
  }>();

  // Seed from DeFiLlama (best TVL source)
  for (const p of defi) {
    const key    = p.name.toLowerCase();
    const gecko  = geckoByName.get(key);
    const cmcRow = cmcByName.get(key);
    merged.set(key, {
      name:      p.name,
      category:  mapCategory(p.category),
      ecosystem: p.chains ?? [],
      tvl:       p.tvl,
      volume:    gecko?.total_volume ?? cmcRow?.quote.USD.volume_24h ?? 0,
      mcap:      gecko?.market_cap   ?? cmcRow?.quote.USD.market_cap ?? 0,
      logo:      p.logo ?? gecko?.image ?? '',
      website:   p.url ?? '',
    });
  }

  // Add CoinGecko coins not yet in map (wallets, L1s without TVL)
  for (const c of gecko) {
    const key = c.name.toLowerCase();
    if (!merged.has(key)) {
      merged.set(key, {
        name:      c.name,
        category:  'Other',
        ecosystem: [],
        tvl:       0,
        volume:    c.total_volume,
        mcap:      c.market_cap,
        logo:      c.image,
        website:   '',
      });
    }
  }

  // Compute normalisation maxima
  const all    = [...merged.values()];
  const maxTvl  = Math.max(...all.map(p => p.tvl));
  const maxVol  = Math.max(...all.map(p => p.volume));
  const maxMcap = Math.max(...all.map(p => p.mcap));

  // Score and return
  return all.map(p => ({
    name:              p.name,
    slug:              slugify(p.name),
    category:          p.category,
    ecosystem:         p.ecosystem,
    tvl_usd:           p.tvl,
    daily_volume_usd:  p.volume,
    market_cap_usd:    p.mcap,
    logo_url:          p.logo,
    website:           p.website,
    significance_score: computeSignificance(
      p.tvl, p.volume, p.mcap,
      maxTvl, maxVol, maxMcap,
    ),
  }));
}

// ── Database write ────────────────────────────────────────────

async function upsertProjects(projects: ScoredProject[]): Promise<string[]> {
  const now = new Date().toISOString();

  // Determine which slugs already exist
  const { data: existing } = await supabase
    .from('projects')
    .select('slug');
  const existingSlugs = new Set((existing ?? []).map(r => r.slug));

  const rows = projects.map(p => ({
    name:               p.name,
    slug:               p.slug,
    website:            p.website || null,
    category:           p.category,
    ecosystem:          p.ecosystem,
    logo_url:           p.logo_url || null,
    tvl_usd:            p.tvl_usd,
    daily_volume_usd:   p.daily_volume_usd,
    market_cap_usd:     p.market_cap_usd,
    significance_score: p.significance_score,
    is_active:          p.significance_score >= config.discovery.minSignificanceScore,
    metrics_updated_at: now,
    last_updated:       now,
  }));

  const { error } = await supabase
    .from('projects')
    .upsert(rows, { onConflict: 'slug', ignoreDuplicates: false });

  if (error) throw new Error(`Project upsert failed: ${error.message}`);

  // Return slugs of brand-new projects (need channel discovery)
  return projects
    .filter(p => !existingSlugs.has(p.slug))
    .map(p => p.slug);
}

// ── Mark stale projects inactive ─────────────────────────────

async function deactivateStaleProjects(activeSlugs: string[]): Promise<void> {
  const { error } = await supabase
    .from('projects')
    .update({ is_active: false, last_updated: new Date().toISOString() })
    .not('slug', 'in', `(${activeSlugs.map(s => `'${s}'`).join(',')})`)
    .eq('is_active', true);

  if (error) logger.warn('Failed to deactivate stale projects', error);
}

// ── Main export ───────────────────────────────────────────────

export async function runProjectDiscovery(): Promise<void> {
  logger.info('=== Project discovery started ===');
  const start = Date.now();

  try {
    const [defi, gecko, cmc] = await Promise.all([
      fetchDeFiLlama(),
      fetchCoinGecko(),
      fetchCoinMarketCap(),
    ]);

    logger.info(`Raw counts — DeFiLlama: ${defi.length}, CoinGecko: ${gecko.length}, CMC: ${cmc.length}`);

    const scored = mergeAndScore(defi, gecko, cmc);
    const top    = scored
      .sort((a, b) => b.significance_score - a.significance_score)
      .slice(0, config.discovery.maxProjects);

    logger.info(`Upserting ${top.length} projects`);
    const newSlugs = await upsertProjects(top);
    logger.info(`${newSlugs.length} new projects added`);

    await deactivateStaleProjects(top.map(p => p.slug));

    // Kick off channel discovery for all new projects
    if (newSlugs.length > 0) {
      const { data: newProjects } = await supabase
        .from('projects')
        .select('id, name, slug, website, category')
        .in('slug', newSlugs);

      for (const project of newProjects ?? []) {
        logger.info(`Discovering channels for: ${project.name}`);
        await discoverChannelsForProject(project).catch(err =>
          logger.warn(`Channel discovery failed for ${project.name}`, err)
        );
      }
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    logger.info(`=== Project discovery completed in ${elapsed}s ===`);
  } catch (err) {
    logger.error('Project discovery failed', err);
    throw err;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// Allow running standalone
if (require.main === module) {
  runProjectDiscovery().catch(err => { logger.error(String(err)); process.exit(1); });
}
