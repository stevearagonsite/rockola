import { describe, expect, it } from 'vitest';
import { Queue } from '../src/player/queue.js';

function make(items: string[] = ['a', 'b', 'c']) {
  const q = new Queue<string>(() => 0);
  q.add(items);
  q.skip(); // start playing the first one
  return q;
}

describe('Queue', () => {
  it('plays in order and ends', () => {
    const q = make();
    expect(q.current).toBe('a');
    expect(q.next()).toBe('b');
    expect(q.next()).toBe('c');
    expect(q.next()).toBeNull();
    expect(q.isEmpty).toBe(true);
    expect(q.history).toEqual(['a', 'b', 'c']);
  });

  it('loop track repeats on natural end but skip moves on', () => {
    const q = make();
    q.loop = 'track';
    expect(q.next()).toBe('a');
    expect(q.next()).toBe('a');
    expect(q.skip()).toBe('b');
  });

  it('loop queue recycles finished items', () => {
    const q = make(['a', 'b']);
    q.loop = 'queue';
    expect(q.next()).toBe('b');
    expect(q.next()).toBe('a');
    expect(q.next()).toBe('b');
    expect(q.upcoming).toEqual(['a']);
  });

  it('previous puts the current item back in front', () => {
    const q = make();
    q.next(); // b
    expect(q.previous()).toBe('a');
    expect(q.upcoming).toEqual(['b', 'c']);
    expect(q.previous()).toBeNull();
  });

  it('previous with queue loop does not duplicate', () => {
    const q = make(['a', 'b', 'c']);
    q.loop = 'queue';
    q.next(); // b, a appended
    expect(q.upcoming).toEqual(['c', 'a']);
    expect(q.previous()).toBe('a');
    expect(q.upcoming).toEqual(['b', 'c']);
  });

  it('add with position inserts (1-based)', () => {
    const q = make(['a', 'b', 'c']);
    q.add(['x'], 1);
    expect(q.upcoming).toEqual(['x', 'b', 'c']);
    q.add(['y'], 99);
    expect(q.upcoming).toEqual(['x', 'b', 'c', 'y']);
  });

  it('jump drops the items in between', () => {
    const q = make(['a', 'b', 'c', 'd']);
    expect(q.jump(3)).toBe('d');
    expect(q.upcoming).toEqual([]);
    expect(q.history).toEqual(['a']);
    expect(q.jump(1)).toBeNull();
  });

  it('jump with queue loop keeps the skipped items at the end', () => {
    const q = make(['a', 'b', 'c', 'd']);
    q.loop = 'queue';
    expect(q.jump(2)).toBe('c');
    expect(q.upcoming).toEqual(['d', 'b', 'a']);
  });

  it('remove and move validate positions', () => {
    const q = make(['a', 'b', 'c', 'd']);
    expect(q.remove(0)).toBeNull();
    expect(q.remove(4)).toBeNull();
    expect(q.remove(2)).toBe('c');
    expect(q.upcoming).toEqual(['b', 'd']);
    expect(q.move(2, 1)).toBe('d');
    expect(q.upcoming).toEqual(['d', 'b']);
    expect(q.move(1, 3)).toBeNull();
  });

  it('shuffle is a permutation', () => {
    const q = new Queue<number>(() => 0.5);
    q.add([1, 2, 3, 4, 5, 6]);
    q.shuffle();
    expect([...q.upcoming].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(q.upcoming).not.toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('clear keeps the current item, reset forgets everything', () => {
    const q = make();
    q.clear();
    expect(q.current).toBe('a');
    expect(q.size).toBe(0);
    q.reset();
    expect(q.current).toBeNull();
    expect(q.history).toEqual([]);
  });

  it('pages are clamped', () => {
    const q = new Queue<number>();
    q.add(Array.from({ length: 25 }, (_, i) => i));
    expect(q.page(1)).toMatchObject({ page: 1, pages: 3, offset: 0 });
    expect(q.page(3).items).toEqual([20, 21, 22, 23, 24]);
    expect(q.page(99).page).toBe(3);
    expect(new Queue<number>().page(1)).toMatchObject({ page: 1, pages: 1, items: [] });
  });

  it('history is capped', () => {
    const q = new Queue<number>();
    q.add(Array.from({ length: 80 }, (_, i) => i));
    for (let i = 0; i <= 80; i++) q.next(); // first call starts item 0
    expect(q.history.length).toBe(50);
    expect(q.history.at(-1)).toBe(79);
  });
});
