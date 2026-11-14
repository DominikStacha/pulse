import { ContainerStatus, HealthSnapshot, HistorySnapshot } from '../core/health.model';

const MiB = 1024 ** 2;
const GiB = 1024 ** 3;
const HOUR = 3600_000;

interface Spec {
  name: string;
  image: string;
  upHours: number | null; // null = stopped
  stoppedHoursAgo?: number;
  policy: 'unless-stopped' | 'always' | 'no';
  mem?: number;
  limit?: number;
  ports?: string[];
  exit?: number;
  health?: string | null;
  restarts?: number;
}

const SPECS: Spec[] = [
  {
    name: 'pulse',
    image: 'pulse:latest',
    upHours: 2,
    policy: 'unless-stopped',
    mem: 71 * MiB,
    limit: 256 * MiB,
    ports: ['3000->3000/tcp'],
    health: 'healthy',
  },
  {
    name: 'stacha-tech-web',
    image: 'stacha-tech-web:latest',
    upHours: 96,
    policy: 'unless-stopped',
    mem: 14 * MiB,
    limit: 64 * MiB,
    ports: ['1997->8080/tcp'],
    health: 'healthy',
  },
  {
    name: 'cloudflared',
    image: 'cloudflare/cloudflared:2026.10.0',
    upHours: 410,
    policy: 'unless-stopped',
    mem: 31 * MiB,
    limit: 128 * MiB,
    health: null,
  },
  {
    name: 'spanelstinadokapsy-web',
    image: 'spanelstinadokapsy-web:2026.11',
    upHours: 188,
    policy: 'unless-stopped',
    mem: 22 * MiB,
    limit: 64 * MiB,
    ports: ['2001->8080/tcp'],
    health: 'healthy',
  },
  {
    name: 'spanelstinadokapsy-api',
    image: 'spanelstinadokapsy-api:2026.11',
    upHours: 188,
    policy: 'unless-stopped',
    mem: 118 * MiB,
    limit: 384 * MiB,
    ports: ['2002->8080/tcp'],
    health: 'healthy',
  },
  {
    name: 'spanelstinadokapsy-db',
    image: 'postgres:17-alpine',
    upHours: 188,
    policy: 'unless-stopped',
    mem: 64 * MiB,
    limit: 256 * MiB,
    ports: ['5432/tcp'],
    health: 'healthy',
  },
  {
    name: 'klettr-web',
    image: 'klettr-web:latest',
    upHours: 52,
    policy: 'unless-stopped',
    mem: 19 * MiB,
    limit: 64 * MiB,
    ports: ['2010->8080/tcp'],
    health: 'healthy',
  },
  {
    name: 'saliny-web',
    image: 'saliny-web:latest',
    upHours: 300,
    policy: 'unless-stopped',
    mem: 9 * MiB,
    limit: 32 * MiB,
    ports: ['2020->8080/tcp'],
    health: 'healthy',
  },
  {
    name: 'webshareflix',
    image: 'webshareflix:hardened',
    upHours: 27,
    policy: 'unless-stopped',
    mem: 142 * MiB,
    limit: 512 * MiB,
    ports: ['2030->8080/tcp'],
    health: 'healthy',
    restarts: 2,
  },
  {
    name: 'pi-monitor',
    image: 'pi-monitor:latest',
    upHours: 410,
    policy: 'always',
    mem: 38 * MiB,
    limit: 128 * MiB,
    health: null,
  },
  {
    name: 'umami',
    image: 'ghcr.io/umami-software/umami:postgresql-v3.5.0',
    upHours: null,
    stoppedHoursAgo: 30,
    policy: 'unless-stopped',
    exit: 0,
  },
  {
    name: 'analytics-db',
    image: 'postgres:16-alpine',
    upHours: null,
    stoppedHoursAgo: 30,
    policy: 'unless-stopped',
    exit: 0,
  },
  {
    name: 'stacha-tech-build',
    image: 'node:26-alpine',
    upHours: null,
    stoppedHoursAgo: 96,
    policy: 'no',
    exit: 0,
  },
  {
    name: 'old-grafana',
    image: 'grafana/grafana:11.2.0',
    upHours: null,
    stoppedHoursAgo: 24 * 41,
    policy: 'unless-stopped',
    exit: 137,
  },
  {
    name: 'old-prometheus',
    image: 'prom/prometheus:v2.54.0',
    upHours: null,
    stoppedHoursAgo: 24 * 41,
    policy: 'unless-stopped',
    exit: 137,
  },
];

