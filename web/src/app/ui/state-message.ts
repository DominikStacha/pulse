import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Icon } from './icon';

/** Empty and error states: say what happened and what to do about it. */
@Component({
  selector: 'pl-state',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'flex flex-col items-center justify-center gap-1 px-4 py-10 text-center',
    '[attr.role]': "kind() === 'error' ? 'alert' : null",
  },
  template: `
    <span
      class="mb-2 grid size-9 place-items-center rounded-full"
      [class]="kind() === 'error' ? 'bg-down/10 text-down' : 'bg-white/5 text-faint'"
    >
      <pl-icon [name]="kind() === 'error' ? 'alert' : 'overview'" [size]="18" />
    </span>
    <p class="font-medium text-ink">{{ title() }}</p>
    @if (message()) {
      <p class="max-w-sm text-sm text-sub">{{ message() }}</p>
    }
    @if (retryable()) {
      <button type="button" class="chip mt-3 text-ink" (click)="retry.emit()">
        <pl-icon name="refresh" [size]="15" />Try again
      </button>
    }
  `,
})
export class StateMessage {
  readonly kind = input<'empty' | 'error'>('empty');
  readonly title = input.required<string>();
  readonly message = input('');
  readonly retryable = input(false);
  readonly retry = output();
}
