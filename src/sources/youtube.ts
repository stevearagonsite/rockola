import type { ResolvedStream, ResolveResult, TrackInfo } from './types.js';
import { bestThumbnail, ytdlpJson, type YtdlpInfo } from './ytdlp.js';

const AUDIO_FORMAT = 'bestaudio[acodec=opus]/bestaudio/best';

function isYouTube(info: YtdlpInfo): boolean {
  const key = (info.ie_key ?? info.extractor_key ?? '').toLowerCase();
  return key.startsWith('youtube') || /youtu\.?be/.test(info.url ?? info.webpage_url ?? '');
}

/** Converts a yt-dlp entry (flat or full) into a TrackInfo. */
export function entryToTrack(info: YtdlpInfo): TrackInfo | null {
  const yt = isYouTube(info);
  const id = info.id;
  const pageUrl = yt && id && /^[A-Za-z0-9_-]{11}$/.test(id)
    ? `https://www.youtube.com/watch?v=${id}`
    : (info.webpage_url ?? info.original_url ?? info.url);
  if (!pageUrl) return null;
  const live = info.is_live === true || info.live_status === 'is_live';
  const title = info.title?.trim() || pageUrl;
  if (title === '[Private video]' || title === '[Deleted video]') return null;
  return {
    title,
    author: info.channel ?? info.uploader ?? info.artist ?? info.creator ?? '',
    url: pageUrl,
    durationMs: !live && typeof info.duration === 'number' ? Math.round(info.duration * 1000) : null,
    thumbnail: bestThumbnail(info) ?? (yt && id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : undefined),
    source: yt ? 'youtube' : 'url',
    plan: { kind: 'ytdlp', target: pageUrl },
    youtubeId: yt ? id : undefined,
  };
}

export async function searchYouTube(query: string, limit = 5): Promise<TrackInfo[]> {
  const info = await ytdlpJson(`ytsearch${limit}:${query}`, ['--flat-playlist']);
  return (info.entries ?? []).flatMap((e) => (e ? [entryToTrack(e)].filter((t): t is TrackInfo => t !== null) : []));
}

/** Resolves a single URL or playlist URL through yt-dlp (YouTube or any supported site). */
export async function resolveWithYtdlp(url: string, maxItems = 500): Promise<ResolveResult> {
  const info = await ytdlpJson(url, ['--flat-playlist', '--playlist-end', String(maxItems)]);
  if (info._type === 'playlist' || Array.isArray(info.entries)) {
    const tracks = (info.entries ?? []).flatMap((e) => {
      const t = e ? entryToTrack(e) : null;
      return t ? [t] : [];
    });
    return { tracks, playlistName: info.title ?? undefined };
  }
  const track = entryToTrack(info);
  return { tracks: track ? [track] : [] };
}

/** Fetches a fresh, playable audio stream URL. */
export async function getStream(target: string): Promise<ResolvedStream> {
  const info = await ytdlpJson(target, ['-f', AUDIO_FORMAT, '--no-playlist']);
  const format = info.requested_formats?.[0] ?? info;
  const url = format.url ?? info.url;
  if (!url) throw new Error('no playable format');
  const expire = Number(new URL(url).searchParams.get('expire'));
  return {
    url,
    headers: format.http_headers ?? info.http_headers,
    // re-resolve a few minutes before the signed URL expires (default 1h when unknown)
    expiresAt: Number.isFinite(expire) && expire > 0 ? expire * 1000 - 5 * 60_000 : Date.now() + 60 * 60_000,
    title: info.title,
    durationMs: typeof info.duration === 'number' ? Math.round(info.duration * 1000) : null,
    youtubeId: isYouTube(info) ? info.id : undefined,
    isLive: info.is_live === true,
  };
}

/** Related songs for autoplay, from YouTube's automatic "mix" of a video. */
export async function relatedTracks(videoId: string, limit = 10): Promise<TrackInfo[]> {
  const info = await ytdlpJson(`https://www.youtube.com/watch?v=${videoId}&list=RD${videoId}`, [
    '--flat-playlist',
    '--yes-playlist',
    '--playlist-end',
    String(limit + 1),
  ]);
  return (info.entries ?? []).flatMap((e) => {
    const t = e ? entryToTrack(e) : null;
    return t && t.youtubeId !== videoId ? [t] : [];
  });
}

const NOISE = /\b(live|cover|karaoke|remix|sped up|slowed|nightcore|8d|instrumental|reaction|lyrics?)\b/i;

/**
 * Picks the YouTube result that best matches a metadata-only track (e.g. from Spotify):
 * prefers close duration, matching artist and "official"/"topic" uploads, and avoids covers/live
 * versions unless the original title asks for them.
 */
export function pickBestMatch(
  candidates: TrackInfo[],
  wanted: { title: string; artist: string; durationMs: number | null },
): TrackInfo | null {
  if (candidates.length === 0) return null;
  const title = wanted.title.toLowerCase();
  const artist = wanted.artist.toLowerCase().split(/,|&|feat\.?/)[0]!.trim();
  let best: TrackInfo | null = null;
  let bestScore = -Infinity;
  candidates.forEach((c, index) => {
    const ct = c.title.toLowerCase();
    const ca = c.author.toLowerCase();
    let score = -index * 2; // keep YouTube's ranking as a tie-breaker
    if (wanted.durationMs && c.durationMs) {
      const diff = Math.abs(wanted.durationMs - c.durationMs) / 1000;
      score += diff <= 3 ? 30 : diff <= 10 ? 20 : diff <= 30 ? 5 : -20;
    }
    if (artist && (ca.includes(artist) || ct.includes(artist))) score += 15;
    if (ca.endsWith('- topic') || ca.endsWith('vevo') || /official (audio|video)/.test(ct)) score += 8;
    const noise = ct.match(NOISE)?.[0];
    if (noise && !title.includes(noise)) score -= 25;
    if (c.durationMs === null) score -= 40; // livestreams
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  });
  return best;
}
