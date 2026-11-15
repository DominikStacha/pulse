import {
  IDENTITY,
  MAX_FIT_ZOOM,
  MAX_ZOOM,
  MIN_FIT_ZOOM,
  MIN_ZOOM,
  constrain,
  dotRadius,
  fitView,
  gesture,
  haloOpacity,
  haloRadius,
  interpolateView,
  mixPercent,
  showDot,
  wheelFactor,
  zoomAt,
} from './map-zoom';

const W = 960;
const H = 500;

/** The content point under a screen point. */
const under = (v: { k: number; x: number; y: number }, sx: number, sy: number) => ({
  x: (sx - v.x) / v.k,
  y: (sy - v.y) / v.k,
});

describe('constrain', () => {
  it('limits zoom to 1x-8x', () => {
    expect(constrain({ k: 0.2, x: 0, y: 0 }, W, H).k).toBe(MIN_ZOOM);
    expect(constrain({ k: 50, x: -9000, y: -4000 }, W, H).k).toBe(MAX_ZOOM);
  });

  it('has nothing to pan at 1x', () => {
    expect(constrain({ k: 1, x: 300, y: -200 }, W, H)).toEqual(IDENTITY);
  });

  it('keeps the world covering the frame: no gap at any edge', () => {
    const k = 4;
    for (const [x, y] of [
      [500, 500],
      [-99999, -99999],
      [500, -99999],
      [-99999, 500],
    ]) {
      const v = constrain({ k, x, y }, W, H);
      expect(v.x).toBeLessThanOrEqual(0);
      expect(v.y).toBeLessThanOrEqual(0);
      expect(v.x).toBeGreaterThanOrEqual(W * (1 - k));
      expect(v.y).toBeGreaterThanOrEqual(H * (1 - k));
    }
  });

  it('keeps the centre of the frame on the globe, never in the empty corners', () => {
    for (const k of [2, 4, 8]) {
      for (const [x, y] of [
        [0, 0],
        [-99999, -99999],
        [0, -99999],
        [-99999, 0],
      ]) {
        const v = constrain({ k, x, y }, W, H);
        const c = under(v, W / 2, H / 2);
        const e = Math.hypot((c.x - W / 2) / (W / 2), (c.y - H / 2) / (H / 2));
        expect(e).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });

  it('leaves a valid view alone', () => {
    const v = { k: 2, x: -300, y: -120 };
    expect(constrain(v, W, H)).toEqual(v);
  });
});

describe('zoomAt', () => {
  it('keeps the point under the cursor still', () => {
    const v = zoomAt({ k: 2, x: -400, y: -150 }, 1.5, 500, 260, W, H);
    expect(v.k).toBeCloseTo(3);
    const before = under({ k: 2, x: -400, y: -150 }, 500, 260);
    const after = under(v, 500, 260);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('clamps at the limits and stays put there', () => {
    expect(zoomAt(IDENTITY, 0.5, 300, 200, W, H)).toEqual(IDENTITY);
    const max = zoomAt({ k: 4, x: -1000, y: -400 }, 100, 480, 250, W, H);
    expect(max.k).toBe(MAX_ZOOM);
    expect(zoomAt(max, 2, 480, 250, W, H)).toEqual(max);
  });

  it('zooms the centre of the frame in place from 1x', () => {
    expect(zoomAt(IDENTITY, 2, W / 2, H / 2, W, H)).toEqual({ k: 2, x: -W / 2, y: -H / 2 });
  });
});

describe('gesture', () => {
  const v = { k: 2, x: -400, y: -150 };

  it('pans: content follows the finger', () => {
    const out = gesture(v, { cx: 400, cy: 200, d: 0 }, { cx: 450, cy: 230, d: 0 }, W, H);
    expect(out).toEqual({ k: 2, x: -350, y: -120 });
  });

  it('a pinch scales by the spread ratio around the fingers', () => {
    const out = gesture(v, { cx: 500, cy: 250, d: 100 }, { cx: 500, cy: 250, d: 150 }, W, H);
    expect(out.k).toBeCloseTo(3);
    const a = under(v, 500, 250);
    const b = under(out, 500, 250);
    expect(b.x).toBeCloseTo(a.x);
    expect(b.y).toBeCloseTo(a.y);
  });

  it('ignores the spread when only one side has two fingers', () => {
    expect(gesture(v, { cx: 1, cy: 1, d: 0 }, { cx: 1, cy: 1, d: 80 }, W, H).k).toBe(2);
  });

  it('cannot pinch past 8x or below 1x', () => {
    const big = gesture(v, { cx: 500, cy: 250, d: 10 }, { cx: 500, cy: 250, d: 1000 }, W, H);
    expect(big.k).toBe(MAX_ZOOM);
    const small = gesture(v, { cx: 500, cy: 250, d: 1000 }, { cx: 500, cy: 250, d: 10 }, W, H);
    expect(small).toEqual(IDENTITY);
  });
});

describe('wheelFactor', () => {
  const px = { deltaMode: 0, ctrlKey: false };

  it('zooms in on scroll up and out on scroll down', () => {
    expect(wheelFactor({ ...px, deltaY: -100 })).toBeGreaterThan(1);
    expect(wheelFactor({ ...px, deltaY: 100 })).toBeLessThan(1);
    expect(wheelFactor({ ...px, deltaY: 0 })).toBe(1);
  });

  it('is smooth for the small deltas of a trackpad pinch (ctrl+wheel)', () => {
    const f = wheelFactor({ deltaMode: 0, ctrlKey: true, deltaY: -2 });
    expect(f).toBeGreaterThan(1);
    expect(f).toBeLessThan(1.05);
  });

  it('reads line and page deltas', () => {
    expect(wheelFactor({ deltaMode: 1, ctrlKey: false, deltaY: -3 })).toBeGreaterThan(1.05);
    expect(wheelFactor({ deltaMode: 2, ctrlKey: false, deltaY: -0.1 })).toBeGreaterThan(1.05);
  });

  it('never more than doubles per event', () => {
    expect(wheelFactor({ deltaMode: 0, ctrlKey: true, deltaY: -100 })).toBe(2);
    expect(wheelFactor({ deltaMode: 0, ctrlKey: true, deltaY: 5000 })).toBe(0.5);
  });
});

describe('interpolateView', () => {
  const a = { k: 1, x: 0, y: 0 };
  const b = zoomAt(a, 4, 700, 120, W, H);

  it('starts and ends on the given views', () => {
    expect(interpolateView(a, b, 0)).toEqual(a);
    const end = interpolateView(a, b, 1);
    expect(end.k).toBeCloseTo(b.k);
    expect(end.x).toBeCloseTo(b.x);
    expect(end.y).toBeCloseTo(b.y);
  });

  it('keeps the zoom anchor still the whole way, and eases k geometrically', () => {
    for (const t of [0.25, 0.5, 0.75]) {
      const v = interpolateView(a, b, t);
      const p = under(v, 700, 120);
      expect(p.x).toBeCloseTo(700);
      expect(p.y).toBeCloseTo(120);
      expect(v.k).toBeCloseTo(4 ** t);
    }
  });

  it('slides linearly for a pure pan', () => {
    const from = { k: 2, x: -100, y: -50 };
    const to = { k: 2, x: -300, y: -150 };
    expect(interpolateView(from, to, 0.5)).toEqual({ k: 2, x: -200, y: -100 });
  });
});

describe('showDot', () => {
  it('marks a country too small to see, not one big enough to light up', () => {
    // Czechia in the 110m atlas: ~15 viewBox units wide, one visitor = full intensity
    expect(showDot(15.3, 1, 1)).toBe(false);
    expect(dotRadius(1)).toBeCloseTo(6.4);
    // Luxembourg-sized
    expect(showDot(3, 1, 1)).toBe(true);
  });

  it('fades out when zooming in grows the shape past the dot', () => {
    expect(showDot(8, 1, 1)).toBe(true);
    expect(showDot(8, 1, 2)).toBe(false);
  });
});

describe('mixPercent / haloRadius / haloOpacity', () => {
  it('rises with share, reaching 92% only for the busiest country', () => {
    expect(mixPercent(1)).toBe(92);
    expect(mixPercent(0.5)).toBeGreaterThan(mixPercent(0.2));
    expect(mixPercent(0.01)).toBeGreaterThanOrEqual(8);
  });

  it('keeps a big country with a small share dim: 7% of the traffic is well under half the amber', () => {
    expect(mixPercent(Math.sqrt(43 / 279))).toBeLessThan(40);
    expect(mixPercent(Math.sqrt(0.05))).toBeLessThan(25);
  });

  it('sizes the glow by share', () => {
    expect(haloRadius(1)).toBeGreaterThan(haloRadius(0.3) + 5);
  });

  it('glows fully on a small country, not at all on a big one, and fades with zoom', () => {
    expect(haloOpacity(15.3, 1, 1)).toBe(1); // Czechia
    expect(haloOpacity(250, 0.4, 1)).toBe(0); // the US
    const mid = haloOpacity(15.3, 1, 3);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(haloOpacity(15.3, 1, 8)).toBe(0);
  });
});

describe('fitView', () => {
  // viewBox boxes (96 and 1 unit wide are roughly Europe's and Czechia's size on the real map)
  const cz = { x0: 508, y0: 96, x1: 523, y1: 104 };
  const de = { x0: 495, y0: 82, x1: 517, y1: 106 };
  const us = { x0: 130, y0: 70, x1: 300, y1: 180 };
  const au = { x0: 790, y0: 320, x1: 900, y1: 400 };

  it('shows the whole world without data', () => {
    expect(fitView([], W, H)).toEqual(IDENTITY);
  });

  it('frames a single small country at the maximum zoom, centred on it', () => {
    const v = fitView([{ box: cz, share: 1 }], W, H);
    expect(v.k).toBe(MAX_FIT_ZOOM);
    const c = { x: (W / 2 - v.x) / v.k, y: (H / 2 - v.y) / v.k };
    expect(c.x).toBeCloseTo(515.5, 0);
    expect(c.y).toBeGreaterThan(95); // pushed down a little: the frame cannot show above the world
  });

  it('frames a big country as closely as it fits', () => {
    const v = fitView([{ box: us, share: 1 }], W, H);
    expect(v.k).toBeGreaterThan(2.5);
    expect(v.k).toBeLessThan(MAX_FIT_ZOOM);
  });

  it('skips a minor outlier but keeps the neighbours', () => {
    const near = fitView(
      [
        { box: cz, share: 0.7 },
        { box: de, share: 0.1 },
      ],
      W,
      H,
    );
    const withUs = fitView(
      [
        { box: cz, share: 0.7 },
        { box: de, share: 0.1 },
        { box: us, share: 0.08 },
        { box: au, share: 0.02 },
      ],
      W,
      H,
    );
    expect(withUs).toEqual(near);
  });

  it('zooms out for an outlier that carries a real share', () => {
    const v = fitView(
      [
        { box: cz, share: 0.5 },
        { box: us, share: 0.3 },
      ],
      W,
      H,
    );
    expect(v.k).toBeLessThan(MIN_FIT_ZOOM);
    expect(v.k).toBeGreaterThanOrEqual(1);
  });

  it('always returns a valid view', () => {
    for (const items of [
      [{ box: au, share: 1 }],
      [
        { box: us, share: 0.5 },
        { box: au, share: 0.5 },
      ],
    ]) {
      const v = fitView(items, W, H);
      expect(constrain(v, W, H)).toEqual(v);
    }
  });
});
