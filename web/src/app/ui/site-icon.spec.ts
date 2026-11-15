import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { SiteIcon } from './site-icon';

const KLETTR = {
  id: 's1',
  name: 'Klettr',
  domain: 'klettr.com',
  createdAt: '2025-11-05T18:40:00Z',
};

async function setup(inputs: { domain?: string | null; siteId?: string | null }) {
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
  const fixture = TestBed.createComponent(SiteIcon);
  for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
  fixture.detectChanges();
  TestBed.tick();
  await new Promise((resolve) => setTimeout(resolve)); // let the sites resource issue its request
  TestBed.inject(HttpTestingController).expectOne('/api/sites').flush([KLETTR]);
  await fixture.whenStable();
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  return { fixture, el, img: () => el.querySelector('img') };
}

describe('SiteIcon', () => {
  it('loads the icon from the API by site id, never from the site itself', async () => {
    const { img } = await setup({ domain: 'klettr.com', siteId: 's1' });
    expect(img()?.getAttribute('src')).toBe('/api/sites/s1/icon');
  });

  it('finds the site id from a known domain', async () => {
    const { img } = await setup({ domain: 'klettr.com' });
    expect(img()?.getAttribute('src')).toBe('/api/sites/s1/icon');
  });

  it('stays a monogram for a name or domain that is not a site', async () => {
    const { el, img } = await setup({ domain: 'Špalíky a stínidla do kapsy' });
    expect(img()).toBeNull();
    expect(el.textContent?.trim()).toBe('Š');
  });

  it('falls back to the monogram when the icon is missing', async () => {
    const { fixture, el, img } = await setup({ domain: 'klettr.com' });
    img()!.dispatchEvent(new Event('error'));
    fixture.detectChanges();
    expect(img()).toBeNull();
    expect(el.textContent?.trim()).toBe('K');
  });
});
