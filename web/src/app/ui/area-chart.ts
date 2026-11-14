import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { Bucket, Point } from '../core/api';
import { formatCompact, formatNumber } from '../core/format';
import { axisLabel, tooltipLabel } from '../core/period';
import { Pt, areaPath, monotonePath, nearestIndex, niceScale, scaleLinear } from './chart-math';
import { hostWidth } from './resize';

const PHONE = 520;

/**
 * Visitors + pageviews over time, with the previous period as a ghost line,
 * a crosshair and a tooltip. Drawn in real pixels from the host's width.
 */
@Component({
  selector: 'pl-area-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'relative block touch-pan-y rounded-lg outline-offset-4',
    '[style.height.px]': 'height()',
    tabindex: '0',
    role: 'group',
    '[attr.aria-label]': 'summary()',
    '(keydown)': 'key($event)',
    '(blur)': 'hover.set(null)',
  },
  template: `
    @if (width() > 0) {
      <svg
        class="absolute inset-0 overflow-visible"
        [attr.width]="width()"
        [attr.height]="height()"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="fill-visitors" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="var(--color-sodium)" stop-opacity="0.34" />
            <stop offset="1" stop-color="var(--color-sodium)" stop-opacity="0" />
          </linearGradient>
          <linearGradient id="fill-pageviews" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="var(--color-peri)" stop-opacity="0.16" />
            <stop offset="1" stop-color="var(--color-peri)" stop-opacity="0" />
          </linearGradient>
        </defs>

        @for (tick of scale().ticks; track tick) {
          <line
            [attr.x1]="plot().l"
            [attr.x2]="plot().r"
            [attr.y1]="y()(tick)"
            [attr.y2]="y()(tick)"
            stroke="var(--color-line)"
            stroke-dasharray="2 5"
            [attr.opacity]="tick === 0 ? 1 : 0.7"
          />
          <text
            [attr.x]="plot().l - 10"
            [attr.y]="y()(tick) + 4"
            text-anchor="end"
            class="num"
            fill="var(--color-faint)"
            font-size="11"
          >
            {{ compact(tick) }}
          </text>
        }
        @for (label of xLabels(); track label.x) {
          <text
            [attr.x]="label.x"
            [attr.y]="plot().b + 20"
            text-anchor="middle"
            fill="var(--color-faint)"
            font-size="11"
          >
            {{ label.text }}
          </text>
        }

        @for (key of [replayKey()]; track key) {
          <g>
            @if (showPrevious()) {
              @if (showPageviews()) {
                <path
                  [attr.d]="curves().prevPageviews"
                  fill="none"
                  stroke="var(--color-peri)"
                  stroke-opacity="0.4"
                  stroke-width="1.25"
                  stroke-dasharray="3 5"
                  style="animation: fade-in 1s 0.6s backwards"
                />
              }
              @if (showVisitors()) {
                <path
                  [attr.d]="curves().prevVisitors"
                  fill="none"
                  stroke="var(--color-sodium)"
                  stroke-opacity="0.45"
                  stroke-width="1.25"
                  stroke-dasharray="3 5"
                  style="animation: fade-in 1s 0.6s backwards"
                />
              }
            }
            @if (showPageviews()) {
              <path
                [attr.d]="curves().pageviewsArea"
                fill="url(#fill-pageviews)"
                style="animation: fade-in 1s 0.5s backwards"
              />
              <path
                [attr.d]="curves().pageviews"
                fill="none"
                stroke="var(--color-peri)"
                stroke-width="1.75"
                stroke-linecap="round"
                stroke-linejoin="round"
                pathLength="1"
                stroke-dasharray="1"
                stroke-dashoffset="1"
                style="animation: draw 1.3s var(--ease-out) 0.1s forwards"
              />
            }
            @if (showVisitors()) {
              <path
                [attr.d]="curves().visitorsArea"
                fill="url(#fill-visitors)"
                style="animation: fade-in 1s 0.5s backwards"
              />
              <path
                [attr.d]="curves().visitors"
                fill="none"
                stroke="var(--color-sodium)"
                stroke-width="2.25"
                stroke-linecap="round"
                stroke-linejoin="round"
                pathLength="1"
                stroke-dasharray="1"
                stroke-dashoffset="1"
                style="filter: drop-shadow(0 0 7px rgb(255 166 61 / 0.55)); animation: draw 1.3s var(--ease-out) forwards"
              />
            }
          </g>
        }

        @if (cursor(); as c) {
          <line
            [attr.x1]="c.x"
            [attr.x2]="c.x"
            [attr.y1]="plot().t"
            [attr.y2]="plot().b"
            stroke="var(--color-sub)"
            stroke-opacity="0.45"
          />
          @if (showPageviews()) {
            <circle
              [attr.cx]="c.x"
              [attr.cy]="c.yPageviews"
              r="4"
              fill="var(--color-peri)"
              stroke="var(--color-bg)"
              stroke-width="2"
            />
          }
          @if (showVisitors()) {
            <circle
              [attr.cx]="c.x"
              [attr.cy]="c.yVisitors"
              r="4.5"
              fill="var(--color-sodium)"
              stroke="var(--color-bg)"
              stroke-width="2"
            />
          }
        }
      </svg>

      @if (empty()) {
        <p class="pointer-events-none absolute inset-x-0 top-[38%] text-center text-sm text-faint">
          No visits in this period yet
        </p>
      }

      <div
        class="absolute"
        [style.left.px]="plot().l"
        [style.top.px]="plot().t"
        [style.width.px]="plot().r - plot().l"
        [style.height.px]="plot().b - plot().t"
        (pointermove)="move($event)"
        (pointerdown)="move($event)"
        (pointerleave)="hover.set(null)"
      ></div>

      @if (cursor(); as c) {
        <div
          class="pointer-events-none absolute z-10 w-44 rounded-xl border border-line bg-raised/95 p-3 text-xs shadow-2xl backdrop-blur"
          [style.left.px]="c.flip ? c.x - 14 : c.x + 14"
          [style.top.px]="plot().t + 6"
          [style.transform]="c.flip ? 'translateX(-100%)' : null"
        >
          <p class="mb-2 font-medium text-ink">{{ c.title }}</p>
          @if (showVisitors()) {
            <p class="flex items-center justify-between gap-3 text-sub">
              <span class="flex items-center gap-1.5"
                ><i class="size-2 rounded-full bg-sodium"></i>Visitors</span
              >
              <span class="num text-ink">{{ n(c.visitors) }}</span>
            </p>
          }
          @if (showPageviews()) {
            <p class="mt-1 flex items-center justify-between gap-3 text-sub">
              <span class="flex items-center gap-1.5"
                ><i class="size-2 rounded-full bg-peri"></i>Pageviews</span
              >
              <span class="num text-ink">{{ n(c.pageviews) }}</span>
            </p>
          }
          @if (showPrevious() && c.before; as before) {
            <p class="mt-2 border-t border-line pt-2 text-faint">
              {{ before.title }}<br />
              <span class="num"
                >{{ n(before.visitors) }} visitors · {{ n(before.pageviews) }} views</span
              >
            </p>
          }
        </div>
      }
      <p class="sr-only" aria-live="polite">{{ liveText() }}</p>
    }
  `,
})
export class AreaChart {
  readonly points = input.required<readonly Point[]>();
  readonly previous = input<readonly Point[]>([]);
  readonly bucket = input.required<Bucket>();
  readonly showVisitors = input(true);
  readonly showPageviews = input(true);
  readonly showPrevious = input(true);
  /** Changes when the data is for a new site/period, so the lines draw in again. */
  readonly replayKey = input('');

