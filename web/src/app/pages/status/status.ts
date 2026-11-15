import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Clock } from '../../core/clock';
import { formatAgo } from '../../core/format';
import {
  ServiceStatus,
  Severity,
  VitalReading,
  attentionReasons,
  containerSeverity,
  isStale,
  overallSeverity,
  snapshotAgeMs,
} from '../../core/health.model';
import { StatusService } from '../../core/status';
import { VITAL_FORMATTERS, buildVitals, sortBySeverity } from '../../core/vitals';
import { Icon } from '../../ui/icon';
import { PageHeader } from '../../ui/page-header';
import { Option, Segmented } from '../../ui/segmented';
import { StateMessage } from '../../ui/state-message';
import { ServiceCard } from './service-card';
import { VitalTile } from './vital-tile';

const OVERALL_LABELS: Record<Severity, string> = {
  ok: 'All systems normal',
  idle: 'All systems normal',
  warn: 'Needs attention',
  down: 'Problem detected',
};

type View = 'active' | 'stopped' | 'all';

@Component({
  selector: 'pl-status',
  imports: [Icon, PageHeader, Segmented, ServiceCard, StateMessage, VitalTile],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './status.html',
})
export class StatusPage {
  protected readonly status = inject(StatusService);
  private readonly clock = inject(Clock);

  protected readonly view = signal<View>('active');
  protected readonly search = signal('');
  protected readonly formatters = VITAL_FORMATTERS;
  protected readonly skeletons = [0, 1, 2, 3, 4, 5];
  /** A stale snapshot is the last known state, not the current one: show it, but quieter. */
  protected readonly fresh = 'transition duration-500';
  protected readonly dimmed = 'transition duration-500 opacity-60 saturate-50';

  constructor() {
    const stop = this.status.startPolling();
    inject(DestroyRef).onDestroy(stop);
  }

  protected readonly now = this.clock.now;
  protected readonly snapshot = this.status.snapshot;

  protected readonly stale = computed(() => {
    const s = this.snapshot();
    return s !== null && isStale(s, this.now());
  });

  protected readonly overall = computed<Severity>(() => {
    const s = this.snapshot();
    return s === null ? 'warn' : overallSeverity(s, this.now());
  });

  protected readonly overallLabel = computed(() =>
    this.stale() ? 'Collector not reporting' : OVERALL_LABELS[this.overall()],
  );

  protected readonly host = computed(() => this.snapshot()?.host ?? null);

  /** Why the verdict is not green, e.g. "1 collector warning". A stale snapshot explains itself. */
  protected readonly reasons = computed(() => {
    const s = this.snapshot();
    return s === null || this.stale() ? '' : attentionReasons(s, this.now()).join(', ');
  });

  /** Age of the data itself: the number that matters when the collector dies. */
  protected readonly dataAge = computed(() => {
    const s = this.snapshot();
    return s ? formatAgo(snapshotAgeMs(s, this.now())) : null;
  });

  private readonly services = computed<ServiceStatus[]>(() =>
    (this.snapshot()?.containers ?? []).map((container) => ({
      container,
      severity: containerSeverity(container, this.now()),
    })),
  );

  protected readonly counts = computed(() => {
    const all = this.services();
    const n = (s: Severity) => all.filter((x) => x.severity === s).length;
    return {
      ok: n('ok'),
      warn: n('warn'),
      down: n('down'),
      idle: n('idle'),
      active: all.length - n('idle'),
      all: all.length,
    };
  });

  protected readonly viewOptions = computed<Option<View>[]>(() => [
    { id: 'active', label: `Active ${this.counts().active}` },
    { id: 'stopped', label: `Stopped ${this.counts().idle}` },
    { id: 'all', label: `All ${this.counts().all}` },
  ]);

  /** The Pi carries dozens of finished containers; hiding them by default keeps the live ones findable. */
  protected readonly visible = computed(() => {
    const view = this.view();
    const q = this.search().trim().toLowerCase();
    const matches = (s: ServiceStatus) =>
      !q ||
      s.container.name.toLowerCase().includes(q) ||
      (s.container.image ?? '').toLowerCase().includes(q);
    return sortBySeverity(
      this.services().filter(
        (s) => (view === 'all' || (view === 'active') === (s.severity !== 'idle')) && matches(s),
      ),
    );
  });

  protected readonly vitals = computed<VitalReading[]>(() => {
    const host = this.host();
    return host ? buildVitals(host, this.status.history()) : [];
  });

  /** Readings with a dial (and a trend); uptime and power are plain facts. */
  protected readonly gauges = computed(() => this.vitals().filter((v) => v.fraction !== null));
  protected readonly facts = computed(() => this.vitals().filter((v) => v.fraction === null));

  protected readonly collectorErrors = computed(() => this.snapshot()?.errors ?? []);

  protected formatterFor(key: string): (value: number) => string {
    return this.formatters[key] ?? ((value) => String(value));
  }

  protected readonly searchTerm = computed(() => this.search().trim());

  protected onSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }
}
