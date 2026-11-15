import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Row } from '../../core/api';
import { Pulse, WorldMap } from './world-map';

const row = (key: string, label: string, visitors: number): Row => ({
  key,
  label,
  visitors,
  count: visitors,
  share: 0,
});

async function render(rows: Row[] = [], pulses: Pulse[] = []) {
  const fixture = TestBed.createComponent(WorldMap);
  fixture.componentRef.setInput('rows', rows);
  fixture.componentRef.setInput('pulses', pulses);
  fixture.detectChanges();
  await vi.waitFor(async () => {
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('path[data-code]')).toBeTruthy();
  });
  await fixture.whenStable();
  return fixture;
}

/** The whole world, whatever the map fitted itself to. */
async function world(f: ComponentFixture<WorldMap>) {
  while (scale(f) > 1) await press(f, '-');
}

/** Map point (viewBox units) in the middle of the frame, from the transform on the map group. */
const centre = (f: ComponentFixture<WorldMap>) => {
  const [x, y, k] = /translate\(([-\d.e]+) ([-\d.e]+)\) scale\(([\d.]+)\)/
    .exec(el(f).querySelector('svg > g')!.getAttribute('transform')!)!
    .slice(1)
    .map(Number);
  return { x: (480 - x) / k, y: (250 - y) / k };
};

const el = (f: ComponentFixture<WorldMap>) => f.nativeElement as HTMLElement;
const frame = (f: ComponentFixture<WorldMap>) => el(f).querySelector<HTMLElement>('[role=group]')!;
const scale = (f: ComponentFixture<WorldMap>) =>
  Number(/scale\(([\d.]+)\)/.exec(el(f).querySelector('svg > g')!.getAttribute('transform')!)![1]);
const button = (f: ComponentFixture<WorldMap>, label: string) =>
  el(f).querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;

async function press(f: ComponentFixture<WorldMap>, key: string) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  frame(f).dispatchEvent(event);
  await f.whenStable();
  return event;
}

