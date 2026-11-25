import { describe, expect, it } from 'vitest';
import { clipAudioUrl, decodeFlight, extractClips, parsePlaylistPage, parseSongPage } from '../src/sources/suno.js';

const A = '0cb4dcee-8e29-4c9f-9568-a0b090ef580b';
const B = 'd7f797ef-48a1-4379-9b0d-43db0bc4ac94';

function clip(id: string, title: string, extra: Record<string, unknown> = {}) {
  return {
    status: 'complete',
    title,
    id,
    entity_type: 'song_schema',
    video_url: `https://cdn1.suno.ai/${id}.mp4`,
    audio_url: 'https://studio-api.prod.suno.com/api/forbidden',
    media_urls: [{ url: `https://cdn.example/${id}.m4a`, content_type: 'm4a-opus', delivery: 'progressive', encoding: '1.0.0' }],
    image_large_url: `https://cdn2.suno.ai/image_large_${id}.jpeg`,
    display_name: 'Some Creator',
    metadata: { duration: 203.6, tags: 'lofi "quoted" {braces}', prompt: '[Verse]\nline' },
    ...extra,
  };
}

/** Builds a page the way Next.js streams it: JSON inside JS string literals. */
function page(payload: unknown, og = ''): string {
  const text = `5:${JSON.stringify(['$', 'div', null, payload])}\n`;
  const half = Math.floor(text.length / 2);
  const push = (s: string) => `<script>self.__next_f.push([1,${JSON.stringify(s)}])</script>`;
  return `<html><head>${og}</head><body>${push(text.slice(0, half))}${push(text.slice(half))}</body></html>`;
}

describe('Suno parser', () => {
  it('decodes flight chunks', () => {
    const html = page({ hello: 'world' });
    expect(decodeFlight(html)).toContain('"hello":"world"');
  });

  it('extracts clips with nested quotes and braces', () => {
    const html = page({ clip: clip(A, 'Song A'), related: [clip(B, 'Song B'), clip(A, 'dup')] });
    const clips = extractClips(html);
    expect(clips.map((c) => c.id)).toEqual([A, B]);
    expect(clips[0]?.metadata?.duration).toBe(203.6);
  });

  it('uses the public share video, never the encoded media file or a forbidden url', () => {
    expect(clipAudioUrl(clip(A, 'x'))).toBe(`https://cdn1.suno.ai/${A}.mp4`);
    expect(clipAudioUrl({ id: A, audio_url: `https://cdn1.suno.ai/${A}.mp3` })).toBe(`https://cdn1.suno.ai/${A}.mp3`);
    expect(clipAudioUrl({ id: A })).toBe(`https://cdn1.suno.ai/${A}.mp4`);
  });

  it('parses a song page', () => {
    const track = parseSongPage(page({ clip: clip(A, 'Song A') }), A);
    expect(track).toMatchObject({
      title: 'Song A',
      author: 'Some Creator',
      url: `https://suno.com/song/${A}`,
      durationMs: 203600,
      source: 'suno',
      plan: { kind: 'direct', url: `https://cdn1.suno.ai/${A}.mp4` },
    });
  });

  it('falls back to OpenGraph tags', () => {
    const html = page({}, '<meta property="og:title" content="Fallback &amp; Co"/><meta property="og:image" content="https://img"/>');
    expect(parseSongPage(html, A)).toMatchObject({ title: 'Fallback & Co', thumbnail: 'https://img', plan: { url: `https://cdn1.suno.ai/${A}.mp4` } });
    expect(() => parseSongPage('<html></html>', A)).toThrow(/not found/);
  });

  it('parses a playlist and trims to songCount', () => {
    const html = page(
      { playlist: { songCount: 1 }, clips: [clip(B, 'First'), clip(A, 'Recommended')] },
      '<meta property="og:title" content="Staff Picks | Suno"/>',
    );
    const result = parsePlaylistPage(html);
    expect(result.playlistName).toBe('Staff Picks');
    expect(result.tracks.map((t) => t.title)).toEqual(['First']);
  });
});
