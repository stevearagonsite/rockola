/** Formats milliseconds as m:ss or h:mm:ss. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return 'LIVE';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/**
 * Parses "90", "1:30", "01:02:03", "1m30s", "2h", "45s" into milliseconds.
 * Returns null when the text is not a valid time.
 */
export function parseTime(input: string): number | null {
  const text = input.trim().toLowerCase();
  if (!text) return null;
  if (/^\d+(\.\d+)?$/.test(text)) return Math.round(Number(text) * 1000);
  if (/^\d+(:\d{1,2}){1,2}$/.test(text)) {
    const parts = text.split(':').map(Number);
    if (parts.slice(1).some((p) => p >= 60)) return null;
    return parts.reduce((acc, p) => acc * 60 + p, 0) * 1000;
  }
  const unit = /^(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?$/.exec(text);
  if (unit && (unit[1] || unit[2] || unit[3])) {
    const [, h = '0', m = '0', s = '0'] = unit;
    return ((Number(h) * 60 + Number(m)) * 60 + Number(s)) * 1000;
  }
  return null;
}

/** Text progress bar like ▬▬▬🔘▬▬▬▬ */
export function progressBar(positionMs: number, durationMs: number | null, size = 18): string {
  if (!durationMs || durationMs <= 0) return '🔴 LIVE';
  const ratio = Math.min(Math.max(positionMs / durationMs, 0), 1);
  const idx = Math.min(size - 1, Math.round(ratio * (size - 1)));
  return Array.from({ length: size }, (_, i) => (i === idx ? '🔘' : '▬')).join('');
}
