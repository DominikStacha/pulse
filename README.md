# Pulse

Own cookieless web analytics plus the Raspberry Pi health dashboard, in one app at
**https://stats.stacha.tech** (Cloudflare Access, owner only). Replaced Umami on 2026-11-15.

- **Tracker** `tracker/script.js`, served at `https://stacha.tech/a/script.js`. Drop-in compatible
  with Umami's tag (`data-website-id`, `data-domains`, `data-before-send`, `window.umami.track`).
- **Collector + API** `src/Pulse.Api`: .NET 11 minimal API, SQLite (`/data/pulse.db`).
- **Dashboard** `web/`: Angular 22 (Overview, Live, Pi status, Sites).

Design, privacy model and API contract: [docs/DESIGN.md](docs/DESIGN.md). Deploy: [docs/DEPLOY.md](docs/DEPLOY.md).

## Privacy, in one paragraph

No cookies, nothing written to the visitor's device (the tracker only reads the opt-out key
`localStorage['umami.disabled']`). No IP address is stored or logged: a visitor is a per-site
SHA-256 hash of a monthly salt, the IP and the user agent, and the salt of the previous month is
deleted. Only the path of a URL is stored, the referrer only as a host name, the country comes
from Cloudflare. Events older than 25 months are deleted daily.

## Add a site

Sites → *Add a site* in the dashboard, then put the shown tag into the site's `<head>`:

```html
<script defer src="https://stacha.tech/a/script.js" data-website-id="…"></script>
```

and allow `script-src https://stacha.tech; connect-src https://stacha.tech` in its CSP.
Custom events: `window.umami?.track('name', { optional: 'data' })`.

## Develop

```bash
export PATH="$HOME/.dotnet:$PATH" DOTNET_ROOT="$HOME/.dotnet"

# API on :5190 with synthetic demo data (Development only), auth off
cd src/Pulse.Api
export Pulse__DbPath=/tmp/pulse-dev.db Pulse__Auth__Disabled=true
dotnet run -- seed-demo --days 120 --reset
dotnet run -- seed-demo --live          # API + a synthetic hit every few seconds

# dashboard on :4290, proxies /api and /script.js to :5190
cd web && pnpm install && pnpm start     # or `pnpm start:mock` without any backend

# tests
dotnet test                              # backend
(cd tracker && pnpm install && pnpm test)
(cd web && pnpm test)
```
