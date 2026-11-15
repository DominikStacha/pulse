import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { geoArea, geoGraticule10, geoNaturalEarth1, geoPath } from 'd3-geo';
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import { Row } from '../../core/api';
import { formatNumber } from '../../core/format';
import { PART_OF, alpha2Of } from './country-codes';
import {
  Box,
  IDENTITY,
  MAX_ZOOM,
  MIN_ZOOM,
  Touchpoint,
  View,
  ZOOM_STEP,
  constrain,
  dotRadius,
  fitView,
  gesture,
  haloOpacity,
  haloRadius,
  interpolateView,
  mixPercent,
  sameView,
  showDot,
  wheelFactor,
  zoomAt,
} from './map-zoom';

const W = 960;
const H = 500;

/** Pointer travel (px) that still counts as a tap, and the windows for a double tap. */
const TAP_SLOP = 10;
const TAP_MS = 400;
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_PX = 30;
const ZOOM_MS = 280;
/** How long a tap keeps the country tooltip open. */
const TIP_MS = 2500;
/** Arrow-key pan step, in viewBox units. */
const PAN_STEP = 70;
const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.userAgent);

export interface Pulse {
  id: number;
  country: string | null;
}

interface Country {
  code: string;
  name: string;
  d: string;
  cx: number;
  cy: number;
  /** Projected extent; a light dot marks countries too small to see at the current zoom. */
  size: number;
  /** Extent of the main landmass, to frame the countries with visitors. */
  box: Box;
  /** Staggers the "lights coming on" fade. */
  delay: number;
  /** A separately drawn piece of another country (Somaliland, N. Cyprus): lit with it, but no dot or tooltip of its own. */
  part: boolean;
}

interface Geography {
  sphere: string;
  graticule: string;
  countries: Country[];
}

const LAND = '#112129';

/** Land colour with amber mixed in by intensity `t` (0-1); the legend uses the same. */
const fillFor = (t: number): string =>
  `color-mix(in oklab, ${LAND}, var(--color-sodium) ${mixPercent(t)}%)`;

const CONTROLS = [
  { id: 'in', label: 'Zoom in', key: '+', icon: 'M12 5v14M5 12h14' },
  { id: 'out', label: 'Zoom out', key: '-', icon: 'M5 12h14' },
  {
    id: 'reset',
    label: 'Reset view',
    key: '0',
    icon: 'M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3',
  },
] as const;

let nextId = 0;

/**
 * A night-side world: land is dark, countries with visitors light up in
 * sodium amber by share. Hits on the Live page ring out from their country.
 *
 * Zoom and pan (1x-8x). The page keeps scrolling normally: the wheel zooms only
 * with Ctrl/Cmd held (a trackpad pinch sends exactly that), and on touch one finger
 * scrolls the page until the map is zoomed in, while two fingers always zoom.
 * Heavy (d3-geo + the 110m atlas), so it is only ever loaded through @defer.
 */
