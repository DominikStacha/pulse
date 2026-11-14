import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { tap } from 'rxjs';
import { Site } from './api';

@Injectable({ providedIn: 'root' })
export class SitesService {
  private readonly http = inject(HttpClient);
  private readonly resource = httpResource<Site[]>(() => '/api/sites');

  /** undefined until the first response (or after a failure). */
  readonly list = computed(() => (this.resource.hasValue() ? this.resource.value() : undefined));
  readonly loading = this.resource.isLoading;
  readonly error = this.resource.error;

  byId(id: string): Site | undefined {
    return this.list()?.find((s) => s.id === id);
  }

  reload(): void {
    this.resource.reload();
  }

  /** POST /api/sites; the list refreshes itself on success. */
  add(name: string, domain: string) {
    return this.http
      .post<Site>('/api/sites', { name, domain })
      .pipe(tap(() => this.resource.reload()));
  }
}
