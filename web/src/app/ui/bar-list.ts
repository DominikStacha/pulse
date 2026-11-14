import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Row } from '../core/api';
import { flag, formatNumber, formatPercent } from '../core/format';
import { SitesService } from '../core/sites';
import { SiteIcon } from './site-icon';

export type RowIcon = 'none' | 'flag' | 'site';

/**
 * Ranked rows with a bar behind each label. Bars grow in on first paint, then
 * glide to their new width when the tab or period changes (rows keep their key).
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
            class="bar absolute inset-y-0 left-0 origin-left rounded-lg"
            [style.width.%]="100"
            [style.transform]="'scaleX(' + row.fill + ')'"
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
              <pl-site-icon class="relative" [domain]="row.domain" [size]="18" />
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
  styles: `
    .bar {
      transition: transform 0.8s var(--ease-out);
      animation: bar-in 0.9s var(--ease-out) backwards;
      animation-delay: calc(var(--i, 0) * 45ms);
    }
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
      label: r.label,
      value: formatNumber(r[metric]),
      share: formatPercent(r.share),
      fill: Math.max(0.02, (r[metric] / max) * 0.96),
      flag: flag(r.key),
      domain: this.icon() === 'site' ? (this.sites.byId(r.key ?? '')?.domain ?? r.label) : null,
      title: `${r.label}: ${formatNumber(r.visitors)} visitors, ${formatNumber(r.count)} ${this.metric() === 'count' ? 'events' : 'pageviews'}`,
    }));
  });
}