@Component({
  selector: 'pl-world-map',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'relative block w-full',
    // A tap anywhere else dismisses the tooltip a finger left open.
    '(document:pointerdown)': 'outside($event)',
  },
  template: `
    @if (geo(); as g) {
      <div
        #frame
        class="frame"
        tabindex="0"
        role="group"
        aria-label="World map, zoomable"
        [attr.aria-describedby]="helpId"
        (keydown)="key($event)"
        (wheel)="wheel($event)"
      >
        <svg
          #svg
          [attr.viewBox]="'0 0 ' + w + ' ' + h"
          class="block h-auto w-full"
          [class.grab]="zoomed() && !dragging()"
          [class.grabbing]="dragging()"
          [style.touch-action]="engaged() ? 'none' : 'pan-x pan-y'"
          role="img"
          [attr.aria-label]="ariaLabel()"
          (pointerdown)="down($event)"
          (pointermove)="move($event)"
          (pointerup)="up($event)"
          (pointercancel)="cancel($event)"
          (pointerleave)="leave($event)"
          (dblclick)="dbl($event)"
        >
          <defs>
            <radialGradient id="ocean" cx="50%" cy="46%" r="62%">
              <stop offset="0" stop-color="#10222b" />
              <stop offset="1" stop-color="#08121763" />
            </radialGradient>
            <radialGradient id="halo">
              <stop offset="0" stop-color="var(--color-sodium)" stop-opacity="0.95" />
              <stop offset="0.3" stop-color="var(--color-sodium)" stop-opacity="0.5" />
              <stop offset="1" stop-color="var(--color-sodium)" stop-opacity="0" />
            </radialGradient>
            <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur [attr.stdDeviation]="glowSpread()" />
            </filter>
          </defs>
          <g [attr.transform]="transform()">
            <path
              class="ns"
              [attr.d]="g.sphere"
              fill="url(#ocean)"
              stroke="var(--color-line)"
              stroke-width="0.8"
            />
            <path
              class="ns"
              [attr.d]="g.graticule"
              fill="none"
              stroke="rgb(255 255 255 / 0.035)"
              stroke-width="0.5"
            />
            @for (c of g.countries; track c.name) {
              <path
                class="ns"
                [attr.d]="c.d"
                [attr.data-code]="c.code"
                [style.fill]="fills().get(c.code) ?? land"
                stroke="#223842"
                stroke-width="0.5"
                stroke-linejoin="round"
                style="animation: fade-in 0.9s backwards; transition: fill 0.6s"
                [style.animation-delay.ms]="c.delay"
              />
            }
            <g filter="url(#glow)" class="pointer-events-none" opacity="0.55">
              @for (l of lit(); track l.name) {
                <path [attr.d]="l.d" fill="var(--color-sodium)" [attr.fill-opacity]="l.t * 0.55" />
              }
            </g>
            @for (b of beacons(); track b.code) {
              <g
                class="pointer-events-none"
                [attr.data-beacon]="b.code"
                [attr.transform]="b.transform"
              >
                <circle
                  class="halo"
                  [attr.r]="b.haloR"
                  fill="url(#halo)"
                  [style.opacity]="b.haloO"
                />
                <circle
                  class="core"
                  [class.on]="b.core"
                  [attr.r]="b.r"
                  fill="var(--color-sodium)"
                  fill-opacity="0.92"
                  style="filter: drop-shadow(0 0 5px rgb(255 166 61 / 0.9)); animation: fade-in 1.2s 0.9s backwards"
                />
              </g>
            }
            @for (o of hoverShapes(); track o.name) {
              <path class="ns country-hover pointer-events-none" [attr.d]="o.d" />
            }
            @for (p of pulseDots(); track p.id) {
              <g [attr.transform]="p.transform" class="pointer-events-none">
                <circle
                  r="4"
                  fill="var(--color-sodium)"
                  style="filter: drop-shadow(0 0 6px var(--color-sodium))"
                />
                <circle
                  r="46"
                  fill="none"
                  stroke="var(--color-sodium)"
                  stroke-width="2"
                  class="ring"
                />
                <circle
                  r="46"
                  fill="none"
                  stroke="var(--color-sodium)"
                  stroke-width="1.2"
                  class="ring ring-2"
                />
              </g>
            }
          </g>
        </svg>
        <div aria-hidden="true" class="edge" [class.on]="zoomed()"></div>
        @if (legend(); as l) {
          <div class="scale-key" role="img" [attr.aria-label]="l.label">
            <span>Fewer</span>
            @for (c of l.steps; track c) {
              <i [style.background]="c"></i>
            }
            <span>More</span>
          </div>
        }
        <div aria-hidden="true" class="hint" [class.on]="hintOn()">
          <span>{{ hintText() }}</span>
        </div>
        <div class="ctls">
          @for (c of controls; track c.id) {
            @if (c.id !== 'reset' || !atHome()) {
              <button
                type="button"
                class="ctl"
                [attr.aria-label]="c.label"
                [attr.aria-keyshortcuts]="c.key"
                [attr.aria-disabled]="off(c.id)"
                [attr.title]="c.label + ' (' + c.key + ')'"
                (click)="press(c.id)"
              >
                <span class="btn-face">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <path [attr.d]="c.icon" />
                  </svg>
                </span>
              </button>
            }
          }
        </div>
        <span class="sr-only" [id]="helpId">
          Press plus or minus to zoom, 0 to reset, and the arrow keys to move the map when zoomed
          in. Hold {{ modifier }} and scroll to zoom with the mouse.
        </span>
      </div>
      @if (tip(); as t) {
        <div
          class="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[130%] whitespace-nowrap rounded-lg border border-line bg-raised/95 px-2.5 py-1.5 text-xs shadow-xl backdrop-blur"
          [style.left.px]="t.x"
          [style.top.px]="t.y"
        >
          <span class="font-medium text-ink">{{ t.name }}</span>
          <span class="num ml-2 text-sub">{{ t.value }}</span>
        </div>
      }
    } @else {
      <div class="skeleton aspect-[960/500] w-full rounded-2xl" aria-busy="true"></div>
    }
  `,
  styleUrl: './world-map.css',
})
export class WorldMap {
  /** Countries breakdown (key = ISO-2). Empty on the Live page. */
  readonly rows = input<readonly Row[]>([]);
  readonly pulses = input<readonly Pulse[]>([]);

