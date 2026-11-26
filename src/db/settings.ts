import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import type { Locale } from '../i18n/index.js';

export interface GuildSettings {
  guildId: string;
  locale: Locale;
  defaultVolume: number;
  djRoleId: string | null;
  stay247: boolean;
  stayChannelId: string | null;
  autoplay: boolean;
  /** When set, commands only work here and every notification is posted here. */
  musicChannelId: string | null;
}

interface Row {
  guild_id: string;
  locale: string | null;
  default_volume: number | null;
  dj_role_id: string | null;
  stay_247: number;
  stay_channel_id: string | null;
  autoplay: number;
  music_channel_id: string | null;
}

export class SettingsStore {
  private readonly db: Database.Database;
  private readonly cache = new Map<string, GuildSettings>();

  constructor(path: string, private readonly defaultLocale: Locale) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id TEXT PRIMARY KEY,
      locale TEXT,
      default_volume INTEGER,
      dj_role_id TEXT,
      stay_247 INTEGER NOT NULL DEFAULT 0,
      stay_channel_id TEXT,
      autoplay INTEGER NOT NULL DEFAULT 0
    )`);
    // migrations for databases created by older versions
    const columns = (this.db.prepare('PRAGMA table_info(guild_settings)').all() as { name: string }[]).map((c) => c.name);
    if (!columns.includes('music_channel_id')) this.db.exec('ALTER TABLE guild_settings ADD COLUMN music_channel_id TEXT');
  }

  get(guildId: string): GuildSettings {
    const hit = this.cache.get(guildId);
    if (hit) return hit;
    const row = this.db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guildId) as Row | undefined;
    const settings: GuildSettings = {
      guildId,
      locale: row?.locale === 'en' || row?.locale === 'es' ? row.locale : this.defaultLocale,
      defaultVolume: row?.default_volume ?? 80,
      djRoleId: row?.dj_role_id ?? null,
      stay247: row?.stay_247 === 1,
      stayChannelId: row?.stay_channel_id ?? null,
      autoplay: row?.autoplay === 1,
      musicChannelId: row?.music_channel_id ?? null,
    };
    this.cache.set(guildId, settings);
    return settings;
  }

  update(guildId: string, patch: Partial<Omit<GuildSettings, 'guildId'>>): GuildSettings {
    const next = { ...this.get(guildId), ...patch };
    this.db
      .prepare(
        `INSERT INTO guild_settings (guild_id, locale, default_volume, dj_role_id, stay_247, stay_channel_id, autoplay, music_channel_id)
         VALUES (@guildId, @locale, @defaultVolume, @djRoleId, @stay247, @stayChannelId, @autoplay, @musicChannelId)
         ON CONFLICT(guild_id) DO UPDATE SET locale = excluded.locale, default_volume = excluded.default_volume,
           dj_role_id = excluded.dj_role_id, stay_247 = excluded.stay_247, stay_channel_id = excluded.stay_channel_id,
           autoplay = excluded.autoplay, music_channel_id = excluded.music_channel_id`,
      )
      .run({ ...next, stay247: next.stay247 ? 1 : 0, autoplay: next.autoplay ? 1 : 0 });
    this.cache.set(guildId, next);
    return next;
  }

  /** Guilds where 24/7 mode is on, to rejoin after a restart. */
  stayingGuilds(): GuildSettings[] {
    const rows = this.db.prepare('SELECT guild_id FROM guild_settings WHERE stay_247 = 1 AND stay_channel_id IS NOT NULL').all() as {
      guild_id: string;
    }[];
    return rows.map((r) => this.get(r.guild_id));
  }

  close(): void {
    this.db.close();
  }
}
