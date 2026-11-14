import { Live, LiveEvent } from '../core/api';
import { LiveStream } from '../core/live';
import { BASE, BROWSERS, COUNTRIES, REFERRERS, SITES, iso } from './mock-data';
import { hash, pickWeighted, rng } from './rng';

const random = rng(hash('live'));

const PATHS: Record<string, string[]> = {
  'ac198dbf-3b47-41c5-ac40-8b92f6143b8d': [
    '/',
    '/projects',
    '/blog',
    '/blog/angular-signals-in-anger',
    '/about',
    '/status',
  ],
  '171ace70-dd73-4c05-a1d4-0c72761da28a': [
    '/',
    '/cenik',
    '/realizace',
    '/sluzby',
    '/poptavka',
    '/kontakt',
  ],
  'a48051f3-1dbf-4f3b-98ed-81f1df584e5e': ['/', '/cenik'],
  '4d7d4cb1-3ab9-4688-aa98-43c45d8e4067': ['/login', '/dashboard', '/objednavky'],
  '9f32713b-d1b8-4632-9793-bcbc561a97dd': ['/', '/routes', '/routes/12', '/routes/34', '/download'],
  '15945b97-945d-4fc8-b287-dc092cfbac3f': ['/', '/map'],
};
const EVENT_NAMES: Record<string, string[]> = {
  'ac198dbf-3b47-41c5-ac40-8b92f6143b8d': ['cv_download', 'contact_click'],
  '171ace70-dd73-4c05-a1d4-0c72761da28a': ['poptavka_odeslana', 'telefon_klik'],
  'a48051f3-1dbf-4f3b-98ed-81f1df584e5e': ['poptavka_odeslana'],
  '4d7d4cb1-3ab9-4688-aa98-43c45d8e4067': ['order_created'],
  '9f32713b-d1b8-4632-9793-bcbc561a97dd': ['route_started', 'gpx_download'],
  '15945b97-945d-4fc8-b287-dc092cfbac3f': ['map_open'],
};
const PLATFORMS: [string, string, string][] = [
  ['Chrome', 'Windows', 'desktop'],
  ['Edge', 'Windows', 'desktop'],
  ['Safari', 'macOS', 'desktop'],
  ['Chrome', 'macOS', 'desktop'],
  ['Firefox', 'Linux', 'desktop'],
  ['Safari', 'iOS', 'mobile'],
  ['Chrome', 'Android', 'mobile'],
  ['Samsung Internet', 'Android', 'mobile'],
];

function makeEvent(ts: number, siteId?: string): LiveEvent {
  const id =
    siteId ??
    pickWeighted(
      SITES.map((s) => [s.id, BASE[s.id]] as const),
      random,
    );
  const [browser, os, device] = PLATFORMS[Math.floor(random() * PLATFORMS.length)];
  const isEvent = random() < 0.08;
  const paths = PATHS[id];
  return {
    siteId: id,
    ts: iso(ts),
    kind: isEvent ? 'event' : 'pageview',
    name: isEvent ? EVENT_NAMES[id][Math.floor(random() * EVENT_NAMES[id].length)] : null,
    path: paths[Math.floor(random() * paths.length)],
    country: random() < 0.04 ? null : (pickWeighted(COUNTRIES, random) as string),
    browser: browser ?? pickWeighted(BROWSERS, random)!,
    os,
    device,
    referrer: pickWeighted(REFERRERS, random),
  };
}

/** Shared by the /api/live snapshot and the fake stream so they never disagree. */
const recent: LiveEvent[] = [];
for (let i = 0, at = Date.now() - 3_000; i < 50; i++, at -= 6_000 + random() * 24_000)
  recent.push(makeEvent(at));
const bumped = new Map<string, number>();

export function liveSnapshot(): Live {
  const now = Date.now();
  const perSite = SITES.map((s) => {
    const base = Math.max(
      0,
      Math.round(
        (BASE[s.id] / 14) * (0.6 + 0.8 * rng(hash(`${s.id}${Math.floor(now / 20_000)}`))()),
      ),
    );
    return { siteId: s.id, active: Math.max(base, bumped.get(s.id) ?? 0) };
  });
  return {
    activeVisitors: perSite.reduce((a, p) => a + p.active, 0),
    perSite,
    recent: recent.slice(0, 50),
  };
}

/** Stands in for EventSource: emits a hit every 2-6 s and a ping every 15 s, like the real endpoint. */
export class MockLiveStream implements LiveStream {
  readyState = 0;
  private readonly target = new EventTarget();
  private readonly timers: ReturnType<typeof setTimeout>[] = [];
  private pingTimer: ReturnType<typeof setInterval>;

  constructor(readonly url: string) {
    this.timers.push(
      setTimeout(() => {
        this.readyState = 1;
        this.target.dispatchEvent(new Event('open'));
        this.scheduleHit();
      }, 250),
    );
    this.pingTimer = setInterval(
      () => this.target.dispatchEvent(new MessageEvent('ping', { data: '' })),
      15_000,
    );
  }

  addEventListener(type: string, listener: (event: Event) => void): void {
    this.target.addEventListener(type, listener);
  }

  close(): void {
    this.readyState = 2;
    this.timers.forEach(clearTimeout);
    clearInterval(this.pingTimer);
  }

  private scheduleHit(): void {
    this.timers.push(
      setTimeout(
        () => {
          if (this.readyState !== 1) return;
          const hit = makeEvent(Date.now());
          recent.unshift(hit);
          recent.length = Math.min(recent.length, 60);
          bumped.set(hit.siteId, (bumped.get(hit.siteId) ?? 0) + 1);
          setTimeout(
            () => bumped.set(hit.siteId, Math.max(0, (bumped.get(hit.siteId) ?? 1) - 1)),
            60_000,
          );
          this.target.dispatchEvent(new MessageEvent('hit', { data: JSON.stringify(hit) }));
          this.scheduleHit();
        },
        1800 + Math.random() * 4200,
      ),
    );
  }
}
