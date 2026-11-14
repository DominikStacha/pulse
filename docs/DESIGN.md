# Pulse — design

Own, self-hosted, cookieless web analytics plus the Raspberry Pi health dashboard,
in one app at **https://stats.stacha.tech**. Replaces Umami 3.5.0 (2026-11-14).

## Why

The owner wants one good-looking place for visitor stats of all his sites and the
health of the Pi, instead of Umami's UI plus the `/status` page on stacha.tech.

## Goals

- Collect pageviews and custom events from all sites, cookieless, no consent banner.
- A polished, animated, modern SPA dashboard: analytics overview, live view, Pi status, sites.
- Drop-in replacement for Umami's tracker: **no site needs a change** to switch.
- Small on the Pi (one container, target < 120 MB RAM, SQLite, no extra DB server).

## Non-goals

- Session replay, heatmaps, per-visitor journeys or profiles, user identification.
- Alerting (stays in `pi-monitor`), Grafana/Prometheus for spanelstinadokapsy.
- City-level geo, UTM campaigns (sites send `data-exclude-search`, so no query strings arrive).
- Importing Umami history (it holds 5 events from 2026-11-14).

## Anti-goals (failure even if it "works")

- Anything that breaks the published privacy promises (saliny `privacy.html`,
  spanelstinadokapsy legal pages): sets no cookies, stores nothing on the device,
  stores **no IP address (only an anonymous hash that changes monthly)**, shares
  nothing with third parties, deletes data after **25 months**, records only the path
  of a page address, never its query string.
- A dashboard reachable without Cloudflare Access.
- Breaking a live site (tracker errors, CSP violations, blocking the page).

## Approaches considered

1. Own dashboard on top of Umami's data — keeps Umami collecting. Rejected by the owner.
2. **Replace Umami completely (chosen):** own tracker, collector, storage and dashboard.
3. Fork and reskin Umami — every upgrade becomes a merge fight. Dropped.

## Architecture

```
site page ── <script src="https://stacha.tech/a/script.js" data-website-id=…>
   │  POST https://stacha.tech/a/api/send  (JSON, Umami payload shape)
   ▼
stacha-tech-web nginx (exact-match /a/script.js, /a/api/send; rate limit 10 r/s/IP, 16 kB)
   │  proxy_pass http://analytics-umami:3000/{script.js,api/send}
   ▼                                       (Docker DNS, resolver re-resolves every 30 s)
pulse container  ── network alias `analytics-umami` on `stachatech_default`, port 3000
   ├─ ASP.NET Core 11 minimal API + static Angular SPA (wwwroot)
   ├─ SQLite /data/pulse.db (WAL)
   └─ /status (bind mount ~/pi-status, read-only): status.json, history.json
   ▲
stats.stacha.tech ── Cloudflare tunnel `stacha-tech` → http://analytics-umami:3000
                     (Cloudflare Access app, owner e-mail only)
```

**Cut-over without touching stacha.tech or Cloudflare:** nginx and the tunnel already
address `analytics-umami:3000`. Pulse joins `stachatech_default` with that alias and
listens on 3000; stopping the Umami container moves the name. Rollback = stop pulse,
start `analytics-umami`. Later, stacha.tech's nginx and the tunnel rule get renamed to
`pulse` and the alias goes away.

## Stack (owner handed over the "how")

- Backend: .NET 11 (SDK 11.0.100, `net11.0`), ASP.NET Core minimal API,
  `Microsoft.Data.Sqlite` + Dapper, xUnit tests. Workstation, non-concurrent GC to keep RAM low.
- Frontend: Angular 22.2.x standalone + zoneless + signals, TypeScript 6.0, Tailwind CSS 4,
  vitest. Charts hand-built in SVG (no chart library); world map with `d3-geo` +
  `topojson-client` + `world-atlas` (110m), lazy-loaded. Fonts self-hosted (`@fontsource`),
  never Google Fonts. pnpm via corepack 0.36.0, Node 26.
- Tracker: plain ES2017 `tracker/script.js`, no build step, tested with vitest + jsdom.
- One Docker image (linux/arm64 for the Pi), multi-stage: Node build → dotnet publish →
  `mcr.microsoft.com/dotnet/aspnet:11.0` runtime.

## Privacy model

