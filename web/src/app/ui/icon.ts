import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

const PATHS = {
  overview: ['M5 20v-8', 'M12 20V5', 'M19 20v-5'],
  live: [
    'M12 12h.01',
    'M8.5 8.5a5 5 0 0 0 0 7',
    'M15.5 8.5a5 5 0 0 1 0 7',
    'M5.6 5.6a9 9 0 0 0 0 12.8',
    'M18.4 5.6a9 9 0 0 1 0 12.8',
  ],
  status: [
    'M9 2v3',
    'M15 2v3',
    'M9 19v3',
    'M15 19v3',
    'M2 9h3',
    'M2 15h3',
    'M19 9h3',
    'M19 15h3',
    'M7 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z',
    'M10 10h4v4h-4z',
  ],
  sites: [
    'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
    'M3 12h18',
    'M12 3c2.6 2.4 4 5.6 4 9s-1.4 6.6-4 9c-2.6-2.4-4-5.6-4-9s1.4-6.6 4-9z',
  ],
  chevron: ['m6 9 6 6 6-6'],
  check: ['m5 12.5 4.5 4.5L19 7.5'],
  copy: [
    'M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1z',
    'M5 15V5a1 1 0 0 1 1-1h10',
  ],
  plus: ['M12 5v14', 'M5 12h14'],
  refresh: ['M20.5 12a8.5 8.5 0 1 1-2.5-6', 'M20.5 4v5h-5'],
  search: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'm20 20-4-4'],
  alert: [
    'M12 9v4',
    'M12 17h.01',
    'M10.3 4.2 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z',
  ],
  up: ['M12 19V5', 'm6 11 6-6 6 6'],
  down: ['M12 5v14', 'm6 13 6 6 6-6'],
  x: ['M18 6 6 18', 'm6 6 12 12'],
  globe: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M3 12h18'],
} as const;

export type IconName = keyof typeof PATHS;

@Component({
  selector: 'pl-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex shrink-0', 'aria-hidden': 'true' },
  template: `<svg
    [attr.width]="size()"
    [attr.height]="size()"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    @for (d of paths(); track d) {
      <path [attr.d]="d" />
    }
  </svg>`,
})
export class Icon {
  readonly name = input.required<IconName>();
  readonly size = input(18);
  protected readonly paths = computed(() => PATHS[this.name()]);
}
