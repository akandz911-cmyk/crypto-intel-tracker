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
    apiKey: process.env.GEMINI_API_KEY ?? '',
    model:  'gemini-2.0-flash-lite' as const,
  },
  groq: {
    apiKey: require_env('GROQ_API_KEY'),
    model:  'llama-3.3-70b-versatile' as const,
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
    intervalMinutes: 30,
    batchSize:       20,
    maxTokens:       2048,
  },

  // ── News & intelligence feeds ──────────────────────────────
  // Ordered by signal quality for actionable crypto intel
  newsFeeds: [
    // Security-first — highest signal for actionable events
    { name: 'Rekt News',       url: 'https://rekt.news/feed/' },
    { name: 'Immunefi Blog',   url: 'https://immunefi.com/blog/rss.xml' },

    // Official protocol communications
    { name: 'Ethereum Blog',   url: 'https://blog.ethereum.org/en/feed.xml' },

    // Tier-1 crypto news
    { name: 'The Block',       url: 'https://www.theblock.co/rss.xml' },
    { name: 'CoinDesk',        url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
    { name: 'Decrypt',         url: 'https://decrypt.co/feed' },
    { name: 'Cointelegraph',   url: 'https://cointelegraph.com/rss' },
    { name: 'DL News',         url: 'https://www.dlnews.com/arc/outboundfeeds/rss/' },
    { name: 'Bitcoin Magazine', url: 'https://bitcoinmagazine.com/feed' },
  ],

  // ── Hardcoded high-exposure infrastructure projects ────────
  // These are always monitored regardless of TVL rank.
  // A security event on any of these affects millions of users.
  infrastructureProjects: [
    // Wallets — hardware
    { name: 'Ledger',          slug: 'ledger',           category: 'Wallet',         website: 'https://ledger.com' },
    { name: 'Trezor',          slug: 'trezor',           category: 'Wallet',         website: 'https://trezor.io' },
    { name: 'Coldcard',        slug: 'coldcard',         category: 'Wallet',         website: 'https://coldcard.com' },

    // Wallets — software / browser
    { name: 'MetaMask',        slug: 'metamask',         category: 'Wallet',         website: 'https://metamask.io' },
    { name: 'Rabby Wallet',    slug: 'rabby-wallet',     category: 'Wallet',         website: 'https://rabby.io' },
    { name: 'Rainbow',         slug: 'rainbow',          category: 'Wallet',         website: 'https://rainbow.me' },
    { name: 'Phantom',         slug: 'phantom',          category: 'Wallet',         website: 'https://phantom.app' },
    { name: 'Coinbase Wallet', slug: 'coinbase-wallet',  category: 'Wallet',         website: 'https://wallet.coinbase.com' },
    { name: 'Trust Wallet',    slug: 'trust-wallet',     category: 'Wallet',         website: 'https://trustwallet.com' },
    { name: 'Exodus',          slug: 'exodus',           category: 'Wallet',         website: 'https://exodus.com' },

    // Portfolio dashboards
    { name: 'Zerion',          slug: 'zerion',           category: 'Dashboard',      website: 'https://zerion.io' },
    { name: 'DeBank',          slug: 'debank',           category: 'Dashboard',      website: 'https://debank.com' },
    { name: 'Zapper',          slug: 'zapper',           category: 'Dashboard',      website: 'https://zapper.xyz' },
    { name: 'Rotki',           slug: 'rotki',            category: 'Dashboard',      website: 'https://rotki.com' },

    // Multisig & infrastructure
    { name: 'Safe',            slug: 'safe',             category: 'Multisig',       website: 'https://safe.global' },
    { name: 'WalletConnect',   slug: 'walletconnect',    category: 'Infrastructure', website: 'https://walletconnect.com' },

    // Block explorers
    { name: 'Etherscan',       slug: 'etherscan',        category: 'Explorer',       website: 'https://etherscan.io' },
    { name: 'Blockscout',      slug: 'blockscout',       category: 'Explorer',       website: 'https://blockscout.com' },
    { name: 'Solscan',         slug: 'solscan',          category: 'Explorer',       website: 'https://solscan.io' },

    // RPC providers
    { name: 'Alchemy',         slug: 'alchemy',          category: 'Infrastructure', website: 'https://alchemy.com' },
    { name: 'Infura',          slug: 'infura',           category: 'Infrastructure', website: 'https://infura.io' },
    { name: 'QuickNode',       slug: 'quicknode',        category: 'Infrastructure', website: 'https://quicknode.com' },

    // DEX aggregators
    { name: '1inch',           slug: '1inch',            category: 'Aggregator',     website: 'https://1inch.io' },
    { name: 'CoW Protocol',    slug: 'cow-protocol',     category: 'Aggregator',     website: 'https://cow.fi' },
    { name: 'Paraswap',        slug: 'paraswap',         category: 'Aggregator',     website: 'https://paraswap.io' },

    // Stablecoins
    { name: 'USDC',            slug: 'usd-coin',         category: 'Stablecoin',     website: 'https://circle.com' },
    { name: 'Tether',          slug: 'tether',           category: 'Stablecoin',     website: 'https://tether.to' },
    { name: 'DAI',             slug: 'dai',              category: 'Stablecoin',     website: 'https://makerdao.com' },

    // Security / monitoring
    { name: 'Immunefi',        slug: 'immunefi',         category: 'Security',       website: 'https://immunefi.com' },
  ],
} as const;
