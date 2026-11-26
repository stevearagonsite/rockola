import 'dotenv/config';
import type { Locale } from './i18n/index.js';

export interface Config {
  token: string;
  clientId: string;
  /** First test guild (self-test target). */
  guildId: string | undefined;
  /** Guilds where slash commands are registered at startup (instant, unlike global commands). */
  guildIds: string[];
  spotifyClientId: string | undefined;
  spotifyClientSecret: string | undefined;
  defaultLocale: Locale;
  idleTimeoutMs: number;
  databasePath: string;
  ytdlpPath: string;
  ytdlpCookies: string | undefined;
  ytdlpJsRuntime: string | undefined;
  ytdlpCacheDir: string | undefined;
  ffmpegPath: string;
  logLevel: string;
}

function opt(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

function num(name: string, fallback: number): number {
  const raw = opt(name);
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Parses "id1, id2,id3" into unique Discord snowflakes, ignoring anything else. */
export function parseIdList(raw: string | undefined): string[] {
  return [...new Set((raw ?? '').split(/[\s,;]+/).filter((v) => /^\d{17,20}$/.test(v)))];
}

/** Loads settings from the environment. Secrets are never logged. */
export function loadConfig(requireDiscord = true): Config {
  const token = opt('DISCORD_TOKEN') ?? '';
  const clientId = opt('DISCORD_CLIENT_ID') ?? '';
  if (requireDiscord && (!token || !clientId)) {
    throw new Error('Missing DISCORD_TOKEN or DISCORD_CLIENT_ID. Copy .env.example to .env and fill it in.');
  }
  const locale = opt('DEFAULT_LOCALE') === 'en' ? 'en' : 'es';
  const guildIds = parseIdList(opt('DISCORD_GUILD_IDS') ?? opt('DISCORD_GUILD_ID'));
  return {
    token,
    clientId,
    guildId: guildIds[0],
    guildIds,
    spotifyClientId: opt('SPOTIFY_CLIENT_ID'),
    spotifyClientSecret: opt('SPOTIFY_CLIENT_SECRET'),
    defaultLocale: locale,
    idleTimeoutMs: num('IDLE_TIMEOUT_SECONDS', 180) * 1000,
    databasePath: opt('DATABASE_PATH') ?? './data/rockola.sqlite',
    ytdlpPath: opt('YTDLP_PATH') ?? 'yt-dlp',
    ytdlpCookies: opt('YTDLP_COOKIES'),
    ytdlpJsRuntime: opt('YTDLP_JS_RUNTIME'),
    ytdlpCacheDir: opt('YTDLP_CACHE_DIR'),
    ffmpegPath: opt('FFMPEG_PATH') ?? 'ffmpeg',
    logLevel: opt('LOG_LEVEL') ?? 'info',
  };
}
