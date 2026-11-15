import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  viewChild,
} from '@angular/core';
import { ALL_SITES, Context } from '../core/context';
import { LiveService } from '../core/live';
import { SitesService } from '../core/sites';
import { Icon } from './icon';
import { SiteIcon } from './site-icon';

let nextId = 0;

/**
 * Picks "All sites" or one site. A native popover: top layer, Esc and click-outside for free.
 * A dropdown that never outgrows the viewport; on phones the same menu is a bottom sheet.
 */
@Component({
  selector: 'pl-site-switcher',
  imports: [Icon, SiteIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex min-w-0' },
  template: `
    <button
      #trigger
      type="button"
      class="chip min-w-0 flex-1 gap-2.5 pl-2.5 pr-2 text-[13.5px] font-medium text-ink"
      [attr.popovertarget]="menuId"
      aria-haspopup="listbox"
      aria-label="Choose site"
    >
      <pl-site-icon [domain]="ctx.siteInfo()?.domain ?? null" [size]="20" />
      <span class="truncate">{{ ctx.siteLabel() }}</span>
      <pl-icon name="chevron" [size]="16" class="ml-auto text-faint" />
    </button>
    <div
      #menu
      popover
      [id]="menuId"
      class="menu m-0 inset-auto w-72 max-w-[calc(100vw-24px)] overflow-y-auto overscroll-contain rounded-2xl border border-line bg-raised p-1.5 text-ink shadow-2xl"
      role="listbox"
      aria-label="Sites"
      (toggle)="onToggle($event)"
      (keydown)="key($event)"
    >
      @for (item of items(); track item.id) {
        <button
          type="button"
          role="option"
          class="flex min-h-11 w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-white/[0.06] focus-visible:bg-white/[0.06] pointer-coarse:min-h-12"
          [attr.aria-selected]="item.id === ctx.site()"
          (click)="choose(item.id)"
        >
          <pl-site-icon [domain]="item.domain" [size]="24" />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-[13.5px] font-medium">{{ item.name }}</span>
            @if (item.domain) {
              <span class="block truncate text-xs text-faint">{{ item.domain }}</span>
            }
          </span>
          @if (item.active > 0) {
            <span class="num flex items-center gap-1.5 text-xs text-mint"
              ><i class="size-1.5 rounded-full bg-mint"></i>{{ item.active }}</span
            >
          }
          <!-- The check's slot is always there, so the counts line up on every row. -->
          <span class="grid size-4 shrink-0 place-items-center text-sodium">
            @if (item.id === ctx.site()) {
              <pl-icon name="check" [size]="16" />
            }
          </span>
        </button>
      }
    </div>
  `,
})
export class SiteSwitcher {
  protected readonly ctx = inject(Context);
  private readonly sites = inject(SitesService);
  private readonly live = inject(LiveService);

  protected readonly menuId = `site-menu-${nextId++}`;
  /** Lives while the menu is open: closes it on page scroll and resize, since it is placed by hand. */
  private watch: AbortController | undefined;
  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private readonly menu = viewChild.required<ElementRef<HTMLElement>>('menu');

  protected readonly items = computed(() => [
    {
      id: ALL_SITES,
      name: 'All sites',
      domain: null as string | null,
      active: this.live.active() ?? 0,
    },
    ...(this.sites.list() ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      domain: s.domain as string | null,
      active: this.live.perSite()[s.id] ?? 0,
    })),
  ]);

  protected choose(id: string): void {
    this.ctx.setSite(id);
    this.menu().nativeElement.hidePopover();
  }

  constructor() {
    inject(DestroyRef).onDestroy(() => this.watch?.abort());
  }

  /** Popovers live in the top layer, so anchor under the button by hand (or as a sheet on phones). */
  protected onToggle(event: Event): void {
    this.watch?.abort();
    if ((event as ToggleEvent).newState !== 'open') return;
    const menu = this.menu().nativeElement;
    const box = this.trigger().nativeElement.getBoundingClientRect();
    const sheet = matchMedia('(max-width: 639.98px)').matches;
    menu.classList.toggle('sheet', sheet);
    for (const prop of ['top', 'left', 'min-width', 'max-height']) menu.style.removeProperty(prop);
    if (!sheet) {
      menu.style.minWidth = `${box.width}px`;
      menu.style.maxHeight = `${Math.max(160, window.innerHeight - box.bottom - 20)}px`;
      menu.style.top = `${box.bottom + 8}px`;
      menu.style.left = `${Math.max(12, Math.min(box.left, window.innerWidth - menu.offsetWidth - 12))}px`;
    }
    (menu.querySelector('[aria-selected="true"]') as HTMLElement | null)?.focus();

    this.watch = new AbortController();
    const { signal } = this.watch;
    const close = () => menu.hidePopover();
    window.addEventListener('resize', close, { signal });
    window.addEventListener(
      'scroll',
      (e) => {
        // The list scrolls inside the menu; only the page moving away from the trigger closes it.
        if (!(e.target instanceof Node) || !menu.contains(e.target)) close();
      },
      { signal, capture: true, passive: true },
    );
  }

  protected key(event: KeyboardEvent): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const options = [...this.menu().nativeElement.querySelectorAll<HTMLElement>('[role="option"]')];
    const at = options.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === 'ArrowDown'
        ? (at + 1) % options.length
        : (at - 1 + options.length) % options.length;
    options[next]?.focus();
  }
}
