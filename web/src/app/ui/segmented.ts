import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  model,
} from '@angular/core';

export interface Option<T extends string> {
  id: T;
  label: string;
}

/** A radio group drawn as a pill with a sliding highlight. Arrow keys move and select. */
@Component({
  selector: 'pl-segmented',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class:
      'relative grid grid-flow-col auto-cols-fr rounded-xl border border-line bg-black/25 p-[3px]',
    role: 'radiogroup',
    '[attr.aria-label]': 'label()',
  },
  template: `
    <span
      aria-hidden="true"
      class="absolute inset-y-[3px] left-[3px] rounded-[9px] bg-white/[0.09] shadow-[inset_0_1px_0_rgb(255_255_255/0.08)] transition-transform duration-300 ease-[var(--ease-out)]"
      [style.width]="'calc((100% - 6px) / ' + options().length + ')'"
      [style.transform]="'translateX(' + index() * 100 + '%)'"
    ></span>
    @for (option of options(); track option.id; let i = $index) {
      <button
        type="button"
        role="radio"
        class="relative z-10 whitespace-nowrap rounded-[9px] px-3 py-1.5 text-center text-[13px] font-medium transition-colors"
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

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly index = computed(() =>
    Math.max(
      0,
      this.options().findIndex((o) => o.id === this.value()),
    ),
  );

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
