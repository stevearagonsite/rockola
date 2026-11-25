import { describe, expect, it } from 'vitest';
import { formatDuration, parseTime, progressBar } from '../src/util/time.js';

describe('time', () => {
  it.each([
    ['90', 90_000],
    ['1:30', 90_000],
    ['01:02:03', 3_723_000],
    ['1m30s', 90_000],
    ['2h', 7_200_000],
    ['45s', 45_000],
    ['1.5', 1500],
  ])('parseTime(%s)', (text, ms) => expect(parseTime(text)).toBe(ms));

  it.each(['', 'abc', '1:75', '-5', '1:2:3:4'])('rejects %s', (text) => expect(parseTime(text)).toBeNull());

  it('formatDuration', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(61_000)).toBe('1:01');
    expect(formatDuration(3_723_000)).toBe('1:02:03');
    expect(formatDuration(null)).toBe('LIVE');
  });

  it('progressBar', () => {
    expect(progressBar(0, 100_000, 5)).toBe('🔘▬▬▬▬');
    expect(progressBar(100_000, 100_000, 5)).toBe('▬▬▬▬🔘');
    expect(progressBar(10, null)).toBe('🔴 LIVE');
  });
});
