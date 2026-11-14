import { httpResource } from '@angular/common/http';
import { inject, linkedSignal } from '@angular/core';
import { Context } from './context';

type Params = Record<string, string | number>;

/**
 * One dashboard query (/api/stats/<path>) driven by the selected site + period.
 * `data` keeps the previous answer while a new one loads (so panels dim instead
 * of flashing empty) but is cleared on error (so a failed switch never shows
 * the old site's numbers under the new site's name). Call in an injection context.
 */
export function stat<T>(path: string, extra?: () => Params) {
  const ctx = inject(Context);
  const resource = httpResource<T>(() => ({
    url: `/api/stats/${path}`,
    params: { site: ctx.site(), period: ctx.period(), ...extra?.() },
  }));

  const data = linkedSignal<{ status: string; value: T | undefined }, T | undefined>({
    source: () => ({
      status: resource.status(),
      value: resource.hasValue() ? resource.value() : undefined,
    }),
    computation: (src, prev) => src.value ?? (src.status === 'loading' ? prev?.value : undefined),
  });

  return {
    data,
    loading: resource.isLoading,
    error: resource.error,
    reload: () => resource.reload(),
  };
}
