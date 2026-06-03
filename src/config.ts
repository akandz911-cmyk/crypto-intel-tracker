import 'dotenv/config';

function require_env(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}

export const config = {
  supabase: {
    url:            require_env('SUPABASE_URL'),
    serviceRoleKey: require_env('SUPABASE_SERVICE_ROLE_KEY'),
    anonKey:        require_env('SUPABASE_ANON_KEY'),
  },
  gemini: {
    apiKey: require_env('GEMINI_API_KEY'),
    model:  'gemini-1.5-flash' as const,
  },
  apis: {
    coinGeckoKey:     process.env.COINGECKO_API_KEY ?? '',
    coinMarketCapKey: process.env.CMC_API_KEY ?? '',
    githubToken:      process.env.GH_TOKEN ?? '',
  },
  discovery: {
    maxProjects:          250,
    minSignificanceScore: 30,
    updateIntervalHours:  24,
  },
  ingestion: {
    intervalMinutes:  15,
    batchSize:        100,
    maxRetries:       3,
    fetchTimeoutMs:   15_000,
  },
  processing: {
    intervalMinutes: 5,
    batchSize:       25,
    maxTokens:       2048,
  },
  newsFeeds: [
    { name: 'CoinDesk',        url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
    { name: 'Cointelegraph',   url: 'https://cointelegraph.com/rss' },
    { name: 'The Block',       url: 'https://www.theblock.co/rss.xml' },
    { name: 'Decrypt',         url: 'https://decrypt.co/feed' },
    { name: 'Bitcoin Magazine', url: 'https://bitcoinmagazine.com/feed' },
    { name: 'DL News',         url: 'https://www.dlnews.com/arc/outboundfeeds/rss/' },
  ],
} as const;
