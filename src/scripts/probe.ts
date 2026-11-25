/**
 * Offline check of the audio pipeline (no Discord): resolves each query/URL, opens the stream
 * with ffmpeg for a few seconds and reports bytes and peak level.
 *   node dist/scripts/probe.js "query" "https://..."
 */
import { loadConfig } from '../config.js';
import { buildFilterChain } from '../player/filters.js';
import { configureFfmpeg, createPcmStream } from '../player/stream.js';
import { resolveQuery, resolveStream, toTrack } from '../sources/resolver.js';
import { configureSpotify } from '../sources/spotify.js';
import { configureYtdlp, ytdlpVersion } from '../sources/ytdlp.js';

const config = loadConfig(false);
configureYtdlp({ binary: config.ytdlpPath, cookies: config.ytdlpCookies, jsRuntime: config.ytdlpJsRuntime });
configureFfmpeg(config.ffmpegPath);
configureSpotify(config.spotifyClientId, config.spotifyClientSecret);

const seconds = Number(process.env.PROBE_SECONDS ?? 3);
console.log(`yt-dlp ${await ytdlpVersion().catch(() => 'missing')}`);
let failed = 0;
for (const q of process.argv.slice(2)) {
  const t0 = Date.now();
  try {
    const res = await resolveQuery(q);
    const info = res.tracks[0];
    if (!info) throw new Error('no tracks');
    const track = toTrack(info, { id: '0', name: 'probe' });
    const stream = await resolveStream(track);
    const pcm = createPcmStream({ url: stream.url, headers: stream.headers, hls: stream.hls, filterChain: buildFilterChain([]) });
    pcm.stream.resume();
    await new Promise((r) => setTimeout(r, seconds * 1000));
    pcm.kill();
    const ok = pcm.bytes() > 0 && pcm.peak() > 500;
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${q} -> "${track.title}" (${res.tracks.length} track(s)) bytes=${pcm.bytes()} peak=${pcm.peak()} ${Date.now() - t0}ms`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${q}: ${(e as Error).message}`);
  }
}
process.exit(failed ? 1 : 0);
