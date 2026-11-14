import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SitesPage, embedSnippet, normaliseDomain } from './sites';

describe('embed snippet', () => {
  it('points at the public script URL with the site id', () => {
    expect(embedSnippet('abc')).toBe(
      '<script defer src="https://stacha.tech/a/script.js" data-website-id="abc"></script>',
    );
  });
});

describe('normaliseDomain', () => {
  it('turns a pasted address into a lowercase host', () => {
    expect(normaliseDomain('  https://Klettr.com/routes?x=1 ')).toBe('klettr.com');
    expect(normaliseDomain('HTTP://app.Klettr.com')).toBe('app.klettr.com');
    expect(normaliseDomain('klettr.com')).toBe('klettr.com');
  });
});

describe('SitesPage', () => {
  async function setup() {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(SitesPage);
    fixture.detectChanges();
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve)); // let the resources issue their requests
    http
      .expectOne('/api/sites')
      .flush([
        { id: 's1', name: 'Klettr', domain: 'klettr.com', createdAt: '2025-11-05T18:40:00+01:00' },
      ]);
    http
      .expectOne((r) => r.url === '/api/stats/breakdown')
      .flush({
        dim: 'sites',
        totalVisitors: 10,
        rows: [{ key: 's1', label: 'Klettr', visitors: 10, count: 12, share: 1 }],
      });
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const submit = async () => {
      el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
      await fixture.whenStable();
      fixture.detectChanges();
    };
    const type = (id: string, value: string) => {
      const input = el.querySelector<HTMLInputElement>(`#${id}`)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    return { el, http, fixture, submit, type };
  }

  it('lists each site with its copyable tag and weekly visitors', async () => {
    const { el } = await setup();
    expect(el.textContent).toContain('klettr.com');
    expect(el.querySelector('code')?.textContent).toBe(embedSnippet('s1'));
    expect(el.textContent).toContain('10');
  });

  it('refuses a bad domain without calling the API', async () => {
    const { el, http, submit, type } = await setup();
    type('site-name', 'Shop');
    type('site-domain', 'not a domain');
    await submit();
    expect(el.querySelector('#domain-err')?.textContent).toContain('plain host name');
    http.expectNone((r) => r.method === 'POST');
  });

  it('posts the cleaned-up host and shows API errors', async () => {
    const { el, http, fixture, submit, type } = await setup();
    type('site-name', 'Shop');
    type('site-domain', 'https://Shop.example.com/');
    await submit();
    const req = http.expectOne((r) => r.method === 'POST');
    expect(req.request.body).toEqual({ name: 'Shop', domain: 'shop.example.com' });
    req.flush({ error: 'exists' }, { status: 409, statusText: 'Conflict' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.textContent).toContain('already exists');
  });
});
