import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { SparkSample, areaPath, linePath, monotonePath, sparkGeometry } from './chart-math';
import { hostWidth } from './resize';

let nextId = 0;

/** A small line with a soft fill. Optionally hoverable, for the 24 h history on the status page. */
@Component({
  selector: 'pl-sparkline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'relative block', '[style.height.px]': 'height()' },
  template: `
    @if (width() > 0) {
      <svg
        class="absolute inset-0 overflow-visible"
        [attr.width]="width()"
        [attr.height]="height()"
        role="img"
        [attr.aria-label]="label()"
      >
        <defs>
          <linearGradient [attr.id]="gradientId" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" [attr.stop-color]="color()" stop-opacity="0.32" />
            <stop offset="1" [attr.stop-color]="color()" stop-opacity="0" />
          </linearGradient>
        </defs>
        @for (seg of paths(); track $index) {
          <path
            [attr.d]="seg.area"
            [attr.fill]="'url(#' + gradientId + ')'"
            style="animation: fade-in 0.9s 0.35s backwards"
          />
          <path
            [attr.d]="seg.line"
            fill="none"
            [attr.stroke]="color()"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
            pathLength="1"
            stroke-dasharray="1"
            stroke-dashoffset="1"
            style="animation: draw 1.1s var(--ease-out) 0.15s forwards"
          />
        }
      </svg>
      @if (interactive()) {
        <div
          class="absolute inset-0 cursor-crosshair touch-pan-y"
          (pointermove)="move($event)"
          (pointerleave)="hover.set(null)"
          (pointerdown)="move($event)"
        ></div>
        @if (marker(); as m) {
          <span
            class="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-bg"
            [style.left.px]="m.x"
            [style.top.px]="m.y"
            [style.background]="color()"
          ></span>
          <span
            class="num pointer-events-none absolute bottom-full z-10 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md border border-line bg-raised px-2 py-1 text-xs text-ink shadow-lg"
            [style.left.px]="m.tipLeft"
          >
            {{ m.tip }}
          </span>
        }
      }
    }
  `,
})
export class Sparkline {
  readonly samples = input.required<readonly SparkSample[]>();
  readonly color = input('var(--color-sodium)');
  readonly label = input('Trend');
  readonly height = input(40);
  readonly smooth = input(true);
  readonly minSpan = input(0);
  readonly gapAfter = input<number | undefined>(undefined);
  readonly interactive = input(false);
  /** Tooltip text for the sample at this index of `samples`. */
  readonly tip = input<(index: number) => string>(() => '');

  protected readonly gradientId = `spark-${nextId++}`;
  protected readonly width = hostWidth();
  protected readonly hover = signal<number | null>(null);

  private readonly geometry = computed(() =>
    sparkGeometry(this.samples(), {
      width: this.width(),
      height: this.height(),
      minSpan: this.minSpan(),
      gapAfter: this.gapAfter(),
    }),
  );

  protected readonly paths = computed(() =>
    this.geometry().segments.map((seg) => {
      const line = this.smooth() ? monotonePath(seg) : linePath(seg);
      return { line, area: areaPath(line, seg, this.height()) };
    }),
  );

  protected readonly marker = computed(() => {
    const i = this.hover();
    const plotted = this.geometry().plotted;
    if (i === null || plotted.length === 0) return null;
    const p = plotted[Math.min(plotted.length - 1, Math.max(0, i))];
    const w = this.width();
    return {
      x: p.x,
      y: p.y,
      tip: this.tip()(p.index),
      tipLeft: Math.min(w - 40, Math.max(40, p.x)),
    };
  });

  protected move(event: PointerEvent): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const count = this.geometry().plotted.length;
    if (rect.width <= 0 || count === 0) return;
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    this.hover.set(Math.round(ratio * (count - 1)));
  }
}
