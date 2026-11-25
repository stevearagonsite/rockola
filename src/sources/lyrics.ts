const UA = 'Rockola Discord bot (https://github.com/stevearagonsite/rockola)';

export interface Lyrics {
  title: string;
  artist: string;
  text: string;
}

interface LrclibItem {
  trackName?: string;
  artistName?: string;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
  instrumental?: boolean;
}

/** Removes "(Official Video)", "[Lyrics]", "ft. X" etc. so lyric searches match. */
export function cleanTitle(title: string): string {
  return title
    .replace(/\s*[([][^)\]]*(official|video|audio|lyrics?|letra|visualizer|remaster|hd|4k|mv)[^)\]]*[)\]]/gi, '')
    .replace(/\s+(ft\.?|feat\.?)\s.+$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function syncedToPlain(synced: string): string {
  return synced.replace(/^\[[\d:.]+\]\s?/gm, '');
}

/** Looks lyrics up on LRCLIB (free, no key). */
export async function findLyrics(query: string): Promise<Lyrics | null> {
  const url = `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return null;
  const items = (await res.json()) as LrclibItem[];
  const hit = items.find((i) => i.plainLyrics || i.syncedLyrics);
  if (!hit) return null;
  return {
    title: hit.trackName ?? query,
    artist: hit.artistName ?? '',
    text: hit.plainLyrics ?? syncedToPlain(hit.syncedLyrics ?? ''),
  };
}
