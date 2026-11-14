import { HttpErrorResponse, HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { Observable, delay, of, throwError } from 'rxjs';
import { Dim, Site } from '../core/api';
import { parsePeriod } from '../core/period';
import { SITES, breakdown, newSiteId, setMockFlags, summary, timeseries } from './mock-data';
import { liveSnapshot } from './mock-live';
import { statusHistory, statusSnapshot } from './mock-status';

/**
 * Dev-only fake of the whole dashboard API (see docs/DESIGN.md). Behaviour can be
 * bent from the browser console with localStorage.pulseMock = "fail,slow,empty,stale,down,warn,nostatus".
 */
const sites: Site[] = [...SITES];

function flags(): Set<string> {
  try {
    const raw = localStorage.getItem('pulseMock') ?? '';
    return new Set(
      raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
  } catch {
    return new Set();
  }
}

export const mockApiInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith('/api/')) return next(req);

  const f = flags();
  setMockFlags(f);
  const url = new URL(req.urlWithParams, 'http://mock.local');
  const path = url.pathname;
  const q = url.searchParams;
  const latency = f.has('slow') ? 2200 : 110 + Math.random() * 260;

  const ok = <T>(body: T, status = 200): Observable<HttpResponse<T>> =>
    of(new HttpResponse({ status, body })).pipe(delay(latency));
  const fail = (status: number, error: unknown): Observable<never> =>
    throwError(() => new HttpErrorResponse({ status, error, url: req.url })).pipe(
      delay(latency),
    ) as Observable<never>;

  if (path.startsWith('/api/stats/') && f.has('fail')) return fail(500, { error: 'mock failure' });

  const site = q.get('site') ?? 'all';
  const period = parsePeriod(q.get('period'));

  switch (true) {
    case path === '/api/sites' && req.method === 'GET':
      return ok(sites);
    case path === '/api/sites' && req.method === 'POST': {
      const { name, domain } = req.body as { name: string; domain: string };
      if (sites.some((s) => s.domain === domain))
        return fail(409, { error: 'domain already exists' });
      if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(domain))
        return fail(400, { error: 'domain must be a lowercase host name' });
      const created: Site = { id: newSiteId(), name, domain, createdAt: new Date().toISOString() };
      sites.push(created);
      return ok(created, 201);
    }
    case path === '/api/stats/summary':
      return ok(summary(site, period));
    case path === '/api/stats/timeseries':
      return ok(timeseries(site, period));
    case path === '/api/stats/breakdown':
      return ok(
        breakdown(
          site,
          period,
          (q.get('dim') ?? 'pages') as Dim,
          Math.min(250, +(q.get('limit') ?? 10)),
        ),
      );
    case path === '/api/live':
      return ok(liveSnapshot());
    case path === '/api/status':
      return f.has('nostatus')
        ? fail(503, { error: 'status.json not found' })
        : ok(statusSnapshot(Date.now(), f));
    case path === '/api/status/history':
      return f.has('nostatus')
        ? fail(503, { error: 'history.json not found' })
        : ok(statusHistory(Date.now()));
    default:
      return fail(404, { error: `no mock for ${req.method} ${path}` });
  }
};