describe('WorldMap', () => {
  beforeEach(() => {
    // no animation: every zoom lands immediately
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query }));
  });
  afterEach(() => vi.unstubAllGlobals());

  describe('lighting', () => {
    it('lights the shape of a country with visitors (Czechia, 1 visitor, 100%)', async () => {
      const f = await render([row('CZ', 'Czechia', 1)]);
      const cz = el(f).querySelector<SVGPathElement>('path[data-code=CZ]')!;
      expect(cz.style.fill).toContain('var(--color-sodium)');
      expect(cz.style.fill).toContain('92%');
      const other = el(f).querySelector<SVGPathElement>('path[data-code=DE]')!;
      expect(other.style.fill).not.toContain('sodium');
    });

    it('glows around a small country in proportion to its share, and dots one too small to see', async () => {
      const f = await render([row('CZ', 'Czechia', 530), row('LU', 'Luxembourg', 10)]);
      await world(f);
      const cores = [...el(f).querySelectorAll('.core')];
      expect(cores).toHaveLength(2);
      // only Luxembourg is too small to see: Czechia's shape stays uncovered
      expect(cores.filter((d) => d.classList.contains('on'))).toHaveLength(1);
      const halo = (code: string) => {
        const h = el(f).querySelector<SVGElement>(`[data-beacon=${code}] .halo`)!;
        return { r: Number(h.getAttribute('r')), o: Number(h.style.opacity) };
      };
      const cz = halo('CZ');
      const lu = halo('LU');
      expect(cz.o).toBeGreaterThan(0.9);
      expect(cz.r).toBeGreaterThan(lu.r * 1.5); // 53% of the traffic reads clearly bigger than 1%
    });

    it('lets a big country with few visitors fade next to a small one with many', async () => {
      const f = await render([row('CZ', 'Czechia', 530), row('US', 'United States', 80)]);
      await world(f);
      const halo = (code: string) =>
        Number(el(f).querySelector<SVGElement>(`[data-beacon=${code}] .halo`)!.style.opacity);
      const [cz, us] = [halo('CZ'), halo('US')];
      expect(cz).toBeGreaterThan(0.9);
      expect(us).toBe(0);
      const mix = (code: string) =>
        Number(
          /(\d+)%\)?$/.exec(
            el(f).querySelector<SVGPathElement>(`path[data-code=${code}]`)!.style.fill,
          )![1],
        );
      expect(mix('CZ')).toBe(92);
      expect(mix('US')).toBeLessThan(40);
    });

    it('draws Somaliland and Northern Cyprus lit with their country instead of leaving holes', async () => {
      const f = await render([row('SO', 'Somalia', 10), row('CY', 'Cyprus', 10)]);
      expect(el(f).querySelectorAll('path[data-code=SO]')).toHaveLength(2);
      expect(el(f).querySelectorAll('path[data-code=CY]')).toHaveLength(2);
      // one beacon per country, not per piece
      expect(el(f).querySelectorAll('.core')).toHaveLength(2);
    });

    it('has a legend for the choropleth only', async () => {
      const f = await render([row('CZ', 'Czechia', 10)]);
      const legend = el(f).querySelector('.scale-key')!;
      expect(legend.textContent).toContain('Fewer');
      expect(legend.textContent).toContain('More');
      expect(legend.querySelectorAll('i')).toHaveLength(3);
      expect(legend.getAttribute('aria-label')).toContain('10');
      const live = await render();
      expect(el(live).querySelector('.scale-key')).toBeNull();
    });

    it('draws the hovered country once more on top, clearly', async () => {
      const f = await render([row('CZ', 'Czechia', 10)]);
      const cz = el(f).querySelector('path[data-code=CZ]')!;
      expect(el(f).querySelector('.country-hover')).toBeNull();
      const Ctor = (window as { PointerEvent?: typeof PointerEvent }).PointerEvent ?? MouseEvent;
      cz.dispatchEvent(new Ctor('pointermove', { bubbles: true, clientX: 5, clientY: 5 }));
      f.detectChanges();
      const shape = el(f).querySelector('.country-hover')!;
      expect(shape.getAttribute('d')).toBe(cz.getAttribute('d'));
      expect(shape.classList).toContain('ns');
    });

    it('keeps borders hairline at any zoom', async () => {
      const f = await render();
      expect(el(f).querySelector('path[data-code=CZ]')!.classList).toContain('ns');
    });
  });

  describe('zoom controls', () => {
    it('zooms with the buttons up to 8x and down to 1x, and dims them at the limits', async () => {
      const f = await render();
      expect(button(f, 'Zoom out').getAttribute('aria-disabled')).toBe('true');
      for (const k of [2, 4, 8, 8]) {
        button(f, 'Zoom in').click();
        await f.whenStable();
        expect(scale(f)).toBe(k);
      }
      expect(button(f, 'Zoom in').getAttribute('aria-disabled')).toBe('true');
      expect(button(f, 'Zoom out').getAttribute('aria-disabled')).toBe('false');
      button(f, 'Zoom out').click();
      await f.whenStable();
      expect(scale(f)).toBe(4);
      button(f, 'Reset view').click();
      await f.whenStable();
      expect(scale(f)).toBe(1);
    });

    it('offers reset only while the map is zoomed in, and keeps focus on the map when it goes', async () => {
      const f = await render();
      expect(button(f, 'Reset view')).toBeNull();
      button(f, 'Zoom in').click();
      await f.whenStable();
      expect(button(f, 'Reset view')).toBeTruthy();
      const reset = button(f, 'Reset view');
      reset.focus();
      reset.click();
      await f.whenStable();
      expect(button(f, 'Reset view')).toBeNull();
      expect(document.activeElement).toBe(frame(f));
    });

    it('zooms with + and - and resets with 0 when the map is focused', async () => {
      const f = await render();
      expect(frame(f).tabIndex).toBe(0);
      expect((await press(f, '+')).defaultPrevented).toBe(true);
      expect(scale(f)).toBe(2);
      await press(f, '=');
      expect(scale(f)).toBe(4);
      await press(f, '-');
      expect(scale(f)).toBe(2);
      await press(f, '0');
      expect(scale(f)).toBe(1);
    });

    it('leaves browser shortcuts and unrelated keys alone', async () => {
      const f = await render();
      const withCtrl = new KeyboardEvent('keydown', { key: '+', ctrlKey: true, cancelable: true });
      frame(f).dispatchEvent(withCtrl);
      expect(withCtrl.defaultPrevented).toBe(false);
      expect((await press(f, 'a')).defaultPrevented).toBe(false);
      expect(scale(f)).toBe(1);
    });

    it('pans with the arrow keys only when zoomed in, so the page keeps scrolling otherwise', async () => {
      const f = await render();
      expect((await press(f, 'ArrowDown')).defaultPrevented).toBe(false);
      await press(f, '+');
      await press(f, '+');
      const before = el(f).querySelector('svg > g')!.getAttribute('transform');
      expect((await press(f, 'ArrowLeft')).defaultPrevented).toBe(true);
      expect(el(f).querySelector('svg > g')!.getAttribute('transform')).not.toBe(before);
    });
  });

  describe('wheel and page scroll', () => {
    const wheel = (f: ComponentFixture<WorldMap>, init: WheelEventInit) => {
      const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
      el(f).querySelector('svg')!.dispatchEvent(event);
      f.detectChanges();
      return event;
    };

    it('lets a plain wheel scroll the page and shows the hint', async () => {
      const f = await render();
      const event = wheel(f, { deltaY: -120 });
      await f.whenStable();
      expect(event.defaultPrevented).toBe(false);
      expect(scale(f)).toBe(1);
      expect(el(f).textContent).toMatch(/Use (⌘|Ctrl) \+ scroll to zoom/);
    });

    it('zooms on ctrl+wheel (a trackpad pinch) and on cmd+wheel, and keeps the page still', async () => {
      const f = await render();
      const pinch = wheel(f, { deltaY: -40, ctrlKey: true });
      expect(pinch.defaultPrevented).toBe(true);
      const afterPinch = scale(f);
      expect(afterPinch).toBeGreaterThan(1);
      const cmd = wheel(f, { deltaY: -100, metaKey: true });
      expect(cmd.defaultPrevented).toBe(true);
      expect(scale(f)).toBeGreaterThan(afterPinch);
      for (let i = 0; i < 20; i++) wheel(f, { deltaY: -100, ctrlKey: true });
      expect(scale(f)).toBe(8);
      for (let i = 0; i < 40; i++) wheel(f, { deltaY: 100, ctrlKey: true });
      expect(scale(f)).toBe(1);
    });
  });

  describe('what scales', () => {
    it('keeps pulse rings, glows and dots at a constant on-screen size by scaling against the zoom', async () => {
      const f = await render([], [{ id: 1, country: 'DE' }]);
      const pulse = () => el(f).querySelector('svg g.pointer-events-none[transform]')!;
      expect(pulse().getAttribute('transform')).toMatch(/scale\(1\)$/);
      await press(f, '+');
      expect(pulse().getAttribute('transform')).toMatch(/scale\(0\.5\)$/);
      await press(f, '+');
      expect(pulse().getAttribute('transform')).toMatch(/scale\(0\.25\)$/);
      // and the glow spread shrinks with it
      expect(el(f).querySelector('feGaussianBlur')!.getAttribute('stdDeviation')).toBe('1.25');

      const g = await render([row('LU', 'Luxembourg', 1)]);
      await world(g);
      await press(g, '+');
      expect(el(g).querySelector('.halo')!.parentElement!.getAttribute('transform')).toMatch(
        /scale\(0\.5\)$/,
      );
    });

    it('fades a dot out once zooming has made the country visible', async () => {
      const f = await render([row('SI', 'Slovenia', 1)]);
      await world(f);
      const core = () => el(f).querySelector('.core')!;
      expect(core().classList.contains('on')).toBe(true);
      await press(f, '+');
      expect(core().classList.contains('on')).toBe(false);
    });

    it('fades the glow out as the shape grows past it', async () => {
      const f = await render([row('CZ', 'Czechia', 10)]);
      await world(f);
      const glow = () => Number(el(f).querySelector<SVGElement>('.halo')!.style.opacity);
      const before = glow();
      for (let i = 0; i < 3; i++) await press(f, '+');
      expect(before).toBeGreaterThan(0.9);
      expect(glow()).toBeLessThan(before);
    });
  });

  describe('fit to data', () => {
    it('frames Czechia, capped at 4x, centred on it (a single visitor, 100%)', async () => {
      const f = await render([row('CZ', 'Czechia', 1)]);
      expect(scale(f)).toBe(4);
      const c = centre(f);
      expect(Math.abs(c.x - 515)).toBeLessThan(25);
      expect(Math.abs(c.y - 100)).toBeLessThan(25);
    });

    it('shows the whole world when there is no data', async () => {
      const f = await render();
      expect(scale(f)).toBe(1);
    });

    it('does not let a far-away handful of visitors push the map out to the whole world', async () => {
      const f = await render([
        row('CZ', 'Czechia', 500),
        row('DE', 'Germany', 90),
        row('US', 'United States', 40),
        row('AU', 'Australia', 5),
      ]);
      expect(scale(f)).toBeGreaterThanOrEqual(2);
      expect(Math.abs(centre(f).x - 515)).toBeLessThan(60); // Europe, not the Atlantic
    });

    it('does not crop an audience that really is spread out', async () => {
      const f = await render([row('US', 'United States', 50), row('AU', 'Australia', 50)]);
      expect(scale(f)).toBeLessThan(2);
    });

    it('follows the data until the visitor takes over', async () => {
      const f = await render([row('CZ', 'Czechia', 5)]);
      const czCentre = centre(f);
      f.componentRef.setInput('rows', [row('US', 'United States', 5)]);
      f.detectChanges();
      await f.whenStable();
      expect(centre(f).x).toBeLessThan(czCentre.x - 100); // moved to North America
      await press(f, '+');
      const after = centre(f);
      f.componentRef.setInput('rows', [row('CZ', 'Czechia', 5)]);
      f.detectChanges();
      await f.whenStable();
      expect(centre(f)).toEqual(after);
    });

    it('resets to the fitted view, and offers reset only when away from it', async () => {
      const f = await render([row('CZ', 'Czechia', 5)]);
      expect(button(f, 'Reset view')).toBeNull();
      await press(f, '-');
      expect(scale(f)).toBe(2);
      expect(button(f, 'Reset view')).toBeTruthy();
      button(f, 'Reset view').click();
      await f.whenStable();
      expect(scale(f)).toBe(4);
      expect(button(f, 'Reset view')).toBeNull();
      await press(f, '-');
      await press(f, '0');
      expect(scale(f)).toBe(4);
    });

    it('zooms the buttons around what is at the centre of the frame now', async () => {
      const f = await render([row('CZ', 'Czechia', 5)]);
      const before = centre(f);
      await press(f, '-');
      // x is exactly where it was; y can only move toward the middle, to keep the world in the frame
      expect(centre(f).x).toBeCloseTo(before.x);
      expect(centre(f).y).toBeGreaterThanOrEqual(before.y);
      expect(centre(f).y).toBeLessThan(before.y + 40);
      await press(f, '+');
      expect(centre(f).x).toBeCloseTo(before.x);
    });

    it('dims a button only when it really cannot do anything', async () => {
      const f = await render([row('CZ', 'Czechia', 5)]);
      expect(button(f, 'Zoom in').getAttribute('aria-disabled')).toBe('false');
      expect(button(f, 'Zoom out').getAttribute('aria-disabled')).toBe('false');
      for (let i = 0; i < 3; i++) await press(f, '+');
      expect(button(f, 'Zoom in').getAttribute('aria-disabled')).toBe('true');
      await world(f);
      expect(button(f, 'Zoom out').getAttribute('aria-disabled')).toBe('true');
      expect(button(f, 'Reset view').getAttribute('aria-disabled')).toBe('false');
    });
  });

  describe('touch', () => {
    it('hands one-finger swipes to the page until zoomed in, then keeps the gesture for panning', async () => {
      const f = await render();
      const svg = el(f).querySelector('svg')!;
      expect(svg.style.touchAction).toBe('pan-x pan-y');
      await press(f, '+');
      expect(svg.style.touchAction).toBe('none');
      await press(f, '0');
      expect(svg.style.touchAction).toBe('pan-x pan-y');
    });

    it('keeps handing swipes to the page at the fitted view, which is zoomed in but untouched', async () => {
      const f = await render([row('CZ', 'Czechia', 5)]);
      const svg = el(f).querySelector('svg')!;
      expect(scale(f)).toBe(4);
      expect(svg.style.touchAction).toBe('pan-x pan-y');
      await press(f, '-');
      expect(svg.style.touchAction).toBe('none');
    });
  });

  describe('tap on touch', () => {
    const tip = (f: ComponentFixture<WorldMap>) =>
      el(f)
        .querySelector('.pointer-events-none.absolute.z-10')
        ?.textContent?.replace(/\s+/g, ' ')
        .trim();

    const pointer = (f: ComponentFixture<WorldMap>, type: string, init: PointerEventInit) => {
      const Ctor = (window as { PointerEvent?: typeof PointerEvent }).PointerEvent;
      const event = Ctor
        ? new Ctor(type, { bubbles: true, cancelable: true, pointerId: 1, ...init })
        : Object.assign(new MouseEvent(type, { bubbles: true, cancelable: true, ...init }), {
            pointerId: 1,
            pointerType: init.pointerType,
          });
      el(f).querySelector('svg')!.dispatchEvent(event);
      f.detectChanges();
    };
    const tap = (f: ComponentFixture<WorldMap>, pointerType: string, x = 100, y = 60) => {
      pointer(f, 'pointerdown', { pointerType, clientX: x, clientY: y });
      pointer(f, 'pointerup', { pointerType, clientX: x, clientY: y });
    };
    const over = (code: string | null) => {
      document.elementFromPoint = () =>
        code ? (document.querySelector(`path[data-code=${code}]`) as Element) : null;
    };

    afterEach(() => {
      vi.useRealTimers();
      delete (document as { elementFromPoint?: unknown }).elementFromPoint;
    });

    it('names the tapped country, for about 2.5 s', async () => {
      const f = await render([row('CZ', 'Czechia', 279)]);
      vi.useFakeTimers();
      over('CZ');
      tap(f, 'touch');
      expect(tip(f)).toBe('Czechia279 visitors');
      expect(el(f).querySelector('.country-hover')).toBeTruthy();
      vi.advanceTimersByTime(2400);
      f.detectChanges();
      expect(tip(f)).toBeTruthy();
      vi.advanceTimersByTime(200);
      f.detectChanges();
      expect(tip(f)).toBeUndefined();
    });

    it('works for a pen, and also for a country without visitors', async () => {
      const f = await render([row('CZ', 'Czechia', 279)]);
      over('DE');
      tap(f, 'pen');
      expect(tip(f)).toBe('GermanyNo visitors');
    });

    it('moves to the next tapped country and closes on a tap on the ocean', async () => {
      const f = await render([row('CZ', 'Czechia', 279)]);
      over('CZ');
      tap(f, 'touch');
      over('DE');
      tap(f, 'touch', 140, 60);
      expect(tip(f)).toContain('Germany');
      over(null);
      tap(f, 'touch', 10, 10);
      expect(tip(f)).toBeUndefined();
    });

    it('closes on a tap outside the map', async () => {
      const f = await render([row('CZ', 'Czechia', 279)]);
      over('CZ');
      tap(f, 'touch');
      expect(tip(f)).toBeTruthy();
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      f.detectChanges();
      expect(tip(f)).toBeUndefined();
    });

    it('is not shown for a drag, and the lifted finger does not close it', async () => {
      const f = await render([row('CZ', 'Czechia', 279)]);
      over('CZ');
      pointer(f, 'pointerdown', { pointerType: 'touch', clientX: 100, clientY: 60 });
      pointer(f, 'pointermove', { pointerType: 'touch', clientX: 160, clientY: 60 });
      pointer(f, 'pointerup', { pointerType: 'touch', clientX: 160, clientY: 60 });
      expect(tip(f)).toBeUndefined();
      tap(f, 'touch');
      pointer(f, 'pointerleave', { pointerType: 'touch' }); // browsers send this right after a touch ends
      expect(tip(f)).toBeTruthy();
    });

    it('does not nudge the fitted map when a finger starts a page scroll, but a mouse drag pans it', async () => {
      const f = await render([row('CZ', 'Czechia', 5)]);
      const before = el(f).querySelector('svg > g')!.getAttribute('transform');
      pointer(f, 'pointerdown', { pointerType: 'touch', clientX: 100, clientY: 100 });
      pointer(f, 'pointermove', { pointerType: 'touch', clientX: 100, clientY: 70 });
      pointer(f, 'pointerup', { pointerType: 'touch', clientX: 100, clientY: 70 });
      expect(el(f).querySelector('svg > g')!.getAttribute('transform')).toBe(before);
      pointer(f, 'pointerdown', { pointerType: 'mouse', clientX: 100, clientY: 100, button: 0 });
      pointer(f, 'pointermove', { pointerType: 'mouse', clientX: 100, clientY: 70 });
      pointer(f, 'pointerup', { pointerType: 'mouse', clientX: 100, clientY: 70 });
      expect(el(f).querySelector('svg > g')!.getAttribute('transform')).not.toBe(before);
    });

    it('pans with one finger once the visitor has zoomed or moved the map', async () => {
      const f = await render([row('CZ', 'Czechia', 5)]);
      await press(f, '-');
      const before = el(f).querySelector('svg > g')!.getAttribute('transform');
      pointer(f, 'pointerdown', { pointerType: 'touch', clientX: 100, clientY: 100 });
      pointer(f, 'pointermove', { pointerType: 'touch', clientX: 100, clientY: 70 });
      pointer(f, 'pointerup', { pointerType: 'touch', clientX: 100, clientY: 70 });
      expect(el(f).querySelector('svg > g')!.getAttribute('transform')).not.toBe(before);
    });

    it('leaves the mouse alone: it hovers, a click does not pin a tooltip', async () => {
      const f = await render([row('CZ', 'Czechia', 279)]);
      over('CZ');
      tap(f, 'mouse');
      expect(tip(f)).toBeUndefined();
    });

    it('a double tap zooms and clears the tooltip', async () => {
      const f = await render([row('CZ', 'Czechia', 279)]);
      await world(f);
      over('CZ');
      tap(f, 'touch');
      expect(tip(f)).toBeTruthy();
      tap(f, 'touch');
      await f.whenStable();
      expect(scale(f)).toBe(2);
      expect(tip(f)).toBeUndefined();
    });
  });
});
