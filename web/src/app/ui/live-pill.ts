import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Context } from '../core/context';
import { LiveService } from '../core/live';
import { CountUp } from './count-up';

/** "● 3 online" for the selected site; links to the Live page. */
@Component({
  selector: 'pl-live-pill',
  imports: [RouterLink, CountUp],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex' },
  template: `
    <a
      routerLink="/live"
      queryParamsHandling="preserve"
      class="chip gap-2.5 py-[7px] pl-3 pr-3.5 text-[13px]"
      [attr.aria-label]="
        count() === null ? 'Live view' : count() + ' visitors online now. Open live view.'
      "
    >
      <span class="relative grid size-2 place-items-center" aria-hidden="true">
        @if (live.connected()) {
          <span
            class="absolute inset-0 rounded-full bg-mint"
            style="animation: ring 2.2s ease-out infinite"
          ></span>
        }
        <span
          class="relative size-2 rounded-full"
          [class]="live.connected() ? 'bg-mint' : 'bg-warn'"
        ></span>
      </span>
      @if (count() !== null) {
        <span class="text-ink"
          ><pl-num [value]="count()!" [duration]="600" />
          <span class="ml-1 text-sub">online</span></span
        >
      } @else {
        <span class="text-sub">Live</span>
      }
    </a>
  `,
})
export class LivePill {
  protected readonly live = inject(LiveService);
  private readonly ctx = inject(Context);
  protected readonly count = computed(() => this.live.activeFor(this.ctx.site()));
}
