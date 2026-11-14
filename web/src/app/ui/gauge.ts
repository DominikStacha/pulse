import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Severity } from '../core/health.model';

const R = 46;
const CIRC = 2 * Math.PI * R;
const SWEEP = 0.75; // a 270 degree dial, open at the bottom

/** A dial for a 0-1 reading. The value (or any content) sits in the middle. */
@Component({
  selector: 'pl-gauge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'relative grid place-items-center',
    '[attr.data-sev]': 'severity()',
    role: 'meter',
    '[attr.aria-label]': 'label()',
    '[attr.aria-valuemin]': '0',
    '[attr.aria-valuemax]': '100',
    '[attr.aria-valuenow]': 'percent()',
  },
  template: `
    <svg
      viewBox="0 0 120 120"
      class="size-full -rotate-[225deg] overflow-visible"
      aria-hidden="true"
    >
      <circle
        cx="60"
        cy="60"
        [attr.r]="r"
        fill="none"
        stroke="rgb(255 255 255 / 0.08)"
        stroke-width="8"
        stroke-linecap="round"
        [attr.stroke-dasharray]="track()"
      />
      <circle
        cx="60"
        cy="60"
        [attr.r]="r"
        fill="none"
        stroke="var(--sev)"
        stroke-width="8"
        stroke-linecap="round"
        [attr.stroke-dasharray]="arc()"
        style="filter: drop-shadow(0 0 6px color-mix(in oklab, var(--sev) 55%, transparent)); transition: stroke-dasharray 1.1s var(--ease-out); animation: gauge-in 1.2s var(--ease-out) backwards"
      />
    </svg>
    <div class="absolute inset-0 grid place-items-center text-center"><ng-content /></div>
  `,
})
export class Gauge {
  readonly fraction = input.required<number>();
  readonly severity = input<Severity>('ok');
  readonly label = input.required<string>();

  protected readonly r = R;
  protected readonly percent = computed(() =>
    Math.round(Math.min(1, Math.max(0, this.fraction())) * 100),
  );
  protected readonly track = computed(() => `${CIRC * SWEEP} ${CIRC}`);
  // At 0 a round cap would still draw a dot; keep a sliver so an idle dial still reads as "0".
  protected readonly arc = computed(
    () => `${Math.max(0.01, Math.min(1, Math.max(0, this.fraction()))) * CIRC * SWEEP} ${CIRC}`,
  );
}
