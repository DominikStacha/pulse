# Pulse web

The dashboard SPA for Pulse: Angular 22 (standalone, zoneless, signals), Tailwind CSS 4,
hand-built SVG charts. The contract it codes against is `docs/DESIGN.md` ("Dashboard API").

```bash
corepack enable && pnpm install

pnpm start:mock    # http://127.0.0.1:4290 with a fake API and a fake live stream (no backend needed)
pnpm start         # http://127.0.0.1:4290, /api and /script.js proxied to the backend on :5190
pnpm test          # vitest, via `ng test`
pnpm build         # production build -> dist/browser (copied to the API's wwwroot by the Docker build)
```

## Mock mode

`ng serve --configuration mock` swaps `src/app/dev-mock.ts` for `dev-mock.mock.ts`
(angular.json `fileReplacements`), which installs an HTTP interceptor and a fake `EventSource`.
Nothing under `src/app/mock/` is reachable from the production bundle.

Bend the fake API from the browser console: `localStorage.pulseMock = 'fail,slow,empty,stale,down,warn,nostatus'`
(any comma separated subset), then reload. Remove the key to go back to normal.

## Layout

- `core/` API types, period + format helpers, the ported Pi health model, services (URL state, live stream, status polling)
- `ui/` presentational pieces: charts (`area-chart`, `sparkline`, `gauge`, `world-map`), `bar-list`, `segmented`, the shell bits
- `pages/` Overview, Live, Status, Sites (lazy routes)
- `mock/` dev-only fake backend
