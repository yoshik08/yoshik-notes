import { getStroke, type StrokeOptions } from 'perfect-freehand';
import type { StrokeElement } from '@/lib/db/models';

// Variable-width ink outlines. A stroke's stored data is untouched; this only
// decides how it is drawn. Pressure maps to 0.4x-1.6x of the stored width (the
// previous renderer used 0.5x-1.5x), so old notes look like themselves.

type Pt = { x: number; y: number; pressure?: number };

/** True when the points carry real pen pressure (mouse input reports a flat 0.5). */
export function hasRealPressure(points: Pt[]): boolean {
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    if (p.pressure == null) continue;
    if (p.pressure < min) min = p.pressure;
    if (p.pressure > max) max = p.pressure;
  }
  return max - min > 0.02;
}

export function strokeOptions(el: Pick<StrokeElement, 'width' | 'isHighlighter' | 'points'>, live = false): StrokeOptions {
  if (el.isHighlighter) {
    return { size: el.width * 3, thinning: 0, smoothing: 0.5, streamline: 0.5, simulatePressure: false, last: !live, start: { cap: true }, end: { cap: true } };
  }
  const real = hasRealPressure(el.points);
  return {
    size: el.width,
    thinning: 0.6,
    smoothing: 0.55,
    streamline: live ? 0.42 : 0.5,
    simulatePressure: !real,
    easing: (t) => t,
    last: !live,
    start: { taper: real ? 0 : el.width * 2, cap: true },
    end: { taper: real ? 0 : el.width * 3, cap: true },
  };
}

/**
 * perfect-freehand smooths toward each new point, so a long segment given as two
 * points turns back before reaching its end (an "h" loses its ascender, a fast
 * mouse stroke loses its corners). Resampling long segments lets ink reach every
 * stored point. Stored data is never changed.
 */
function resample(points: Pt[], maxSeg: number): number[][] {
  const out: number[][] = [];
  if (!points.length) return out;
  out.push([points[0].x, points[0].y, points[0].pressure ?? 0.5]);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const pa = a.pressure ?? 0.5, pb = b.pressure ?? 0.5;
    const n = Math.min(64, Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / maxSeg)));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      out.push([a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, pa + (pb - pa) * t]);
    }
  }
  return out;
}

export function strokeOutline(el: Pick<StrokeElement, 'width' | 'isHighlighter' | 'points'>, live = false): number[][] {
  const maxSeg = Math.max(1.5, el.width * 0.9);
  return getStroke(resample(el.points, maxSeg), strokeOptions(el, live));
}

const average = (a: number, b: number) => (a + b) / 2;

/** perfect-freehand's recommended quadratic smoothing of an outline into an SVG path. */
export function outlineToSvgPath(points: number[][], closed = true): string {
  const len = points.length;
  if (len < 4) {
    if (len === 0) return '';
    // Tiny dot: a circle-ish polygon is fine.
    return `M${points.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join('L')}Z`;
  }
  let a = points[0];
  let b = points[1];
  const c = points[2];
  let d = `M${a[0].toFixed(2)},${a[1].toFixed(2)} Q${b[0].toFixed(2)},${b[1].toFixed(2)} ${average(b[0], c[0]).toFixed(2)},${average(b[1], c[1]).toFixed(2)} T`;
  for (let i = 2, max = len - 1; i < max; i++) {
    a = points[i];
    b = points[i + 1];
    d += `${average(a[0], b[0]).toFixed(2)},${average(a[1], b[1]).toFixed(2)} `;
  }
  if (closed) d += 'Z';
  return d;
}

const pathCache = new WeakMap<StrokeElement, Path2D>();

/** Committed strokes are immutable objects, so their outline path is computed once. */
export function strokePath(el: StrokeElement): Path2D {
  let p = pathCache.get(el);
  if (!p) {
    p = new Path2D(outlineToSvgPath(strokeOutline(el)));
    pathCache.set(el, p);
  }
  return p;
}

export function liveStrokePath(el: StrokeElement): Path2D {
  return new Path2D(outlineToSvgPath(strokeOutline(el, true)));
}
