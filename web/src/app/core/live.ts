import { HttpClient } from '@angular/common/http';
import { DestroyRef, Injectable, InjectionToken, inject, signal } from '@angular/core';
import { Live, LiveEvent } from './api';

/** The slice of EventSource we use, so the dev mock can stand in for it. */
export interface LiveStream {
  readonly readyState: number;
  addEventListener(type: string, listener: (event: Event) => void): void;
  close(): void;
}

export const LIVE_STREAM = new InjectionToken<(url: string) => LiveStream>('LIVE_STREAM', {
  providedIn: 'root',
  factory: () => (url) => new EventSource(url),
});

/** A hit with a local id, so the feed can track rows and the map can retire pulses. */
export type LiveHit = LiveEvent & { id: number };

const FEED_LIMIT = 60;
const CLOSED = 2;

/**
 * Live visitors: the /api/live snapshot first, then the SSE stream on top.
 * One connection for the whole session (the header pill needs it everywhere).
 * The stream carries hits only, so the "online" count is re-read from the
 * snapshot shortly after a hit and on every server ping.
 */
@Injectable({ providedIn: 'root' })
export class LiveService {
  private readonly http = inject(HttpClient);
  private readonly open = inject(LIVE_STREAM);

  readonly connected = signal(false);
  readonly active = signal<number | null>(null);
  readonly perSite = signal<Record<string, number>>({});
  /** Newest first. */
  readonly recent = signal<LiveHit[]>([]);
  /** Set on every new hit; the map turns it into a pulse. */
  readonly lastHit = signal<LiveHit | null>(null);

  private nextId = 1;
  private started = false;
  private stream: LiveStream | null = null;
  private readonly destroyRef = inject(DestroyRef);
  private retry = 0;
  private snapshotTimer: ReturnType<typeof setTimeout> | undefined;

  /** Online count for one site, or all sites. Reads signals, so call it inside a computed. */
  activeFor(siteId: string): number | null {
    return siteId === 'all' ? this.active() : (this.perSite()[siteId] ?? 0);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    // A page left for another document can stay alive in the back/forward cache with its
    // stream open, holding one of the browser's six HTTP/1.1 connections per host; after a
    // few navigations every request queues. Close on pagehide, reopen if the page comes back.
    const listeners = new AbortController();
    this.destroyRef.onDestroy(() => {
      listeners.abort();
      this.disconnect();
    });
    addEventListener('pagehide', () => this.disconnect(), { signal: listeners.signal });
    addEventListener(
      'pageshow',
      (e) => {
        if ((e as PageTransitionEvent).persisted) {
          this.loadSnapshot();
          this.connect();
        }
      },
      { signal: listeners.signal },
    );
    this.loadSnapshot(true);
    this.connect();
  }

  private disconnect(): void {
    this.stream?.close();
    this.stream = null;
    this.connected.set(false);
  }

  private loadSnapshot(replaceFeed = false): void {
    this.http.get<Live>('/api/live').subscribe({
      next: (live) => {
        this.active.set(live.activeVisitors);
        this.perSite.set(Object.fromEntries(live.perSite.map((p) => [p.siteId, p.active])));
        if (replaceFeed && this.recent().length === 0) {
          this.recent.set(live.recent.map((e) => ({ ...e, id: this.nextId++ })));
        }
      },
      error: () => {
        /* The pill just keeps its last value; the stream status says if we are offline. */
      },
    });
  }

  private connect(): void {
    this.stream?.close();
    const stream = this.open('/api/live/stream');
    this.stream = stream;
    stream.addEventListener('open', () => {
      this.connected.set(true);
      this.retry = 0;
    });
    stream.addEventListener('hit', (e) => {
      try {
        const hit: LiveHit = {
          ...(JSON.parse((e as MessageEvent<string>).data) as LiveEvent),
          id: this.nextId++,
        };
        this.recent.update((list) => [hit, ...list].slice(0, FEED_LIMIT));
        this.lastHit.set(hit);
        this.scheduleSnapshot();
      } catch {
        /* A malformed frame is dropped; the next one is fine. */
      }
    });
    stream.addEventListener('ping', () => this.loadSnapshot());
    stream.addEventListener('error', () => {
      this.connected.set(false);
      // The browser retries by itself while CONNECTING; a CLOSED stream (HTTP error,
      // proxy cut) it does not, so reopen with a growing delay.
      if (stream.readyState === CLOSED) {
        stream.close();
        const delay = Math.min(30_000, 3000 * 2 ** this.retry++);
        setTimeout(() => {
          if (this.stream !== stream) return; // disconnected (pagehide) or replaced meanwhile
          this.loadSnapshot();
          this.connect();
        }, delay);
      }
    });
  }

  private scheduleSnapshot(): void {
    clearTimeout(this.snapshotTimer);
    this.snapshotTimer = setTimeout(() => this.loadSnapshot(), 1500);
  }
}
