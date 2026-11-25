import { log } from '../util/logger.js';
import { fetchText } from '../util/http.js';
import type { ResolveResult, TrackInfo } from './types.js';

/**
 * Spotify does not allow streaming, so Spotify links are turned into metadata (title, artists,
 * duration) and played from the best YouTube match. Without credentials we read the public embed
 * page; with SPOTIFY_CLIENT_ID/SECRET we use the Web API (complete playlists, more fields).
 */

export type SpotifyKind = 'track' | 'album' | 'playlist' | 'artist';

interface SpotifySong {
  title: string;
  artists: string[];
  durationMs: number | null;
  id?: string;
  image?: string;
}

interface EmbedEntity {
  type?: string;
  name?: string;
  title?: string;
  subtitle?: string;
  id?: string;
  uri?: string;
  duration?: number;
  artists?: { name?: string }[];
  coverArt?: { sources?: { url: string; width?: number }[] };
  visualIdentity?: { image?: { url: string; maxWidth?: number }[] };
  trackList?: { uri?: string; title?: string; subtitle?: string; duration?: number }[];
}

function splitArtists(subtitle: string | undefined): string[] {
  return (subtitle ?? '')
    .split(/,\s*/)
    .map((s) => s.replace(/\u00a0/g, ' ').trim())
    .filter(Boolean);
}

function entityImage(e: EmbedEntity): string | undefined {
  const sources = e.coverArt?.sources ?? e.visualIdentity?.image ?? [];
  return [...sources].sort((a, b) => ((b as { width?: number }).width ?? 0) - ((a as { width?: number }).width ?? 0))[0]?.url;
}

/** Parses the public embed page HTML (open.spotify.com/embed/<kind>/<id>). Exported for tests. */
export function parseEmbedHtml(html: string): { name: string; songs: SpotifySong[]; kind: string } {
  const m = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  if (!m?.[1]) throw new Error('Spotify embed data not found');
  const data = JSON.parse(m[1]) as { props?: { pageProps?: { state?: { data?: { entity?: EmbedEntity } } } } };
  const entity = data.props?.pageProps?.state?.data?.entity;
  if (!entity) throw new Error('Spotify entity not found');
  const name = entity.name ?? entity.title ?? 'Spotify';
  const image = entityImage(entity);
  if (entity.type === 'track') {
    return {
      kind: 'track',
      name,
      songs: [
        {
          title: name,
          artists: (entity.artists ?? []).map((a) => a.name ?? '').filter(Boolean),
          durationMs: entity.duration ?? null,
          id: entity.id,
          image,
        },
      ],
    };
  }
  const songs = (entity.trackList ?? []).map((t) => ({
    title: t.title ?? '',
    artists: splitArtists(t.subtitle),
    durationMs: t.duration ?? null,
    id: t.uri?.split(':').pop(),
    image,
  }));
  return { kind: entity.type ?? 'playlist', name, songs: songs.filter((s) => s.title) };
}

function toTrackInfo(song: SpotifySong): TrackInfo {
  const artist = song.artists.join(', ');
  return {
    title: song.title,
    author: artist,
    url: song.id ? `https://open.spotify.com/track/${song.id}` : 'https://open.spotify.com',
    durationMs: song.durationMs,
    thumbnail: song.image,
    source: 'spotify',
    plan: {
      kind: 'search',
      query: `${song.artists[0] ?? ''} - ${song.title}`.replace(/^ - /, ''),
      durationMs: song.durationMs,
    },
  };
}

// ---------- optional Web API ----------

let credentials: { id: string; secret: string } | null = null;
let token: { value: string; expiresAt: number } | null = null;

export function configureSpotify(id?: string, secret?: string): void {
  credentials = id && secret ? { id, secret } : null;
}

async function apiToken(): Promise<string | null> {
  if (!credentials) return null;
  if (token && token.expiresAt > Date.now()) return token.value;
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${credentials.id}:${credentials.secret}`).toString('base64')}`,
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Spotify auth failed (${res.status})`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: json.access_token, expiresAt: Date.now() + (json.expires_in - 60) * 1000 };
  return token.value;
}

interface ApiTrack {
  id?: string;
  name?: string;
  duration_ms?: number;
  artists?: { name: string }[];
  album?: { images?: { url: string }[] };
}

async function api<T>(path: string, bearer: string): Promise<T> {
  const res = await fetch(path.startsWith('http') ? path : `https://api.spotify.com/v1${path}`, {
    headers: { authorization: `Bearer ${bearer}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Spotify API ${res.status}`);
  return (await res.json()) as T;
}

function apiSong(t: ApiTrack, image?: string): SpotifySong | null {
  if (!t.name) return null;
  return {
    title: t.name,
    artists: (t.artists ?? []).map((a) => a.name),
    durationMs: t.duration_ms ?? null,
    id: t.id,
    image: t.album?.images?.[0]?.url ?? image,
  };
}

async function resolveWithApi(kind: SpotifyKind, id: string, bearer: string, max: number): Promise<{ name: string; songs: SpotifySong[] }> {
  if (kind === 'track') {
    const t = await api<ApiTrack>(`/tracks/${id}`, bearer);
    const s = apiSong(t);
    return { name: t.name ?? 'Spotify', songs: s ? [s] : [] };
  }
  if (kind === 'artist') {
    const a = await api<{ name: string }>(`/artists/${id}`, bearer);
    const top = await api<{ tracks: ApiTrack[] }>(`/artists/${id}/top-tracks?market=US`, bearer);
    return { name: a.name, songs: top.tracks.flatMap((t) => apiSong(t) ?? []) };
  }
  const meta = await api<{ name: string; images?: { url: string }[] }>(
    kind === 'album' ? `/albums/${id}` : `/playlists/${id}?fields=name,images`,
    bearer,
  );
  const image = meta.images?.[0]?.url;
  const songs: SpotifySong[] = [];
  let next: string | null = kind === 'album' ? `/albums/${id}/tracks?limit=50` : `/playlists/${id}/tracks?limit=100`;
  while (next && songs.length < max) {
    const page: { items: (ApiTrack | { track: ApiTrack | null })[]; next: string | null } = await api(next, bearer);
    for (const item of page.items) {
      const t = 'track' in item ? item.track : (item as ApiTrack);
      const s = t ? apiSong(t, image) : null;
      if (s) songs.push(s);
    }
    next = page.next;
  }
  return { name: meta.name, songs: songs.slice(0, max) };
}

export async function resolveSpotify(kind: SpotifyKind, id: string, max = 500): Promise<ResolveResult> {
  let parsed: { name: string; songs: SpotifySong[] } | null = null;
  const bearer = await apiToken().catch((e: unknown) => {
    log.warn('Spotify API token failed, using public embed:', (e as Error).message);
    return null;
  });
  if (bearer) {
    parsed = await resolveWithApi(kind, id, bearer, max).catch((e: unknown) => {
      log.warn(`Spotify API failed for ${kind}/${id}, using public embed:`, (e as Error).message);
      return null;
    });
  }
  if (!parsed) {
    const { text } = await fetchText(`https://open.spotify.com/embed/${kind}/${id}`);
    parsed = parseEmbedHtml(text);
  }
  const tracks = parsed.songs.slice(0, max).map(toTrackInfo);
  return { tracks, playlistName: kind === 'track' ? undefined : parsed.name };
}
