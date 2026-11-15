import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Clock } from '../../core/clock';
import { ContainerStatus, HealthSnapshot } from '../../core/health.model';
import { SitesService } from '../../core/sites';
import { StatusService } from '../../core/status';
import { StatusPage } from './status';

const NOW = Date.parse('2026-11-14T12:00:30Z');

const container = (over: Partial<ContainerStatus> = {}): ContainerStatus => ({
  id: 'id-' + (over.name ?? 'web'),
  name: 'web',
  image: 'web:latest',
  state: 'running',
  running: true,
  health: 'healthy',
  exitCode: null,
  restartCount: 0,
  restartPolicy: 'unless-stopped',
  startedAt: '2026-11-10T00:00:00Z',
  finishedAt: null,
  uptimeSeconds: 3600,
  memoryBytes: 10 * 1024 ** 2,
  memoryLimitBytes: 64 * 1024 ** 2,
  ports: [],
  ...over,
});

function snapshot(over: Partial<HealthSnapshot> = {}): HealthSnapshot {
  return {
    schemaVersion: 1,
    generatedAt: '2026-11-14T12:00:20Z',
    collectionMs: 200,
    host: {
      hostname: 'raspberrypi',
      os: 'Debian',
      kernel: '6.12',
      cpuCount: 4,
      uptimeSeconds: 86_400,
      load: { avg1: 0.5, avg5: 0.4, avg15: 0.3 },
      memory: {
        totalBytes: 8e9,
        availableBytes: 6e9,
        usedBytes: 2e9,
        swapTotalBytes: 0,
        swapUsedBytes: 0,
      },
      disk: { totalBytes: 1e11, freeBytes: 7e10, usedBytes: 3e10 },
      temperatureC: 50,
      throttling: {
        underVoltageNow: false,
        throttledNow: false,
        underVoltageSinceBoot: false,
        throttledSinceBoot: false,
      },
    },
    containers: [
      container({ name: 'api', id: 'api' }),
      container({
        name: 'old-grafana',
        id: 'old',
        running: false,
        state: 'exited',
        health: null,
        finishedAt: '2026-10-01T00:00:00Z',
        exitCode: 137,
      }),
    ],
    errors: [],
    ...over,
  };
}

function render(snap: HealthSnapshot | null, error: string | null = null) {
  const fake = {
    snapshot: signal(snap),
    history: signal(null),
    error: signal(error),
    loading: signal(false),
    hasLoaded: signal(snap !== null || error !== null),
    schemaMismatch: signal(false),
    startPolling: () => () => undefined,
    refresh: vi.fn(),
  };
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: StatusService, useValue: fake },
      { provide: Clock, useValue: { now: signal(NOW) } },
      { provide: SitesService, useValue: { list: signal(undefined), byId: () => undefined } },
    ],
  });
  const fixture = TestBed.createComponent(StatusPage);
  fixture.detectChanges();
  return { el: fixture.nativeElement as HTMLElement, fixture };
}

describe('StatusPage', () => {
  it('reports a healthy Pi and hides long-stopped containers by default', () => {
    const { el } = render(snapshot());
    expect(el.textContent).toContain('All systems normal');
    expect(el.textContent).toContain('api');
    expect(el.textContent).not.toContain('old-grafana');
  });

  it('lists stopped containers on request (decommissioned, not down)', async () => {
    const { el, fixture } = render(snapshot());
    const stopped = [...el.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((b) =>
      b.textContent?.includes('Stopped'),
    )!;
    stopped.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.textContent).toContain('old-grafana');
    expect(el.textContent).not.toContain('Problem detected');
  });

  it('flags a stale snapshot as a dead collector, whatever else it says', () => {
    const { el } = render(snapshot({ generatedAt: '2026-11-14T11:50:00Z' }));
    expect(el.textContent).toContain('Collector not reporting');
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('older than a minute');
  });

  it('surfaces an unhealthy container first', () => {
    const { el } = render(
      snapshot({
        containers: [
          container({ name: 'a-ok', id: 'a' }),
          container({ name: 'z-bad', id: 'z', health: 'unhealthy' }),
        ],
      }),
    );
    expect(el.textContent).toContain('Problem detected');
    const names = [...el.querySelectorAll('pl-service-card h3')].map((h) => h.textContent?.trim());
    expect(names).toEqual(['z-bad', 'a-ok']);
  });

  it('filters containers by name', async () => {
    const { el, fixture } = render(
      snapshot({
        containers: [container({ name: 'alpha', id: 'a' }), container({ name: 'beta', id: 'b' })],
      }),
    );
    const input = el.querySelector<HTMLInputElement>('input[type="search"]')!;
    input.value = 'bet';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    fixture.detectChanges();
    const names = [...el.querySelectorAll('pl-service-card h3')].map((h) => h.textContent?.trim());
    expect(names).toEqual(['beta']);
  });

  it('shows the error with a retry when there is nothing to show', () => {
    const { el } = render(null, 'No status data yet.');
    expect(el.textContent).toContain('No status data yet.');
  });

  it('is plain "normal" (mint) when the only containers stopped are stopped on purpose', () => {
    const { el } = render(
      snapshot({
        containers: [
          container({ name: 'api', id: 'api' }),
          container({
            name: 'one-shot',
            id: 'one',
            running: false,
            state: 'exited',
            health: null,
            restartPolicy: 'no',
            exitCode: 0,
          }),
        ],
      }),
    );
    expect(el.querySelector('[aria-label="Overall status"]')?.getAttribute('data-sev')).toBe('ok');
    expect(el.textContent).toContain('All systems normal');
  });

  it('says why it needs attention', () => {
    const { el } = render(snapshot({ errors: ['docker stats: timeout'] }));
    expect(el.textContent).toContain('Needs attention');
    expect(el.textContent).toContain('1 collector warning.');
  });

  it('does not claim to refresh automatically while the collector is silent', () => {
    const { el } = render(snapshot({ generatedAt: '2026-11-14T11:50:00Z' }));
    expect(el.textContent).toContain('Last reported 10m ago.');
    expect(el.textContent).not.toContain('refreshes automatically');
  });

  it('shows a missing status once, as the empty state and not also as a banner', () => {
    const { el } = render(null, 'No status data yet.');
    expect(el.textContent?.split('No status data yet.').length).toBe(2);
    expect(el.querySelectorAll('[role="alert"]').length).toBe(1);
  });

  it('offers to clear a search that matches nothing', async () => {
    const { el, fixture } = render(snapshot());
    const input = el.querySelector<HTMLInputElement>('input[type="search"]')!;
    input.value = 'zzz';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.textContent).toContain('No container matches “zzz”');
    expect(el.textContent).not.toContain('switch to All');
    [...el.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent?.includes('Clear search'))!
      .click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('pl-service-card')).not.toBeNull();
  });
});
