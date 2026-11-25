import { describe, expect, it } from 'vitest';
import { detect } from '../src/sources/detect.js';

describe('detect: YouTube', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?si=abc', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=42', 'dQw4w9WgXcQ'],
    ['https://music.youtube.com/watch?v=dQw4w9WgXcQ&feature=share', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/live/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabc123', 'dQw4w9WgXcQ'],
    ['<https://youtu.be/dQw4w9WgXcQ>', 'dQw4w9WgXcQ'],
  ])('video %s', (url, id) => {
    expect(detect(url)).toEqual({ type: 'youtube', kind: 'video', id, url: `https://www.youtube.com/watch?v=${id}` });
  });

  it('playlist', () => {
    expect(detect('https://www.youtube.com/playlist?list=PLF3eNE6vR-4WsBf8qnJLqBywqX39QczxJ')).toEqual({
      type: 'youtube',
      kind: 'playlist',
      listId: 'PLF3eNE6vR-4WsBf8qnJLqBywqX39QczxJ',
      url: 'https://www.youtube.com/playlist?list=PLF3eNE6vR-4WsBf8qnJLqBywqX39QczxJ',
    });
    expect(detect('https://music.youtube.com/playlist?list=OLAK5uy_abc')).toMatchObject({ kind: 'playlist', listId: 'OLAK5uy_abc' });
  });

  it('ignores endless mixes without a video id', () => {
    expect(detect('https://www.youtube.com/watch?list=RDdQw4w9WgXcQ')).toEqual({
      type: 'url',
      url: 'https://www.youtube.com/watch?list=RDdQw4w9WgXcQ',
    });
  });
});

describe('detect: Spotify', () => {
  it.each([
    ['https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=x', 'track'],
    ['https://open.spotify.com/intl-es/track/4cOdK2wGLETKBW3PvgPWqT', 'track'],
    ['https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy', 'album'],
    ['https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M', 'playlist'],
    ['https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M', 'playlist'],
    ['https://open.spotify.com/user/someone/playlist/37i9dQZF1DXcBWIGoYBM5M', 'playlist'],
    ['https://open.spotify.com/artist/0gxyHStUsqpMadRV0Di1Qt', 'artist'],
    ['spotify:track:4cOdK2wGLETKBW3PvgPWqT', 'track'],
  ])('%s', (url, kind) => {
    expect(detect(url)).toMatchObject({ type: 'spotify', kind });
  });

  it('short links are resolved later', () => {
    expect(detect('https://spotify.link/AbCdEf')).toEqual({ type: 'spotify', kind: 'short', url: 'https://spotify.link/AbCdEf' });
  });

  it('podcasts are unsupported', () => {
    expect(detect('https://open.spotify.com/episode/4cOdK2wGLETKBW3PvgPWqT')).toEqual({
      type: 'spotify',
      kind: 'unsupported',
      what: 'episode',
    });
  });
});

describe('detect: Suno', () => {
  const id = '0cb4dcee-8e29-4c9f-9568-a0b090ef580b';
  it.each([
    [`https://suno.com/song/${id}`, 'song'],
    [`https://www.suno.com/song/${id}?sh=abc`, 'song'],
    [`https://app.suno.ai/song/${id}`, 'song'],
    [`https://suno.com/embed/${id}`, 'song'],
    [`https://suno.com/playlist/${id}`, 'playlist'],
  ])('%s', (url, kind) => {
    expect(detect(url)).toEqual({ type: 'suno', kind, id });
  });

  it('short share links', () => {
    expect(detect('https://suno.com/s/Ab12Cd34')).toEqual({ type: 'suno', kind: 'short', url: 'https://suno.com/s/Ab12Cd34' });
  });
});

describe('detect: other', () => {
  it('plain text is a search', () => {
    expect(detect('  daft punk one more time ')).toEqual({ type: 'search', query: 'daft punk one more time' });
  });
  it('other URLs go to yt-dlp', () => {
    expect(detect('https://soundcloud.com/artist/song')).toEqual({ type: 'url', url: 'https://soundcloud.com/artist/song' });
  });
  it('non-http schemes are searches', () => {
    expect(detect('ftp://example.com/song.mp3')).toEqual({ type: 'search', query: 'ftp://example.com/song.mp3' });
  });
});