- **Visitor id** = first 8 bytes of SHA-256(`monthSalt ‖ siteId ‖ ip ‖ userAgent`), as a
  signed int64. Per site, so the same person on two sites is not linkable.
- **Month salt:** 32 random bytes, stored in table `salts(month TEXT PK, salt BLOB)`, created on
  first use in a month (UTC); salts of earlier months are **deleted** at rotation, so old
  ids can never be recomputed. This matches the published "anonymous hash that changes monthly".
- IP comes from `CF-Connecting-IP` (set by nginx), fallback first `X-Forwarded-For`, fallback
  the socket address. It is used for the hash only, never stored or logged.
- Country from Cloudflare's `CF-IPCountry` header (ISO-2; `XX`/`T1` → null). No GeoIP database.
- URL: only the **path** is stored (query and hash dropped server-side too, whatever the client sends).
  Referrer: only the **host name**, and none when it equals the page's own host.
- Retention: a daily job deletes events older than 25 months.
- Ingest logging: no request logging of `/api/send` (no IPs in logs).

## Ingestion — `POST /api/send` (public, via nginx)

Umami-compatible body:

```json
{ "type": "event",
  "payload": { "website": "uuid", "hostname": "klettr.com", "url": "/routes/12?x=1",
               "referrer": "https://www.google.com/", "title": "…", "screen": "1440x900",
               "language": "cs-CZ", "name": "cv_download", "data": { "language": "en" }, "tag": null } }
```

- `type` other than `event` (e.g. `identify`) → `204`, nothing stored. Never store identities.
- `payload.name` absent → **pageview**; present → **custom event** (`name` ≤ 50 chars).
- Drop (`204`, not stored) when: unknown site id; `hostname` is neither the site's domain nor a
  subdomain of it; bot user agent (bot|crawl|spider|slurp|headless|lighthouse|pingdom|uptime|
  monitor|preview|python|curl|wget|httpclient|go-http|java/|okhttp|facebookexternalhit|…);
  empty user agent.
- Malformed JSON / missing website → `400`. Bodies > 16 kB → `413`.
- Field limits (truncate): path 500, title 200, event data JSON 2 kB (drop data if larger),
  language 35, screen 20.
- **Visit** (session): same visitor and site with the previous event < 30 min ago → same
  `visit` id, else a new random int64. Look-up: last event of `(site, visitor)` via index.
- Response `200 {"ok":true}`. CORS: `Access-Control-Allow-Origin: *`, methods `POST, OPTIONS`,
  header `Content-Type`; `OPTIONS` → `204`. No credentials.
- Device/browser/OS parsed from the User-Agent by a small in-house parser:
  browser ∈ Chrome, Safari, Firefox, Edge, Opera, Samsung Internet, Other;
  os ∈ iOS, iPadOS, Android, macOS, Windows, Linux, ChromeOS, Other;
  device ∈ mobile, tablet, desktop (UA first; screen width < 768 → mobile as tie-breaker).

## Storage (SQLite)

```sql
sites  (id TEXT PK, name TEXT, domain TEXT UNIQUE, created_at INTEGER)
salts  (month TEXT PK, salt BLOB)
events (id INTEGER PK, site_id TEXT, ts INTEGER /*unix ms*/, visitor INTEGER, visit INTEGER,
        kind INTEGER /*1 pageview, 2 event*/, name TEXT, path TEXT, title TEXT, referrer TEXT,
        country TEXT, browser TEXT, os TEXT, device TEXT, screen TEXT, language TEXT, data TEXT)
INDEX events(site_id, ts);  INDEX events(site_id, visitor, ts)
```

Seeded on first start from `PULSE_SEED_SITES` (JSON) or the built-in list of the 6 current
sites, **keeping Umami's ids** so embedded snippets keep working:

| id | name / domain |
|---|---|
| ac198dbf-3b47-41c5-ac40-8b92f6143b8d | stacha.tech |
| 171ace70-dd73-4c05-a1d4-0c72761da28a | spanelstinadokapsy.cz |
| a48051f3-1dbf-4f3b-98ed-81f1df584e5e | new.spanelstinadokapsy.cz |
| 4d7d4cb1-3ab9-4688-aa98-43c45d8e4067 | portal.spanelstinadokapsy.cz |
| 9f32713b-d1b8-4632-9793-bcbc561a97dd | klettr.com |
| 15945b97-945d-4fc8-b287-dc092cfbac3f | saliny.stacha.tech |

