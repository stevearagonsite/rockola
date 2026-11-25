import { describe, expect, it } from 'vitest';
import type { TrackInfo } from '../src/sources/types.js';
import { entryToTrack, pickBestMatch } from '../src/sources/youtube.js';

describe('entryToTrack', () => {
  it('maps a flat YouTube search entry', () => {
    const t = entryToTrack({ id: 'FGBhQbmPwH8', ie_key: 'Youtube', url: 'https://www.youtube.com/watch?v=FGBhQbmPwH8', title: 'Song', channel: 'Band', duration: 322 });
    expect(t).toMatchObject({
      title: 'Song',
      author: 'Band',
      url: 'https://www.youtube.com/watch?v=FGBhQbmPwH8',
      durationMs: 322000,
      source: 'youtube',
      youtubeId: 'FGBhQbmPwH8',
      thumbnail: 'https://i.ytimg.com/vi/FGBhQbmPwH8/hqdefault.jpg',
    });
  });
  it('marks live streams without duration and skips private videos', () => {
    expect(entryToTrack({ id: 'abcdefghijk', ie_key: 'Youtube', title: 'Radio', live_status: 'is_live', duration: 10 })?.durationMs).toBeNull();
    expect(entryToTrack({ id: 'abcdefghijk', ie_key: 'Youtube', title: '[Private video]' })).toBeNull();
  });
  it('maps other sites', () => {
    expect(entryToTrack({ id: '1', extractor_key: 'Soundcloud', webpage_url: 'https://soundcloud.com/a/b', title: 'B', uploader: 'A' })).toMatchObject({
      source: 'url',
      plan: { kind: 'ytdlp', target: 'https://soundcloud.com/a/b' },
    });
  });
});

function c(title: string, author: string, seconds: number | null): TrackInfo {
  return { title, author, url: `https://x/${title}`, durationMs: seconds === null ? null : seconds * 1000, source: 'youtube', plan: { kind: 'ytdlp', target: '' } };
}

describe('pickBestMatch', () => {
  const wanted = { title: 'One More Time', artist: 'Daft Punk', durationMs: 320_000 };
  it('prefers the original over covers and live versions', () => {
    const best = pickBestMatch(
      [c('One More Time (Live)', 'Daft Punk', 330), c('One More Time - piano cover', 'Someone', 321), c('One More Time', 'Daft Punk - Topic', 320)],
      wanted,
    );
    expect(best?.author).toBe('Daft Punk - Topic');
  });
  it('avoids livestreams and wildly different durations', () => {
    const best = pickBestMatch([c('Daft Punk radio 24/7', 'Radio', null), c('One More Time 10 hours', 'X', 36000), c('One More Time', 'Daft Punk', 322)], wanted);
    expect(best?.author).toBe('Daft Punk');
  });
  it('keeps remixes when asked for', () => {
    const best = pickBestMatch([c('Song', 'Artist', 200), c('Song (Remix)', 'Artist', 200)], { title: 'Song (Remix)', artist: 'Artist', durationMs: 200_000 });
    expect(best?.title).toBe('Song');
    expect(pickBestMatch([], wanted)).toBeNull();
  });
});
