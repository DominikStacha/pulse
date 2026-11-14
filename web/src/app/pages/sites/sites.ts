import { httpResource, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Breakdown, Site } from '../../core/api';
import { formatNumber } from '../../core/format';
import { SitesService } from '../../core/sites';
import { Icon } from '../../ui/icon';
import { PageHeader } from '../../ui/page-header';
import { SiteIcon } from '../../ui/site-icon';
import { StateMessage } from '../../ui/state-message';

const DOMAIN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** What the tracker tag looks like for a site. Exported for the spec. */
export function embedSnippet(siteId: string): string {
  return `<script defer src="https://stacha.tech/a/script.js" data-website-id="${siteId}"></script>`;
}

/** "https://Klettr.com/routes?x=1" -> "klettr.com": people paste addresses, the API wants a host. */
export function normaliseDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/[/?#].*$/, '');
}

@Component({
  selector: 'pl-sites',
  imports: [Icon, PageHeader, RouterLink, SiteIcon, StateMessage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sites.html',
})
export class SitesPage {
  protected readonly sites = inject(SitesService);
  protected readonly snippet = embedSnippet;
  protected readonly formatNumber = formatNumber;

  /** Last 7 days of visitors per site, for the little count on each card. */
  private readonly week = httpResource<Breakdown>(() => ({
    url: '/api/stats/breakdown',
    params: { dim: 'sites', site: 'all', period: '7d', limit: 50 },
  }));
  protected readonly weekly = computed(
    () =>
      new Map((this.week.hasValue() ? this.week.value().rows : []).map((r) => [r.key, r.visitors])),
  );

  /** The site that was just added leads the list, so it is not hidden below the fold. */
  protected readonly ordered = computed(() => {
    const list = this.sites.list();
    const added = this.added();
    if (!list || !added) return list;
    return [...list.filter((s) => s.id === added.id), ...list.filter((s) => s.id !== added.id)];
  });

  protected readonly name = signal('');
  protected readonly domain = signal('');
  protected readonly touched = signal(false);
  protected readonly saving = signal(false);
  protected readonly serverError = signal<string | null>(null);
  protected readonly added = signal<Site | null>(null);
  protected readonly copied = signal<string | null>(null);

  protected readonly cleanDomain = computed(() => normaliseDomain(this.domain()));
  protected readonly nameError = computed(() =>
    this.name().trim() ? null : 'Give the site a name.',
  );
  protected readonly domainError = computed(() => {
    const d = this.cleanDomain();
    if (!d) return 'Enter the site address, for example klettr.com.';
    return DOMAIN.test(d) ? null : 'Use a plain host name such as klettr.com or app.klettr.com.';
  });

  protected submit(event: Event): void {
    event.preventDefault();
    this.touched.set(true);
    this.serverError.set(null);
    if (this.nameError() || this.domainError() || this.saving()) return;

    this.saving.set(true);
    this.sites.add(this.name().trim(), this.cleanDomain()).subscribe({
      next: (site) => {
        this.saving.set(false);
        this.added.set(site);
        this.name.set('');
        this.domain.set('');
        this.touched.set(false);
      },
      error: (e: unknown) => {
        this.saving.set(false);
        this.serverError.set(describe(e));
      },
    });
  }

  protected async copy(site: Site): Promise<void> {
    if (!(await copyText(embedSnippet(site.id)))) return;
    this.copied.set(site.id);
    setTimeout(() => this.copied.update((id) => (id === site.id ? null : id)), 1800);
  }

  protected created(site: Site): string {
    return new Date(site.createdAt).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  protected onName(event: Event): void {
    this.name.set((event.target as HTMLInputElement).value);
  }

  protected onDomain(event: Event): void {
    this.domain.set((event.target as HTMLInputElement).value);
  }
}

function describe(e: unknown): string {
  if (!(e instanceof HttpErrorResponse)) return 'Could not add the site. Try again.';
  if (e.status === 409) return 'A site with this domain already exists.';
  const message = (e.error as { error?: unknown } | null)?.error;
  if (e.status === 400 && typeof message === 'string') return message;
  if (e.status === 401 || e.status === 403)
    return 'Access denied. Sign in through Cloudflare Access again.';
  return `Could not add the site (HTTP ${e.status}). Try again.`;
}

/**
 * The async Clipboard API needs a secure context and a focused page, and in some
 * browsers never settles when it is refused; give it a second, then fall back
 * to selecting a hidden field.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    await Promise.race([
      navigator.clipboard.writeText(text),
      new Promise<never>((_, reject) => setTimeout(reject, 1000)),
    ]);
    return true;
  } catch {
    const field = document.createElement('textarea');
    field.value = text;
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    const ok = document.execCommand('copy');
    field.remove();
    return ok;
  }
}
