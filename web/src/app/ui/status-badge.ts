import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Severity } from '../core/health.model';

const LABELS: Record<Severity, string> = {
  ok: 'Healthy',
  idle: 'Stopped',
  warn: 'Warning',
  down: 'Down',
};

@Component({
  selector: 'pl-status-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium',
    '[attr.data-sev]': 'severity()',
    style:
      'color: var(--sev); border-color: color-mix(in oklab, var(--sev) 32%, transparent); background: color-mix(in oklab, var(--sev) 10%, transparent)',
  },
  template: `<span class="size-1.5 rounded-full bg-current"></span>{{ text() }}`,
})
export class StatusBadge {
  readonly severity = input.required<Severity>();
  /** Overrides the default word for the severity. */
  readonly label = input<string | null>(null);
  protected readonly text = computed(() => this.label() ?? LABELS[this.severity()]);
}
