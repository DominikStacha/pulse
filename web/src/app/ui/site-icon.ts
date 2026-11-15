import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
} from '@angular/core';
import { SitesService } from '../core/sites';
import { Icon } from './icon';

function hue(text: string): number {
  let h = 0;
  for (const c of text) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

/**
 * A site's icon, or a coloured monogram until (or unless) it loads. Icons come only from
 * the API (GET /api/sites/{id}/icon), never from the site's own domain, so the browser
 * never contacts a third party and the CSP can stay `img-src 'self' data:`.
 * Pass `siteId`, or a `domain` that belongs to a known site; anything else stays a monogram.
 */
@Component({
  selector: 'pl-site-icon',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'relative inline-grid shrink-0 place-items-center overflow-hidden',
    '[style.width.px]': 'size()',
    '[style.height.px]': 'size()',
    '[style.border-radius.px]': 'size() * 0.3',
    '[style.background]': 'background()',
  },
  template: `
    @if (domain()) {
      @if (!loaded()) {
        <span
          class="font-semibold leading-none"
          [style.font-size.px]="size() * 0.46"
          [style.color]="ink()"
          >{{ letter() }}</span
        >
      }
      @if (src(); as url) {
        <img
          class="absolute inset-0 size-full object-contain p-[12%] opacity-[.88] transition-opacity duration-300"
          [style.opacity]="loaded() ? null : 0"
          [src]="url"
          alt=""
          loading="lazy"
          decoding="async"
          (load)="state.set('loaded')"
          (error)="state.set('failed')"
        />
        @if (loaded()) {
          <!-- A hairline keeps a white favicon tile from glaring on the dark UI. -->
          <span
            aria-hidden="true"
            class="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-white/10"
          ></span>
        }
      }
    } @else {
      <pl-icon name="globe" [size]="size() * 0.62" />
    }
  `,
})
export class SiteIcon {
  /** null renders the "all sites" globe. */
  readonly domain = input<string | null>(null);
  /** The site's id, when the caller has it; otherwise it is found from `domain`. */
  readonly siteId = input<string | null>(null);
  readonly size = input(22);

  private readonly sites = inject(SitesService);

  /** Null (monogram only) until there is a known site to ask for, and after a failed load. */
  protected readonly src = computed(() => {
    const domain = this.domain();
    const id =
      this.siteId() ?? (domain ? this.sites.list()?.find((s) => s.domain === domain)?.id : null);
    return id && !this.failed() ? `/api/sites/${encodeURIComponent(id)}/icon` : null;
  });
  /** Starts over whenever the icon URL's site changes. */
  protected readonly state = linkedSignal<string | null, 'loading' | 'loaded' | 'failed'>({
    source: () => this.siteId() ?? this.domain(),
    computation: () => 'loading',
  });
  protected readonly loaded = computed(() => this.state() === 'loaded');
  protected readonly failed = computed(() => this.state() === 'failed');
  protected readonly letter = computed(() =>
    (this.domain() ?? '?')
      .replace(/^(www|new|portal)\./, '')
      .charAt(0)
      .toUpperCase(),
  );
  private readonly h = computed(() => hue(this.domain() ?? ''));
  protected readonly ink = computed(() => `oklch(0.9 0.07 ${this.h()})`);
  protected readonly background = computed(() => {
    if (!this.domain()) return 'rgb(255 255 255 / 0.08)';
    if (this.loaded()) return 'rgb(255 255 255 / 0.07)';
    const h = this.h();
    return `linear-gradient(140deg, oklch(0.42 0.1 ${h}), oklch(0.3 0.07 ${h + 40}))`;
  });
}
