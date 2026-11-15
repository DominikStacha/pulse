import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Row } from '../core/api';
import { flag, formatNumber, formatPercent } from '../core/format';
import { SitesService } from '../core/sites';
import { SiteIcon } from './site-icon';

export type RowIcon = 'none' | 'flag' | 'site';

/**
 * Ranked rows with a bar behind each label. The leader's bar spans the whole row. Bars
 * wipe in on first paint, then glide to their new length when the tab or period changes
 * (rows keep their key). They are clipped, not scaled, so the rounded ends stay round.
 */
@Component({
  selector: 'pl-bar-list',
  imports: [SiteIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <ul class="space-y-1">
      @for (row of view(); track row.id; let i = $index) {
        <li
          class="group relative flex h-9 items-center gap-2.5 overflow-hidden rounded-lg px-2.5 transition-colors hover:bg-white/[0.04]"
          [title]="row.title"
        >
          <span
            aria-hidden="true"
            class="bar-fill absolute inset-0"
            [style.--fill]="row.fill"
            [style.--i]="i"
            [style.background]="color()"
          ></span>
          @switch (icon()) {
            @case ('flag') {
              <span
                class="relative w-5 shrink-0 text-center text-[15px] leading-none"
                aria-hidden="true"
                >{{ row.flag || '🌐' }}</span
              >
            }
            @case ('site') {
              <pl-site-icon class="relative" [siteId]="row.key" [domain]="row.domain" [size]="18" />
            }
          }
          <span class="relative min-w-0 flex-1 truncate text-[13.5px] text-ink">{{
            row.label
          }}</span>
          <span class="num relative text-[13.5px] font-medium text-ink">{{ row.value }}</span>
          @if (showShare()) {
            <span class="num relative w-10 text-right text-xs text-faint">{{ row.share }}</span>
          }
        </li>
      }
    </ul>
  `,
})
export class BarList {
  readonly rows = input.required<readonly Row[]>();
  readonly metric = input<'visitors' | 'count'>('visitors');
  readonly icon = input<RowIcon>('none');
  readonly color = input('linear-gradient(90deg, rgb(255 166 61 / 0.2), rgb(255 166 61 / 0.07))');
  readonly showShare = input(true);

  private readonly sites = inject(SitesService);

  protected readonly view = computed(() => {
    const rows = this.rows();
    const metric = this.metric();
    const max = Math.max(1, ...rows.map((r) => r[metric]));
    return rows.map((r) => ({
      id: r.key ?? '(none)',
      key: r.key,
      label: r.label,
      value: formatNumber(r[metric]),
      share: formatPercent(r.share),
      fill: Math.max(0.02, r[metric] / max),
      flag: flag(r.key),
      // The label stands in for the domain only so the monogram has a letter; it is never looked up.
      domain: this.icon() === 'site' ? (this.sites.byId(r.key ?? '')?.domain ?? r.label) : null,
      title: `${r.label}: ${formatNumber(r.visitors)} visitors, ${formatNumber(r.count)} ${this.metric() === 'count' ? 'events' : 'pageviews'}`,
    }));
  });
}
