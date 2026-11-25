import { describe, expect, it } from 'vitest';
import { buildFilterChain, speedOf, toggleFilter } from '../src/player/filters.js';

describe('filters', () => {
  it('toggles on and off', () => {
    expect(toggleFilter([], 'bassboost')).toEqual(['bassboost']);
    expect(toggleFilter(['bassboost'], 'bassboost')).toEqual([]);
  });
  it('nightcore and vaporwave are exclusive', () => {
    expect(toggleFilter(['nightcore', 'bassboost'], 'vaporwave')).toEqual(['bassboost', 'vaporwave']);
  });
  it('builds an ffmpeg chain resampled to 48k first', () => {
    expect(buildFilterChain([])).toBe('aresample=48000');
    const chain = buildFilterChain(['8d', 'nightcore']);
    expect(chain.startsWith('aresample=48000,asetrate=60000')).toBe(true);
    expect(chain).toContain('apulsator');
  });
  it('speed', () => {
    expect(speedOf([])).toBe(1);
    expect(speedOf(['nightcore', 'bassboost'])).toBe(1.25);
    expect(speedOf(['vaporwave'])).toBe(0.8);
  });
});
