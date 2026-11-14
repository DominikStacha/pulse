import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import {
  ActivatedRouteSnapshot,
  provideRouter,
  withEnabledBlockingInitialNavigation,
  withViewTransitions,
} from '@angular/router';
import { devInterceptors, devProviders } from './dev-mock';
import { routes } from './app.routes';

/** The snapshots handed to onViewTransitionCreated are the router roots. */
const leaf = (s: ActivatedRouteSnapshot): ActivatedRouteSnapshot =>
  s.firstChild ? leaf(s.firstChild) : s;

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withFetch(), withInterceptors(devInterceptors)),
    provideRouter(
      routes,
      withEnabledBlockingInitialNavigation(),
      withViewTransitions({
        // Switching site or period only changes the query string: update in place,
        // no page-wide cross-fade. Real page changes (different route) get one.
        onViewTransitionCreated: ({ transition, from, to }) => {
          if (leaf(from).routeConfig === leaf(to).routeConfig) transition.skipTransition();
        },
      }),
    ),
    ...devProviders,
  ],
};
