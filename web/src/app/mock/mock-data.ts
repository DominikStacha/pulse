import { Breakdown, Bucket, Dim, Point, Row, Site, Summary, Timeseries, Totals } from '../core/api';
import { Period } from '../core/period';
import { hash, rng } from './rng';

export const SITES: Site[] = [
  {
    id: 'ac198dbf-3b47-41c5-ac40-8b92f6143b8d',
    name: 'stacha.tech',
    domain: 'stacha.tech',
    createdAt: '2025-03-02T09:12:00+01:00',
  },
  {
    id: '171ace70-dd73-4c05-a1d4-0c72761da28a',
    name: 'Špalíky a stínidla do kapsy',
    domain: 'spanelstinadokapsy.cz',
    createdAt: '2025-08-19T14:30:00+02:00',
  },
  {
    id: 'a48051f3-1dbf-4f3b-98ed-81f1df584e5e',
    name: 'Špalíky (new)',
    domain: 'new.spanelstinadokapsy.cz',
    createdAt: '2026-02-11T10:05:00+01:00',
  },
  {
    id: '4d7d4cb1-3ab9-4688-aa98-43c45d8e4067',
    name: 'Špalíky portal',
    domain: 'portal.spanelstinadokapsy.cz',
    createdAt: '2026-02-11T10:07:00+01:00',
  },
  {
    id: '9f32713b-d1b8-4632-9793-bcbc561a97dd',
    name: 'Klettr',
    domain: 'klettr.com',
    createdAt: '2025-11-05T18:40:00+01:00',
  },
  {
    id: '15945b97-945d-4fc8-b287-dc092cfbac3f',
    name: 'Saliny',
    domain: 'saliny.stacha.tech',
    createdAt: '2026-06-23T21:15:00+02:00',
  },
];

/** Average visitors per day, per site. */
export const BASE: Record<string, number> = {
  'ac198dbf-3b47-41c5-ac40-8b92f6143b8d': 46,
  '171ace70-dd73-4c05-a1d4-0c72761da28a': 31,
  'a48051f3-1dbf-4f3b-98ed-81f1df584e5e': 9,
  '4d7d4cb1-3ab9-4688-aa98-43c45d8e4067': 6,
  '9f32713b-d1b8-4632-9793-bcbc561a97dd': 22,
  '15945b97-945d-4fc8-b287-dc092cfbac3f': 7,
};
const PAGES_PER_VISIT: Record<string, number> = {
  'ac198dbf-3b47-41c5-ac40-8b92f6143b8d': 1.7,
  '171ace70-dd73-4c05-a1d4-0c72761da28a': 2.6,
  'a48051f3-1dbf-4f3b-98ed-81f1df584e5e': 1.9,
  '4d7d4cb1-3ab9-4688-aa98-43c45d8e4067': 4.1,
  '9f32713b-d1b8-4632-9793-bcbc561a97dd': 3.2,
  '15945b97-945d-4fc8-b287-dc092cfbac3f': 1.4,
};
const BOUNCE: Record<string, number> = {
  'ac198dbf-3b47-41c5-ac40-8b92f6143b8d': 0.58,
  '171ace70-dd73-4c05-a1d4-0c72761da28a': 0.47,
  'a48051f3-1dbf-4f3b-98ed-81f1df584e5e': 0.52,
  '4d7d4cb1-3ab9-4688-aa98-43c45d8e4067': 0.28,
  '9f32713b-d1b8-4632-9793-bcbc561a97dd': 0.36,
  '15945b97-945d-4fc8-b287-dc092cfbac3f': 0.64,
};
const AVG_VISIT: Record<string, number> = {
  'ac198dbf-3b47-41c5-ac40-8b92f6143b8d': 96,
  '171ace70-dd73-4c05-a1d4-0c72761da28a': 142,
  'a48051f3-1dbf-4f3b-98ed-81f1df584e5e': 81,
  '4d7d4cb1-3ab9-4688-aa98-43c45d8e4067': 305,
  '9f32713b-d1b8-4632-9793-bcbc561a97dd': 174,
  '15945b97-945d-4fc8-b287-dc092cfbac3f': 58,
};

// ---- Europe/Prague wall-clock helpers (the API buckets in this zone) ----

