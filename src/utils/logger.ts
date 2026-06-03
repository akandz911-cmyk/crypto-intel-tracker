const level = process.env.LOG_LEVEL ?? 'info';
const levels = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = levels[level as keyof typeof levels] ?? 1;

function fmt(lvl: string, msg: string, meta?: unknown): string {
  const ts = new Date().toISOString();
  const base = `[${ts}] [${lvl.toUpperCase()}] ${msg}`;
  return meta !== undefined ? `${base} ${JSON.stringify(meta)}` : base;
}

export const logger = {
  debug: (msg: string, meta?: unknown) => {
    if (currentLevel <= 0) console.debug(fmt('debug', msg, meta));
  },
  info: (msg: string, meta?: unknown) => {
    if (currentLevel <= 1) console.info(fmt('info', msg, meta));
  },
  warn: (msg: string, meta?: unknown) => {
    if (currentLevel <= 2) console.warn(fmt('warn', msg, meta));
  },
  error: (msg: string, meta?: unknown) => {
    if (currentLevel <= 3) console.error(fmt('error', msg, meta));
  },
};
