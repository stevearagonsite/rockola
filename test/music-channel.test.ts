import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { SendableChannels } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { SettingsStore } from '../src/db/settings.js';
import { redirectChannel } from '../src/discord/channelGate.js';
import { GuildPlayer } from '../src/player/guildPlayer.js';

const MUSIC = '1111111111111111111';
const OTHER = '2222222222222222222';

describe('redirectChannel', () => {
  it('lets everything through when no music channel is set', () => {
    expect(redirectChannel(null, 'play', OTHER)).toBeNull();
  });
  it('allows commands in the music channel and redirects the rest', () => {
    expect(redirectChannel(MUSIC, 'play', MUSIC)).toBeNull();
    expect(redirectChannel(MUSIC, 'play', OTHER)).toBe(MUSIC);
    expect(redirectChannel(MUSIC, 'queue', null)).toBe(MUSIC);
  });
  it('keeps /settings usable anywhere so admins can change it', () => {
    expect(redirectChannel(MUSIC, 'settings', OTHER)).toBeNull();
  });
});

describe('music channel setting storage', () => {
  it('persists and clears', () => {
    const s = new SettingsStore(':memory:', 'es');
    expect(s.get('1').musicChannelId).toBeNull();
    s.update('1', { musicChannelId: MUSIC });
    expect(s.get('1').musicChannelId).toBe(MUSIC);
    s.update('1', { musicChannelId: null });
    expect(s.get('1').musicChannelId).toBeNull();
    s.close();
  });
  it('migrates a database created before the column existed', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'rockola-')), 'old.sqlite');
    const old = new Database(path);
    old.exec(`CREATE TABLE guild_settings (guild_id TEXT PRIMARY KEY, locale TEXT, default_volume INTEGER, dj_role_id TEXT,
      stay_247 INTEGER NOT NULL DEFAULT 0, stay_channel_id TEXT, autoplay INTEGER NOT NULL DEFAULT 0)`);
    old.prepare("INSERT INTO guild_settings (guild_id, locale, default_volume) VALUES ('9', 'en', 55)").run();
    old.close();
    const s = new SettingsStore(path, 'es');
    expect(s.get('9')).toMatchObject({ locale: 'en', defaultVolume: 55, musicChannelId: null });
    s.update('9', { musicChannelId: MUSIC });
    s.close();
    expect(new SettingsStore(path, 'es').get('9').musicChannelId).toBe(MUSIC);
  });
});

describe('GuildPlayer notifications', () => {
  const fake = (id: string) => ({ id }) as unknown as SendableChannels;
  function player(settings: SettingsStore) {
    return new GuildPlayer({
      guildId: '1',
      settings,
      idleTimeoutMs: 1000,
      botUserId: '0',
      onDestroy: () => undefined,
      findChannel: (id) => fake(id),
    });
  }
  it('go to the command channel when no music channel is set', () => {
    const settings = new SettingsStore(':memory:', 'es');
    const p = player(settings);
    p.textChannel = fake(OTHER);
    expect(p.notifyChannel()).toEqual({ id: OTHER });
  });
  it('always go to the music channel when it is set', () => {
    const settings = new SettingsStore(':memory:', 'es');
    settings.update('1', { musicChannelId: MUSIC });
    const p = player(settings);
    p.textChannel = fake(OTHER);
    expect(p.notifyChannel()).toEqual({ id: MUSIC });
  });
});

describe('redirectChannel edge cases', () => {
  it('redirects buttons pressed on messages outside the music channel', () => {
    expect(redirectChannel(MUSIC, 'button', OTHER)).toBe(MUSIC);
    expect(redirectChannel(MUSIC, 'button', MUSIC)).toBeNull();
  });
  it('redirects when the channel is unknown (no free pass)', () => {
    expect(redirectChannel(MUSIC, 'play', undefined)).toBe(MUSIC);
  });
  it('a voice channel text chat or a thread is not the music channel', () => {
    expect(redirectChannel(MUSIC, 'play', '1506004952097619998')).toBe(MUSIC);
  });
  it('tolerates ids stored with stray whitespace', () => {
    expect(redirectChannel(` ${MUSIC} `, 'play', MUSIC)).toBeNull();
  });
  it('the setting survives a restart (new store on the same file)', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'rockola-')), 'restart.sqlite');
    const a = new SettingsStore(path, 'es');
    a.update('1506003930436604037', { musicChannelId: MUSIC });
    a.close();
    const b = new SettingsStore(path, 'es');
    expect(redirectChannel(b.get('1506003930436604037').musicChannelId, 'play', OTHER)).toBe(MUSIC);
    b.close();
  });
});
