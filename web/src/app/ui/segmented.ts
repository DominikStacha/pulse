import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  inject,
  input,
  model,
  signal,
} from '@angular/core';
import { hostWidth } from './resize';

export interface Option<T extends string> {
  id: T;
  label: string;
}

/**
 * A radio group drawn as a pill with a sliding highlight. Arrow keys move and select.
 * The host is 36px tall (44px for fingers), so it lines up with every control beside it.
 * Segments share the width equally; with `fit` each is as wide as its label.
 */
@Component({
  selector: 'pl-segmented',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class:
      'relative grid h-9 grid-flow-col rounded-xl border border-line bg-black/25 p-[3px] pointer-coarse:h-11',
    '[class.auto-cols-fr]': '!fit()',
    '[class.auto-cols-auto]': 'fit()',
    role: 'radiogroup',
    '[attr.aria-label]': 'label()',
  },
  template: `
    <!-- Placed from the active button's measured box; it only glides once it has been placed. -->
    <span
      aria-hidden="true"
      class="absolute inset-y-[3px] left-0 rounded-[9px] bg-white/[0.09] shadow-[inset_0_1px_0_rgb(255_255_255/0.08)]"
      [style.width.px]="pill()?.w ?? 0"
      [style.transform]="'translateX(' + (pill()?.x ?? 0) + 'px)'"
      [style.opacity]="pill() ? 1 : 0"
      [style.transition]="
        pill()?.glide ? 'transform 0.3s var(--ease-out), width 0.3s var(--ease-out)' : 'none'
      "
    ></span>
    @for (option of options(); track option.id; let i = $index) {
      <button
        type="button"
        role="radio"
        class="relative z-10 whitespace-nowrap rounded-[9px] text-center font-medium transition-colors pointer-coarse:after:absolute pointer-coarse:after:-inset-y-1 pointer-coarse:after:inset-x-0 pointer-coarse:after:content-['']"
        [class]="fit() ? 'px-2 text-[12px]' : 'px-2.5 text-[12.5px]'"
        [class.text-ink]="i === index()"
        [class.text-sub]="i !== index()"
        [class.hover:text-ink]="i !== index()"
        [attr.aria-checked]="i === index()"
        [tabindex]="i === index() ? 0 : -1"
        (click)="value.set(option.id)"
        (keydown)="key($event, i)"
      >
        {{ option.label }}
      </button>
    }
  `,
})
export class Segmented<T extends string> {
  readonly options = input.required<readonly Option<T>[]>();
  readonly value = model.required<T>();
  readonly label = input.required<string>();
  readonly fit = input(false);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly width = hostWidth();
  protected readonly pill = signal<{ x: number; w: number; glide: boolean } | null>(null);
  protected readonly index = computed(() =>
    Math.max(
      0,
      this.options().findIndex((o) => o.id === this.value()),
    ),
  );

  constructor() {
    afterRenderEffect(() => {
      // Re-place the highlight when the selection, the labels or the host's width change.
      this.index();
      this.options();
      this.width();
      const button = this.host.nativeElement.querySelectorAll('button')[this.index()];
      const prev = this.pill();
      if (button && (prev?.x !== button.offsetLeft || prev?.w !== button.offsetWidth))
        this.pill.set({ x: button.offsetLeft, w: button.offsetWidth, glide: prev !== null });
    });
  }

  protected key(event: KeyboardEvent, i: number): void {
    const n = this.options().length;
    const next =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? (i + 1) % n
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? (i - 1 + n) % n
          : -1;
    if (next < 0) return;
    event.preventDefault();
    this.value.set(this.options()[next].id);
    this.host.nativeElement.querySelectorAll('button')[next]?.focus();
  }
}
