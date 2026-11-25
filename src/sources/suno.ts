import { fetchText, resolveRedirect } from '../util/http.js';
import type { ResolveResult, TrackInfo } from './types.js';
import { isUuid } from './detect.js';

/**
 * Suno songs are played from the public audio file the song page itself uses (no login, no
 * cookies, no API keys). The page embeds the clip data in Next.js "flight" chunks; we decode
 * those and read the clip objects.
 */

export interface SunoClip {
  id: string;
  title?: string;
  display_name?: string;
  handle?: string;
  audio_url?: string;
  video_url?: string;
  media_urls?: { url?: string; content_type?: string; delivery?: string }[];
  image_url?: string;
  image_large_url?: string;
  duration?: number;
  metadata?: { duration?: number };
  is_public?: boolean;
}

/** Joins the string payloads pushed through `self.__next_f.push([1,"…"])`. */
export function decodeFlight(html: string): string {
  const re = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;
  let out = '';
  for (const m of html.matchAll(re)) {
    try {
      out += JSON.parse(m[1]!) as string;
    } catch {
      /* ignore malformed chunk */
    }
  }
  return out;
}

function isEscaped(text: string, i: number): boolean {
  let n = 0;
  for (let j = i - 1; j >= 0 && text[j] === '\\'; j--) n++;
  return n % 2 === 1;
}

/** Returns the JSON object that encloses position `pos` (which must be outside a string). */
export function enclosingObject(text: string, pos: number): unknown {
  let depth = 0;
  let inString = false;
  let start = -1;
  for (let i = pos - 1; i >= 0; i--) {
    const c = text[i];
    if (c === '"' && !isEscaped(text, i)) inString = !inString;
    else if (inString) continue;
    else if (c === '}' || c === ']') depth++;
    else if (c === '{' || c === '[') {
      if (depth === 0) {
        if (c === '{') {
          start = i;
          break;
        }
        return null;
      }
      depth--;
    }
  }
  if (start < 0) return null;
  depth = 0;
  inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === '"' && !isEscaped(text, i)) inString = !inString;
    else if (inString) continue;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Extracts every Suno clip object found in a page, in order of appearance, without duplicates. */
export function extractClips(html: string): SunoClip[] {
  const text = decodeFlight(html) || html;
  const clips = new Map<string, SunoClip>();
  const re = /"(?:audio_url|video_url)":"/g;
  for (const m of text.matchAll(re)) {
    const obj = enclosingObject(text, m.index) as SunoClip | null;
    if (obj && typeof obj.id === 'string' && isUuid(obj.id) && !clips.has(obj.id)) clips.set(obj.id, obj);
  }
  return [...clips.values()];
}

function meta(html: string, property: string): string | undefined {
  const re = new RegExp(`<meta[^>]+(?:property|name)="${property}"[^>]+content="([^"]*)"`, 'i');
  const v = re.exec(html)?.[1];
  return v
    ?.replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/**
 * Chooses the best public, plain audio source for a clip. The `media_urls` files are an encoded
 * format meant for Suno's own player, so they are skipped on purpose; the public share video
 * (H.264 + AAC) carries the full song and ffmpeg reads its audio track directly.
 */
export function clipAudioUrl(clip: SunoClip): string {
  if (clip.audio_url && !/forbidden/.test(clip.audio_url) && /^https:/.test(clip.audio_url)) return clip.audio_url;
  if (clip.video_url && /^https:/.test(clip.video_url)) return clip.video_url;
  return `https://cdn1.suno.ai/${clip.id}.mp4`;
}

export function clipToTrack(clip: SunoClip): TrackInfo {
  const seconds = clip.metadata?.duration ?? clip.duration;
  return {
    title: clip.title?.trim() || 'Suno song',
    author: clip.display_name ?? clip.handle ?? 'Suno',
    url: `https://suno.com/song/${clip.id}`,
    durationMs: typeof seconds === 'number' ? Math.round(seconds * 1000) : null,
    thumbnail: clip.image_large_url ?? clip.image_url,
    source: 'suno',
    plan: { kind: 'direct', url: clipAudioUrl(clip) },
  };
}

/** Parses a song page; falls back to OpenGraph tags + the public CDN file when no clip data exists. */
export function parseSongPage(html: string, id: string): TrackInfo {
  const clip = extractClips(html).find((c) => c.id === id);
  if (clip) {
    const track = clipToTrack(clip);
    if (!clip.title) track.title = meta(html, 'og:title') ?? track.title;
    return track;
  }
  const title = meta(html, 'og:title');
  if (!title) throw new Error('Suno song not found or not public');
  return {
    title,
    author: 'Suno',
    url: `https://suno.com/song/${id}`,
    durationMs: null,
    thumbnail: meta(html, 'og:image'),
    source: 'suno',
    plan: { kind: 'direct', url: `https://cdn1.suno.ai/${id}.mp4` },
  };
}

export function parsePlaylistPage(html: string, max = 500): ResolveResult {
  const name = meta(html, 'og:title')?.replace(/\s*\|\s*Suno\s*$/, '') ?? 'Suno playlist';
  const flight = decodeFlight(html);
  const count = Number(/"songCount":(\d+)/.exec(flight)?.[1] ?? NaN);
  let clips = extractClips(html);
  if (Number.isFinite(count) && count > 0) clips = clips.slice(0, count);
  return { tracks: clips.slice(0, max).map(clipToTrack), playlistName: name };
}

export async function resolveSuno(kind: 'song' | 'playlist' | 'short', idOrUrl: string): Promise<ResolveResult> {
  if (kind === 'short') {
    const final = await resolveRedirect(idOrUrl);
    const m = /\/(song|playlist)\/([0-9a-f-]{36})/i.exec(final);
    if (!m) throw new Error('Suno link did not lead to a song');
    return resolveSuno(m[1] as 'song' | 'playlist', m[2]!.toLowerCase());
  }
  const { text } = await fetchText(`https://suno.com/${kind}/${idOrUrl}`);
  if (kind === 'song') return { tracks: [parseSongPage(text, idOrUrl)] };
  return parsePlaylistPage(text);
}
