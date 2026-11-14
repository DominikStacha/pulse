import { describe, it, expect } from 'vitest';
import {
  ContainerStatus,
  HealthSnapshot,
  HostVitals,
  containerSeverity,
  diskSeverity,
  historySeries,
  hostSeverity,
  isStale,
  loadSeverity,
  memorySeverity,
  overallSeverity,
  snapshotAgeMs,
  temperatureSeverity,
  throttlingLabel,
  throttlingSeverity,
  worstSeverity,
} from './health.model';

function container(overrides: Partial<ContainerStatus> = {}): ContainerStatus {
  return {
    id: 'abc123',
    name: 'stacha-tech-web',
    image: 'stacha-tech-web:latest',
    state: 'running',
    running: true,
    health: 'healthy',
    exitCode: null,
    restartCount: 0,
    restartPolicy: 'unless-stopped',
    startedAt: '2026-08-10T10:00:00Z',
    finishedAt: null,
    uptimeSeconds: 3600,
    memoryBytes: 12 * 1024 * 1024,
    memoryLimitBytes: 32 * 1024 * 1024,
    ports: ['1997->8080/tcp'],
    ...overrides,
  };
}

function host(overrides: Partial<HostVitals> = {}): HostVitals {
  return {
    hostname: 'raspberrypi',
    os: 'Debian GNU/Linux 12 (bookworm)',
    kernel: '6.6.31+rpt-rpi-v8',
    cpuCount: 4,
    uptimeSeconds: 86_400,
    load: { avg1: 0.4, avg5: 0.3, avg15: 0.2 },
    memory: {
      totalBytes: 4 * 1024 ** 3,
      availableBytes: 3 * 1024 ** 3,
      usedBytes: 1 * 1024 ** 3,
      swapTotalBytes: 0,
      swapUsedBytes: 0,
    },
    disk: { totalBytes: 64 * 1024 ** 3, freeBytes: 40 * 1024 ** 3, usedBytes: 24 * 1024 ** 3 },
    temperatureC: 48.2,
    throttling: {
      underVoltageNow: false,
      throttledNow: false,
      underVoltageSinceBoot: false,
      throttledSinceBoot: false,
    },
    ...overrides,
  };
}

function snapshot(overrides: Partial<HealthSnapshot> = {}): HealthSnapshot {
  return {
    schemaVersion: 1,
    generatedAt: '2026-08-13T10:00:00Z',
    collectionMs: 240,
    host: host(),
    containers: [container()],
    errors: [],
    ...overrides,
  };
}

const NOW = Date.parse('2026-08-13T10:00:05Z');

describe('historySeries', () => {
  const history = {
    schemaVersion: 1,
    intervalSeconds: 60,
    windowSeconds: 86_400,
    fields: ['t', 'load1', 'memUsedBytes', 'diskUsedBytes', 'temperatureC'],
    points: [
      [1000, 0.4, 100, 200, 48.2],
      [1060, 0.6, 110, 200, 49.0],
    ],
  };

  it('pulls a column out by name', () => {
    expect(historySeries(history, 'load1')).toEqual([
      { t: 1000, value: 0.4 },
      { t: 1060, value: 0.6 },
    ]);
  });

  it('reads columns positionally, not by guessing order', () => {
    expect(historySeries(history, 'temperatureC').map((s) => s.value)).toEqual([48.2, 49.0]);
  });

  it('is empty for a field the collector does not record', () => {
    expect(historySeries(history, 'networkBytes')).toEqual([]);
  });

  it('is empty when there is no history at all', () => {
    expect(historySeries(null, 'load1')).toEqual([]);
  });

  it('keeps missing readings as null rather than dropping the timestamp', () => {
    const withGap = { ...history, points: [[1000, null, 100, 200, 48.2]] };
    expect(historySeries(withGap, 'load1')).toEqual([{ t: 1000, value: null }]);
  });

  it('skips rows with an unusable timestamp', () => {
    const broken = { ...history, points: [[null, 0.4, 100, 200, 48.2]] };
    expect(historySeries(broken, 'load1')).toEqual([]);
  });
});

