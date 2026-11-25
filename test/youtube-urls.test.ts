import { describe, expect, it } from 'vitest';
import { detect } from '../src/sources/detect.js';
import { classifyLoadError, LoadError, resolveQuery } from '../src/sources/resolver.js';

// IDs with '-' and '_' and ending in a letter, like the one that failed in production (3PFJ9SETS4M)
const IDS = ['3PFJ9SETS4M', 'a-B_c1D2e3F', '_-_-_-_-_-_', 'dQw4w9WgXc-'];

const FORMS: ((id: string) => string)[] = [
  (id) => `https://www.youtube.com/watch?v=${id}`,
  (id) => `https://youtube.com/watch?v=${id}`,
  (id) => `http://www.youtube.com/watch?v=${id}`,
  (id) => `https://m.youtube.com/watch?v=${id}`,
  (id) => `https://music.youtube.com/watch?v=${id}&feature=share`,
  (id) => `https://www.youtube.com/watch?v=${id}&t=42s`,
  (id) => `https://www.youtube.com/watch?v=${id}&list=PLF3eNE6vR-4WsBf8qnJLqBywqX39QczxJ&index=2`,
  (id) => `https://www.youtube.com/watch?v=${id}&list=RD${id}&start_radio=1`,
  (id) => `https://www.youtube.com/watch?feature=shared&v=${id}`,
  (id) => `https://youtu.be/${id}`,
  (id) => `https://youtu.be/${id}?si=AbC-dEf_123`,
  (id) => `https://youtu.be/${id}?t=10`,
  (id) => `https://www.youtube.com/shorts/${id}`,
  (id) => `https://youtube.com/shorts/${id}?si=xyz`,
  (id) => `https://www.youtube.com/live/${id}?si=xyz`,
  (id) => `https://www.youtube.com/embed/${id}`,
  (id) => `https://www.youtube-nocookie.com/embed/${id}`,
  (id) => `  <https://www.youtube.com/watch?v=${id}>  `,
];

describe('YouTube URL forms keep the full 11-character id', () => {
  for (const id of IDS) {
    for (const form of FORMS) {
      const url = form(id);
      it(url.trim(), () => {
        expect(detect(url)).toEqual({ type: 'youtube', kind: 'video', id, url: `https://www.youtube.com/watch?v=${id}` });
      });
    }
  }
});

describe('incomplete YouTube links', () => {
  it.each([
    'https://www.youtube.com/watch?v=3PFJ9SETS4',
    'https://youtu.be/3PFJ9SETS4',
    'https://www.youtube.com/shorts/3PFJ9SETS4?si=x',
    'https://www.youtube.com/watch?v=3PFJ9SETS4MX',
  ])('%s is flagged instead of sent to yt-dlp', (url) => {
    expect(detect(url)).toMatchObject({ type: 'youtube', kind: 'invalid' });
  });

  it('a playlist link with a broken video id still loads the playlist', () => {
    expect(detect('https://www.youtube.com/watch?v=3PFJ9SETS4&list=PLabc')).toMatchObject({ kind: 'playlist', listId: 'PLabc' });
  });

  it('resolving one fails with a friendly reason, without calling yt-dlp', async () => {
    await expect(resolveQuery('https://www.youtube.com/watch?v=3PFJ9SETS4')).rejects.toMatchObject({ reason: 'incompleteLink' });
  });
});

describe('classifyLoadError', () => {
  it.each([
    ['[youtube:truncated_id] 3PFJ9SETS4: Incomplete YouTube ID 3PFJ9SETS4. URL https://www.youtube.com/watch?v=3PFJ9SETS4 looks truncated.', 'incompleteLink'],
    ['[youtube] abc: Video unavailable', 'unavailable'],
    ['[youtube] abc: Private video. Sign in if you\'ve been granted access', 'private'],
    ['[youtube] abc: Sign in to confirm your age', 'ageRestricted'],
    ["[youtube] abc: Sign in to confirm you're not a bot", 'blocked'],
    ['Unsupported URL: https://example.com', 'unsupported'],
    ['something odd happened', 'generic'],
  ])('%s', (text, reason) => {
    expect(classifyLoadError(new Error(text)).reason).toBe(reason);
  });
  it('keeps LoadError as is', () => {
    const e = new LoadError('private', 'x');
    expect(classifyLoadError(e)).toBe(e);
  });
});
