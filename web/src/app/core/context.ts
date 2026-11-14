import { Injectable, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map } from 'rxjs';
import { DEFAULT_PERIOD, Period, parsePeriod } from './period';
import { SitesService } from './sites';

export const ALL_SITES = 'all';

/**
 * The selected site and period. They live in the URL (?site=…&period=…) so a
 * view can be linked and survives reload; this is just a typed read/write lens.
 * Defaults are left out of the URL to keep links short.
 */
@Injectable({ providedIn: 'root' })
export class Context {
  private readonly router = inject(Router);
  private readonly sites = inject(SitesService);

  private readonly query = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.router.parseUrl(this.router.url).queryParams),
    ),
    { initialValue: this.router.parseUrl(this.router.url).queryParams },
  );

  readonly period = computed<Period>(() => parsePeriod(this.query()['period']));

  /** A site id or "all". An id that is not in the list (stale link) counts as "all". */
  readonly site = computed(() => {
    const raw = this.query()['site'];
    if (typeof raw !== 'string' || raw === ALL_SITES) return ALL_SITES;
    const list = this.sites.list();
    return !list || list.some((s) => s.id === raw) ? raw : ALL_SITES;
  });

  readonly siteInfo = computed(() => {
    const id = this.site();
    return id === ALL_SITES ? null : (this.sites.byId(id) ?? null);
  });

  readonly siteLabel = computed(() => this.siteInfo()?.name ?? 'All sites');

  setSite(id: string): void {
    void this.router.navigate([], {
      queryParams: { site: id === ALL_SITES ? null : id },
      queryParamsHandling: 'merge',
    });
  }

  setPeriod(period: Period): void {
    void this.router.navigate([], {
      queryParams: { period: period === DEFAULT_PERIOD ? null : period },
      queryParamsHandling: 'merge',
    });
  }
}