export function statusSnapshot(now: number, flags: Set<string>): HealthSnapshot {
  const tick = Math.floor(now / 5000);
  const wobble = (seed: number) => Math.sin(tick / 7 + seed) * 0.5 + 0.5;
  const generated = flags.has('stale') ? now - 6 * 60_000 : now - 1500 - (tick % 4) * 900;

  const containers: ContainerStatus[] = SPECS.map((s, i) => {
    const running = s.upHours !== null;
    let health = s.health ?? null;
    if (flags.has('down') && s.name === 'spanelstinadokapsy-api') health = 'unhealthy';
    return {
      id: `c${i.toString(16).padStart(4, '0')}a9f3e1`,
      name: s.name,
      image: s.image,
      state: running ? 'running' : 'exited',
      running,
      health: running ? health : null,
      exitCode: running ? null : (s.exit ?? 0),
      restartCount: s.restarts ?? 0,
      restartPolicy: s.policy,
      startedAt: running ? new Date(now - s.upHours! * HOUR).toISOString() : null,
      finishedAt: running ? null : new Date(now - (s.stoppedHoursAgo ?? 1) * HOUR).toISOString(),
      uptimeSeconds: running ? Math.round(s.upHours! * 3600) : null,
      memoryBytes: running && s.mem ? Math.round(s.mem * (0.94 + 0.12 * wobble(i))) : null,
      memoryLimitBytes: running && s.limit ? s.limit : null,
      ports: s.ports ?? [],
    };
  });

  return {
    schemaVersion: 1,
    generatedAt: new Date(generated).toISOString(),
    collectionMs: 180 + (tick % 90),
    host: {
      hostname: 'raspberrypi',
      os: 'Debian GNU/Linux 13 (trixie)',
      kernel: '6.12.47+rpt-rpi-2712',
      cpuCount: 4,
      uptimeSeconds: 19 * 86400 + 5 * 3600 + (Math.floor(now / 1000) % 3600),
      load: { avg1: 0.38 + 0.5 * wobble(1), avg5: 0.42, avg15: 0.4 },
      memory: {
        totalBytes: 7.8 * GiB,
        availableBytes: 5.9 * GiB,
        usedBytes: 1.9 * GiB + 40 * MiB * wobble(2),
        swapTotalBytes: 2 * GiB,
        swapUsedBytes: 0,
      },
      disk: { totalBytes: 233 * GiB, freeBytes: 169 * GiB, usedBytes: 64 * GiB },
      temperatureC: 49 + 5 * wobble(3),
      throttling: {
        underVoltageNow: false,
        throttledNow: false,
        underVoltageSinceBoot: false,
        throttledSinceBoot: false,
      },
    },
    containers,
    errors: flags.has('warn') ? ['docker stats: timeout after 4s (using cached values)'] : [],
  };
}

/** 24 h at one point a minute, columnar like the real history.json. */
export function statusHistory(now: number): HistorySnapshot {
  const points: number[][] = [];
  const end = Math.floor(now / 60_000) * 60;
  for (let i = 1439; i >= 0; i--) {
    const t = end - i * 60;
    const hour = (((t / 3600) % 24) + 1) % 24;
    const day = 0.5 + 0.5 * Math.sin(((hour - 9) / 24) * Math.PI * 2);
    const noise =
      Math.sin(t / 1700) * 0.5 + Math.sin(t / 610) * 0.3 + (((t * 7919) % 13) / 13 - 0.5) * 0.12;
    points.push([
      t,
      +(0.28 + 0.4 * day + 0.18 * noise + (i % 360 === 0 ? 0.9 : 0)).toFixed(2),
      Math.round(1.8 * GiB + 0.18 * GiB * day + 25 * MiB * noise),
      Math.round(63.2 * GiB + (1439 - i) * 1.1 * MiB),
      +(47 + 6 * day + 1.8 * noise).toFixed(1),
    ]);
  }
  return {
    schemaVersion: 1,
    intervalSeconds: 60,
    windowSeconds: 86400,
    fields: ['t', 'load1', 'memUsedBytes', 'diskUsedBytes', 'temperatureC'],
    points,
  };
}
