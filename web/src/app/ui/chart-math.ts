/** Pure geometry for the hand-built SVG charts. No DOM, no Angular: easy to test. */

export interface Pt {
  x: number;
  y: number;
}

const f = (n: number) => (Math.round(n * 100) / 100).toString();

/**
 * Axis top and gridline values that cover `max`: 87 -> top 100, ticks 0/20/40/60/80/100.
 * Steps are 1, 2 or 5 times a power of ten, whole numbers only (a visitor axis never
 * reads "2.5"), picked to land closest to `targetTicks` gridlines.
 */
export function niceScale(max: number, targetTicks = 4): { top: number; ticks: number[] } {
  if (max <= 0) return { top: 1, ticks: [0, 1] };
  const decade = Math.max(1, 10 ** Math.floor(Math.log10(max / targetTicks)));
  let best = { step: 1, count: Math.ceil(max), score: Infinity };
  for (const step of [1, 2, 5, 10, 20, 50, 100].map((m) => m * decade).filter((s) => s >= 1)) {
    const count = Math.max(1, Math.ceil(max / step));
    const score = Math.abs(count - targetTicks);
    if (score < best.score || (score === best.score && step > best.step))
      best = { step, count, score };
  }
  return {
    top: best.count * best.step,
    ticks: Array.from({ length: best.count + 1 }, (_, i) => i * best.step),
  };
}

export function scaleLinear(
  domain: [number, number],
  range: [number, number],
): (v: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  return (v) => r0 + ((v - d0) / span) * (r1 - r0);
}

/** Index of the evenly spaced sample nearest to pixel `x`. */
export function nearestIndex(x: number, left: number, right: number, count: number): number {
  if (count <= 1 || right <= left) return 0;
  const ratio = (x - left) / (right - left);
  return Math.min(count - 1, Math.max(0, Math.round(ratio * (count - 1))));
}

export function linePath(points: readonly Pt[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${f(p.x)},${f(p.y)}`).join('');
}

/**
 * Smooth line through the points that never overshoots them (Fritsch-Butland
 * monotone cubic). A plain spline would dip below zero between two quiet days,
 * which reads as negative traffic.
 */
export function monotonePath(points: readonly Pt[]): string {
  const n = points.length;
  if (n === 0) return '';
  if (n < 3) return linePath(points);

  const dx: number[] = [];
  const s: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(points[i + 1].x - points[i].x);
    s.push(dx[i] === 0 ? 0 : (points[i + 1].y - points[i].y) / dx[i]);
  }
  const m: number[] = new Array<number>(n);
  m[0] = s[0];
  m[n - 1] = s[n - 2];
  for (let i = 1; i < n - 1; i++) {
    m[i] =
      s[i - 1] * s[i] <= 0
        ? 0
        : (3 * (dx[i - 1] + dx[i])) /
          ((2 * dx[i] + dx[i - 1]) / s[i - 1] + (dx[i] + 2 * dx[i - 1]) / s[i]);
  }

  let d = `M${f(points[0].x)},${f(points[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const h = dx[i] / 3;
    d += `C${f(a.x + h)},${f(a.y + m[i] * h)},${f(b.x - h)},${f(b.y - m[i + 1] * h)},${f(b.x)},${f(b.y)}`;
  }
  return d;
}

/** Closes a line path down to `baseY` so it can be filled. */
export function areaPath(line: string, points: readonly Pt[], baseY: number): string {
  if (points.length === 0) return '';
  const first = points[0];
  const last = points[points.length - 1];
  return `${line}L${f(last.x)},${f(baseY)}L${f(first.x)},${f(baseY)}Z`;
}

export interface SparkSample {
  /** Position on the x axis (time, or just the index). */
  t: number;
  y: number | null;
}

export interface SparkOptions {
  width: number;
  height: number;
  /** Keeps a peak from being clipped by half the stroke width. */
  padY?: number;
  /**
   * Smallest y-domain as a share of the value range, so a 42.00 -> 42.09 wobble
   * stays a wobble instead of becoming a mountain range. Ported from stacha.tech.
   */
  minSpan?: number;
  /** A gap wider than this (in `t` units) breaks the line instead of joining it. */
  gapAfter?: number;
}

export interface SparkGeometry {
  /** Continuous runs of 2+ points, in SVG pixels. */
  segments: Pt[][];
  /** Pixel position of every plottable sample, in input order of the plottable ones. */
  plotted: (Pt & { index: number })[];
}

export function sparkGeometry(samples: readonly SparkSample[], o: SparkOptions): SparkGeometry {
  const padY = o.padY ?? 2;
  const ys = samples.map((s) => s.y).filter((y): y is number => y !== null);
  if (ys.length < 2) return { segments: [], plotted: [] };

  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const span = Math.max(hi - lo, o.minSpan ?? 0) || 1;
  const low = lo - (span - (hi - lo)) / 2;

  const first = samples[0].t;
  const tSpan = samples[samples.length - 1].t - first || 1;
  const x = (t: number) => ((t - first) / tSpan) * o.width;
  const y = (v: number) => o.height - padY - ((v - low) / span) * (o.height - padY * 2);

  const segments: Pt[][] = [];
  const plotted: (Pt & { index: number })[] = [];
  let run: Pt[] = [];
  let prevT: number | null = null;
  samples.forEach((sample, index) => {
    if (sample.y === null) {
      if (run.length > 1) segments.push(run);
      run = [];
      prevT = null;
      return;
    }
    const p = { x: x(sample.t), y: y(sample.y) };
    plotted.push({ ...p, index });
    if (prevT !== null && o.gapAfter !== undefined && sample.t - prevT > o.gapAfter) {
      if (run.length > 1) segments.push(run);
      run = [];
    }
    run.push(p);
    prevT = sample.t;
  });
  if (run.length > 1) segments.push(run);
  return { segments, plotted };
}
