import { randomUUID } from 'node:crypto';
import { resolveRedirect } from '../util/http.js';
import { assertPublicUrl, BlockedUrlError } from '../util/netguard.js';
import { detect, type Detected } from './detect.js';
import { resolveSpotify } from './spotify.js';
import { resolveSuno } from './suno.js';
import type { Requester, ResolvedStream, ResolveResult, Track, TrackInfo } from './types.js';
import { getStream, pickBestMatch, resolveWithYtdlp, searchYouTube } from './youtube.js';

export const MAX_PLAYLIST_ITEMS = 500;

export class UnsupportedError extends Error {}

export type LoadErrorReason = 'incompleteLink' | 'unavailable' | 'private' | 'ageRestricted' | 'unsupported' | 'blocked' | 'generic';

/** An error safe to show to users: a reason code, never raw extractor output. */
export class LoadError extends Error {
  constructor(readonly reason: LoadErrorReason, detail: string) {
    super(detail);
    this.name = 'LoadError';
  }
}

/** Maps raw yt-dlp / HTTP errors to a reason we can explain to users. */
export function classifyLoadError(e: unknown): LoadError {
  if (e instanceof LoadError) return e;
  const text = e instanceof Error ? e.message : String(e);
  if (e instanceof UnsupportedError || e instanceof BlockedUrlError) return new LoadError('unsupported', text);
  const rules: [RegExp, LoadErrorReason][] = [
    [/truncated|incomplete youtube id|looks truncated|invalid url|is not a valid url/i, 'incompleteLink'],
    [/private video|private playlist|this playlist is private/i, 'private'],
    [/age|sign in to confirm your age|inappropriate/i, 'ageRestricted'],
    [/not a bot|sign in to confirm|http error 429|too many requests/i, 'blocked'],
    [/unavailable|does not exist|not found|removed|terminated|HTTP 404|no video formats/i, 'unavailable'],
    [/unsupported url/i, 'unsupported'],
  ];
  const hit = rules.find(([re]) => re.test(text));
  return new LoadError(hit ? hit[1] : 'generic', text);
}

/** Turns user input (search text or URL) into playable tracks. */
export async function resolveQuery(input: string): Promise<ResolveResult> {
  return resolveDetected(detect(input));
}

async function resolveDetected(d: Detected): Promise<ResolveResult> {
  switch (d.type) {
    case 'search': {
      const [first] = await searchYouTube(d.query, 1);
      return { tracks: first ? [first] : [] };
    }
    case 'youtube':
      if (d.kind === 'invalid') throw new LoadError('incompleteLink', `YouTube id "${d.id}" is not 11 characters`);
      return resolveWithYtdlp(d.url, MAX_PLAYLIST_ITEMS);
    case 'spotify':
      if (d.kind === 'short') {
        const final = await resolveRedirect(d.url);
        const next = detect(final);
        if (next.type !== 'spotify' || next.kind === 'short') throw new UnsupportedError('Spotify link');
        return resolveDetected(next);
      }
      if (d.kind === 'unsupported') throw new UnsupportedError(`Spotify ${d.what}`);
      return resolveSpotify(d.kind, d.id, MAX_PLAYLIST_ITEMS);
    case 'suno':
      return resolveSuno(d.kind, d.kind === 'short' ? d.url : d.id);
    case 'url':
      // any other site goes through yt-dlp's generic extractor: never towards internal hosts
      return resolveWithYtdlp(await assertPublicUrl(d.url), MAX_PLAYLIST_ITEMS);
  }
}

export function toTrack(info: TrackInfo, requester: Requester): Track {
  return { ...info, uid: randomUUID(), requester };
}

const streamCache = new WeakMap<Track, ResolvedStream>();

/**
 * Finds the audio for a track right before it plays. Metadata-only tracks (Spotify) are matched
 * against YouTube here, so large playlists load instantly. Results are cached until they expire.
 */
export async function resolveStream(track: Track): Promise<ResolvedStream> {
  const cached = streamCache.get(track);
  if (cached && (!cached.expiresAt || cached.expiresAt > Date.now())) return cached;
  let stream: ResolvedStream;
  const plan = track.plan;
  if (plan.kind === 'direct') {
    stream = { url: plan.url };
  } else if (plan.kind === 'ytdlp') {
    // playlist entries from arbitrary sites can point anywhere: check each one before fetching it
    stream = await getStream(await assertPublicUrl(plan.target));
  } else {
    const candidates = await searchYouTube(plan.query, 5);
    const best = pickBestMatch(candidates, { title: track.title, artist: track.author, durationMs: plan.durationMs });
    if (!best) throw new Error(`no YouTube match for "${plan.query}"`);
    stream = await getStream(best.url);
    // remember the match so later replays/autoplay don't search again
    track.plan = { kind: 'ytdlp', target: best.url };
    track.youtubeId = best.youtubeId;
    track.thumbnail ??= best.thumbnail;
  }
  // the media URL itself (from a page, a playlist or Suno) is what ffmpeg will fetch: pass on the
  // checked, normalized form, since ffmpeg parses raw URLs differently from Node
  stream.url = await assertPublicUrl(stream.url);
  if (stream.youtubeId) track.youtubeId = stream.youtubeId;
  if (track.durationMs === null && stream.durationMs && !stream.isLive) track.durationMs = stream.durationMs;
  streamCache.set(track, stream);
  return stream;
}
