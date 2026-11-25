export type LoopMode = 'off' | 'track' | 'queue';

const HISTORY_LIMIT = 50;

/**
 * Pure queue state: the current item, what comes next and what already played.
 * Positions exposed to users are 1-based and refer to `upcoming`.
 */
export class Queue<T> {
  current: T | null = null;
  upcoming: T[] = [];
  history: T[] = [];
  loop: LoopMode = 'off';

  constructor(private readonly random: () => number = Math.random) {}

  get size(): number {
    return this.upcoming.length;
  }

  get isEmpty(): boolean {
    return this.current === null && this.upcoming.length === 0;
  }

  add(items: T[], position?: number): void {
    if (position === undefined || position > this.upcoming.length) this.upcoming.push(...items);
    else this.upcoming.splice(Math.max(0, position - 1), 0, ...items);
  }

  private pushHistory(item: T): void {
    this.history.push(item);
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
  }

  /**
   * Advances after a track ends naturally, honouring the loop mode.
   * Returns the item to play next (or null when the queue is over).
   */
  next(): T | null {
    if (this.current !== null && this.loop === 'track') return this.current;
    return this.skip();
  }

  /** Advances ignoring track-loop (user pressed skip). */
  skip(): T | null {
    const finished = this.current;
    if (finished !== null) {
      this.pushHistory(finished);
      if (this.loop === 'queue') this.upcoming.push(finished);
    }
    this.current = this.upcoming.shift() ?? null;
    return this.current;
  }

  /** Goes back to the previously played item; current goes back to the front of the queue. */
  previous(): T | null {
    const prev = this.history.pop();
    if (prev === undefined) return null;
    if (this.current !== null) {
      this.upcoming.unshift(this.current);
      // with queue loop the previous item was also appended to the end: drop that copy
      if (this.loop === 'queue' && this.upcoming[this.upcoming.length - 1] === prev) this.upcoming.pop();
    }
    this.current = prev;
    return prev;
  }

  /** Skips straight to the item at 1-based `position`; the ones in between are dropped (or recycled with queue loop). */
  jump(position: number): T | null {
    if (!this.isValidPosition(position)) return null;
    const skipped = this.upcoming.splice(0, position - 1);
    if (this.loop === 'queue') this.upcoming.push(...skipped);
    return this.skip();
  }

  remove(position: number): T | null {
    if (!this.isValidPosition(position)) return null;
    return this.upcoming.splice(position - 1, 1)[0] ?? null;
  }

  move(from: number, to: number): T | null {
    if (!this.isValidPosition(from) || !this.isValidPosition(to)) return null;
    const [item] = this.upcoming.splice(from - 1, 1);
    if (item === undefined) return null;
    this.upcoming.splice(to - 1, 0, item);
    return item;
  }

  shuffle(): void {
    const a = this.upcoming;
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
  }

  clear(): void {
    this.upcoming = [];
  }

  /** Forgets everything (stop). */
  reset(): void {
    this.current = null;
    this.upcoming = [];
    this.history = [];
  }

  isValidPosition(position: number): boolean {
    return Number.isInteger(position) && position >= 1 && position <= this.upcoming.length;
  }

  page(page: number, perPage = 10): { items: T[]; page: number; pages: number; offset: number } {
    const pages = Math.max(1, Math.ceil(this.upcoming.length / perPage));
    const p = Math.min(Math.max(1, page), pages);
    const offset = (p - 1) * perPage;
    return { items: this.upcoming.slice(offset, offset + perPage), page: p, pages, offset };
  }
}
