import { describe, expect, it } from 'vitest';
import { en } from '../src/i18n/en.js';
import { es } from '../src/i18n/es.js';
import { t } from '../src/i18n/index.js';
import { ffmpegArgs } from '../src/player/stream.js';
import { cleanTitle } from '../src/sources/lyrics.js';
import { redact } from '../src/util/logger.js';
import { SettingsStore } from '../src/db/settings.js';

describe('i18n', () => {
  it('both languages have the same keys', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(es).sort());
  });
  it('interpolates', () => {
    expect(t('en', 'volume.set', { volume: 50 })).toBe('🔊 Volume: **50%**');
    expect(t('es', 'volume.set', { volume: 50 })).toBe('🔊 Volumen: **50%**');
    expect(t('es', 'error.notFound')).toContain('{query}');
  });
});

describe('ffmpegArgs', () => {
  it('adds reconnect, headers and seek for http inputs', () => {
    const args = ffmpegArgs({ url: 'https://host/a', headers: { 'User-Agent': 'UA', Accept: '*/*' }, seekMs: 1500, filterChain: 'aresample=48000' });
    expect(args).toContain('-reconnect');
    expect(args[args.indexOf('-user_agent') + 1]).toBe('UA');
    expect(args[args.indexOf('-headers') + 1]).toBe('Accept: */*\r\n');
    expect(args[args.indexOf('-ss') + 1]).toBe('1.500');
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'));
    expect(args.slice(-7)).toEqual(['-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1']);
  });
  it('plain files have no network flags', () => {
    expect(ffmpegArgs({ url: '/tmp/a.mp3', filterChain: 'x' })).not.toContain('-reconnect');
  });
});

describe('lyrics title cleanup', () => {
  it.each([
    ['Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)', 'Rick Astley - Never Gonna Give You Up'],
    ['Song [Official Audio]', 'Song'],
    ['Song ft. Someone', 'Song'],
    ['Song (Acoustic)', 'Song (Acoustic)'],
  ])('%s', (input, output) => expect(cleanTitle(input)).toBe(output));
});

describe('logger', () => {
  it('redacts Discord tokens and bearer secrets', () => {
    const fakeToken = ['MTAxMjM0NTY3ODkwMTIzNDU2', 'GabcDE', 'Xk9qLm2pZr7tWv4yBn8cDf1gHj5kMs3aQe6'].join('.');
    expect(redact(`token ${fakeToken} end`)).toBe('token [redacted] end');
    expect(redact('Authorization: Bearer abcdefghijklmnopqrstuvwxyz')).toBe('Authorization: [redacted]');
  });
});

describe('SettingsStore', () => {
  it('stores per-guild settings with defaults', () => {
    const s = new SettingsStore(':memory:', 'es');
    expect(s.get('1')).toMatchObject({ locale: 'es', defaultVolume: 80, djRoleId: null, stay247: false, autoplay: false });
    s.update('1', { locale: 'en', defaultVolume: 50, stay247: true, stayChannelId: '9' });
    expect(s.get('1')).toMatchObject({ locale: 'en', defaultVolume: 50, stay247: true });
    expect(s.stayingGuilds().map((g) => g.guildId)).toEqual(['1']);
    expect(s.get('2').locale).toBe('es');
    s.close();
  });
});

describe('ffmpegArgs HLS', () => {
  it('disables picky extensions for HLS when supported and never seeks live streams', async () => {
    const { setHlsPickyOption } = await import('../src/player/stream.js');
    setHlsPickyOption(true);
    const args = ffmpegArgs({ url: 'https://host/manifest/hls.m3u8', hls: true, seekMs: 5000, filterChain: 'x' });
    expect(args[args.indexOf('-extension_picky') + 1]).toBe('0');
    expect(args).not.toContain('-ss');
    setHlsPickyOption(false);
    expect(ffmpegArgs({ url: 'https://host/a.m3u8', hls: true, filterChain: 'x' })).not.toContain('-extension_picky');
  });
});

describe('parseIdList', () => {
  it('splits, validates and dedupes guild ids', async () => {
    const { parseIdList } = await import('../src/config.js');
    expect(parseIdList('476195750246875136, 1506003930436604037,476195750246875136')).toEqual(['476195750246875136', '1506003930436604037']);
    expect(parseIdList(' 476195750246875136 ;abc; ')).toEqual(['476195750246875136']);
    expect(parseIdList(undefined)).toEqual([]);
  });
});