describe('worstSeverity', () => {
  it('is ok for an empty list', () => {
    expect(worstSeverity([])).toBe('ok');
  });

  it('ranks down above warn above idle above ok', () => {
    expect(worstSeverity(['ok', 'idle'])).toBe('idle');
    expect(worstSeverity(['idle', 'warn'])).toBe('warn');
    expect(worstSeverity(['warn', 'down'])).toBe('down');
    expect(worstSeverity(['down', 'ok'])).toBe('down');
  });
});

describe('containerSeverity', () => {
  it('is ok for a running healthy container', () => {
    expect(containerSeverity(container(), NOW)).toBe('ok');
  });

  it('is ok for a running container with no healthcheck', () => {
    expect(containerSeverity(container({ health: null }), NOW)).toBe('ok');
  });

  it('warns while a healthcheck is still starting', () => {
    expect(containerSeverity(container({ health: 'starting' }), NOW)).toBe('warn');
  });

  it('is down for a running but unhealthy container', () => {
    expect(containerSeverity(container({ health: 'unhealthy' }), NOW)).toBe('down');
  });

  it('warns while a container is restarting', () => {
    expect(containerSeverity(container({ state: 'restarting', running: false }), NOW)).toBe('warn');
  });

  it('is down when a container that should stay up stopped recently', () => {
    expect(
      containerSeverity(
        container({
          running: false,
          state: 'exited',
          health: null,
          restartPolicy: 'unless-stopped',
          finishedAt: '2026-08-13T09:30:00Z', // 30 minutes before NOW
        }),
        NOW,
      ),
    ).toBe('down');
  });

  it('treats a long-stopped service as decommissioned, not broken', () => {
    // `unless-stopped` also describes a container someone deliberately stopped.
    // Weeks later it is not an incident, and red forever trains you to ignore
    // the dashboard.
    expect(
      containerSeverity(
        container({
          running: false,
          state: 'exited',
          health: null,
          restartPolicy: 'unless-stopped',
          finishedAt: '2026-06-29T15:15:33Z',
        }),
        NOW,
      ),
    ).toBe('idle');
  });

  it('still counts a stop with no recorded finish time as an outage', () => {
    // Fail loud rather than swallowing a real outage on missing data.
    expect(
      containerSeverity(
        container({
          running: false,
          state: 'exited',
          health: null,
          restartPolicy: 'always',
          finishedAt: null,
        }),
        NOW,
      ),
    ).toBe('down');
  });

  it('is idle for a finished one-shot container, whatever its exit code', () => {
    const oneShot = {
      running: false,
      state: 'exited',
      health: null,
      restartPolicy: 'no',
      finishedAt: '2026-08-13T09:59:00Z',
    };
    expect(containerSeverity(container({ ...oneShot, exitCode: 0 }), NOW)).toBe('idle');
    // A build container that failed minutes ago is still not a service outage.
    expect(containerSeverity(container({ ...oneShot, exitCode: 255 }), NOW)).toBe('idle');
  });
});

