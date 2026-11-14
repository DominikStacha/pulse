/**
 * Shape of GET /api/status (status.json, written on the Raspberry Pi by
 * collect-status.py and passed through verbatim by Pulse). Ported from
 * stacha.tech's health.model.ts; keep SCHEMA_VERSION in sync with the collector:
 * a mismatch means the Pi is running an older script than this app expects.
 */
export const HEALTH_SCHEMA_VERSION = 1;

/** Snapshots older than this mean the collector timer has stopped. */
export const HEALTH_STALE_AFTER_MS = 60_000;

/**
 * A stopped container older than this is treated as decommissioned rather than
 * broken. `unless-stopped` means "restart unless deliberately stopped", so an
 * exited container with that policy is ambiguous: it either crashed, or you
 * stopped it on purpose. Age resolves it — a real outage either self-heals via
 * the restart policy or gets noticed within a day. Without this, a stack torn
 * down weeks ago pins the dashboard to red permanently and trains you to
 * ignore it.
 */
export const CONTAINER_DECOMMISSIONED_AFTER_MS = 24 * 60 * 60 * 1000;

export interface LoadAverage {
  avg1: number;
  avg5: number;
  avg15: number;
}

export interface MemoryUsage {
  totalBytes: number;
  availableBytes: number;
  usedBytes: number;
  swapTotalBytes: number;
  swapUsedBytes: number;
}

export interface DiskUsage {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
}

export interface ThrottlingFlags {
  underVoltageNow: boolean;
  throttledNow: boolean;
  underVoltageSinceBoot: boolean;
  throttledSinceBoot: boolean;
}

export interface HostVitals {
  hostname: string;
  os: string | null;
  kernel: string | null;
  cpuCount: number | null;
  uptimeSeconds: number | null;
  load: LoadAverage | null;
  memory: MemoryUsage | null;
  disk: DiskUsage | null;
  temperatureC: number | null;
  throttling: ThrottlingFlags | null;
}

export interface ContainerStatus {
  id: string;
  name: string;
  image: string | null;
  state: string | null;
  running: boolean;
  health: string | null;
  exitCode: number | null;
  restartCount: number;
  restartPolicy: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  uptimeSeconds: number | null;
  memoryBytes: number | null;
  memoryLimitBytes: number | null;
  ports: string[];
}

/** Written alongside status.json; see scripts/pi-status/collect-status.py. */
export const HISTORY_SCHEMA_VERSION = 1;

/**
 * Rows are arrays whose column order is given by `fields`, not objects —
 * 1440 five-key objects would be several times the bytes for the same numbers.
 */
export interface HistorySnapshot {
  schemaVersion: number;
  intervalSeconds: number;
  windowSeconds: number;
  fields: string[];
  points: (number | null)[][];
}

export interface HistorySample {
  /** Epoch seconds. */
  t: number;
  value: number | null;
}

/** A sample ready to plot: the raw value for the tooltip, 0-1 for the geometry. */
export interface SparklinePoint extends HistorySample {
  fraction: number | null;
}

/** Pulls one column out of the columnar history, tolerating an unknown field. */
export function historySeries(history: HistorySnapshot | null, field: string): HistorySample[] {
  if (!history || !Array.isArray(history.fields)) return [];
  const timeIndex = history.fields.indexOf('t');
  const valueIndex = history.fields.indexOf(field);
  if (timeIndex < 0 || valueIndex < 0) return [];

  const samples: HistorySample[] = [];
  for (const row of history.points ?? []) {
    const t = row[timeIndex];
    if (typeof t !== 'number') continue;
    const value = row[valueIndex];
    samples.push({ t, value: typeof value === 'number' ? value : null });
  }
  return samples;
}

export interface HealthSnapshot {
  schemaVersion: number;
  generatedAt: string;
  collectionMs: number;
  host: HostVitals | null;
  containers: ContainerStatus[];
  errors: string[];
}

/**
 * `idle` is deliberately distinct from `down`: a container that ran to
 * completion, or was stopped long ago, is not an outage, and colouring it red
 * would train you to ignore the dashboard.
 */
export type Severity = 'ok' | 'idle' | 'warn' | 'down';

/** A container paired with the verdict the page reached about it. */
export interface ServiceStatus {
  container: ContainerStatus;
  severity: Severity;
}

const SEVERITY_RANK: Record<Severity, number> = { ok: 0, idle: 1, warn: 2, down: 3 };

export function worstSeverity(severities: readonly Severity[]): Severity {
  return severities.reduce<Severity>(
    (worst, current) => (SEVERITY_RANK[current] > SEVERITY_RANK[worst] ? current : worst),
    'ok',
  );
}

/** Containers with an `always`/`unless-stopped` policy are the ones meant to stay up. */
function isLongRunning(container: ContainerStatus): boolean {
  return container.restartPolicy === 'always' || container.restartPolicy === 'unless-stopped';
}

