import { TestBed } from '@angular/core/testing';
import { Point } from '../core/api';
import { AreaChart } from './area-chart';

const day = (d: number, visitors: number, pageviews: number): Point => ({
  t: `2026-11-${String(d).padStart(2, '0')}T00:00:00+01:00`,
  visitors,
  visits: visitors,
  pageviews,
});

const points = [day(8, 10, 25), day(9, 40, 90), day(10, 20, 50)];
const previous = [day(1, 8, 20), day(2, 30, 70), day(3, 25, 60)];

async function render(data: Point[]) {
  // jsdom has no layout: give the chart a width to draw in.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 640,
    height: 320,
  } as DOMRect);
  const fixture = TestBed.createComponent(AreaChart);
  fixture.componentRef.setInput('points', data);
  fixture.componentRef.setInput('previous', previous);
  fixture.componentRef.setInput('bucket', 'day');
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

describe('AreaChart', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('draws both series and the ghost lines', async () => {
    const el = (await render(points)).nativeElement as HTMLElement;
    // 2 areas + 2 lines + 2 dashed tails for the unfinished newest bucket + 2 ghosts
    expect(el.querySelectorAll('svg g path')).toHaveLength(8);
    expect(el.textContent).toContain('8 Nov');
    expect(el.textContent).toContain('10 Nov');
  });

  it('describes itself for screen readers', async () => {
    const el = (await render(points)).nativeElement as HTMLElement;
    const label = el.getAttribute('aria-label') ?? '';
    expect(label).toContain('3 day buckets');
    expect(label).toContain('Busiest: Mon 9 Nov with 40 visitors');
  });

  it('can be inspected with the arrow keys and cleared with Escape', async () => {
    const fixture = await render(points);
    const el = fixture.nativeElement as HTMLElement;
    const press = async (key: string) => {
      el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      await fixture.whenStable();
      fixture.detectChanges();
    };

    await press('ArrowLeft'); // starts at the newest bucket
    expect(el.textContent).toContain('Tue 10 Nov (so far)');
    await press('ArrowLeft');
    expect(el.textContent).toContain('Mon 9 Nov');
    expect(el.textContent).toContain('Before: Mon 2 Nov');
    await press('Escape');
    expect(el.textContent).not.toContain('Before:');
  });

  it('says so when nothing was recorded', async () => {
    const el = (await render([day(8, 0, 0), day(9, 0, 0)])).nativeElement as HTMLElement;
    expect(el.textContent).toContain('No visits in this period yet');
  });
});
