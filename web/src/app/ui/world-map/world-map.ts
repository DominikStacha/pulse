import {
  ChangeDetectionStrategy,
  Component,
  afterNextRender,
  computed,
  input,
  signal,
} from '@angular/core';
import { geoArea, geoGraticule10, geoNaturalEarth1, geoPath } from 'd3-geo';
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import { Row } from '../../core/api';
import { formatNumber } from '../../core/format';
import { NUMERIC_TO_ALPHA2 } from './country-codes';

const W = 960;
const H = 500;

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
  /** Projected extent; small countries get a light dot so they are not lost at world scale. */
  size: number;
  /** Staggers the "lights coming on" fade. */
  delay: number;
}

interface Geography {
  sphere: string;
  graticule: string;
  countries: Country[];
}

const LAND = '#112129';

/**
 * A night-side world: land is dark, countries with visitors light up in
 * sodium amber by share. Hits on the Live page ring out from their country.
 * Heavy (d3-geo + the 110m atlas), so it is only ever loaded through @defer.
 */
@Component({
  selector: 'pl-world-map',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'relative block' },
  template: `
    @if (geo(); as g) {
      <svg
        [attr.viewBox]="'0 0 ' + w + ' ' + h"
        class="block h-auto w-full"
        role="img"
        [attr.aria-label]="ariaLabel()"
        (pointermove)="hoverAt($event)"
        (pointerleave)="hovered.set(null)"
      >
        <defs>
          <radialGradient id="ocean" cx="50%" cy="46%" r="62%">
            <stop offset="0" stop-color="#10222b" />
            <stop offset="1" stop-color="#08121763" />
          </radialGradient>
          <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="5" />
          </filter>
        </defs>
        <path
          [attr.d]="g.sphere"
          fill="url(#ocean)"
          stroke="var(--color-line)"
          stroke-width="0.8"
        />
        <path
          [attr.d]="g.graticule"
          fill="none"
          stroke="rgb(255 255 255 / 0.035)"
          stroke-width="0.6"
        />
        @for (c of g.countries; track c.code) {
          <path
            [attr.d]="c.d"
            [attr.data-code]="c.code"
            [style.fill]="fills().get(c.code) ?? land"
            [attr.stroke]="hovered()?.code === c.code ? 'var(--color-sodium)' : '#223842'"
            stroke-width="0.6"
            stroke-linejoin="round"
            style="animation: fade-in 0.9s backwards; transition: fill 0.6s, stroke 0.15s"
            [style.animation-delay.ms]="c.delay"
          />
        }
        <g filter="url(#glow)" class="pointer-events-none" opacity="0.55">
          @for (l of lit(); track l.code) {
            <path [attr.d]="l.d" fill="var(--color-sodium)" [attr.fill-opacity]="l.t * 0.55" />
          }
        </g>
        @for (l of lit(); track l.code) {
          @if (l.size < 34) {
            <circle
              class="pointer-events-none"
              [attr.cx]="l.cx"
              [attr.cy]="l.cy"
              [attr.r]="2.2 + l.t * 4.2"
              fill="var(--color-sodium)"
              fill-opacity="0.92"
              style="filter: drop-shadow(0 0 5px rgb(255 166 61 / 0.9)); animation: fade-in 1.2s 0.9s backwards"
            />
          }
        }
        @for (p of pulseDots(); track p.id) {
          <g [attr.transform]="'translate(' + p.cx + ' ' + p.cy + ')'" class="pointer-events-none">
            <circle
              r="4"
              fill="var(--color-sodium)"
              style="filter: drop-shadow(0 0 6px var(--color-sodium))"
            />
            <circle r="46" fill="none" stroke="var(--color-sodium)" stroke-width="2" class="ring" />
            <circle
              r="46"
              fill="none"
              stroke="var(--color-sodium)"
              stroke-width="1.2"
              class="ring ring-2"
            />
          </g>
        }
      </svg>
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
  styles: `
    .ring {
      transform-box: fill-box;
      transform-origin: center;
      animation: ring 2.4s cubic-bezier(0.2, 0.7, 0.3, 1) both;
    }
    .ring-2 {
      animation-delay: 0.5s;
    }
  `,
})
export class WorldMap {
  /** Countries breakdown (key = ISO-2). Empty on the Live page. */
  readonly rows = input<readonly Row[]>([]);
  readonly pulses = input<readonly Pulse[]>([]);

  protected readonly w = W;
  protected readonly h = H;
  protected readonly land = LAND;
  protected readonly geo = signal<Geography | null>(null);
  protected readonly hovered = signal<{ code: string; x: number; y: number } | null>(null);

  private readonly byCode = computed(() => new Map(this.rows().map((r) => [r.key ?? '', r])));

  protected readonly fills = computed(() => {
    const rows = this.rows();
    const max = Math.max(1, ...rows.map((r) => r.visitors));
    return new Map(
      rows.map((r) => {
        // sqrt: a country with 1% of the traffic should still be visible next to one with 60%
        const t = 0.3 + 0.7 * Math.sqrt(r.visitors / max);
        return [
          r.key ?? '',
          `color-mix(in oklab, ${LAND}, var(--color-sodium) ${Math.round(t * 92)}%)`,
        ];
      }),
    );
  });

  /** Countries with visitors, with their intensity 0-1, for the glow layer and the dots. */
  protected readonly lit = computed(() => {
    const countries = this.geo()?.countries;
    const rows = this.rows();
    if (!countries || !rows.length) return [];
    const max = Math.max(1, ...rows.map((r) => r.visitors));
    const byCode = new Map(countries.map((c) => [c.code, c]));
    return rows.flatMap((r) => {
      const c = byCode.get(r.key ?? '');
      return c ? [{ ...c, t: Math.sqrt(r.visitors / max) }] : [];
    });
  });

  protected readonly pulseDots = computed(() => {
    const countries = this.geo()?.countries;
    if (!countries) return [];
    const byCode = new Map(countries.map((c) => [c.code, c]));
    return this.pulses().flatMap((p) => {
      const c = p.country ? byCode.get(p.country) : undefined;
      return c ? [{ id: p.id, cx: c.cx, cy: c.cy }] : [];
    });
  });

  protected readonly tip = computed(() => {
    const h = this.hovered();
    const country = h && this.geo()?.countries.find((c) => c.code === h.code);
    if (!h || !country) return null;
    const row = this.byCode().get(h.code);
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
  }

  protected hoverAt(event: PointerEvent): void {
    const code = (event.target as SVGElement).dataset['code'];
    if (!code) return this.hovered.set(null);
    const box = (event.currentTarget as SVGElement).getBoundingClientRect();
    this.hovered.set({ code, x: event.clientX - box.left, y: event.clientY - box.top });
  }

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
      const code =
        f.properties.name === 'Kosovo' ? 'XK' : NUMERIC_TO_ALPHA2[String(f.id).padStart(3, '0')];
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
          delay: (i * 37) % 800,
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