## Metrics (definitions)

- **Visitors** = distinct visitor ids in the range. **Visits** = distinct visit ids.
  **Pageviews** = events with kind 1. **Events** = kind 2.
- **Bounce rate** = visits with exactly one event (any kind) ÷ visits.
- **Avg visit duration** = mean over visits of (last ts − first ts), seconds; one-event visits count as 0.
- **Entry / exit page** = path of the first / last pageview of a visit.
- **Active now** = distinct visitors with an event in the last 5 minutes.

## Periods

`period` ∈ `today | 24h | 7d | 30d | 90d | 12m`, time zone `Europe/Prague` (override `tz`).
`today`: local midnight → now, hourly buckets. `24h`: now−24 h → now, hourly. `7d|30d|90d`:
the last N local days including today, daily. `12m`: the last 12 calendar months including
the current one, monthly. **Previous** = the window of equal length right before.
Bucketing is done in C# over the rows of the range (time-zone and DST correct).
`ponytail:` reads all rows in range; add daily roll-ups if 12m gets slow.

## Dashboard API (Cloudflare Access required in Production)

All `/api/*` except `/api/send` need a valid `Cf-Access-Jwt-Assertion` JWT: RS256, signed by
a key from `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` (cached, refreshed on
unknown `kid`), `iss` = `https://<team>.cloudflareaccess.com`, `aud` contains `PULSE_ACCESS_AUD`.
Config: `PULSE_ACCESS_TEAM_DOMAIN`, `PULSE_ACCESS_AUD`. In Production a missing config makes the
app **refuse to start**. `Pulse:Auth:Disabled=true` is honoured only in Development.
Unauthenticated → `401`. `GET /healthz` is public (`200 ok`).

Common query: `site` = a site id or `all` (default `all`), `period` (default `7d`), `tz`.

```ts
// GET /api/sites
type Site = { id: string; name: string; domain: string; createdAt: string };
// POST /api/sites  { name, domain }  → 201 Site   (domain: lowercase host, validated)

// GET /api/stats/summary
type Totals = { visitors: number; visits: number; pageviews: number; events: number;
                bounceRate: number /*0-1*/; avgVisitSeconds: number };
type Summary = { range: { from: string; to: string; previousFrom: string; previousTo: string;
                          bucket: 'hour' | 'day' | 'month'; tz: string };
                 current: Totals; previous: Totals };

// GET /api/stats/timeseries
type Point = { t: string /*bucket start, ISO with offset*/; visitors: number; visits: number; pageviews: number };
type Timeseries = { bucket: 'hour' | 'day' | 'month'; points: Point[]; previous: Point[] };
// points and previous have the same length; empty buckets are present with zeros.

// GET /api/stats/breakdown?dim=…&limit=10
// dim ∈ pages | entries | exits | referrers | countries | browsers | os | devices |
//       languages | screens | events | sites
type Row = { key: string | null /*null = (none), e.g. direct traffic*/; label: string;
             visitors: number; count: number /*pageviews, or event count for dim=events*/; share: number /*visitors ÷ total visitors, 0-1*/ };
type Breakdown = { dim: string; totalVisitors: number; rows: Row[] };
// sites: key = site id, label = site name. countries: key = ISO-2, label = English name.

// GET /api/live   — snapshot
type LiveEvent = { siteId: string; ts: string; kind: 'pageview' | 'event'; name: string | null;
                   path: string; country: string | null; browser: string; os: string; device: string;
                   referrer: string | null };
type Live = { activeVisitors: number; perSite: { siteId: string; active: number }[]; recent: LiveEvent[] /*last 50, newest first*/ };

// GET /api/live/stream — text/event-stream; `event: hit` with a LiveEvent as data for every
// stored event; `event: ping` every 15 s; `retry: 3000`. No visitor or visit ids ever leave the server.

// GET /api/status          — ~/pi-status/status.json verbatim (503 {error} when missing)
// GET /api/status/history  — ~/pi-status/history.json verbatim
//   fields: ["t","load1","memUsedBytes","diskUsedBytes","temperatureC"], 1/min, 24 h
//   (schema: stacha.tech src/app/core/models/health.model.ts, collector scripts/pi-status/collect-status.py)
```