  protected readonly w = W;
  protected readonly h = H;
  protected readonly land = LAND;
  protected readonly modifier = MAC ? 'Cmd' : 'Ctrl';
  protected readonly helpId = `world-map-help-${nextId++}`;
  protected readonly geo = signal<Geography | null>(null);
  protected readonly hovered = signal<{ code: string; x: number; y: number } | null>(null);

  /** Current zoom and pan. */
  protected readonly view = signal<View>(IDENTITY, { equal: sameView });
  protected readonly zoomed = computed(() => this.view().k > MIN_ZOOM);
  protected readonly dragging = signal(false);
  protected readonly hintOn = signal(false);
  private readonly hintKind = signal<'wheel' | 'touch'>('wheel');
  protected readonly hintText = computed(() =>
    this.hintKind() === 'touch'
      ? 'Use two fingers to move or zoom'
      : `Use ${MAC ? '⌘' : 'Ctrl'} + scroll to zoom`,
  );

  protected readonly transform = computed(() => {
    const v = this.view();
    return `translate(${v.x} ${v.y}) scale(${v.k})`;
  });
  /** Lights and rings keep their on-screen size, so they are scaled against the zoom. */
  private readonly inverse = computed(() => 1 / this.view().k);
  protected readonly glowSpread = computed(() => 5 * this.inverse());

  protected readonly controls = CONTROLS;

  private readonly svg = viewChild<ElementRef<SVGSVGElement>>('svg');
  private readonly frame = viewChild<ElementRef<HTMLElement>>('frame');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private tap = { x: 0, y: 0, t: 0, ok: false };
  private lastTap: { x: number; y: number; t: number } | null = null;
  private lastTouchZoom = 0;
  private lastPointer: { x: number; y: number } | null = null;
  private raf = 0;
  private goal: View | null = null;
  private hintTimer: ReturnType<typeof setTimeout> | undefined;
  /** Set while a tap has the tooltip open (a finger has no hover to close it). */
  private tipTimer: ReturnType<typeof setTimeout> | undefined;
  /** The visitor has zoomed or panned: stop re-fitting the map when the data changes. */
  private touched = false;
  private fitted = false;

  private readonly rowByCode = computed(() => new Map(this.rows().map((r) => [r.key ?? '', r])));

  /** The country itself, not its separately drawn pieces. */
  private readonly countryByCode = computed(
    () =>
      new Map(
        this.geo()
          ?.countries.filter((c) => !c.part)
          .map((c) => [c.code, c] as const),
      ),
  );

