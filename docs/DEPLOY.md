# Deploy (Raspberry Pi)

Pulse runs as container `pulse` from `~/pulse/docker-compose.yml` (copy of
`deploy/docker-compose.yml`) on the Pi. The image is built on the Mac (Apple Silicon builds
linux/arm64 natively) and shipped as a tarball. Data lives in `~/pulse/data/pulse.db`.

## How traffic reaches it

| From | Path | To |
|---|---|---|
| Sites (public) | `https://stacha.tech/a/script.js`, `/a/api/send` | stacha.tech nginx → `http://analytics-umami:3000/{script.js,api/send}` |
| Owner | `https://stats.stacha.tech` | Cloudflare tunnel `stacha-tech` → `http://analytics-umami:3000` (Access app "Analytics (Umami)") |

`analytics-umami` is a **network alias** of the pulse container on `stachatech_default`, kept from
the Umami days so nothing in stacha.tech or Cloudflare had to change. To retire it: point
`nginx.conf` (`set $umami http://pulse:3000;`) and the tunnel rule at `pulse:3000`, deploy
stacha.tech, then drop the alias from the compose file.

## Ship a new version

```bash
# on the Mac, in the repo
docker buildx build --platform linux/arm64 -t pulse:latest --load .
docker save pulse:latest | gzip > /tmp/pulse.tar.gz
scp /tmp/pulse.tar.gz ssh.stacha.tech:/tmp/

# on the Pi
ssh ssh.stacha.tech
docker tag pulse:latest pulse:previous 2>/dev/null   # rollback point
gunzip -c /tmp/pulse.tar.gz | docker load && rm /tmp/pulse.tar.gz
cd ~/pulse && DOCKER_API_VERSION=1.41 docker compose up -d
docker logs --tail 20 pulse
curl -s -o /dev/null -w '%{http_code}\n' https://stacha.tech/a/script.js   # 200
```

Rollback: `docker tag pulse:previous pulse:latest && cd ~/pulse && DOCKER_API_VERSION=1.41 docker compose up -d`.

## Configuration (`~/pulse/.env`)

```
PULSE_ACCESS_TEAM_DOMAIN=spanelstinadokapsy.cloudflareaccess.com
PULSE_ACCESS_AUD=<AUD tag of the Access app covering stats.stacha.tech>
```

Without both, the container refuses to start (the dashboard API must never be open).

## Backup / restore

```bash
# backup (consistent copy while running)
docker run --rm -v ~/pulse/data:/data -v ~/backups:/b alpine:3.20 \
  sh -c 'apk add -q sqlite && sqlite3 /data/pulse.db ".backup /b/pulse-$(date +%Y%m%d).db"'
# restore
cd ~/pulse && docker compose stop pulse && cp ~/backups/pulse-YYYYMMDD.db data/pulse.db && docker compose up -d
```

## Back to Umami (emergency)

Umami's stack is stopped, not removed (`~/analytics`). `docker stop pulse`, then
`cd ~/analytics && docker compose up -d`. The `analytics-umami` name moves back within 30 s.
