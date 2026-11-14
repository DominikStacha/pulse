import {
  HistorySnapshot,
  HostVitals,
  ServiceStatus,
  Severity,
  SparklinePoint,
  VitalReading,
  diskSeverity,
  historySeries,
  loadSeverity,
  memorySeverity,
  temperatureSeverity,
  throttlingLabel,
  throttlingSeverity,
} from './health.model';
import { formatBytes, formatDuration, formatPercent } from './format';

/** Problems first: a red card should never be below the fold. */
export function sortBySeverity(services: readonly ServiceStatus[]): ServiceStatus[] {
  const rank: Record<Severity, number> = { down: 0, warn: 1, ok: 2, idle: 3 };
  return [...services].sort((a, b) => {
    const bySeverity = rank[a.severity] - rank[b.severity];
    return bySeverity !== 0 ? bySeverity : a.container.name.localeCompare(b.container.name);
  });
}

/**
 * Maps a history column onto the same 0-1 scale the tile's meter uses, so the
 * dial and the trend line never disagree about what "full" means.
 */
function seriesFor(
  history: HistorySnapshot | null,
  field: string,
  toFraction: (value: number) => number,
): SparklinePoint[] {
  return historySeries(history, field).map((sample) => ({
    ...sample,
    fraction: sample.value === null ? null : Math.min(1, Math.max(0, toFraction(sample.value))),
  }));
}

/** Ported from stacha.tech's status page: the host's readings, ready to draw. */
export function buildVitals(host: HostVitals, history: HistorySnapshot | null): VitalReading[] {
  const readings: VitalReading[] = [];

  if (host.load) {
    const cores = host.cpuCount && host.cpuCount > 0 ? host.cpuCount : 1;
    readings.push({
      key: 'load',
      label: 'CPU load',
      value: host.load.avg1.toFixed(2),
      detail: `${host.load.avg5.toFixed(2)} / ${host.load.avg15.toFixed(2)} (5m / 15m) · ${cores} cores`,
      fraction: Math.min(1, host.load.avg1 / cores),
      severity: loadSeverity(host.load, host.cpuCount),
      history: seriesFor(history, 'load1', (value) => value / cores),
    });
  }

  if (host.memory) {
    const { usedBytes, totalBytes, swapUsedBytes } = host.memory;
    readings.push({
      key: 'memory',
      label: 'Memory',
      value: formatBytes(usedBytes),
      detail: `of ${formatBytes(totalBytes)}${swapUsedBytes > 0 ? ` · swap ${formatBytes(swapUsedBytes)}` : ''}`,
      fraction: usedBytes / totalBytes,
      severity: memorySeverity(host.memory),
      history: seriesFor(history, 'memUsedBytes', (value) => value / totalBytes),
    });
  }

  if (host.disk) {
    const { usedBytes, totalBytes, freeBytes } = host.disk;
    readings.push({
      key: 'disk',
      label: 'Disk',
      value: formatPercent(usedBytes / totalBytes),
      detail: `${formatBytes(freeBytes)} free of ${formatBytes(totalBytes)}`,
      fraction: usedBytes / totalBytes,
      severity: diskSeverity(host.disk),
      history: seriesFor(history, 'diskUsedBytes', (value) => value / totalBytes),
    });
  }

  if (host.temperatureC !== null) {
    readings.push({
      key: 'temperature',
      label: 'Temperature',
      value: `${host.temperatureC.toFixed(1)} °C`,
      detail: 'throttles at 80 °C',
      // 30 °C is roughly ambient idle; scaling from zero would flatten the dial.
      fraction: Math.min(1, Math.max(0, (host.temperatureC - 30) / 55)),
      severity: temperatureSeverity(host.temperatureC),
      history: seriesFor(history, 'temperatureC', (value) => (value - 30) / 55),
    });
  }

  if (host.uptimeSeconds !== null) {
    readings.push({
      key: 'uptime',
      label: 'Host uptime',
      value: formatDuration(host.uptimeSeconds),
      detail: host.kernel,
      fraction: null,
      severity: 'ok',
      history: [],
    });
  }

  if (host.throttling) {
    const flags = host.throttling;
    const severity = throttlingSeverity(flags);
    readings.push({
      key: 'power',
      label: 'Power',
      value: throttlingLabel(flags),
      detail:
        severity === 'warn'
          ? 'recovered since boot'
          : severity === 'down'
            ? 'happening now'
            : 'no undervoltage or throttling',
      fraction: null,
      severity,
      history: [],
    });
  }

  return readings;
}

/** Tooltip formatters for the sparklines, keyed like the readings. */
export const VITAL_FORMATTERS: Record<string, (value: number) => string> = {
  load: (value) => value.toFixed(2),
  memory: (value) => formatBytes(value),
  disk: (value) => formatBytes(value),
  temperature: (value) => `${value.toFixed(1)} °C`,
};
