import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { LiveService } from './core/live';
import { Icon, IconName } from './ui/icon';

interface NavItem {
  path: string;
  label: string;
  icon: IconName;
}

@Component({
  selector: 'pl-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.html',
})
export class App {
  protected readonly live = inject(LiveService);

  protected readonly nav: NavItem[] = [
    { path: '/', label: 'Overview', icon: 'overview' },
    { path: '/live', label: 'Live', icon: 'live' },
    { path: '/status', label: 'Pi status', icon: 'status' },
    { path: '/sites', label: 'Sites', icon: 'sites' },
  ];

  constructor() {
    this.live.start();
  }
}
