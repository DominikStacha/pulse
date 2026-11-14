import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Context } from './context';
import { SitesService } from './sites';

const sites = [
  { id: 's1', name: 'Klettr', domain: 'klettr.com', createdAt: '2025-11-05T18:40:00+01:00' },
];

function setup(list: typeof sites | undefined = sites) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: '**', children: [] }]),
      {
        provide: SitesService,
        useValue: { list: signal(list), byId: (id: string) => list?.find((s) => s.id === id) },
      },
    ],
  });
  return { router: TestBed.inject(Router), ctx: TestBed.inject(Context) };
}

describe('Context (site + period in the URL)', () => {
  it('defaults to all sites and 7 days', async () => {
    const { router, ctx } = setup();
    await router.navigateByUrl('/');
    expect(ctx.site()).toBe('all');
    expect(ctx.period()).toBe('7d');
    expect(ctx.siteLabel()).toBe('All sites');
  });

  it('reads both from the query string', async () => {
    const { router, ctx } = setup();
    await router.navigateByUrl('/?site=s1&period=30d');
    expect(ctx.site()).toBe('s1');
    expect(ctx.period()).toBe('30d');
    expect(ctx.siteLabel()).toBe('Klettr');
  });

  it('treats an unknown site or period (stale link) as the defaults', async () => {
    const { router, ctx } = setup();
    await router.navigateByUrl('/?site=gone&period=forever');
    expect(ctx.site()).toBe('all');
    expect(ctx.period()).toBe('7d');
  });

  it('keeps an id it cannot check yet while the site list is still loading', async () => {
    const { router, ctx } = setup(undefined);
    await router.navigateByUrl('/?site=s1');
    expect(ctx.site()).toBe('s1');
  });

  it('writes changes back to the URL, dropping defaults, and keeps the other value', async () => {
    const { router, ctx } = setup();
    await router.navigateByUrl('/live');
    const settle = () => new Promise((resolve) => setTimeout(resolve));
    ctx.setSite('s1');
    await settle();
    ctx.setPeriod('90d');
    await settle();
    expect(router.url).toBe('/live?site=s1&period=90d');

    ctx.setPeriod('7d');
    await settle();
    ctx.setSite('all');
    await settle();
    expect(router.url).toBe('/live');
  });
});
