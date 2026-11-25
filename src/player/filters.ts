export const FILTER_NAMES = ['bassboost', 'nightcore', 'vaporwave', '8d'] as const;
export type FilterName = (typeof FILTER_NAMES)[number];

interface FilterDef {
  af: string;
  /** Playback speed multiplier the filter introduces. */
  speed: number;
  /** Filters that cannot be combined with this one. */
  excludes?: FilterName[];
}

const RATE = 48000;

export const FILTERS: Record<FilterName, FilterDef> = {
  bassboost: { af: 'bass=g=12:f=110:w=0.6,alimiter=limit=0.95', speed: 1 },
  nightcore: { af: `asetrate=${RATE * 1.25},aresample=${RATE}`, speed: 1.25, excludes: ['vaporwave'] },
  vaporwave: { af: `asetrate=${RATE * 0.8},aresample=${RATE}`, speed: 0.8, excludes: ['nightcore'] },
  '8d': { af: 'apulsator=hz=0.125', speed: 1 },
};

export const FILTER_LABELS: Record<FilterName, string> = {
  bassboost: 'Bass boost',
  nightcore: 'Nightcore',
  vaporwave: 'Vaporwave',
  '8d': '8D',
};

export function isFilterName(v: string): v is FilterName {
  return (FILTER_NAMES as readonly string[]).includes(v);
}

/** Toggles a filter, removing incompatible ones. Returns the new ordered list. */
export function toggleFilter(active: readonly FilterName[], name: FilterName): FilterName[] {
  if (active.includes(name)) return active.filter((f) => f !== name);
  const excluded = FILTERS[name].excludes ?? [];
  return FILTER_NAMES.filter((f) => f === name || (active.includes(f) && !excluded.includes(f)));
}

/** Builds the ffmpeg -af chain (always resampled to 48 kHz first so rate-based effects are exact). */
export function buildFilterChain(active: readonly FilterName[]): string {
  const parts = [`aresample=${RATE}`];
  for (const name of FILTER_NAMES) if (active.includes(name)) parts.push(FILTERS[name].af);
  return parts.join(',');
}

export function speedOf(active: readonly FilterName[]): number {
  return active.reduce((s, f) => s * FILTERS[f].speed, 1);
}
