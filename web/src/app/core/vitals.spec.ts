import { HistorySnapshot, HostVitals, ServiceStatus } from './health.model';
import { buildVitals, sortBySeverity } from './vitals';

const host: HostVitals = {
  hostname: 'raspberrypi',
  os: 'Debian',
  kernel: '6.12.0',
  cpuCount: 4,
  uptimeSeconds: 90_000,
  load: { avg1: 2, avg5: 1, avg15: 0.5 },
  memory: {
    totalBytes: 8000,
    availableBytes: 6000,
    usedBytes: 2000,
    swapTotalBytes: 0,
    swapUsedBytes: 0,
  },
  disk: { totalBytes: 1000, freeBytes: 250, usedBytes: 750 },
  temperatureC: 57.5,
  throttling: {
    underVoltageNow: false,
    throttledNow: false,
    underVoltageSinceBoot: false,
    throttledSinceBoot: false,
  },
};

const history: HistorySnapshot = {
  schemaVersion: 1,
  intervalSeconds: 60,
  windowSeconds: 86_400,
  fields: ['t', 'load1', 'memUsedBytes', 'diskUsedBytes', 'temperatureC'],
  points: [
    [0, 4, 4000, 500, 30],
    [60, 8, 8000, 1000, 85],
  ],
};

describe('buildVitals', () => {
  const byKey = (key: string) => buildVitals(host, history).find((r) => r.key === key)!;

  it('scales load by cores and puts the dial and the trend on the same 0-1 scale', () => {
    const load = byKey('load');
    expect(load.fraction).toBe(0.5);
    expect(load.history.map((p) => p.fraction)).toEqual([1, 1]); // 4/4 and 8/4 both clamp to 1
  });

  it('measures temperature from a 30 degree floor', () => {
    expect(byKey('temperature').fraction).toBeCloseTo(0.5, 5);
    expect(byKey('temperature').history.map((p) => p.fraction)).toEqual([0, 1]);
  });

  it('reports disk as percent used and memory as bytes', () => {
    expect(byKey('disk').value).toBe('75%');
    expect(byKey('memory').fraction).toBe(0.25);
  });

  it('leaves out readings the collector could not take', () => {
    const keys = buildVitals(
      { ...host, load: null, throttling: null, temperatureC: null },
      null,
    ).map((r) => r.key);
    expect(keys).toEqual(['memory', 'disk', 'uptime']);
  });
});

describe('sortBySeverity', () => {
  const svc = (name: string, severity: ServiceStatus['severity']) => ({
    container: { name } as ServiceStatus['container'],
    severity,
  });

  it('puts problems first, then alphabetical', () => {
    const sorted = sortBySeverity([
      svc('b', 'ok'),
      svc('z', 'down'),
      svc('a', 'ok'),
      svc('m', 'warn'),
    ]);
    expect(sorted.map((s) => s.container.name)).toEqual(['z', 'm', 'a', 'b']);
  });
});
