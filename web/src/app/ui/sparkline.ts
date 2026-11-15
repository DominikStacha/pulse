import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { SparkSample, areaPath, linePath, monotonePath, sparkGeometry } from './chart-math';
import { hostWidth } from './resize';
import { touchHold } from './touch-hold';

let nextId = 0;

/** A `t` above this is unix seconds (it is September 2001); anything smaller is just an index. */
const EPOCH_SECONDS = 1e9;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A small line with a soft fill. Optionally inspectable, for the 24 h history on the status
 * page: hover or touch, or focus it and use the arrow keys. When the samples carry unix
 * seconds and the window crosses midnight, the tooltip also names the day.
 */
@Component({
  selector: 'pl-sparkline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'relative block rounded-md outline-offset-4',
    '[style.height.px]': 'height()',
    '[attr.tabindex]': 'interactive() ? 0 : null',
    '[attr.role]': "interactive() ? 'group' : null",
    '[attr.aria-label]': "interactive() ? label() + '. Use arrow keys to inspect.' : null",
    '(keydown)': 'key($event)',
    '(blur)': 'hover.set(null)',
    '(document:pointerdown)': 'outside($event)',
  },
  template: `
    @if (width() > 0) {
      <svg
        class="absolute inset-0 overflow-visible"
        [attr.width]="width()"
        [attr.height]="height()"
        [attr.role]="interactive() ? null : 'img'"
        [attr.aria-label]="interactive() ? null : label()"
        [attr.aria-hidden]="interactive() ? true : null"
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
          (pointerdown)="move($event)"
          (pointerup)="hold.lift($event)"
          (pointerleave)="hold.leave($event)"
          (pointercancel)="hold.cancel()"
        ></div>
        @if (marker(); as m) {
          <span
            class="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-bg"
            [style.left.px]="m.x"
            [style.top.px]="m.y"
            [style.background]="color()"
          ></span>
          <span
            class="num pointer-events-none absolute bottom-full z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-line bg-raised px-2 py-1 text-center text-xs text-ink shadow-lg"
            [style.left.px]="m.tipLeft"
          >
            @if (m.day) {
              <span class="block text-faint">{{ m.day }}</span>
            }
            {{ m.tip }}
          </span>
        }
        <p class="sr-only" aria-live="polite">{{ liveText() }}</p>
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

  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  protected readonly gradientId = `spark-${nextId++}`;
  protected readonly width = hostWidth();
  protected readonly hover = signal<number | null>(null);
  protected readonly hold = touchHold(() => this.hover.set(null));

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

  /** Unix-seconds samples whose window spans two calendar days (local time). */
  private readonly crossesMidnight = computed(() => {
    const list = this.samples();
    if (list.length < 2 || list[0].t < EPOCH_SECONDS) return false;
    return (
      new Date(list[0].t * 1000).toDateString() !==
      new Date(list[list.length - 1].t * 1000).toDateString()
    );
  });

  protected readonly marker = computed(() => {
    const i = this.hover();
    const plotted = this.geometry().plotted;
    if (i === null || plotted.length === 0) return null;
    const p = plotted[Math.min(plotted.length - 1, Math.max(0, i))];
    const w = this.width();
    const t = this.samples()[p.index]?.t ?? 0;
    const d = new Date(t * 1000);
    return {
      x: p.x,
      y: p.y,
      tip: this.tip()(p.index),
      day: this.crossesMidnight()
        ? `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`
        : '',
      // The pill is about 110px wide and centred on the point; keep both ends inside.
      tipLeft: Math.min(w - 56, Math.max(56, p.x)),
    };
  });

  protected readonly liveText = computed(() => {
    const m = this.marker();
    return m ? [m.day, m.tip].filter(Boolean).join(', ') : '';
  });

  protected move(event: PointerEvent): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const count = this.geometry().plotted.length;
    if (rect.width <= 0 || count === 0) return;
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    this.hold.keep();
    this.hover.set(Math.round(ratio * (count - 1)));
  }

  /** A touch readout stays after the finger lifts; tapping anywhere else puts it away. */
  protected outside(event: PointerEvent): void {
    if (this.hover() !== null && !this.el.contains(event.target as Node)) this.hold.cancel();
  }

  protected key(event: KeyboardEvent): void {
    const count = this.geometry().plotted.length;
    if (!this.interactive() || count === 0) return;
    const at = this.hover();
    const moves: Record<string, number> = {
      ArrowLeft: at === null ? count - 1 : Math.max(0, at - 1),
      ArrowRight: at === null ? count - 1 : Math.min(count - 1, at + 1),
      Home: 0,
      End: count - 1,
    };
    if (event.key === 'Escape') this.hover.set(null);
    else if (event.key in moves) {
      event.preventDefault();
      this.hold.keep();
      this.hover.set(moves[event.key]);
    }
  }
}
