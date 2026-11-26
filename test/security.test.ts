import { describe, expect, it } from 'vitest';
import { guildLimiter, heavyCommandWait, memberLimiter } from '../src/discord/interactions.js';
import { trackLink } from '../src/discord/ui.js';
import { ffmpegArgs } from '../src/player/stream.js';
import { detect } from '../src/sources/detect.js';
import { classifyLoadError } from '../src/sources/resolver.js';
import type { Track } from '../src/sources/types.js';
import { redact } from '../src/util/logger.js';
import { assertPublicUrl, BlockedUrlError, isPublicAddress, type Lookup } from '../src/util/netguard.js';
import { RateLimiter, Semaphore } from '../src/util/rateLimit.js';

const resolvesTo =
  (...ips: string[]): Lookup =>
  async () =>
    ips;

describe('isPublicAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    'fe80::1',
    'fd00:ec2::254',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:a9fe:a9fe',
    '64:ff9b::a9fe:a9fe',
    'not-an-ip',
  ])('%s is not public', (ip) => expect(isPublicAddress(ip)).toBe(false));

  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '142.250.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])('%s is public', (ip) =>
    expect(isPublicAddress(ip)).toBe(true),
  );
});

describe('assertPublicUrl', () => {
  it.each([
    'http://localhost:3000/a.mp3',
    'http://127.0.0.1/',
    'http://2130706433/', // 127.0.0.1 as a number
    'http://0x7f.0.0.1/',
    'http://[::1]/',
    'http://[::ffff:169.254.169.254]/latest/meta-data/',
    'http://169.254.169.254/latest/meta-data/',
    'http://metadata.google.internal/computeMetadata/v1/',
    'http://redis:6379/', // Docker service name
    'http://printer.local/',
    'http://foo.localhost/',
    'http://user:pass@example.com/',
    'file:///etc/passwd',
    'ftp://example.com/a.mp3',
    'gopher://example.com/',
    'not a url',
    'http://example.com\\@127.0.0.1:9099/x.mp3', // Node: example.com, ffmpeg/Python: 127.0.0.1
    'http://example.com\t@127.0.0.1/',
    ' http://example.com/',
  ])('blocks %s', async (url) => {
    await expect(assertPublicUrl(url, resolvesTo('93.184.216.34'))).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it('blocks public names that resolve to private addresses (any of them)', async () => {
    await expect(assertPublicUrl('https://evil.example/a.mp3', resolvesTo('10.0.0.5'))).rejects.toBeInstanceOf(BlockedUrlError);
    await expect(assertPublicUrl('https://evil.example/a.mp3', resolvesTo('93.184.216.34', '127.0.0.1'))).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it('allows public hosts and returns the normalized URL', async () => {
    expect(await assertPublicUrl('https://example.com/a%20b.mp3?x=1', resolvesTo('93.184.216.34'))).toBe('https://example.com/a%20b.mp3?x=1');
    expect(await assertPublicUrl('https://8.8.8.8/x', resolvesTo())).toBe('https://8.8.8.8/x');
  });

  it('a host that does not resolve is a generic load error, not a block', async () => {
    const failing: Lookup = async () => {
      throw new Error('ENOTFOUND');
    };
    const err = await assertPublicUrl('https://nope.example/', failing).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(BlockedUrlError);
    expect(classifyLoadError(err).reason).toBe('generic');
  });

  it('blocked links are explained to users as unsupported, without details', () => {
    expect(classifyLoadError(new BlockedUrlError('non-public address')).reason).toBe('unsupported');
  });
});

describe('ffmpeg protocol whitelist', () => {
  const whitelist = (args: string[]) => args[args.indexOf('-protocol_whitelist') + 1];
  it('remote inputs only get network protocols, before -i', () => {
    const args = ffmpegArgs({ url: 'https://host/a.m3u8', hls: true, filterChain: 'x' });
    expect(whitelist(args)).toBe('http,https,tls,tcp,crypto');
    expect(args.indexOf('-protocol_whitelist')).toBeLessThan(args.indexOf('-i'));
  });
  it('local files only get file', () => {
    expect(whitelist(ffmpegArgs({ url: '/tmp/a.mp3', filterChain: 'x' }))).toBe('file');
  });
  it('strips CR/LF from extractor headers', () => {
    const args = ffmpegArgs({ url: 'https://host/a', headers: { Accept: 'a\r\nX-Evil: 1', 'X\r\nY': 'z' }, filterChain: 'x' });
    expect(args[args.indexOf('-headers') + 1]).toBe('Accept: a  X-Evil: 1\r\nXY: z\r\n');
  });
});

describe('redact', () => {
  it('masks URL credentials and secret query params', () => {
    expect(redact('GET https://user:hunter2@host/x')).toBe('GET https://[redacted]@host/x');
    expect(redact('https://api.example.com/v1?api_key=abc123&q=song')).toBe('https://api.example.com/v1?api_key=[redacted]&q=song');
    expect(redact('https://x.googlevideo.com/videoplayback?expire=1&sig=AOq0QJ8&lsig=xyz')).toBe(
      'https://x.googlevideo.com/videoplayback?expire=1&sig=[redacted]&lsig=xyz',
    );
    expect(redact('https://h/?access_token=t0k&client_secret=s3c')).toBe('https://h/?access_token=[redacted]&client_secret=[redacted]');
  });
  it('leaves normal text alone', () => {
    expect(redact('resolve failed for "never gonna give you up"')).toBe('resolve failed for "never gonna give you up"');
  });
});

describe('RateLimiter', () => {
  it('allows `limit` hits per window and reports the wait', () => {
    let now = 0;
    const rl = new RateLimiter(2, 1000, () => now);
    expect(rl.take('a')).toBe(0);
    expect(rl.take('a')).toBe(0);
    now = 400;
    expect(rl.take('a')).toBe(600);
    expect(rl.take('b')).toBe(0);
    now = 1000;
    expect(rl.take('a')).toBe(0);
  });

  it('heavy commands are limited per member and per server', () => {
    const now = 0;
    const member = new RateLimiter(2, 1000, () => now);
    const guild = new RateLimiter(3, 1000, () => now);
    expect(heavyCommandWait('g', 'u1', member, guild)).toBe(0);
    expect(heavyCommandWait('g', 'u1', member, guild)).toBe(0);
    expect(heavyCommandWait('g', 'u1', member, guild)).toBeGreaterThan(0);
    expect(heavyCommandWait('g', 'u2', member, guild)).toBe(0);
    expect(heavyCommandWait('g', 'u3', member, guild)).toBeGreaterThan(0); // server limit
    expect(heavyCommandWait('other', 'u3', member, guild)).toBe(0);
    expect(memberLimiter.limit).toBeGreaterThan(0);
    expect(guildLimiter.limit).toBeGreaterThan(memberLimiter.limit);
  });
});

describe('Semaphore', () => {
  it('never runs more than `max` tasks at once', async () => {
    const sem = new Semaphore(2);
    let active = 0;
    let peak = 0;
    const task = () =>
      sem.run(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
      });
    await Promise.all(Array.from({ length: 7 }, task));
    expect(peak).toBe(2);
    expect(sem.pending).toBe(0);
  });
  it('frees the slot when a task throws', async () => {
    const sem = new Semaphore(1);
    await expect(sem.run(async () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    expect(await sem.run(async () => 42)).toBe(42);
  });
});

describe('trackLink', () => {
  const track = (url: string, title = 'Song') => ({ title, url }) as Track;
  it('keeps markdown links for web URLs and escapes ")"', () => {
    expect(trackLink(track('https://e.com/a_(b)'))).toBe('[Song](https://e.com/a_%28b%29)');
  });
  it('drops non-web URLs', () => {
    expect(trackLink(track('javascript:alert(1)', '[x]'))).toBe('\\[x\\]');
  });
});

describe('detect', () => {
  it('encodes YouTube playlist ids it puts into URLs', () => {
    const d = detect('https://www.youtube.com/playlist?list=PL1%26x%3D1');
    expect(d).toMatchObject({ kind: 'playlist', url: 'https://www.youtube.com/playlist?list=PL1%26x%3D1' });
  });
});

describe('startHeartbeat', () => {
  it('writes the file only while healthy', async () => {
    const { mkdtempSync, existsSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const { startHeartbeat } = await import('../src/util/health.js');
    const dir = mkdtempSync(join(tmpdir(), 'rockola-health-'));
    const down = join(dir, 'down');
    startHeartbeat(down, () => false)();
    expect(existsSync(down)).toBe(false);
    const up = join(dir, 'up');
    startHeartbeat(up, () => true)();
    expect(Number(readFileSync(up, 'utf8'))).toBeGreaterThan(0);
  });
});
