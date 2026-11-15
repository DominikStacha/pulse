/**
 * Pure zoom/pan math for the world map. A View is the transform applied to the
 * map group: screen = (x, y) + k * point, all in viewBox units.
 */
export interface View {
  k: number;
  x: number;
  y: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;
/** One click on + / - or one double-click. */
export const ZOOM_STEP = 2;
export const IDENTITY: View = { k: 1, x: 0, y: 0 };

export const sameView = (a: View, b: View): boolean => a.k === b.k && a.x === b.x && a.y === b.y;

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * Zoom limits, and the world never leaves the frame: no gap at any edge, and the
 * centre of the frame stays on the globe (an ellipse), so the corners of the
 * rectangle around the oval map can never fill the whole view with nothing.
 */
export function constrain(v: View, w: number, h: number): View {
  const k = clamp(v.k, MIN_ZOOM, MAX_ZOOM);
  let x = clamp(v.x, w * (1 - k), 0);
  let y = clamp(v.y, h * (1 - k), 0);
  // View centre as an offset from the map centre; scale it back onto the ellipse if it is outside.
  const cx = (w / 2 - x) / k - w / 2;
  const cy = (h / 2 - y) / k - h / 2;
  const e = Math.hypot(cx / (w / 2), cy / (h / 2));
  if (e > 1) {
    x += k * (cx - cx / e);
    y += k * (cy - cy / e);
  }
  return { k, x, y };
}

/** Scale by `factor` keeping the viewBox point (px, py) still on screen. */
export function zoomAt(
  v: View,
  factor: number,
  px: number,
  py: number,
  w: number,
  h: number,
): View {
  const k = clamp(v.k * factor, MIN_ZOOM, MAX_ZOOM);
  const r = k / v.k;
  return constrain({ k, x: px - (px - v.x) * r, y: py - (py - v.y) * r }, w, h);
}

/** Where the fingers are: their centre and, with two of them, how far apart (0 for one). */
export interface Touchpoint {
  cx: number;
  cy: number;
  d: number;
}

/**
 * One gesture step from `prev` to `next`: the content that was under the old
 * centre follows the new one (pan), and the spread ratio scales it (pinch).
 */
export function gesture(v: View, prev: Touchpoint, next: Touchpoint, w: number, h: number): View {
  const f = prev.d > 0 && next.d > 0 ? next.d / prev.d : 1;
  const k = clamp(v.k * f, MIN_ZOOM, MAX_ZOOM);
  const r = k / v.k;
  return constrain({ k, x: next.cx - (prev.cx - v.x) * r, y: next.cy - (prev.cy - v.y) * r }, w, h);
}

/**
 * Zoom factor of one wheel event. Same curve as d3-zoom (a trackpad pinch
 * arrives as small ctrl+wheel deltas), but capped at 2x per event so a
 * ctrl+mouse-wheel notch cannot jump four levels at once.
 */
export function wheelFactor(e: { deltaY: number; deltaMode: number; ctrlKey: boolean }): number {
  const unit = e.deltaMode === 1 ? 0.05 : e.deltaMode ? 1 : 0.002; // lines, pages, pixels
  return 2 ** clamp(-e.deltaY * unit * (e.ctrlKey ? 10 : 1), -1, 1);
}

/**
 * In-between view for an animated zoom: k eases geometrically and the point that
 * stays put between `a` and `b` stays put all the way, so a zoom around the cursor
 * does not slide. Both ends are valid views, so every step is too.
 */
export function interpolateView(a: View, b: View, t: number): View {
  const k = a.k * (b.k / a.k) ** t;
  if (Math.abs(b.k - a.k) < 1e-9) {
    return { k, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }
  const s = k / a.k;
  const pivot = (a0: number, b0: number) => a0 + (a.k * (b0 - a0)) / (a.k - b.k);
  const px = pivot(a.x, b.x);
  const py = pivot(a.y, b.y);
  return { k, x: px - (px - a.x) * s, y: py - (py - a.y) * s };
}

export const dotRadius = (t: number): number => 2.2 + t * 4.2;

/**
 * A light dot is only an extra for a country too small to see: it shows when it
 * would cover the whole shape anyway (`size` is the shape's extent in viewBox units
 * at 1x). Zoom in and the shape grows past the dot, which then fades out.
 */
export function showDot(size: number, t: number, k: number): boolean {
  return size * k <= 2 * dotRadius(t);
}

/** How much amber a country with intensity `t` (sqrt of its share of the busiest country, 0-1) gets, in percent. */
export const mixPercent = (t: number): number => Math.round(8 + 84 * t ** 1.4);

/**
 * A soft glow around a lit country, sized by its share, so that a small country with
 * many visitors still reads next to a huge one with few. It fades out as the shape
 * itself grows past it (more zoom, or a big country to begin with).
 */
export const haloRadius = (t: number): number => 6 + 16 * t;

export function haloOpacity(size: number, t: number, k: number): number {
  const r = haloRadius(t);
  return clamp(1 - (size * k - r) / (3 * r), 0, 1);
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** "Fit to data" never zooms further than this, and gives up minor outliers that would need less than MIN. */
export const MAX_FIT_ZOOM = 4;
export const MIN_FIT_ZOOM = 2;
/** A country with at least this share of the visitors is framed even if it means zooming out. */
const MUST_FRAME = 0.15;

export interface Framed {
  box: Box;
  /** Share of all visitors, 0-1. */
  share: number;
}

/** Zoom that frames a box with air around it (30% of its size, at least 30 units, per side). */
function zoomFor(b: Box, w: number, h: number): number {
  const bw = b.x1 - b.x0;
  const bh = b.y1 - b.y0;
  return Math.min(w / (bw + 2 * Math.max(30, 0.3 * bw)), h / (bh + 2 * Math.max(30, 0.3 * bh)));
}

/**
 * The view that frames the countries with visitors. `items` come busiest first: the busiest
 * is always framed; each next one is too if the frame can stay at 2x or closer, or if it carries
 * a real share of the traffic. A few visits from the other side of the world do not push the map
 * out to the whole globe; an audience that really is spread out does.
 */
export function fitView(items: readonly Framed[], w: number, h: number): View {
  if (!items.length) return IDENTITY;
  let u = items[0].box;
  for (const { box: b, share } of items.slice(1)) {
    const n = {
      x0: Math.min(u.x0, b.x0),
      y0: Math.min(u.y0, b.y0),
      x1: Math.max(u.x1, b.x1),
      y1: Math.max(u.y1, b.y1),
    };
    if (zoomFor(n, w, h) >= MIN_FIT_ZOOM || share >= MUST_FRAME) u = n;
  }
  const k = clamp(zoomFor(u, w, h), MIN_ZOOM, MAX_FIT_ZOOM);
  const cx = (u.x0 + u.x1) / 2;
  const cy = (u.y0 + u.y1) / 2;
  return constrain({ k, x: w / 2 - k * cx, y: h / 2 - k * cy }, w, h);
}