## Tracker — `GET /script.js`

Umami-compatible attributes on its `<script>` tag: `data-website-id` (required),
`data-host-url` (default: the script URL's directory, so `https://stacha.tech/a/script.js`
posts to `https://stacha.tech/a/api/send`), `data-auto-track` (default `true`),
`data-domains` (comma list; elsewhere do nothing), `data-exclude-search`, `data-exclude-hash`,
`data-do-not-track` (honour `navigator.doNotTrack`), `data-before-send` (name of a global
function `(type, payload) => payload | falsy`; falsy cancels), `data-tag`.

- Opt-out: `localStorage.getItem('umami.disabled')` truthy → do nothing (read only, in try/catch;
  sites' privacy pages document this key). Never write storage or cookies.
- Auto-track: one pageview on load, then on `history.pushState` / `replaceState` / `popstate`
  when the URL (path, plus search/hash unless excluded) changed. Referrer: `document.referrer`
  on the first view, the previous URL afterwards.
- API: `window.umami.track()` (pageview), `.track(name, data?)` (event), `.track(object)` (raw
  payload fields merged), `.track(fn)` (fn(defaultPayload) → payload). `window.pulse` = same object.
- Send: `fetch(endpoint, { method: 'POST', body: JSON, keepalive: true, credentials: 'omit',
  headers: { 'Content-Type': 'application/json' } })`, errors swallowed. Never throws into the page.
- Served with `Cache-Control: public, max-age=3600`, `Content-Type: text/javascript`.

## Dashboard UX (the point of the app)

Dark-first, modern, animated; must also work on a phone. Pages:

1. **Overview** `/` — site switcher (All sites + each site with its favicon), period picker,
   live "● N online" pill. KPI cards (Visitors, Visits, Pageviews, Bounce rate, Avg visit) with
   count-up numbers, delta vs previous period and a mini sparkline. Big animated area chart
   (visitors + pageviews, previous period as a ghost line, crosshair tooltip). Panels with
   animated bars: Pages / Entry / Exit (tabs), Referrers, Countries (choropleth map + list with
   flags), Browsers / OS / Devices (tabs), Languages, Events, and Sites (in "All sites").
2. **Live** `/live` — big active-visitor counter, per-site live counts, map with pulses where hits
   land, a streaming feed of hits (SSE) with enter animations.
3. **Status** `/status` — the Pi: overall badge, vitals (CPU load, memory, disk, temperature,
   power, uptime) with gauges and 24 h sparklines, container grid with severity and filters,
   stale-snapshot detection. Port the logic of stacha.tech's `health.model.ts` (with its spec).
4. **Sites** `/sites` — list with embed snippet (copy button), add a site.

Motion: route transitions (View Transitions API), staggered card entrance, number count-up,
chart draw-in, hover states. Respect `prefers-reduced-motion`. State of site + period lives in
the URL query (`?site=…&period=…`) so views are linkable and survive reload.

## Testing

- Backend: ingestion rules (accept, each drop reason, identify ignored, limits, CORS), visitor
  hash + monthly salt rotation (old salt deleted), visit splitting at 30 min, every metric and
  breakdown on a fixture, period/bucket math incl. DST days, Access JWT validation (valid,
  wrong aud, wrong iss, expired, unknown kid, missing), retention, status passthrough.
- Tracker: attributes, opt-out, DNT, domains, exclude search/hash, before-send, SPA navigation,
  `track` overloads, never throws.
- Frontend: health model spec (ported), period/format helpers, chart scaling, key components.
- End-to-end: the production image run locally with synthetic data, every page checked in a
  browser on desktop and phone widths.

## Deploy (Pi)

`~/pulse/docker-compose.yml`, image `pulse:latest` built on the Mac for linux/arm64,
volumes `./data:/data` and `~/pi-status:/status:ro`, network `stachatech_default` (external)
with alias `analytics-umami`, `restart: unless-stopped`, env file `~/pulse/.env` (Access team
domain + AUD). Cut-over: start pulse, `docker stop analytics-umami analytics-db` (kept for
rollback), verify `/a/script.js`, a test hit, `/healthz`; remove the Umami retention cron line.
