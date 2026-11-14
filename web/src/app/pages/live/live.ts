import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { Context } from '../../core/context';
import { Clock } from '../../core/clock';
import { countryName, flag, formatAgoShort } from '../../core/format';
import { LiveService } from '../../core/live';
import { SitesService } from '../../core/sites';
import { CountUp } from '../../ui/count-up';
import { PageHeader } from '../../ui/page-header';
import { SiteIcon } from '../../ui/site-icon';
import { Pulse, WorldMap } from '../../ui/world-map/world-map';

const PULSE_MS = 3600;
const FEED_ROWS = 40;

@Component({
  selector: 'pl-live',
  imports: [CountUp, PageHeader, SiteIcon, WorldMap],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './live.html',
})
export class LivePage {
  protected readonly live = inject(LiveService);
  protected readonly ctx = inject(Context);
  private readonly sites = inject(SitesService);
  private readonly clock = inject(Clock);

  protected readonly pulses = signal<Pulse[]>([]);
  /** Rows that were already in the feed when the page opened do not flash. */
  private readonly baseline = this.live.recent()[0]?.id ?? 0;

  protected readonly count = computed(() => this.live.activeFor(this.ctx.site()));
  protected readonly flag = flag;

  protected readonly feed = computed(() => {
    const site = this.ctx.site();
    const now = this.clock.now();
    return this.live
      .recent()
      .filter((h) => site === 'all' || h.siteId === site)
      .slice(0, FEED_ROWS)
      .map((h) => ({
        ...h,
        fresh: h.id > this.baseline,
        age: formatAgoShort(now - Date.parse(h.ts)),
        domain: this.sites.byId(h.siteId)?.domain ?? h.siteId,
        place: countryName(h.country),
      }));
  });

  protected readonly perSite = computed(() => {
    const counts = this.live.perSite();
    return (this.sites.list() ?? [])
      .map((s) => ({ site: s, active: counts[s.id] ?? 0 }))
      .sort((a, b) => b.active - a.active || a.site.name.localeCompare(b.site.name));
  });

  protected readonly maxActive = computed(() =>
    Math.max(1, ...this.perSite().map((r) => r.active)),
  );

  constructor() {
    effect(() => {
      const hit = this.live.lastHit();
      if (!hit || hit.id <= this.baseline) return;
      untracked(() => {
        const site = this.ctx.site();
        if (site !== 'all' && hit.siteId !== site) return;
        this.pulses.update((list) => [...list, { id: hit.id, country: hit.country }]);
        setTimeout(
          () => this.pulses.update((list) => list.filter((p) => p.id !== hit.id)),
          PULSE_MS,
        );
      });
    });
  }
}
