import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { VitalReading } from '../../core/health.model';
import { Gauge } from '../../ui/gauge';
import { Sparkline } from '../../ui/sparkline';

/** One host reading: a dial (when it has a natural maximum), the value, and its 24 h trend. */
@Component({
  selector: 'pl-vital-tile',
  imports: [Gauge, Sparkline],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'panel block p-4 sm:p-5', '[attr.data-sev]': 'reading().severity' },
  template: `
    <h3 class="text-[13px] text-sub">{{ reading().label }}</h3>
    <div class="mt-3 flex items-center gap-4">
      @if (reading().fraction !== null) {
        <pl-gauge
          class="size-24 shrink-0"
          [fraction]="reading().fraction!"
          [severity]="reading().severity"
          [label]="reading().label"
          [value]="reading().value"
        />
        <p class="min-w-0 text-[13px] leading-snug text-sub">{{ reading().detail }}</p>
      } @else {
        <div class="min-w-0">
          <p
            class="display text-[34px]"
            [style.color]="reading().key === 'power' ? 'var(--sev)' : null"
          >
            {{ reading().value }}
          </p>
          <p class="mt-2 truncate text-[13px] text-sub" [title]="reading().detail">
            {{ reading().detail }}
          </p>
        </div>
      }
    </div>
    @if (samples().length > 1) {
      <pl-sparkline
        class="mt-4"
        [samples]="samples()"
        color="var(--sev)"
        [height]="44"
        [minSpan]="0.15"
        [gapAfter]="180"
        [interactive]="true"
        [tip]="tip"
        [label]="reading().label + ' over the last 24 hours'"
      />
      <p class="mt-1.5 text-xs text-faint">Last 24 hours</p>
    } @else if (reading().fraction !== null) {
      <!-- Same footprint as the real trend, so the tile does not grow when history arrives. -->
      <div class="mt-4 grid h-11 items-center" aria-hidden="true">
        <div class="skeleton h-0.5 w-full rounded-full"></div>
      </div>
      <p class="mt-1.5 text-xs text-faint">Collecting history</p>
    }
  `,
})
export class VitalTile {
  readonly reading = input.required<VitalReading>();
  readonly format = input<(value: number) => string>((v) => String(v));

  protected readonly samples = computed(() =>
    this.reading().history.map((p) => ({ t: p.t, y: p.fraction })),
  );

  protected readonly tip = (index: number): string => {
    const p = this.reading().history[index];
    if (!p || p.value === null) return '';
    const d = new Date(p.t * 1000);
    const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return `${this.format()(p.value)} · ${time}`;
  };
}
