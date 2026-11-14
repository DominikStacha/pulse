import { Bucket } from './api';

export const PERIODS = [
  { id: 'today', label: 'Today', long: 'Today' },
  { id: '24h', label: '24h', long: 'Last 24 hours' },
  { id: '7d', label: '7d', long: 'Last 7 days' },
  { id: '30d', label: '30d', long: 'Last 30 days' },
  { id: '90d', label: '90d', long: 'Last 90 days' },
  { id: '12m', label: '12m', long: 'Last 12 months' },
] as const;

export type Period = (typeof PERIODS)[number]['id'];

export const DEFAULT_PERIOD: Period = '7d';

/** Anything that is not a known period (hand-edited URL) falls back to the default. */
export function parsePeriod(value: unknown): Period {
  return PERIODS.find((p) => p.id === value)?.id ?? DEFAULT_PERIOD;
}

export function periodLong(period: Period): string {
  return PERIODS.find((p) => p.id === period)?.long ?? '';
}

/** "vs previous 7 days" wording for the comparison line. */
export function previousLong(period: Period): string {
  switch (period) {
    case 'today':
      return 'the same span yesterday';
    case '24h':
      return 'the 24 hours before';
    case '12m':
      return 'the 12 months before';
    default:
      return `the ${period.replace('d', ' days')} before`;
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

/**
 * Reads the wall-clock parts straight out of an ISO string with offset
 * ("2026-11-14T13:00:00+01:00"). The API buckets in Europe/Prague, so labels
 * must show that clock and never the browser's own zone.
 */
export function localParts(iso: string): LocalParts | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(iso);
  if (!m) return null;
  return {
    year: +m[1],
    month: +m[2],
    day: +m[3],
    hour: m[4] ? +m[4] : 0,
    minute: m[5] ? +m[5] : 0,
  };
}

function weekdayOf(p: LocalParts): string {
  return WEEKDAYS[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()];
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Short x-axis label for a bucket start. */
export function axisLabel(iso: string, bucket: Bucket): string {
  const p = localParts(iso);
  if (!p) return '';
  switch (bucket) {
    case 'hour':
      return `${pad(p.hour)}:00`;
    case 'day':
      return `${p.day} ${MONTHS[p.month - 1]}`;
    case 'month':
      return MONTHS[p.month - 1];
  }
}

/** Longer label for the chart tooltip. */
export function tooltipLabel(iso: string, bucket: Bucket): string {
  const p = localParts(iso);
  if (!p) return '';
  switch (bucket) {
    case 'hour':
      return `${weekdayOf(p)} ${p.day} ${MONTHS[p.month - 1]}, ${pad(p.hour)}:00`;
    case 'day':
      return `${weekdayOf(p)} ${p.day} ${MONTHS[p.month - 1]}`;
    case 'month':
      return `${MONTHS_LONG[p.month - 1]} ${p.year}`;
  }
}
