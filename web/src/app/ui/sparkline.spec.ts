import { TestBed } from '@angular/core/testing';
import { Sparkline } from './sparkline';

const at = (d: number, h: number) => new Date(2026, 10, d, h).getTime() / 1000;

async function render(samples: { t: number; y: number }[]) {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 240,
    height: 44,
    left: 0,
    top: 0,
  } as DOMRect);
  const fixture = TestBed.createComponent(Sparkline);
  fixture.componentRef.setInput('samples', samples);
  fixture.componentRef.setInput('interactive', true);
  fixture.componentRef.setInput('tip', (i: number) => `value ${i}`);
  await fixture.whenStable();
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const press = async (key: string) => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    await fixture.whenStable();
    fixture.detectChanges();
  };
  return { el, press };
}

describe('Sparkline', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('is focusable and can be inspected with the arrow keys', async () => {
    const { el, press } = await render([1, 2, 3].map((y) => ({ t: y, y })));
    expect(el.getAttribute('tabindex')).toBe('0');
    await press('ArrowLeft'); // starts at the newest sample
    expect(el.textContent).toContain('value 2');
    await press('ArrowLeft');
    expect(el.textContent).toContain('value 1');
    await press('Escape');
    expect(el.textContent).not.toContain('value');
  });

  it('names the day when a 24 h window crosses midnight', async () => {
    const { el, press } = await render([
      { t: at(14, 22), y: 1 },
      { t: at(15, 2), y: 2 },
      { t: at(15, 6), y: 3 },
    ]);
    await press('Home');
    expect(el.textContent).toContain('Sat 14 Nov');
    await press('End');
    expect(el.textContent).toContain('Sun 15 Nov');
  });

  it('stays quiet about the day inside a single day', async () => {
    const { el, press } = await render([
      { t: at(15, 1), y: 1 },
      { t: at(15, 2), y: 2 },
      { t: at(15, 3), y: 3 },
    ]);
    await press('Home');
    expect(el.textContent).toContain('value 0');
    expect(el.textContent).not.toContain('Nov');
  });

  it('is not a tab stop when it is only decoration', async () => {
    const fixture = TestBed.createComponent(Sparkline);
    fixture.componentRef.setInput(
      'samples',
      [1, 2, 3].map((y) => ({ t: y, y })),
    );
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).hasAttribute('tabindex')).toBe(false);
  });
});
