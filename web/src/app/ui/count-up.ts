import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  signal,
  untracked,
} from '@angular/core';
import { formatNumber } from '../core/format';
import { prefersReducedMotion } from './resize';

/** Eases the displayed number to its new value; jumps straight there for reduced motion. */
@Component({
  selector: 'pl-num',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'num' },
  template: `<span aria-hidden="true">{{ shown() }}</span
    ><span class="sr-only">{{ final() }}</span>`,
})
export class CountUp {
  readonly value = input.required<number>();
  readonly format = input<(n: number) => string>(formatNumber);
  readonly duration = input(1100);

  private readonly current = signal(0);
  protected readonly shown = computed(() => this.format()(this.current()));
  protected readonly final = computed(() => this.format()(this.value()));

  constructor() {
    effect((onCleanup) => {
      const target = this.value();
      const from = untracked(this.current);
      if (
        prefersReducedMotion() ||
        typeof requestAnimationFrame !== 'function' ||
        from === target
      ) {
        this.current.set(target);
        return;
      }
      const duration = untracked(this.duration);
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        // ease-out expo: most of the climb happens early, the last digits settle slowly
        this.current.set(from + (target - from) * (t === 1 ? 1 : 1 - 2 ** (-10 * t)));
        if (t < 1) frame = requestAnimationFrame(tick);
      };
      let frame = requestAnimationFrame(tick);
      onCleanup(() => cancelAnimationFrame(frame));
    });
  }
}