  protected readonly width = hostWidth();
  protected readonly hover = signal<number | null>(null);
  protected readonly compact = formatCompact;
  protected readonly n = formatNumber;

  protected readonly height = computed(() => (this.width() < PHONE ? 240 : 320));
  protected readonly plot = computed(() => {
    const phone = this.width() < PHONE;
    return {
      l: phone ? 36 : 46,
      r: this.width() - (phone ? 22 : 26),
      t: 12,
      b: this.height() - 30,
    };
  });

  protected readonly scale = computed(() => {
    let max = 0;
    for (const p of this.points()) {
      if (this.showVisitors()) max = Math.max(max, p.visitors);
      if (this.showPageviews()) max = Math.max(max, p.pageviews);
    }
    if (this.showPrevious()) {
      for (const p of this.previous()) {
        if (this.showVisitors()) max = Math.max(max, p.visitors);
        if (this.showPageviews()) max = Math.max(max, p.pageviews);
      }
    }
    return niceScale(max);
  });

  protected readonly y = computed(() =>
    scaleLinear([0, this.scale().top], [this.plot().b, this.plot().t]),
  );

  private readonly xs = computed(() => {
    const { l, r } = this.plot();
    const n = this.points().length;
    return this.points().map((_, i) => (n === 1 ? (l + r) / 2 : l + (i / (n - 1)) * (r - l)));
  });

