/** The dashboard API contract, mirrored 1:1 from docs/DESIGN.md ("Dashboard API"). */

export type Bucket = 'hour' | 'day' | 'month';

export type Site = { id: string; name: string; domain: string; createdAt: string };

export type Totals = {
  visitors: number;
  visits: number;
  pageviews: number;
  events: number;
  /** 0-1 */
  bounceRate: number;
  avgVisitSeconds: number;
};

export type Summary = {
  range: {
    from: string;
    to: string;
    previousFrom: string;
    previousTo: string;
    bucket: Bucket;
    tz: string;
  };
  current: Totals;
  previous: Totals;
};

export type Point = {
  /** Bucket start, ISO with offset. */
  t: string;
  visitors: number;
  visits: number;
  pageviews: number;
};

export type Timeseries = { bucket: Bucket; points: Point[]; previous: Point[] };

export type Dim =
  | 'pages'
  | 'entries'
  | 'exits'
  | 'referrers'
  | 'countries'
  | 'browsers'
  | 'os'
  | 'devices'
  | 'languages'
  | 'screens'
  | 'events'
  | 'sites';

export type Row = {
  /** null = "(none)", e.g. direct traffic. */
  key: string | null;
  label: string;
  visitors: number;
  /** Pageviews, or the event count for dim=events. */
  count: number;
  /** visitors / total visitors, 0-1 */
  share: number;
};

export type Breakdown = { dim: string; totalVisitors: number; rows: Row[] };

export type LiveEvent = {
  siteId: string;
  ts: string;
  kind: 'pageview' | 'event';
  name: string | null;
  path: string;
  country: string | null;
  browser: string;
  os: string;
  device: string;
  referrer: string | null;
};

export type Live = {
  activeVisitors: number;
  perSite: { siteId: string; active: number }[];
  /** Last 50, newest first. */
  recent: LiveEvent[];
};