  protected readonly fills = computed(() => {
    const rows = this.rows();
    const max = Math.max(1, ...rows.map((r) => r.visitors));
    return new Map(rows.map((r) => [r.key ?? '', fillFor(Math.sqrt(r.visitors / max))]));
  });

  /** Three steps of the choropleth, for the legend: a few visitors, some, the most. */
  protected readonly legend = computed(() => {
    const rows = this.rows();
    if (!rows.length) return null;
    const max = Math.max(...rows.map((r) => r.visitors));
    return {
      steps: [0.05, 0.3, 1].map((rel) => fillFor(Math.sqrt(rel))),
      label: `Legend: brighter amber means more visitors, up to ${formatNumber(max)} in the busiest country.`,
    };
  });

  /** Countries with visitors, with their intensity 0-1, for the glow layer and the beacons. */
  protected readonly lit = computed(() => {
    const countries = this.geo()?.countries;
    const rows = this.rows();
    if (!countries || !rows.length) return [];
    const max = Math.max(1, ...rows.map((r) => r.visitors));
    const byRow = this.rowByCode();
    return countries.flatMap((c) => {
      const r = byRow.get(c.code);
      return r ? [{ ...c, t: Math.sqrt(r.visitors / max), visitors: r.visitors }] : [];
    });
  });

  /**
   * A beacon per lit country: a glow sized by its share, so a small country with many
   * visitors reads next to a huge one with few, and a core dot for one too small to see
   * at all. Both fade out as the shape itself grows (zoom in). Always rendered, so they
   * can fade in and out.
   */
  protected readonly beacons = computed(() => {
    const k = this.view().k;
    return this.lit()
      .filter((l) => !l.part)
      .map((l) => ({
        code: l.code,
        transform: this.pinned(l.cx, l.cy),
        haloR: haloRadius(l.t),
        haloO: haloOpacity(l.size, l.t, k),
        r: dotRadius(l.t),
        core: showDot(l.size, l.t, k),
      }));
  });

  /** Every piece of the hovered country, drawn once more on top. */
  protected readonly hoverShapes = computed(() => {
    const code = this.hovered()?.code;
    return code ? (this.geo()?.countries.filter((c) => c.code === code) ?? []) : [];
  });

  /** The view that frames the countries with visitors; the whole world when there are none. */
  private readonly home = computed(() => {
    const lit = this.lit().filter((l) => !l.part);
    const total = lit.reduce((sum, l) => sum + l.visitors, 0);
    const items = lit
      .sort((a, b) => b.visitors - a.visitors)
      .map((l) => ({ box: l.box, share: l.visitors / total }));
    return fitView(items, W, H);
  });
  protected readonly atHome = computed(() => sameView(this.view(), this.home()));
  /** One finger pans the map (instead of scrolling the page) only once the visitor has moved it. */
  protected readonly engaged = computed(() => this.zoomed() && !this.atHome());

  protected readonly pulseDots = computed(() => {
    const byCode = this.countryByCode();
    return this.pulses().flatMap((p) => {
      const c = p.country ? byCode.get(p.country) : undefined;
      return c ? [{ id: p.id, transform: this.pinned(c.cx, c.cy) }] : [];
    });
  });

  protected readonly tip = computed(() => {
    const h = this.hovered();
    const country = h && this.countryByCode().get(h.code);
    if (!h || !country) return null;
    const row = this.rowByCode().get(h.code);
    return {
      x: h.x,
      y: h.y,
      name: row?.label ?? country.name,
      value: this.rows().length
        ? row
          ? `${formatNumber(row.visitors)} visitors`
          : 'No visitors'
        : '',
    };
  });

  protected readonly ariaLabel = computed(() => {
    const top = [...this.rows()].sort((a, b) => b.visitors - a.visitors).slice(0, 3);
    return top.length
      ? `World map of visitors by country. Top countries: ${top.map((r) => `${r.label}, ${formatNumber(r.visitors)}`).join('; ')}.`
      : 'World map';
  });

