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

  describe('pointer readout', () => {
    const fire = (el: Element, type: string, pointerType: string, clientX: number, clientY = 100) =>
      el.dispatchEvent(
        Object.assign(new Event(type, { bubbles: true }), { pointerType, clientX, clientY }),
      );
    const setup = async () => {
      const fixture = await render(points);
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
        width: 640,
        height: 320,
        left: 0,
        top: 0,
      } as DOMRect);
      const el = fixture.nativeElement as HTMLElement;
      const surface = el.querySelector<HTMLElement>('div.absolute')!;
      const tooltip = () => el.querySelector<HTMLElement>('.z-10');
      const settle = async () => {
        await fixture.whenStable();
        fixture.detectChanges();
      };
      return { el, surface, tooltip, settle };
    };

    it('follows a mouse and goes when it leaves', async () => {
      const { surface, tooltip, settle } = await setup();
      fire(surface, 'pointermove', 'mouse', 300);
      await settle();
      expect(tooltip()).not.toBeNull();
      fire(surface, 'pointerleave', 'mouse', 300);
      await settle();
      expect(tooltip()).toBeNull();
    });

    it('keeps a finger readout after the finger lifts, until a tap elsewhere', async () => {
      const { surface, tooltip, settle } = await setup();
      fire(surface, 'pointerdown', 'touch', 300);
      fire(surface, 'pointerup', 'touch', 300);
      fire(surface, 'pointerleave', 'touch', 300);
      await settle();
      expect(tooltip()).not.toBeNull();
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      await settle();
      expect(tooltip()).toBeNull();
    });

    it('drops the readout when a touch turns into a scroll', async () => {
      const { surface, tooltip, settle } = await setup();
      fire(surface, 'pointerdown', 'touch', 300);
      fire(surface, 'pointercancel', 'touch', 300);
      await settle();
      expect(tooltip()).toBeNull();
    });

    it('never lets the tooltip leave the chart', async () => {
      const { surface, tooltip, settle } = await setup();
      for (const [type, x] of [
        ['mouse', 20],
        ['mouse', 620],
        ['touch', 20],
        ['touch', 620],
      ] as const) {
        fire(surface, 'pointermove', type, x, 30);
        await settle();
        const left = parseFloat(tooltip()!.style.left);
        expect(left, `${type} ${x}`).toBeGreaterThanOrEqual(0);
        expect(left + 176, `${type} ${x}`).toBeLessThanOrEqual(640);
      }
    });

    it('floats above a finger when there is room, beside it when there is not', async () => {
      const { surface, tooltip, settle } = await setup();
      fire(surface, 'pointermove', 'touch', 300, 280);
      await settle();
      expect(tooltip()!.style.bottom).not.toBe('');
      fire(surface, 'pointermove', 'touch', 300, 20);
      await settle();
      expect(tooltip()!.style.bottom).toBe('');
      expect(tooltip()!.style.top).not.toBe('');
    });
  });

  it('says so when nothing was recorded', async () => {
    const el = (await render([day(8, 0, 0), day(9, 0, 0)])).nativeElement as HTMLElement;
    expect(el.textContent).toContain('No visits in this period yet');
  });
});