describe('host metric severities', () => {
  it('escalates disk usage past 80% and 90%', () => {
    const at = (usedFraction: number) => ({
      totalBytes: 100,
      usedBytes: 100 * usedFraction,
      freeBytes: 100 * (1 - usedFraction),
    });
    expect(diskSeverity(at(0.5))).toBe('ok');
    expect(diskSeverity(at(0.85))).toBe('warn');
    expect(diskSeverity(at(0.95))).toBe('down');
  });

  it('escalates memory usage past 85% and 95%', () => {
    const at = (usedFraction: number) => ({
      totalBytes: 100,
      usedBytes: 100 * usedFraction,
      availableBytes: 100 * (1 - usedFraction),
      swapTotalBytes: 0,
      swapUsedBytes: 0,
    });
    expect(memorySeverity(at(0.5))).toBe('ok');
    expect(memorySeverity(at(0.9))).toBe('warn');
    expect(memorySeverity(at(0.96))).toBe('down');
  });

  it('escalates temperature past 70 and 80 degrees', () => {
    expect(temperatureSeverity(48)).toBe('ok');
    expect(temperatureSeverity(72)).toBe('warn');
    expect(temperatureSeverity(84)).toBe('down');
  });

  it('scales load average by core count', () => {
    const load = { avg1: 4, avg5: 4, avg15: 4 };
    expect(loadSeverity(load, 8)).toBe('ok');
    expect(loadSeverity(load, 4)).toBe('warn');
    expect(loadSeverity(load, 2)).toBe('down');
  });

  it('treats a missing core count as a single core', () => {
    expect(loadSeverity({ avg1: 0.5, avg5: 0.5, avg15: 0.5 }, null)).toBe('ok');
    expect(loadSeverity({ avg1: 1.2, avg5: 1, avg15: 1 }, null)).toBe('warn');
  });

  it('names the specific power fault', () => {
    const flags = {
      underVoltageNow: false,
      throttledNow: false,
      underVoltageSinceBoot: false,
      throttledSinceBoot: false,
    };
    expect(throttlingLabel(flags)).toBe('Stable');
    // Historical undervoltage must not be reported as throttling: different fix.
    expect(throttlingLabel({ ...flags, underVoltageSinceBoot: true })).toBe('Undervoltage');
    expect(throttlingLabel({ ...flags, throttledSinceBoot: true })).toBe('Throttled');
    expect(throttlingLabel({ ...flags, throttledNow: true })).toBe('Throttled');
    // A live fault outranks a historical one of the other kind.
    expect(throttlingLabel({ ...flags, underVoltageNow: true, throttledSinceBoot: true })).toBe(
      'Undervoltage',
    );
  });

  it('treats live undervoltage as down and historical as warn', () => {
    expect(
      throttlingSeverity({
        underVoltageNow: true,
        throttledNow: false,
        underVoltageSinceBoot: true,
        throttledSinceBoot: false,
      }),
    ).toBe('down');
    expect(
      throttlingSeverity({
        underVoltageNow: false,
        throttledNow: false,
        underVoltageSinceBoot: true,
        throttledSinceBoot: false,
      }),
    ).toBe('warn');
  });
});

describe('hostSeverity', () => {
  it('is ok for a healthy host', () => {
    expect(hostSeverity(host())).toBe('ok');
  });

  it('warns when host vitals could not be collected at all', () => {
    expect(hostSeverity(null)).toBe('warn');
  });

  it('reports the worst individual metric', () => {
    expect(hostSeverity(host({ temperatureC: 84 }))).toBe('down');
  });

  it('ignores metrics the collector could not read', () => {
    expect(
      hostSeverity(host({ load: null, memory: null, temperatureC: null, throttling: null })),
    ).toBe('ok');
  });
});

describe('snapshotAgeMs', () => {
  it('measures elapsed time since generation', () => {
    expect(snapshotAgeMs(snapshot(), NOW)).toBe(5_000);
  });

  it('clamps clock skew from the future to zero', () => {
    expect(snapshotAgeMs(snapshot(), Date.parse('2026-08-13T09:59:50Z'))).toBe(0);
  });

  it('treats an unparseable timestamp as infinitely old', () => {
    expect(snapshotAgeMs(snapshot({ generatedAt: 'not-a-date' }), NOW)).toBe(
      Number.POSITIVE_INFINITY,
    );
  });
});

describe('isStale', () => {
  it('is fresh within the stale window', () => {
    expect(isStale(snapshot(), NOW)).toBe(false);
  });

  it('is stale once the collector stops writing', () => {
    expect(isStale(snapshot(), Date.parse('2026-08-13T10:02:00Z'))).toBe(true);
  });
});

describe('overallSeverity', () => {
  it('is ok when everything is healthy and fresh', () => {
    expect(overallSeverity(snapshot(), NOW)).toBe('ok');
  });

  it('is down when the snapshot is stale, whatever it reports', () => {
    expect(overallSeverity(snapshot(), Date.parse('2026-08-13T11:00:00Z'))).toBe('down');
  });

  it('surfaces a failing container', () => {
    expect(
      overallSeverity(snapshot({ containers: [container({ health: 'unhealthy' })] }), NOW),
    ).toBe('down');
  });

  it('warns when the collector reported partial errors', () => {
    expect(overallSeverity(snapshot({ errors: ['docker stats: timeout'] }), NOW)).toBe('warn');
  });

  it('is ok when only idle one-shot containers are present alongside healthy services', () => {
    const idle = container({
      name: 'build-once',
      running: false,
      state: 'exited',
      health: null,
      restartPolicy: 'no',
      exitCode: 0,
    });
    expect(overallSeverity(snapshot({ containers: [container(), idle] }), NOW)).toBe('idle');
  });
});
