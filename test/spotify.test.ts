import { describe, expect, it } from 'vitest';
import { parseEmbedHtml } from '../src/sources/spotify.js';

function embedPage(entity: unknown): string {
  const data = { props: { pageProps: { state: { data: { entity } } } } };
  return `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></body></html>`;
}

describe('Spotify embed parser', () => {
  it('reads a track', () => {
    const html = embedPage({
      type: 'track',
      name: 'Song Title',
      id: '4cOdK2wGLETKBW3PvgPWqT',
      duration: 213573,
      artists: [{ name: 'Artist One' }, { name: 'Artist Two' }],
    });
    expect(parseEmbedHtml(html)).toEqual({
      kind: 'track',
      name: 'Song Title',
      songs: [{ title: 'Song Title', artists: ['Artist One', 'Artist Two'], durationMs: 213573, id: '4cOdK2wGLETKBW3PvgPWqT', image: undefined }],
    });
  });

  it('reads a playlist track list and splits artists', () => {
    const html = embedPage({
      type: 'playlist',
      name: 'My Mix',
      coverArt: { sources: [{ url: 'small.jpg', width: 60 }, { url: 'big.jpg', width: 640 }] },
      trackList: [
        { uri: 'spotify:track:AAAAAAAAAAAAAAAAAAAAAA', title: 'First', subtitle: 'Band, Guest Singer', duration: 100000 },
        { uri: 'spotify:track:BBBBBBBBBBBBBBBBBBBBBB', title: 'Second', subtitle: 'Solo Artist', duration: 200000 },
        { uri: 'spotify:track:CCCCCCCCCCCCCCCCCCCCCC', title: '', subtitle: 'Nobody' },
      ],
    });
    const parsed = parseEmbedHtml(html);
    expect(parsed.name).toBe('My Mix');
    expect(parsed.songs).toHaveLength(2);
    expect(parsed.songs[0]).toEqual({ title: 'First', artists: ['Band', 'Guest Singer'], durationMs: 100000, id: 'AAAAAAAAAAAAAAAAAAAAAA', image: 'big.jpg' });
  });

  it('fails clearly without embed data', () => {
    expect(() => parseEmbedHtml('<html></html>')).toThrow(/embed data/);
  });
});