  constructor() {
    afterNextRender(() => void this.load());
    // Frame the data once the map is drawn, and again when it changes, until the visitor takes over.
    effect(() => {
      const home = this.home();
      if (!this.geo()) return;
      untracked(() => {
        if (this.touched) return;
        if (this.fitted) this.animateTo(home);
        else this.view.set(home);
        this.fitted = true;
      });
    });
    inject(DestroyRef).onDestroy(() => {
      this.stop();
      clearTimeout(this.hintTimer);
      clearTimeout(this.tipTimer);
    });
  }

  // --- zoom and pan ------------------------------------------------------

  protected wheel(e: WheelEvent): void {
    if (!(e.ctrlKey || e.metaKey)) return this.showHint('wheel'); // let the page scroll
    e.preventDefault();
    this.stop();
    this.touched = true;
    const p = this.toView(e.clientX, e.clientY);
    this.view.update((v) => zoomAt(v, wheelFactor(e), p.x, p.y, W, H));
    this.lastPointer = { x: e.clientX, y: e.clientY };
    requestAnimationFrame(() => this.refreshHover());
  }

  protected key(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return; // leave browser shortcuts alone
    const arrow = ARROWS[e.key];
    if (arrow) {
      if (!this.zoomed()) return; // nothing to move: the arrows keep scrolling the page
      const b = this.base();
      this.touched = true;
      this.animateTo(
        constrain({ ...b, x: b.x + arrow[0] * PAN_STEP, y: b.y + arrow[1] * PAN_STEP }, W, H),
      );
    } else if (e.key === '+' || e.key === '=') this.zoomBy(ZOOM_STEP);
    else if (e.key === '-' || e.key === '_') this.zoomBy(1 / ZOOM_STEP);
    else if (e.key === '0') this.goHome();
    else return;
    e.preventDefault();
  }

  protected press(id: (typeof CONTROLS)[number]['id']): void {
    if (id === 'reset') {
      this.goHome();
      // the button is about to leave: keep keyboard users on the map
      this.frame()?.nativeElement.focus({ preventScroll: true });
    } else {
      this.zoomBy(id === 'in' ? ZOOM_STEP : 1 / ZOOM_STEP);
    }
  }

  /** At the limits a button is dimmed, not disabled, so it does not drop keyboard focus. */
  protected off(id: (typeof CONTROLS)[number]['id']): boolean {
    const k = this.view().k;
    return id === 'in' ? k >= MAX_ZOOM : id === 'out' ? k <= MIN_ZOOM : false;
  }

  protected down(e: PointerEvent): void {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.stop();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.hideTip();
    if (this.pointers.size === 1) {
      this.tap = { x: e.clientX, y: e.clientY, t: e.timeStamp, ok: true };
      this.dragging.set(this.zoomed());
    } else {
      this.tap.ok = false;
    }
  }

  protected move(e: PointerEvent): void {
    const held = this.pointers.get(e.pointerId);
    if (!held) return this.hoverAt(e);
    const before = measure(this.pointers);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const after = measure(this.pointers);
    if (Math.hypot(e.clientX - this.tap.x, e.clientY - this.tap.y) > TAP_SLOP) this.tap.ok = false;
    // A lone mouse has nothing to move at 1x. A lone finger moves the map only once the visitor has
    // taken it over: until then the browser scrolls the page (touch-action) and the first few moves
    // before it cancels the pointer must not nudge the map.
    if (this.pointers.size === 1 && !(e.pointerType === 'mouse' ? this.zoomed() : this.engaged())) {
      return;
    }
    const box = this.box();
    const s = W / (box.width || W);
    const inView = (t: Touchpoint): Touchpoint => ({
      cx: (t.cx - box.left) * s,
      cy: (t.cy - box.top) * s,
      d: t.d * s,
    });
    this.touched = true;
    this.view.update((v) => gesture(v, inView(before), inView(after), W, H));
  }

