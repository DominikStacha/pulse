import { TestBed } from '@angular/core/testing';
import { CountUp } from './count-up';

function render(value: number) {
  const fixture = TestBed.createComponent(CountUp);
  fixture.componentRef.setInput('value', value);
  return fixture;
}

describe('CountUp', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('jumps straight to the number when the visitor prefers reduced motion', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query }));
    const fixture = render(1234);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('1,234');
  });

  it('always exposes the final number to screen readers, even mid-animation', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query }));
    vi.stubGlobal('requestAnimationFrame', () => 1); // never ticks: the visible count stays at 0
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    const fixture = render(5678);
    await fixture.whenStable();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[aria-hidden="true"]')?.textContent).toBe('0');
    expect(el.querySelector('.sr-only')?.textContent).toBe('5,678');
  });

  it('formats with the given formatter', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query }));
    const fixture = render(42);
    fixture.componentRef.setInput('format', (n: number) => `${n}%`);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('42%');
  });
});
