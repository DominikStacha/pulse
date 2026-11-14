import { HttpInterceptorFn } from '@angular/common/http';
import { Provider } from '@angular/core';

/**
 * Production: nothing. The `mock` build configuration (angular.json
 * fileReplacements) swaps this file for dev-mock.mock.ts, which wires the fake
 * API and the fake live stream. Nothing in here may import from ./mock.
 */
export const devInterceptors: HttpInterceptorFn[] = [];
export const devProviders: Provider[] = [];
