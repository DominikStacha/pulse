import {
  ChangeDetectionStrategy,
  Component,
  WritableSignal,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Summary, Timeseries, Totals } from '../../core/api';
import { Context } from '../../core/context';
import { Delta, delta, formatNumber, formatPercent, formatSeconds } from '../../core/format';
import { periodLong } from '../../core/period';
import { stat } from '../../core/stat';
import { AreaChart } from '../../ui/area-chart';
import { Tab, BreakdownPanel } from '../../ui/breakdown-panel';
import { CountUp } from '../../ui/count-up';
import { Icon } from '../../ui/icon';
import { PageHeader } from '../../ui/page-header';
import { Sparkline } from '../../ui/sparkline';
import { StateMessage } from '../../ui/state-message';
import { CountriesPanel } from './countries-panel';

interface Kpi {
  key: string;
  label: string;
  value: number;
  format: (n: number) => string;
  delta: Delta;
  /** Is a rise good news? (Not for bounce rate.) */
  upIsGood: boolean;
  previous: string;
  color: string;
  series: 'visitors' | 'visits' | 'pageviews' | null;
  /** Draws two thin bars (now, and ghosted: before) instead of a sparkline. Both 0-1. */
  meter: { now: number; before: number } | null;
}

const PAGES: Tab[] = [
  { id: 'pages', label: 'Pages' },
  { id: 'entries', label: 'Entry' },
  { id: 'exits', label: 'Exit' },
];
const REFERRERS: Tab[] = [{ id: 'referrers', label: 'Referrers' }];
const TECH: Tab[] = [
  { id: 'browsers', label: 'Browsers' },
  { id: 'os', label: 'OS' },
  { id: 'devices', label: 'Devices' },
];
const LANGUAGES: Tab[] = [{ id: 'languages', label: 'Languages' }];
const EVENTS: Tab[] = [{ id: 'events', label: 'Events' }];
const SITES: Tab[] = [{ id: 'sites', label: 'Sites' }];

@Component({
  selector: 'pl-overview',
  imports: [
    AreaChart,
    BreakdownPanel,
    CountriesPanel,
    CountUp,
    Icon,
    PageHeader,
    Sparkline,
    StateMessage,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './overview.html',
})
export class Overview {
  protected readonly ctx = inject(Context);
  protected readonly summary = stat<Summary>('summary');
  protected readonly series = stat<Timeseries>('timeseries');

  protected readonly pages = PAGES;
  protected readonly referrers = REFERRERS;
  protected readonly tech = TECH;
  protected readonly languages = LANGUAGES;
  protected readonly events = EVENTS;
  protected readonly sites = SITES;
  protected readonly skeletons = [0, 1, 2, 3, 4];

  protected readonly showVisitors = signal(true);
  protected readonly showPageviews = signal(true);
  protected readonly showPrevious = signal(true);

  protected readonly subtitle = computed(
    () => `${this.ctx.siteLabel()} · ${periodLong(this.ctx.period())}`,
  );
  protected readonly bucketName = computed(
    () => ({ hour: 'Hourly', day: 'Daily', month: 'Monthly' })[this.series.data()?.bucket ?? 'day'],
  );

  protected readonly kpis = computed<Kpi[] | null>(() => {
    const s = this.summary.data();
    if (!s) return null;
    const { current: c, previous: p } = s;
    const count = (
      key: Extract<keyof Totals, string>,
      label: string,
      color: string,
      series: Kpi['series'],
    ): Kpi => ({
      key,
      label,
      value: c[key],
      format: formatNumber,
      delta: delta(c[key], p[key]),
      upIsGood: true,
      previous: formatNumber(p[key]),
      color,
      series,
      meter: null,
    });
    const avgMax = Math.max(1, c.avgVisitSeconds, p.avgVisitSeconds);
    return [
      count('visitors', 'Visitors', 'var(--color-sodium)', 'visitors'),
      count('visits', 'Visits', '#b8c9ce', 'visits'),
      count('pageviews', 'Pageviews', 'var(--color-peri)', 'pageviews'),
      {
        key: 'bounceRate',
        label: 'Bounce rate',
        value: c.bounceRate * 100,
        format: (n) => formatPercent(n / 100),
        delta: delta(c.bounceRate, p.bounceRate),
        upIsGood: false,
        previous: formatPercent(p.bounceRate),
        color: '#b8c9ce',
        series: null,
        meter: { now: c.bounceRate, before: p.bounceRate },
      },
      {
        key: 'avgVisitSeconds',
        label: 'Avg. visit',
        value: c.avgVisitSeconds,
        format: formatSeconds,
        delta: delta(c.avgVisitSeconds, p.avgVisitSeconds),
        upIsGood: true,
        previous: formatSeconds(p.avgVisitSeconds),
        color: '#b8c9ce',
        series: null,
        meter: { now: c.avgVisitSeconds / avgMax, before: p.avgVisitSeconds / avgMax },
      },
    ];
  });

  protected readonly sparks = computed(() => {
    const points = this.series.data()?.points ?? [];
    const pick = (k: 'visitors' | 'visits' | 'pageviews') => points.map((p, t) => ({ t, y: p[k] }));
    return { visitors: pick('visitors'), visits: pick('visits'), pageviews: pick('pageviews') };
  });

  protected readonly hasData = computed(() =>
    (this.series.data()?.points ?? []).some((p) => p.pageviews > 0),
  );

  /** Changes when a different dataset arrives, so the chart draws itself in again. */
  protected readonly replayKey = computed(() => {
    const d = this.series.data();
    return d
      ? `${d.bucket}|${d.points[0]?.t}|${d.points.length}|${d.points.reduce((a, p) => a + p.pageviews, 0)}`
      : '';
  });

  protected tone(k: Kpi): 'good' | 'bad' | 'flat' {
    const { direction } = k.delta;
    if (direction === 'flat') return 'flat';
    if (direction === 'new') return 'good';
    return (direction === 'up') === k.upIsGood ? 'good' : 'bad';
  }

  protected toggle(flag: WritableSignal<boolean>): void {
    flag.update((v) => !v);
  }
}
