import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    title: 'Overview · Pulse',
    loadComponent: () => import('./pages/overview/overview').then((m) => m.Overview),
  },
  {
    path: 'live',
    title: 'Live · Pulse',
    loadComponent: () => import('./pages/live/live').then((m) => m.LivePage),
  },
  {
    path: 'status',
    title: 'Pi status · Pulse',
    loadComponent: () => import('./pages/status/status').then((m) => m.StatusPage),
  },
  {
    path: 'sites',
    title: 'Sites · Pulse',
    loadComponent: () => import('./pages/sites/sites').then((m) => m.SitesPage),
  },
  { path: '**', redirectTo: '' },
];
