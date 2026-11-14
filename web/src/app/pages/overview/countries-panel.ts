import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { Breakdown } from '../../core/api';
import { stat } from '../../core/stat';
import { BarList } from '../../ui/bar-list';
import { StateMessage } from '../../ui/state-message';
import { WorldMap } from '../../ui/world-map/world-map';

/** Choropleth + ranked list of countries. The map (d3 + atlas) is a lazy chunk, loaded when it scrolls into view. */
@Component({
  selector: 'pl-countries-panel',
  imports: [BarList, StateMessage, WorldMap],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'panel block p-4 sm:p-5' },
  template: `
    <h2 class="mb-3 text-[15px] font-medium text-ink">Countries</h2>
    <div
      class="grid gap-x-8 gap-y-5 transition-opacity duration-300 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]"
      [class.opacity-50]="query.loading() && query.data()"
    >
      @if (query.error() && !query.data()) {
        <pl-state
          class="xl:col-span-2"
          kind="error"
          title="Couldn't load countries"
          message="The API didn't answer."
          [retryable]="true"
          (retry)="query.reload()"
        />
      } @else {
        @defer (on viewport; prefetch on idle) {
          <pl-world-map [rows]="rows()" />
        } @placeholder {
          <div class="skeleton aspect-[960/500] w-full rounded-2xl"></div>
        }
        <div>
          @if (query.data() && !rows().length) {
            <pl-state
              title="No visitors yet"
              message="Countries come from Cloudflare when a visit is recorded."
            />
          } @else if (query.data()) {
            <div class="mb-1.5 flex items-center justify-end gap-2.5 px-2.5 text-xs text-faint">
              <span>Visitors</span><span class="w-10 text-right">Share</span>
            </div>
            <pl-bar-list [rows]="top()" icon="flag" />
          } @else {
            <div class="space-y-1" aria-busy="true">
              @for (n of [0, 1, 2, 3, 4, 5, 6, 7]; track n) {
                <div class="skeleton h-9" [style.width.%]="100 - n * 8"></div>
              }
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class CountriesPanel {
  protected readonly query = stat<Breakdown>('breakdown', () => ({ dim: 'countries', limit: 250 }));
  protected readonly rows = computed(() => this.query.data()?.rows ?? []);
  protected readonly top = computed(() => this.rows().slice(0, 8));
}
