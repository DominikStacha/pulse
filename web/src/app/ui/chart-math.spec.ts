import {
  areaPath,
  linePath,
  monotonePath,
  nearestIndex,
  niceScale,
  scaleLinear,
  sparkGeometry,
} from './chart-math';

describe('niceScale', () => {
  it('covers the max with round whole-number gridlines', () => {
    expect(niceScale(87)).toEqual({ top: 100, ticks: [0, 20, 40, 60, 80, 100] });
    expect(niceScale(1234).top).toBe(1500);
  });

  it('never produces fractional steps for small counts', () => {
    expect(niceScale(3).ticks).toEqual([0, 1, 2, 3]);
  });

  it('survives an all-zero series', () => {
    const { top, ticks } = niceScale(0);
    expect(top).toBeGreaterThan(0);
    expect(ticks[0]).toBe(0);
  });
});

describe('scaleLinear / nearestIndex', () => {
  it('maps a domain onto a range, including an inverted one', () => {
    const y = scaleLinear([0, 100], [200, 0]);
    expect(y(0)).toBe(200);
    expect(y(100)).toBe(0);
    expect(y(25)).toBe(150);
  });

  it('does not divide by zero on a flat domain', () => {
    expect(Number.isFinite(scaleLinear([5, 5], [0, 10])(5))).toBe(true);
  });

  it('snaps the pointer to the closest sample and clamps at the edges', () => {
    expect(nearestIndex(50, 0, 100, 5)).toBe(2);
    expect(nearestIndex(-30, 0, 100, 5)).toBe(0);
    expect(nearestIndex(900, 0, 100, 5)).toBe(4);
    expect(nearestIndex(10, 0, 100, 1)).toBe(0);
  });
});

describe('paths', () => {
  const pts = [
    { x: 0, y: 100 },
    { x: 10, y: 20 },
    { x: 20, y: 100 },
    { x: 30, y: 100 },
  ];

  it('draws a plain polyline', () => {
    expect(linePath(pts.slice(0, 2))).toBe('M0,100L10,20');
  });

  it('closes an area down to the baseline', () => {
    expect(areaPath(linePath(pts), pts, 120)).toBe('M0,100L10,20L20,100L30,100L30,120L0,120Z');
    expect(areaPath('', [], 120)).toBe('');
  });

  it('keeps the smooth curve inside the data range (no dip below a flat run)', () => {
    const d = monotonePath(pts);
    expect(d.startsWith('M0,100')).toBe(true);
    const ys = (d.match(/-?\d+(\.\d+)?,-?\d+(\.\d+)?/g) ?? []).map((pair) => +pair.split(',')[1]);
    expect(Math.max(...ys)).toBeLessThanOrEqual(100.01);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(19.99);
  });

  it('falls back to straight lines for fewer than three points', () => {
    expect(monotonePath(pts.slice(0, 2))).toBe(linePath(pts.slice(0, 2)));
    expect(monotonePath([])).toBe('');
  });
});

describe('sparkGeometry', () => {
  const opts = { width: 100, height: 20, padY: 2 };

  it('needs two plottable samples to draw anything', () => {
    expect(sparkGeometry([{ t: 0, y: 1 }], opts).segments).toEqual([]);
    expect(
      sparkGeometry(
        [
          { t: 0, y: null },
          { t: 1, y: 3 },
        ],
        opts,
      ).segments,
    ).toEqual([]);
  });

  it('spans the full width and puts the peak at the top padding', () => {
    const { segments } = sparkGeometry(
      [
        { t: 0, y: 0 },
        { t: 1, y: 5 },
        { t: 2, y: 10 },
      ],
      opts,
    );
    expect(segments).toHaveLength(1);
    expect(segments[0][0].x).toBe(0);
    expect(segments[0][2].x).toBe(100);
    expect(segments[0][2].y).toBe(2);
    expect(segments[0][0].y).toBe(18);
  });

  it('breaks the line at a missing reading instead of interpolating', () => {
    const { segments } = sparkGeometry(
      [
        { t: 0, y: 1 },
        { t: 1, y: 2 },
        { t: 2, y: null },
        { t: 3, y: 2 },
        { t: 4, y: 1 },
      ],
      opts,
    );
    expect(segments).toHaveLength(2);
  });

  it('breaks the line when the collector was down for longer than the gap', () => {
    const { segments } = sparkGeometry(
      [
        { t: 0, y: 1 },
        { t: 60, y: 2 },
        { t: 1000, y: 2 },
        { t: 1060, y: 1 },
      ],
      { ...opts, gapAfter: 180 },
    );
    expect(segments).toHaveLength(2);
  });

  it('keeps a tiny wobble looking tiny when a minimum span is set', () => {
    const { segments } = sparkGeometry(
      [
        { t: 0, y: 0.42 },
        { t: 1, y: 0.4209 },
      ],
      { ...opts, minSpan: 0.15 },
    );
    const [a, b] = segments[0];
    expect(Math.abs(a.y - b.y)).toBeLessThan(2);
  });

  it('draws a flat series as a centred line', () => {
    const { segments } = sparkGeometry(
      [
        { t: 0, y: 7 },
        { t: 1, y: 7 },
      ],
      opts,
    );
    expect(segments[0][0].y).toBe(10);
  });
});
