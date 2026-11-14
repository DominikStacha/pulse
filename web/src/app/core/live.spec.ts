import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Live, LiveEvent } from './api';
import { LIVE_STREAM, LiveService, LiveStream } from './live';

class FakeStream implements LiveStream {
  readyState = 0;
  closed = false;
  private readonly listeners = new Map<string, ((event: Event) => void)[]>();
  constructor(readonly url: string) {}
  addEventListener(type: string, listener: (event: Event) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close(): void {
    this.closed = true;
    this.readyState = 2;
  }
  emit(type: string, data = ''): void {
    for (const listener of this.listeners.get(type) ?? [])
      listener(new MessageEvent(type, { data }));
  }
}

const event = (path: string): LiveEvent => ({
  siteId: 's1',
  ts: '2026-11-14T12:00:00+01:00',
  kind: 'pageview',
  name: null,
  path,
  country: 'CZ',
  browser: 'Chrome',
  os: 'macOS',
  device: 'desktop',
  referrer: null,
});

const snapshot = (active: number, recent: LiveEvent[] = []): Live => ({
  activeVisitors: active,
  perSite: [{ siteId: 's1', active }],
  recent,
});

describe('LiveService', () => {
  let streams: FakeStream[];
  let http: HttpTestingController;
  let live: LiveService;

  beforeEach(() => {
    vi.useFakeTimers();
    streams = [];
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: LIVE_STREAM,
          useValue: (url: string) => streams[streams.push(new FakeStream(url)) - 1],
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    live = TestBed.inject(LiveService);
  });

  afterEach(() => vi.useRealTimers());

  it('reads the snapshot first, then follows the stream', () => {
    live.start();
    http.expectOne('/api/live').flush(snapshot(3, [event('/old')]));
    expect(streams[0].url).toBe('/api/live/stream');
    expect(live.active()).toBe(3);
    expect(live.perSite()).toEqual({ s1: 3 });
    expect(live.recent().map((h) => h.path)).toEqual(['/old']);
    expect(live.activeFor('s1')).toBe(3);
    expect(live.activeFor('all')).toBe(3);
    expect(live.activeFor('other')).toBe(0);

    streams[0].emit('open');
    expect(live.connected()).toBe(true);
  });

  it('puts new hits on top and refreshes the online count shortly after', () => {
    live.start();
    http.expectOne('/api/live').flush(snapshot(1, [event('/old')]));

    streams[0].emit('hit', JSON.stringify(event('/new')));
    expect(live.recent().map((h) => h.path)).toEqual(['/new', '/old']);
    expect(live.lastHit()?.path).toBe('/new');

    http.expectNone('/api/live'); // debounced
    vi.advanceTimersByTime(1600);
    http.expectOne('/api/live').flush(snapshot(2));
    expect(live.active()).toBe(2);
  });

  it('ignores a malformed frame', () => {
    live.start();
    http.expectOne('/api/live').flush(snapshot(1));
    streams[0].emit('hit', '{nope');
    expect(live.recent()).toEqual([]);
  });

  it('reopens a closed stream with a delay, and reads the snapshot again', () => {
    live.start();
    http.expectOne('/api/live').flush(snapshot(1));
    streams[0].emit('open');

    streams[0].readyState = 2; // the browser gave up (proxy cut, HTTP error)
    streams[0].emit('error');
    expect(live.connected()).toBe(false);
    expect(streams).toHaveLength(1);

    vi.advanceTimersByTime(3100);
    expect(streams).toHaveLength(2);
    http.expectOne('/api/live').flush(snapshot(4));
    expect(live.active()).toBe(4);
  });

  it('leaves a stream the browser is retrying by itself alone', () => {
    live.start();
    http.expectOne('/api/live').flush(snapshot(1));
    streams[0].readyState = 0; // CONNECTING
    streams[0].emit('error');
    vi.advanceTimersByTime(60_000);
    expect(streams).toHaveLength(1);
  });
});
