import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { Context } from '../core/context';
import { PERIODS } from '../core/period';
import { LivePill } from './live-pill';
import { Segmented } from './segmented';
import { SiteSwitcher } from './site-switcher';

/** Page title plus the shared controls: site switcher, period picker, live pill. */
@Component({
  selector: 'pl-page-header',
  imports: [LivePill, Segmented, SiteSwitcher],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mb-6 flex flex-wrap items-end gap-x-4 gap-y-4 sm:mb-8' },
  template: `
    <div class="order-1 min-w-0 flex-1 basis-56">
      <h1 class="display text-[32px] sm:text-[40px]">{{ title() }}</h1>
      @if (subtitle()) {
        <p class="mt-2.5 text-sub">{{ subtitle() }}</p>
      }
    </div>
    @if (live()) {
      <pl-live-pill class="order-2 lg:order-3" />
    }
    <div
      class="order-3 flex w-full flex-col gap-2 sm:flex-row sm:items-center lg:order-2 lg:w-auto"
    >
      @if (site()) {
        <pl-site-switcher class="sm:w-56" />
      }
      @if (period()) {
        <pl-segmented
          class="sm:w-[21rem]"
          [options]="periods"
          [value]="ctx.period()"
          (valueChange)="ctx.setPeriod($event)"
          label="Period"
        />
      }
      <ng-content />
    </div>
  `,
})
export class PageHeader {
  protected readonly ctx = inject(Context);
  protected readonly periods = PERIODS;

  readonly title = input.required<string>();
  readonly subtitle = input('');
  readonly site = input(true);
  readonly period = input(true);
  readonly live = input(true);
}