  protected up(e: PointerEvent): void {
    if (!this.pointers.delete(e.pointerId) || this.pointers.size) return;
    this.dragging.set(false);
    // A mouse has dblclick and hover; a finger or pen needs its own tap and double tap.
    if (e.pointerType === 'mouse' || !this.tap.ok || e.timeStamp - this.tap.t > TAP_MS) return;
    const last = this.lastTap;
    if (
      last &&
      e.timeStamp - last.t < DOUBLE_TAP_MS &&
      Math.hypot(last.x - e.clientX, last.y - e.clientY) < DOUBLE_TAP_PX
    ) {
      this.lastTap = null;
      this.lastTouchZoom = performance.now();
      this.zoomBy(ZOOM_STEP, this.toView(e.clientX, e.clientY));
    } else {
      this.lastTap = { x: e.clientX, y: e.clientY, t: e.timeStamp };
      this.showTip(e.clientX, e.clientY);
    }
  }

  protected cancel(e: PointerEvent): void {
    const had = this.pointers.delete(e.pointerId);
    this.dragging.set(false);
    // The browser took a one-finger swipe to scroll the page: say how to zoom instead.
    if (had && e.pointerType === 'touch' && !this.engaged() && !this.pointers.size) {
      this.showHint('touch');
    }
  }

  protected dbl(e: MouseEvent): void {
    e.preventDefault();
    if (performance.now() - this.lastTouchZoom < 600) return; // already zoomed by the double tap
    this.zoomBy(ZOOM_STEP, this.toView(e.clientX, e.clientY));
  }

  protected leave(e: PointerEvent): void {
    if (e.pointerType === 'touch') return; // a finger's tooltip closes on its own
    this.lastPointer = null;
    this.hovered.set(null);
  }

  protected outside(e: Event): void {
    if (this.tipTimer && !this.host.nativeElement.contains(e.target as Node)) this.hideTip();
  }

  /** Where a zoom step starts: the end of a running animation, so quick clicks add up. */
  private base(): View {
    return this.goal ?? this.view();
  }

  /** Back to the fitted view (the whole world when there is no data) and follow the data again. */
  private goHome(): void {
    this.touched = false;
    this.animateTo(this.home());
  }

  /** Zoom around `at`, by default the centre of what is on screen now. */
  private zoomBy(factor: number, at = { x: W / 2, y: H / 2 }): void {
    this.touched = true;
    const b = this.base();
    this.animateTo(zoomAt(b, factor, at.x, at.y, W, H));
  }

