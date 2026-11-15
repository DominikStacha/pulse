const EMPTY = '—';

const full = new Intl.NumberFormat('en');
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

/** 12,345 */
export function formatNumber(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? EMPTY
    : full.format(Math.round(value));
}

/** 12.3K, for axes where space is tight. */
export function formatCompact(value: number): string {
  return compact.format(value);
}

/** 0.4213 -> "42%". A real but tiny share reads "<1%", never a misleading "0%". */
export function formatPercent(fraction: number | null | undefined, fractionDigits = 0): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return EMPTY;
  const text = (fraction * 100).toFixed(fractionDigits);
  if (fraction > 0 && Number(text) === 0)
    return `<${(10 ** -fractionDigits).toFixed(fractionDigits)}%`;
  return `${text}%`;
}

/** Visit length: "48s", "2m 14s", "1h 05m". */
export function formatSeconds(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0)
    return EMPTY;
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

export type DeltaDirection = 'up' | 'down' | 'flat' | 'new';

export interface Delta {
  direction: DeltaDirection;
  /** Absolute change in percent, rounded for display. null for "new". */
  percent: number | null;
}

/**
 * Change against the previous period. With nothing to compare against
 * (previous is 0) the honest answer is "new", not an infinite percentage.
 */
export function delta(current: number, previous: number): Delta {
  if (previous === 0)
    return current === 0 ? { direction: 'flat', percent: 0 } : { direction: 'new', percent: null };
  const percent = ((current - previous) / previous) * 100;
  const rounded = Math.round(Math.abs(percent));
  if (rounded === 0) return { direction: 'flat', percent: 0 };
  return { direction: percent > 0 ? 'up' : 'down', percent: rounded };
}

/** Regional-indicator flag emoji for an ISO-2 code; empty for anything else. */
export function flag(country: string | null | undefined): string {
  if (!country || !/^[A-Za-z]{2}$/.test(country)) return '';
  return String.fromCodePoint(...[...country.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}

const regionNames =
  typeof Intl.DisplayNames === 'function'
    ? new Intl.DisplayNames(['en'], { type: 'region' })
    : null;

/** English country name for an ISO-2 code; falls back to the code itself. */
export function countryName(country: string | null | undefined): string {
  if (!country) return 'Unknown';
  try {
    return regionNames?.of(country.toUpperCase()) ?? country;
  } catch {
    return country;
  }
}

/** "now", "12s", "4m", "3h" for the live feed. */
export function formatAgoShort(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return 'now';
  const s = Math.floor(ms / 1000);
  if (s < 5) return 'now';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// --- ported from stacha.tech/src/app/shared/utils/format.ts (status page) ---

const BYTE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB'] as const;

/** Binary units, because this reports memory and disk to a developer. */
export function formatBytes(bytes: number | null | undefined, fractionDigits = 1): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return EMPTY;
  if (bytes < 1024) return `${Math.round(bytes)} B`;

  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(fractionDigits)} ${BYTE_UNITS[unit]}`;
}

/** Coarse, two-unit durations: "3d 4h" rather than "3d 4h 17m 6s". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0)
    return EMPTY;
  const total = Math.floor(seconds);
  if (total < 60) return `${total}s`;

  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);

  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

/** Short relative age for "updated 4s ago" labels. */
export function formatAgo(milliseconds: number | null | undefined): string {
  if (
    milliseconds === null ||
    milliseconds === undefined ||
    !Number.isFinite(milliseconds) ||
    milliseconds < 0
  ) {
    return EMPTY;
  }
  return `${formatDuration(Math.floor(milliseconds / 1000))} ago`;
}
