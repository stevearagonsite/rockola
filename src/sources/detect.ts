/** Classifies what the user typed into /play without touching the network. */
export type Detected =
  | { type: 'youtube'; kind: 'video'; id: string; url: string }
  | { type: 'youtube'; kind: 'playlist'; listId: string; url: string }
  | { type: 'spotify'; kind: 'track' | 'album' | 'playlist' | 'artist'; id: string }
  | { type: 'spotify'; kind: 'short'; url: string }
  | { type: 'spotify'; kind: 'unsupported'; what: string }
  | { type: 'suno'; kind: 'song' | 'playlist'; id: string }
  | { type: 'suno'; kind: 'short'; url: string }
  | { type: 'url'; url: string }
  | { type: 'search'; query: string };

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;

function tryUrl(input: string): URL | null {
  const text = input.trim().replace(/^<(.+)>$/, '$1');
  if (!/^https?:\/\//i.test(text)) return null;
  try {
    return new URL(text);
  } catch {
    return null;
  }
}

function host(u: URL): string {
  return u.hostname.toLowerCase().replace(/^(www|m)\./, '');
}

function detectYouTube(u: URL): Detected | null {
  const h = host(u);
  const parts = u.pathname.split('/').filter(Boolean);
  let id: string | undefined;
  if (h === 'youtu.be') id = parts[0];
  else if (h === 'youtube.com' || h === 'music.youtube.com' || h === 'youtube-nocookie.com') {
    if (parts[0] === 'watch') id = u.searchParams.get('v') ?? undefined;
    else if (['shorts', 'live', 'embed', 'v'].includes(parts[0] ?? '')) id = parts[1];
    else if (parts[0] === 'playlist') {
      const listId = u.searchParams.get('list');
      if (listId) return { type: 'youtube', kind: 'playlist', listId, url: `https://www.youtube.com/playlist?list=${listId}` };
    }
  } else return null;
  if (id && YT_ID.test(id)) return { type: 'youtube', kind: 'video', id, url: `https://www.youtube.com/watch?v=${id}` };
  const listId = u.searchParams.get('list');
  // watch?list=... without a video id: treat as a playlist (mixes "RD…" are endless, so skip them)
  if (listId && !listId.startsWith('RD')) {
    return { type: 'youtube', kind: 'playlist', listId, url: `https://www.youtube.com/playlist?list=${listId}` };
  }
  return null;
}

function detectSpotify(input: string, u: URL | null): Detected | null {
  const uri = /^spotify:(track|album|playlist|artist):([A-Za-z0-9]{22})$/.exec(input.trim());
  if (uri) return { type: 'spotify', kind: uri[1] as 'track', id: uri[2]! };
  if (!u) return null;
  const h = host(u);
  if (h === 'spotify.link' || h === 'spotify.app.link') return { type: 'spotify', kind: 'short', url: u.toString() };
  if (h !== 'open.spotify.com' && h !== 'play.spotify.com') return null;
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts[0]?.startsWith('intl-')) parts.shift();
  if (parts[0] === 'embed') parts.shift();
  // /user/<name>/playlist/<id> (legacy)
  if (parts[0] === 'user' && parts[2] === 'playlist') parts.splice(0, 2);
  const [kind, id] = parts;
  if ((kind === 'track' || kind === 'album' || kind === 'playlist' || kind === 'artist') && id && SPOTIFY_ID.test(id)) {
    return { type: 'spotify', kind, id };
  }
  return { type: 'spotify', kind: 'unsupported', what: kind ?? 'unknown' };
}

function detectSuno(u: URL): Detected | null {
  const h = host(u);
  if (h !== 'suno.com' && h !== 'app.suno.ai' && h !== 'suno.ai') return null;
  const parts = u.pathname.split('/').filter(Boolean);
  const [kind, id] = parts;
  if ((kind === 'song' || kind === 'embed') && id && UUID.test(id)) return { type: 'suno', kind: 'song', id: id.toLowerCase() };
  if (kind === 'playlist' && id && UUID.test(id)) return { type: 'suno', kind: 'playlist', id: id.toLowerCase() };
  if (kind === 's' && id) return { type: 'suno', kind: 'short', url: `https://suno.com/s/${id}` };
  return null;
}

export function detect(input: string): Detected {
  const text = input.trim();
  const u = tryUrl(text);
  const spotify = detectSpotify(text, u);
  if (spotify) return spotify;
  if (!u) return { type: 'search', query: text };
  return detectYouTube(u) ?? detectSuno(u) ?? { type: 'url', url: u.toString() };
}

export function isUuid(text: string): boolean {
  return UUID.test(text);
}