  private animateTo(target: View): void {
    if (this.tipTimer) this.hideTip(); // the map is about to move away from it
    const from = this.view();
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced || sameView(from, target)) {
      this.goal = null;
      this.view.set(target);
      return this.refreshHover();
    }
    this.goal = target;
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / ZOOM_MS);
      this.view.set(
        t === 1 ? target : constrain(interpolateView(from, target, 1 - (1 - t) ** 3), W, H),
      );
      this.refreshHover();
      if (t === 1) this.goal = null;
      else this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  /** Any direct input takes over from a running animation. */
  private stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.goal = null;
  }

  private showHint(kind: 'wheel' | 'touch'): void {
    this.hintKind.set(kind);
    this.hintOn.set(true);
    clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => this.hintOn.set(false), 1400);
  }

  /** Scale and place something at a map point so that it keeps its on-screen size. */
  private pinned(cx: number, cy: number): string {
    return `translate(${cx} ${cy}) scale(${this.inverse()})`;
  }

  private box(): { left: number; top: number; width: number } {
    return this.svg()?.nativeElement.getBoundingClientRect() ?? { left: 0, top: 0, width: W };
  }

  /** Client pixels to viewBox units. */
  private toView(clientX: number, clientY: number): { x: number; y: number } {
    const box = this.box();
    const s = W / (box.width || W);
    return { x: (clientX - box.left) * s, y: (clientY - box.top) * s };
  }

  // --- hover -------------------------------------------------------------

  protected hoverAt(e: PointerEvent): void {
    this.lastPointer = { x: e.clientX, y: e.clientY };
    if (this.pointers.size) return; // dragging or pinching: no tooltip
    this.pick((e.target as SVGElement).dataset['code'], e.clientX, e.clientY);
  }

  /** After the map moved under a still cursor, find the country that is there now. */
  private refreshHover(): void {
    const p = this.lastPointer;
    if (!p || this.pointers.size) return;
    const el = document.elementFromPoint?.(p.x, p.y) as SVGElement | null;
    this.pick(el?.dataset?.['code'], p.x, p.y);
  }

  /** Tap: name the country under the finger for a moment, since there is no hover. */
  private showTip(clientX: number, clientY: number): void {
    const el = document.elementFromPoint?.(clientX, clientY) as SVGElement | null;
    this.pick(el?.dataset?.['code'], clientX, clientY);
    clearTimeout(this.tipTimer);
    this.tipTimer = this.hovered() ? setTimeout(() => this.hideTip(), TIP_MS) : undefined;
  }

  private hideTip(): void {
    clearTimeout(this.tipTimer);
    this.tipTimer = undefined;
    this.hovered.set(null);
  }

  private pick(code: string | undefined, clientX: number, clientY: number): void {
    if (!code) return this.hovered.set(null);
    const box = this.box();
    this.hovered.set({ code, x: clientX - box.left, y: clientY - box.top });
  }

  // --- data --------------------------------------------------------------

  private async load(): Promise<void> {
    const topology = (await import('world-atlas/countries-110m.json'))
      .default as unknown as Topology;
    const collection = feature(topology, topology.objects['countries'] as never) as unknown as {
      features: Feature<Polygon | MultiPolygon, { name: string }>[];
    };
    // Antarctica takes a tenth of the map and has no visitors.
    const features = collection.features.filter((f) => String(f.id) !== '010');
    const projection = geoNaturalEarth1().fitExtent(
      [
        [6, 6],
        [W - 6, H - 6],
      ],
      { type: 'Sphere' },
    );
    const path = geoPath(projection);

    const countries = features.flatMap<Country>((f, i) => {
      const code = alpha2Of(f.id, f.properties.name);
      const d = path(f);
      if (!code || !d) return [];
      const polygon = largestPolygon(f);
      const [cx, cy] = path.centroid(polygon);
      const [[x0, y0], [x1, y1]] = path.bounds(polygon);
      return [
        {
          code,
          name: f.properties.name,
          d,
          cx,
          cy,
          size: Math.max(x1 - x0, y1 - y0),
          box: { x0, y0, x1, y1 },
          delay: (i * 37) % 800,
          part: f.properties.name in PART_OF,
        },
      ];
    });
    this.geo.set({
      sphere: path({ type: 'Sphere' }) ?? '',
      graticule: path(geoGraticule10()) ?? '',
      countries,
    });
  }
}

/** Content moves the opposite way to the view: ArrowLeft shows what is to the left. */
const ARROWS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [1, 0],
  ArrowRight: [-1, 0],
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
};

/** Centre of the first two fingers, and their distance (0 for a single one). */
function measure(pointers: ReadonlyMap<number, { x: number; y: number }>): Touchpoint {
  const [a, b] = [...pointers.values()];
  if (!b) return { cx: a.x, cy: a.y, d: 0 };
  return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) };
}

/** The biggest polygon of a country: the centroid of "France" should not sit in the Atlantic. */
function largestPolygon(f: Feature<Polygon | MultiPolygon>): Feature<Polygon> {
  const g = f.geometry;
  const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  const best = polygons.reduce((a, b) =>
    geoArea({ type: 'Polygon', coordinates: b }) > geoArea({ type: 'Polygon', coordinates: a })
      ? b
      : a,
  );
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: best } };
}
