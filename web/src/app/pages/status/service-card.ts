import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ContainerStatus, Severity } from '../../core/health.model';
import { formatBytes, formatDuration } from '../../core/format';
import { StatusBadge } from '../../ui/status-badge';

@Component({
  selector: 'pl-service-card',
  imports: [StatusBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'panel block p-4 !rounded-2xl transition-colors hover:border-white/15',
    '[attr.data-sev]': 'severity()',
  },
  template: `
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <h3 class="truncate font-mono text-[13.5px] font-medium">{{ container().name }}</h3>
        <p class="mt-1 truncate text-xs text-faint" [title]="container().image ?? ''">
          {{ container().image ?? 'unknown image' }}
        </p>
      </div>
      <pl-status-badge [severity]="severity()" />
    </div>

    <dl class="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
      <div class="min-w-0">
        <dt class="text-xs text-faint">State</dt>
        <dd class="mt-0.5 truncate">{{ stateLabel() }}</dd>
      </div>
      <div class="min-w-0">
        <dt class="text-xs text-faint">{{ container().running ? 'Uptime' : 'Stopped' }}</dt>
        <dd class="num mt-0.5">{{ container().running ? uptime() : stoppedFor() }}</dd>
      </div>
      @if (memory(); as m) {
        <div class="min-w-0">
          <dt class="text-xs text-faint">Memory</dt>
          <dd class="num mt-0.5">{{ m }}</dd>
        </div>
      }
      @if (container().restartCount > 0) {
        <div class="min-w-0">
          <dt class="text-xs text-faint">Restarts</dt>
          <dd class="num mt-0.5 text-warn">{{ container().restartCount }}</dd>
        </div>
      }
      @if (container().ports.length) {
        <div class="col-span-2 min-w-0">
          <dt class="text-xs text-faint">Ports</dt>
          <dd class="mt-0.5 truncate font-mono text-xs">{{ container().ports.join(', ') }}</dd>
        </div>
      }
    </dl>

    @if (memoryPercent() !== null) {
      <div
        class="mt-3.5 h-1 overflow-hidden rounded-full bg-white/[0.07]"
        role="meter"
        [attr.aria-valuenow]="memoryPercent()"
        aria-valuemin="0"
        aria-valuemax="100"
        [attr.aria-label]="container().name + ' memory against its limit'"
      >
        <div
          class="h-full origin-left rounded-full"
          style="background: var(--sev); transition: transform 0.9s var(--ease-out); animation: bar-in 1s var(--ease-out) backwards"
          [style.transform]="'scaleX(' + memoryPercent()! / 100 + ')'"
        ></div>
      </div>
    }
  `,
})
export class ServiceCard {
  readonly container = input.required<ContainerStatus>();
  readonly severity = input.required<Severity>();
  /** Clock for "stopped 3d ago"; the page owns it so cards stay presentational. */
  readonly now = input.required<number>();

  /** The verdict is the badge; this is the raw Docker state behind it. */
  protected readonly stateLabel = computed(() => {
    const c = this.container();
    if (c.running) return c.health ? `running · ${c.health}` : 'running';
    return c.exitCode === null
      ? (c.state ?? 'unknown')
      : `${c.state ?? 'stopped'} · exit ${c.exitCode}`;
  });

  protected readonly uptime = computed(() => formatDuration(this.container().uptimeSeconds));

  protected readonly stoppedFor = computed(() => {
    const finished = this.container().finishedAt ? Date.parse(this.container().finishedAt!) : NaN;
    return Number.isNaN(finished) ? '—' : `${formatDuration((this.now() - finished) / 1000)} ago`;
  });

  protected readonly memory = computed(() => {
    const { memoryBytes, memoryLimitBytes } = this.container();
    if (memoryBytes === null) return null;
    return memoryLimitBytes
      ? `${formatBytes(memoryBytes)} / ${formatBytes(memoryLimitBytes)}`
      : formatBytes(memoryBytes);
  });

  protected readonly memoryPercent = computed(() => {
    const { memoryBytes, memoryLimitBytes } = this.container();
    if (memoryBytes === null || !memoryLimitBytes) return null;
    return Math.round(Math.min(1, memoryBytes / memoryLimitBytes) * 100);
  });
}
