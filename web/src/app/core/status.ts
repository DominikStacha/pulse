import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { HEALTH_SCHEMA_VERSION, HealthSnapshot, HistorySnapshot } from './health.model';

const POLL_MS = 10_000;
/** The collector writes one history point a minute. */
const HISTORY_POLL_MS = 60_000;

/**
 * The Pi status feed (GET /api/status and /api/status/history), ported from
 * stacha.tech's HealthService. A failed refresh keeps the last snapshot next to
 * the error: the last known state beats a blank page after one blip.
 */
@Injectable({ providedIn: 'root' })
export class StatusService {
  private readonly http = inject(HttpClient);

  private readonly snapshotState = signal<HealthSnapshot | null>(null);
  private readonly errorState = signal<string | null>(null);
  private readonly loadingState = signal(false);
  private readonly historyState = signal<HistorySnapshot | null>(null);

  readonly snapshot = this.snapshotState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly loading = this.loadingState.asReadonly();
  readonly history = this.historyState.asReadonly();

  /** True once any response (good or bad) has arrived: drives the first skeleton. */
  readonly hasLoaded = computed(() => this.snapshotState() !== null || this.errorState() !== null);

  /** The Pi runs another collector version than this app was built against. */
  readonly schemaMismatch = computed(() => {
    const version = this.snapshotState()?.schemaVersion;
    return version !== undefined && version !== HEALTH_SCHEMA_VERSION;
  });

  /** Starts both polls; returns the function that stops them. */
  startPolling(): () => void {
    this.refresh();
    this.refreshHistory();
    const status = setInterval(() => this.refresh(), POLL_MS);
    const history = setInterval(() => this.refreshHistory(), HISTORY_POLL_MS);
    return () => {
      clearInterval(status);
      clearInterval(history);
    };
  }

  refresh(): void {
    this.loadingState.set(true);
    this.http.get<HealthSnapshot>('/api/status').subscribe({
      next: (snapshot) => {
        this.snapshotState.set(snapshot);
        this.errorState.set(null);
        this.loadingState.set(false);
      },
      error: (error: unknown) => {
        this.errorState.set(describeError(error));
        this.loadingState.set(false);
      },
    });
  }

  refreshHistory(): void {
    this.http.get<HistorySnapshot>('/api/status/history').subscribe({
      next: (history) => this.historyState.set(history),
      error: () => {
        /* Only the sparklines are lost; one error banner is enough. */
      },
    });
  }
}

export function describeError(error: unknown): string {
  if (!(error instanceof HttpErrorResponse)) return 'Unexpected error while loading status.';
  switch (error.status) {
    case 0:
      return 'Cannot reach Pulse. Your Cloudflare session may have expired (reload to sign in again), or the tunnel is down.';
    case 401:
    case 403:
      return 'Access denied. Sign in through Cloudflare Access again.';
    case 503:
    case 404:
      return 'No status data yet. The collector on the Pi has not written status.json, or the folder is not mounted.';
    default:
      return `Status request failed (HTTP ${error.status}).`;
  }
}