/**
 * Did this container stop recently enough to still count as an incident?
 * An unparseable or missing finish time counts as recent — better a false
 * alarm than silently swallowing a real outage.
 */
function stoppedRecently(container: ContainerStatus, now: number): boolean {
  if (!container.finishedAt) return true;
  const finished = Date.parse(container.finishedAt);
  if (Number.isNaN(finished)) return true;
  return now - finished < CONTAINER_DECOMMISSIONED_AFTER_MS;
}

export function containerSeverity(container: ContainerStatus, now: number): Severity {
  if (container.state === 'restarting') return 'warn';

  if (!container.running) {
    // Anything without a restart policy exited because it was meant to.
    if (!isLongRunning(container)) return 'idle';
    // A service that should have restarted itself and hasn't is an outage —
    // but only while it is recent enough to still be one.
    return stoppedRecently(container, now) ? 'down' : 'idle';
  }

  switch (container.health) {
    case 'unhealthy':
      return 'down';
    case 'starting':
      return 'warn';
    default:
      return 'ok';
  }
}

export interface VitalReading {
  key: string;
  label: string;
  value: string;
  detail: string | null;
  /** 0-1, for meters. Null when the reading has no natural maximum. */
  fraction: number | null;
  severity: Severity;
  /**
   * 24h history for the sparkline, on the same 0-1 scale as `fraction` so the
   * bar and the trend line agree about what "full" means. Empty until the
   * collector has been running for a while.
   */
  history: SparklinePoint[];
}

export function diskSeverity(disk: DiskUsage): Severity {
  const used = disk.usedBytes / disk.totalBytes;
  if (used >= 0.9) return 'down';
  if (used >= 0.8) return 'warn';
  return 'ok';
}

export function memorySeverity(memory: MemoryUsage): Severity {
  const used = memory.usedBytes / memory.totalBytes;
  if (used >= 0.95) return 'down';
  if (used >= 0.85) return 'warn';
  return 'ok';
}

export function temperatureSeverity(celsius: number): Severity {
  // The Pi begins soft-throttling around 80 °C and hard-throttling at 85 °C.
  if (celsius >= 80) return 'down';
  if (celsius >= 70) return 'warn';
  return 'ok';
}

export function loadSeverity(load: LoadAverage, cpuCount: number | null): Severity {
  const cores = cpuCount && cpuCount > 0 ? cpuCount : 1;
  const ratio = load.avg1 / cores;
  if (ratio >= 2) return 'down';
  if (ratio >= 1) return 'warn';
  return 'ok';
}

export function throttlingSeverity(flags: ThrottlingFlags): Severity {
  if (flags.underVoltageNow || flags.throttledNow) return 'down';
  if (flags.underVoltageSinceBoot || flags.throttledSinceBoot) return 'warn';
  return 'ok';
}

/**
 * Names the specific power fault, since "throttled" and "undervoltage" have
 * different fixes: one is cooling, the other is the power supply or cable.
 * Live faults win over historical ones.
 */
export function throttlingLabel(flags: ThrottlingFlags): string {
  if (flags.underVoltageNow) return 'Undervoltage';
  if (flags.throttledNow) return 'Throttled';
  if (flags.underVoltageSinceBoot) return 'Undervoltage';
  if (flags.throttledSinceBoot) return 'Throttled';
  return 'Stable';
}

export function hostSeverity(host: HostVitals | null): Severity {
  if (!host) return 'warn';
  const severities: Severity[] = [];
  if (host.disk) severities.push(diskSeverity(host.disk));
  if (host.memory) severities.push(memorySeverity(host.memory));
  if (host.temperatureC !== null) severities.push(temperatureSeverity(host.temperatureC));
  if (host.load) severities.push(loadSeverity(host.load, host.cpuCount));
  if (host.throttling) severities.push(throttlingSeverity(host.throttling));
  return worstSeverity(severities);
}

export function snapshotAgeMs(snapshot: HealthSnapshot, now: number): number {
  const generated = Date.parse(snapshot.generatedAt);
  if (Number.isNaN(generated)) return Number.POSITIVE_INFINITY;
  // Clock skew between the Pi and the browser can make a fresh snapshot look
  // like it came from the future; that is not staleness.
  return Math.max(0, now - generated);
}

export function isStale(snapshot: HealthSnapshot, now: number): boolean {
  return snapshotAgeMs(snapshot, now) > HEALTH_STALE_AFTER_MS;
}

/**
 * Overall badge for the page header. A stale snapshot outranks everything
 * else: if the collector is dead, every other reading on screen is fiction.
 */
export function overallSeverity(snapshot: HealthSnapshot, now: number): Severity {
  if (isStale(snapshot, now)) return 'down';
  return worstSeverity([
    hostSeverity(snapshot.host),
    ...snapshot.containers.map((container) => containerSeverity(container, now)),
    snapshot.errors.length > 0 ? 'warn' : 'ok',
  ]);
}