  protected readonly empty = computed(() =>
    this.points().every((p) => p.visitors === 0 && p.pageviews === 0),
  );

  protected readonly curves = computed(() => {
    const xs = this.xs();
    const y = this.y();
    const base = this.plot().b;
    const build = (
      list: readonly Point[],
      pick: (p: Point) => number,
    ): { d: string; area: string } => {
      const pts: Pt[] = list.slice(0, xs.length).map((p, i) => ({ x: xs[i], y: y(pick(p)) }));
      const d = monotonePath(pts);
      return { d, area: areaPath(d, pts, base) };
    };
    const visitors = build(this.points(), (p) => p.visitors);
    const pageviews = build(this.points(), (p) => p.pageviews);
    return {
      visitors: visitors.d,
      visitorsArea: visitors.area,
      pageviews: pageviews.d,
      pageviewsArea: pageviews.area,
      prevVisitors: build(this.previous(), (p) => p.visitors).d,
      prevPageviews: build(this.previous(), (p) => p.pageviews).d,
    };
  });

  protected readonly xLabels = computed(() => {
    const xs = this.xs();
    const { l, r } = this.plot();
    const n = xs.length;
    if (n === 0) return [];
    const bucket = this.bucket();
    const maxLabels = Math.max(2, Math.floor((r - l) / (bucket === 'hour' ? 64 : 76)));
    const step = Math.ceil(n / maxLabels);
    const labels: { x: number; text: string }[] = [];
    for (let i = 0; i < n; i += step)
      labels.push({ x: xs[i], text: axisLabel(this.points()[i].t, bucket) });
    return labels;
  });

  protected readonly cursor = computed(() => {
    const i = this.hover();
    const point = i === null ? undefined : this.points()[i];
    if (i === null || !point) return null;
    const x = this.xs()[i];
    const y = this.y();
    const before = this.previous()[i];
    return {
      x,
      yVisitors: y(point.visitors),
      yPageviews: y(point.pageviews),
      title: tooltipLabel(point.t, this.bucket()),
      visitors: point.visitors,
      pageviews: point.pageviews,
      before: before
        ? {
            title: `Before: ${tooltipLabel(before.t, this.bucket())}`,
            visitors: before.visitors,
            pageviews: before.pageviews,
          }
        : null,
      flip: x > this.width() * 0.58,
    };
  });

  protected readonly summary = computed(() => {
    const points = this.points();
    if (points.length === 0) return 'Visitors and pageviews over time: no data';
    const peak = points.reduce((a, b) => (b.visitors > a.visitors ? b : a));
    const total = points.reduce((sum, p) => sum + p.pageviews, 0);
    return `Visitors and pageviews over time, ${points.length} ${this.bucket()} buckets, ${formatNumber(total)} pageviews. Busiest: ${tooltipLabel(peak.t, this.bucket())} with ${formatNumber(peak.visitors)} visitors. Use arrow keys to inspect.`;
  });

  protected readonly liveText = computed(() => {
    const c = this.cursor();
    return c
      ? `${c.title}: ${formatNumber(c.visitors)} visitors, ${formatNumber(c.pageviews)} pageviews`
      : '';
  });

  protected move(event: PointerEvent): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const n = this.points().length;
    if (n === 0) return;
    const { l, r } = this.plot();
    this.hover.set(nearestIndex(event.clientX - rect.left + l, l, r, n));
  }

  protected key(event: KeyboardEvent): void {
    const n = this.points().length;
    if (n === 0) return;
    const at = this.hover();
    const moves: Record<string, number> = {
      ArrowLeft: at === null ? n - 1 : Math.max(0, at - 1),
      ArrowRight: at === null ? n - 1 : Math.min(n - 1, at + 1),
      Home: 0,
      End: n - 1,
    };
    if (event.key === 'Escape') this.hover.set(null);
    else if (event.key in moves) {
      event.preventDefault();
      this.hover.set(moves[event.key]);
    }
  }
}