const prague = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Prague',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function parts(ms: number) {
  const o = Object.fromEntries(prague.formatToParts(ms).map((p) => [p.type, p.value]));
  return {
    y: +o['year'],
    mo: +o['month'],
    d: +o['day'],
    h: +o['hour'],
    mi: +o['minute'],
    s: +o['second'],
  };
}

function offsetMinutes(ms: number): number {
  const p = parts(ms);
  return (Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000) / 60000;
}

/** Wall-clock Prague time to epoch ms; day/month overflow is normalised by Date.UTC. */
function localToMs(y: number, mo: number, d: number, h = 0): number {
  const guess = Date.UTC(y, mo - 1, d, h);
  const once = guess - offsetMinutes(guess) * 60000;
  return guess - offsetMinutes(once) * 60000;
}

export function iso(ms: number): string {
  const p = parts(ms);
  const off = offsetMinutes(ms);
  const sign = off < 0 ? '-' : '+';
  const pad = (n: number) => String(Math.floor(n)).padStart(2, '0');
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}${sign}${pad(Math.abs(off) / 60)}:${pad(Math.abs(off) % 60)}`;
}

const HOUR = 3_600_000;

interface Range {
  bucket: Bucket;
  starts: number[];
  prevStarts: number[];
  to: number;
  prevTo: number;
}

function buildRange(period: Period, now: number): Range {
  const n = parts(now);
  const hourStart = Math.floor(now / HOUR) * HOUR;
  switch (period) {
    case 'today': {
      const starts = Array.from({ length: n.h + 1 }, (_, i) => localToMs(n.y, n.mo, n.d, i));
      return {
        bucket: 'hour',
        starts,
        prevStarts: starts.map((_, i) => localToMs(n.y, n.mo, n.d - 1, i)),
        to: now,
        prevTo: now - 24 * HOUR,
      };
    }
    case '24h': {
      const starts = Array.from({ length: 24 }, (_, i) => hourStart - (23 - i) * HOUR);
      return {
        bucket: 'hour',
        starts,
        prevStarts: starts.map((s) => s - 24 * HOUR),
        to: now,
        prevTo: now - 24 * HOUR,
      };
    }
    case '12m': {
      const starts = Array.from({ length: 12 }, (_, i) => localToMs(n.y, n.mo - 11 + i, 1));
      return {
        bucket: 'month',
        starts,
        prevStarts: starts.map((_, i) => localToMs(n.y, n.mo - 23 + i, 1)),
        to: now,
        prevTo: starts[0],
      };
    }
    default: {
      const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
      const starts = Array.from({ length: days }, (_, i) =>
        localToMs(n.y, n.mo, n.d - (days - 1) + i),
      );
      return {
        bucket: 'day',
        starts,
        prevStarts: starts.map((_, i) => localToMs(n.y, n.mo, n.d - (2 * days - 1) + i)),
        to: now,
        prevTo: starts[0],
      };
    }
  }
}

// ---- traffic model ----

const PROFILE = [
  0.25, 0.18, 0.15, 0.14, 0.16, 0.25, 0.45, 0.75, 1.1, 1.4, 1.55, 1.6, 1.5, 1.5, 1.55, 1.5, 1.4,
  1.3, 1.2, 1.15, 1.0, 0.8, 0.55, 0.38,
];
const PROFILE_MEAN = PROFILE.reduce((a, b) => a + b, 0) / 24;
const WEEKDAY = [0.78, 1.05, 1.1, 1.08, 1.04, 0.92, 0.8]; // Sunday first

let flags = new Set<string>();
export function setMockFlags(next: Set<string>): void {
  flags = next;
}

function hourly(siteId: string, hourMs: number, now: number) {
  if (flags.has('empty') || hourMs > now) return { v: 0, vs: 0, pv: 0 };
  const p = parts(hourMs);
  const dow = new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay();
  const random = rng(hash(`${siteId}|${hourMs}`));
  const day = Math.floor(hourMs / 86_400_000);
  const spike = hash(`${siteId}|spike|${day}`) % 19 === 0 ? 2.6 : 1;
  const dayMood = 0.62 + 0.76 * rng(hash(`${siteId}|mood|${day}`))();
  const trend = 0.85 + 0.3 * ((hourMs - (now - 400 * 86_400_000)) / (400 * 86_400_000));
  const elapsed = Math.min(1, (now - hourMs) / HOUR);
  const lambda =
    (BASE[siteId] / 24) *
    (PROFILE[p.h] / PROFILE_MEAN) *
    WEEKDAY[dow] *
    spike *
    dayMood *
    trend *
    elapsed;
  const v = Math.round(lambda * (0.65 + 0.7 * random()));
  return {
    v,
    vs: Math.round(v * (1.06 + 0.1 * random())),
    pv: Math.round(v * PAGES_PER_VISIT[siteId] * (0.88 + 0.24 * random())),
  };
}

function sumBucket(siteIds: string[], from: number, to: number, now: number) {
  let v = 0;
  let vs = 0;
  let pv = 0;
  for (let h = Math.floor(from / HOUR) * HOUR; h < to; h += HOUR) {
    for (const id of siteIds) {
      const x = hourly(id, h, now);
      v += x.v;
      vs += x.vs;
      pv += x.pv;
    }
  }
  return { v, vs, pv };
}

/** Distinct visitors over a long range are fewer than the sum of the buckets. */
const UNIQUE: Record<Bucket, number> = { hour: 0.93, day: 0.8, month: 0.6 };

function series(siteIds: string[], starts: number[], to: number, now: number): Point[] {
  return starts.map((s, i) => {
    const { v, vs, pv } = sumBucket(siteIds, s, starts[i + 1] ?? to, now);
    return { t: iso(s), visitors: v, visits: vs, pageviews: pv };
  });
}

function totals(siteIds: string[], points: Point[], bucket: Bucket, salt: string): Totals {
  const sum = (k: 'visitors' | 'visits' | 'pageviews') => points.reduce((a, p) => a + p[k], 0);
  const visitors = Math.round(sum('visitors') * UNIQUE[bucket]);
  const weights = siteIds.map((id) => BASE[id]);
  const wsum = weights.reduce((a, b) => a + b, 0) || 1;
  const blend = (table: Record<string, number>) =>
    siteIds.reduce((a, id, i) => a + (table[id] * weights[i]) / wsum, 0);
  const noise = rng(hash(salt))();
  return {
    visitors,
    visits: Math.round(sum('visits') * (bucket === 'month' ? 0.97 : 0.995)),
    pageviews: sum('pageviews'),
    events: Math.round(sum('pageviews') * 0.06),
    bounceRate: visitors ? Math.min(0.95, blend(BOUNCE) * (0.86 + 0.28 * noise)) : 0,
    avgVisitSeconds: visitors ? Math.round(blend(AVG_VISIT) * (0.8 + 0.4 * noise)) : 0,
  };
}

function siteIdsFor(site: string): string[] {
  return site === 'all' ? SITES.map((s) => s.id) : SITES.some((s) => s.id === site) ? [site] : [];
}

export function summary(site: string, period: Period, now = Date.now()): Summary {
  const ids = siteIdsFor(site);
  const r = buildRange(period, now);
  const cur = series(ids, r.starts, r.to, now);
  const prev = series(ids, r.prevStarts, r.prevTo, now);
  return {
    range: {
      from: iso(r.starts[0]),
      to: iso(now),
      previousFrom: iso(r.prevStarts[0]),
      previousTo: iso(r.prevTo),
      bucket: r.bucket,
      tz: 'Europe/Prague',
    },
    current: totals(ids, cur, r.bucket, `${site}|${period}|c`),
    previous: totals(ids, prev, r.bucket, `${site}|${period}|p`),
  };
}

export function timeseries(site: string, period: Period, now = Date.now()): Timeseries {
  const ids = siteIdsFor(site);
  const r = buildRange(period, now);
  return {
    bucket: r.bucket,
    points: series(ids, r.starts, r.to, now),
    previous: series(ids, r.prevStarts, r.prevTo, now),
  };
}

// ---- breakdowns ----

type Weighted = readonly (readonly [string | null, number])[];

const PAGES: Record<string, Weighted> = {
  'ac198dbf-3b47-41c5-ac40-8b92f6143b8d': [
    ['/', 0.4],
    ['/projects', 0.17],
    ['/blog', 0.1],
    ['/blog/angular-signals-in-anger', 0.09],
    ['/about', 0.08],
    ['/status', 0.07],
    ['/contact', 0.05],
    ['/blog/pi-5-nvme', 0.04],
  ],
  '171ace70-dd73-4c05-a1d4-0c72761da28a': [
    ['/', 0.34],
    ['/cenik', 0.18],
    ['/realizace', 0.14],
    ['/sluzby', 0.1],
    ['/poptavka', 0.08],
    ['/kontakt', 0.07],
    ['/o-nas', 0.05],
    ['/faq', 0.04],
  ],
  'a48051f3-1dbf-4f3b-98ed-81f1df584e5e': [
    ['/', 0.5],
    ['/cenik', 0.25],
    ['/kontakt', 0.25],
  ],
  '4d7d4cb1-3ab9-4688-aa98-43c45d8e4067': [
    ['/login', 0.4],
    ['/dashboard', 0.3],
    ['/objednavky', 0.2],
    ['/profil', 0.1],
  ],
  '9f32713b-d1b8-4632-9793-bcbc561a97dd': [
    ['/', 0.3],
    ['/routes', 0.24],
    ['/routes/12', 0.12],
    ['/routes/34', 0.09],
    ['/download', 0.1],
    ['/privacy', 0.05],
    ['/routes/7', 0.1],
  ],
  '15945b97-945d-4fc8-b287-dc092cfbac3f': [
    ['/', 0.6],
    ['/map', 0.3],
    ['/privacy.html', 0.1],
  ],
};
const EVENTS: Record<string, Weighted> = {
  'ac198dbf-3b47-41c5-ac40-8b92f6143b8d': [
    ['cv_download', 0.5],
    ['contact_click', 0.3],
    ['theme_toggle', 0.2],
  ],
  '171ace70-dd73-4c05-a1d4-0c72761da28a': [
    ['poptavka_odeslana', 0.4],
    ['telefon_klik', 0.4],
    ['cenik_otevren', 0.2],
  ],
  'a48051f3-1dbf-4f3b-98ed-81f1df584e5e': [['poptavka_odeslana', 1]],
  '4d7d4cb1-3ab9-4688-aa98-43c45d8e4067': [
    ['order_created', 0.6],
    ['invoice_download', 0.4],
  ],
  '9f32713b-d1b8-4632-9793-bcbc561a97dd': [
    ['route_started', 0.5],
    ['gpx_download', 0.3],
    ['share_click', 0.2],
  ],
  '15945b97-945d-4fc8-b287-dc092cfbac3f': [['map_open', 1]],
};
export const REFERRERS: Weighted = [
  [null, 0.46],
  ['google.com', 0.21],
  ['github.com', 0.09],
  ['seznam.cz', 0.08],
  ['linkedin.com', 0.06],
  ['duckduckgo.com', 0.04],
  ['t.co', 0.025],
  ['news.ycombinator.com', 0.02],
  ['reddit.com', 0.015],
];
export const COUNTRIES: Weighted = [
  ['CZ', 0.52],
  ['DE', 0.09],
  ['US', 0.08],
  ['SK', 0.07],
  ['GB', 0.04],
  ['AT', 0.03],
  ['PL', 0.03],
  ['NL', 0.03],
  ['FR', 0.02],
  ['CH', 0.02],
  ['IE', 0.012],
  ['SE', 0.01],
  ['ES', 0.01],
  ['IT', 0.01],
  ['CA', 0.01],
  ['JP', 0.006],
  ['IN', 0.006],
  ['BR', 0.005],
  ['AU', 0.005],
  ['UA', 0.005],
  ['NO', 0.004],
  ['FI', 0.004],
  ['PT', 0.003],
  ['MX', 0.003],
  ['ZA', 0.002],
];
export const BROWSERS: Weighted = [
  ['Chrome', 0.56],
  ['Safari', 0.24],
  ['Firefox', 0.08],
  ['Edge', 0.08],
  ['Samsung Internet', 0.02],
  ['Opera', 0.01],
  ['Other', 0.01],
];
export const OSES: Weighted = [
  ['Windows', 0.34],
  ['macOS', 0.22],
  ['iOS', 0.2],
  ['Android', 0.17],
  ['Linux', 0.05],
  ['ChromeOS', 0.01],
  ['iPadOS', 0.01],
];
const DEVICES: Weighted = [
  ['desktop', 0.58],
  ['mobile', 0.38],
  ['tablet', 0.04],
];
const LANGUAGES: Weighted = [
  ['cs-CZ', 0.5],
  ['en-US', 0.2],
  ['de-DE', 0.08],
  ['en-GB', 0.07],
  ['sk-SK', 0.06],
  ['pl-PL', 0.03],
  ['fr-FR', 0.02],
  ['nl-NL', 0.02],
  ['es-ES', 0.015],
  ['uk-UA', 0.005],
];
const SCREENS: Weighted = [
  ['1920x1080', 0.26],
  ['1440x900', 0.14],
  ['390x844', 0.13],
  ['1536x864', 0.12],
  ['360x800', 0.1],
  ['412x915', 0.08],
  ['2560x1440', 0.07],
  ['1366x768', 0.06],
  ['768x1024', 0.04],
];

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });

function merge(lists: { weights: Weighted; scale: number }[]): [string | null, number][] {
  const map = new Map<string | null, number>();
  for (const { weights, scale } of lists)
    for (const [k, w] of weights) map.set(k, (map.get(k) ?? 0) + w * scale);
  return [...map];
}

export function breakdown(
  site: string,
  period: Period,
  dim: Dim,
  limit: number,
  now = Date.now(),
): Breakdown {
  const ids = siteIdsFor(site);
  const r = buildRange(period, now);
  const cur = series(ids, r.starts, r.to, now);
  const total = totals(ids, cur, r.bucket, `${site}|${period}|c`);
  const random = rng(hash(`${site}|${period}|${dim}`));

  let items: [string | null, number][];
  if (dim === 'sites') {
    items = SITES.map(
      (s) => [s.id, sumBucket([s.id], r.starts[0], r.to, now).v] as [string, number],
    );
  } else if (dim === 'pages' || dim === 'entries' || dim === 'exits' || dim === 'events') {
    const table = dim === 'events' ? EVENTS : PAGES;
    const siteWeights = ids.map((id) => BASE[id]);
    const wsum = siteWeights.reduce((a, b) => a + b, 0) || 1;
    items = merge(ids.map((id, i) => ({ weights: table[id], scale: siteWeights[i] / wsum })));
    if (dim === 'entries') items = items.map(([k, w]) => [k, k === '/' ? w * 1.5 : w * 0.7]);
    if (dim === 'exits')
      items = items.map(([k, w]) => [k, k === '/' ? w * 0.8 : w * (0.8 + random() * 0.6)]);
  } else {
    const table: Weighted =
      {
        referrers: REFERRERS,
        countries: COUNTRIES,
        browsers: BROWSERS,
        os: OSES,
        devices: DEVICES,
        languages: LANGUAGES,
        screens: SCREENS,
      }[dim] ?? [];
    items = table.map(([k, w]) => [k, w]);
  }

  const weightSum = items.reduce((a, [, w]) => a + w, 0) || 1;
  const sitesDim = dim === 'sites';
  const rows: Row[] = items
    .map(([key, w]) => {
      // Sites are measured, not modelled: their distinct visitors add up to the total.
      const visitors = sitesDim
        ? Math.round(w * UNIQUE[r.bucket])
        : Math.round(total.visitors * (w / weightSum) * (0.85 + 0.3 * random()));
      const perVisitor = dim === 'events' ? 1.4 : dim === 'pages' ? 1.5 : 1.1;
      return {
        key,
        label: labelFor(dim, key),
        visitors,
        count: Math.round(visitors * perVisitor * (0.9 + 0.3 * random())),
        share: 0,
      };
    })
    .filter((row) => row.visitors > 0);
  // The sites panel's shares sum to 1; the other lists are shares of the period's total visitors.
  const shareBase = sitesDim ? rows.reduce((a, row) => a + row.visitors, 0) : total.visitors;
  for (const row of rows) row.share = shareBase ? Math.min(1, row.visitors / shareBase) : 0;
  // The Events panel ranks by its displayed count; every other list ranks by visitors.
  const by = dim === 'events' ? 'count' : 'visitors';
  rows.sort((a, b) => b[by] - a[by]);
  rows.length = Math.min(rows.length, limit);

  return { dim, totalVisitors: total.visitors, rows };
}

function labelFor(dim: Dim, key: string | null): string {
  if (key === null) return 'Direct';
  if (dim === 'sites') return SITES.find((s) => s.id === key)?.name ?? key;
  if (dim === 'countries') return regionNames.of(key) ?? key;
  return key;
}

export function newSiteId(): string {
  return crypto.randomUUID();
}
