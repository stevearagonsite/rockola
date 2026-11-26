type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let threshold = ORDER.info;

export function setLogLevel(level: string): void {
  threshold = ORDER[level as Level] ?? ORDER.info;
}

// Anything that looks like a Discord token or bearer secret is masked before printing.
const SECRET_PATTERNS: [RegExp, string][] = [
  [/[MNO][A-Za-z\d_-]{23,25}\.[A-Za-z\d_-]{6}\.[A-Za-z\d_-]{27,38}/g, '[redacted]'],
  [/(Bearer|Bot|Basic)\s+[A-Za-z0-9._~+/=-]{20,}/g, '[redacted]'],
  // user:password@ in URLs
  [/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[redacted]@'],
  // credentials in query strings (API keys, signed-URL signatures, tokens)
  [/([?&](?:[a-z_]*key|[a-z_]*token|secret|client_secret|password|passwd|sig|signature|auth)=)[^&\s"']+/gi, '$1[redacted]'],
];

export function redact(text: string): string {
  return SECRET_PATTERNS.reduce((acc, [re, to]) => acc.replace(re, to), text);
}

function fmt(arg: unknown): string {
  if (arg instanceof Error) return arg.stack ?? `${arg.name}: ${arg.message}`;
  if (typeof arg === 'string') return arg;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function write(level: Level, args: unknown[]): void {
  if (ORDER[level] < threshold) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${redact(args.map(fmt).join(' '))}`;
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
}

export const log = {
  debug: (...a: unknown[]) => write('debug', a),
  info: (...a: unknown[]) => write('info', a),
  warn: (...a: unknown[]) => write('warn', a),
  error: (...a: unknown[]) => write('error', a),
};
