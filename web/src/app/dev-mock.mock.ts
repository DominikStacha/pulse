import { HttpInterceptorFn } from '@angular/common/http';
import { Provider } from '@angular/core';
import { LIVE_STREAM } from './core/live';
import { MockLiveStream } from './mock/mock-live';
import { mockApiInterceptor } from './mock/mock-api';

export const devInterceptors: HttpInterceptorFn[] = [mockApiInterceptor];
export const devProviders: Provider[] = [
  { provide: LIVE_STREAM, useValue: (url: string) => new MockLiveStream(url) },
];
