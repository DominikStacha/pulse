import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { Icon } from './icon';

function hue(text: string): number {
  let h = 0;
  for (const c of text) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

/** A site's favicon, or a coloured monogram until (or unless) it loads. */
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
    @if (domain(); as d) {
      @if (!loaded()) {
        <span
          class="font-semibold leading-none"
          [style.font-size.px]="size() * 0.46"
          [style.color]="ink()"
          >{{ letter() }}</span
        >
      }
      @if (!failed()) {
        <img
          class="absolute inset-0 size-full object-contain p-[12%] transition-opacity duration-300"
          [class.opacity-0]="!loaded()"
          [src]="'https://' + d + '/favicon.ico'"
          alt=""
          loading="lazy"
          decoding="async"
          referrerpolicy="no-referrer"
          (load)="loaded.set(true)"
          (error)="failed.set(true)"
        />
      }
    } @else {
      <pl-icon name="globe" [size]="size() * 0.62" />
    }
  `,
})
export class SiteIcon {
  /** null renders the "all sites" globe. */
  readonly domain = input<string | null>(null);
  readonly size = input(22);

  protected readonly loaded = signal(false);
  protected readonly failed = signal(false);
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
