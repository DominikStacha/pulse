import { ChangeDetectionStrategy, Component, input, linkedSignal } from '@angular/core';
import { Breakdown, Dim } from '../core/api';
import { stat } from '../core/stat';
import { BarList, RowIcon } from './bar-list';
import { Option, Segmented } from './segmented';
import { StateMessage } from './state-message';

export interface Tab extends Option<Dim> {}

/** One ranked list (pages, referrers, …) with optional tabs for sibling dimensions. */
@Component({
  selector: 'pl-breakdown-panel',
  imports: [BarList, Segmented, StateMessage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'panel flex flex-col p-4 sm:p-5' },
  template: `
    <div class="mb-3 flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <h2 class="text-[15px] font-medium text-ink">{{ title() }}</h2>
      @if (tabs().length > 1) {
        <pl-segmented [options]="tabs()" [(value)]="dim" [label]="title() + ' view'" />
      }
    </div>
    <div
      class="relative min-h-[18.5rem] flex-1 transition-opacity duration-300"
      [class.opacity-50]="query.loading() && query.data()"
    >
      @if (query.data(); as data) {
        @if (data.rows.length) {
          <div class="mb-1.5 flex items-center justify-end gap-2.5 px-2.5 text-xs text-faint">
            <span>{{ metric() === 'count' ? 'Events' : 'Visitors' }}</span>
            @if (metric() === 'visitors') {
              <span class="w-10 text-right">Share</span>
            }
          </div>
          @for (key of [dim()]; track key) {
            <pl-bar-list
              [rows]="data.rows"
              [metric]="metric()"
              [icon]="icon()"
              [showShare]="metric() === 'visitors'"
            />
          }
        } @else {
          <pl-state title="Nothing here yet" [message]="emptyHint()" />
        }
      } @else if (query.error()) {
        <pl-state
          kind="error"
          title="Couldn't load this list"
          message="The API didn't answer. Your other panels may still be fine."
          [retryable]="true"
          (retry)="query.reload()"
        />
      } @else {
        <div class="space-y-1" aria-busy="true" aria-label="Loading">
          @for (n of skeletonRows; track n) {
            <div class="skeleton h-9" [style.width.%]="100 - n * 9"></div>
          }
        </div>
      }
    </div>
  `,
})
export class BreakdownPanel {
  readonly title = input.required<string>();
  readonly tabs = input.required<readonly Tab[]>();
  readonly metric = input<'visitors' | 'count'>('visitors');
  readonly icon = input<RowIcon>('none');
  readonly limit = input(8);
  readonly emptyHint = input('Once visitors arrive they will show up here.');

  /** The first tab is the default dimension. */
  protected readonly dim = linkedSignal<Dim>(() => this.tabs()[0].id);
  protected readonly skeletonRows = [0, 1, 2, 3, 4, 5, 6, 7];

  protected readonly query = stat<Breakdown>('breakdown', () => ({
    dim: this.dim(),
    limit: this.limit(),
  }));
}
