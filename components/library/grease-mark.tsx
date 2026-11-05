'use client';

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { outlineToSvgPath, strokeOutline } from '@/lib/canvas/ink';

// The signature mark: a red grease-pencil loop drawn around a picked frame,
// the way a photographer circles keepers on a contact sheet.

function seeded(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/** A point at distance s along a rounded rectangle's perimeter, starting at the middle of the left edge, going up. */
function perimeterPoint(s: number, x: number, y: number, w: number, h: number, r: number) {
  const straightH = h - 2 * r, straightW = w - 2 * r, arc = (Math.PI * r) / 2;
  const segs: Array<[number, (t: number) => [number, number]]> = [
    [straightH / 2, (t) => [x, y + h / 2 - t]],
    [arc, (t) => { const a = Math.PI + (t / r); return [x + r + Math.cos(a) * r, y + r + Math.sin(a) * r]; }],
    [straightW, (t) => [x + r + t, y]],
    [arc, (t) => { const a = -Math.PI / 2 + (t / r); return [x + w - r + Math.cos(a) * r, y + r + Math.sin(a) * r]; }],
    [straightH, (t) => [x + w, y + r + t]],
    [arc, (t) => { const a = t / r; return [x + w - r + Math.cos(a) * r, y + h - r + Math.sin(a) * r]; }],
    [straightW, (t) => [x + w - r - t, y + h]],
    [arc, (t) => { const a = Math.PI / 2 + (t / r); return [x + r + Math.cos(a) * r, y + h - r + Math.sin(a) * r]; }],
    [straightH / 2, (t) => [x, y + h - r - t]],
  ];
  for (const [len, at] of segs) {
    if (s <= len) return at(s);
    s -= len;
  }
  return [x, y + h / 2] as [number, number];
}

/** The loop's centreline around a w×h box (local pixels), loose like a real marker loop. */
export function loopPoints(w: number, h: number, seed: string, gap: number) {
  const rnd = seeded(seed);
  const phase1 = rnd() * Math.PI * 2, phase2 = rnd() * Math.PI * 2;
  const r = Math.min(w, h) * 0.2 + gap;
  const X = -gap, Y = -gap, W = w + gap * 2, H = h + gap * 2;
  const perimeter = 2 * (W - 2 * r) + 2 * (H - 2 * r) + 2 * Math.PI * r;
  const overshoot = 0.1 + rnd() * 0.05;
  const steps = 96;
  const pts: { x: number; y: number; pressure: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const s = (t * (1 + overshoot) * perimeter) % perimeter;
    const [px, py] = perimeterPoint(s, X, Y, W, H, r);
    // Low-frequency wobble out from the frame, tightening as the loop closes.
    const wobble = Math.sin(t * Math.PI * 2 * 1.5 + phase1) * gap * 0.22 + Math.sin(t * Math.PI * 2 * 3.2 + phase2) * gap * 0.1 - t * gap * 0.35;
    const cx = w / 2, cy = h / 2;
    const dx = px - cx, dy = py - cy;
    const len = Math.hypot(dx, dy) || 1;
    pts.push({ x: px + (dx / len) * wobble, y: py + (dy / len) * wobble, pressure: 0.35 + 0.4 * Math.sin(Math.PI * Math.min(1, t * 1.1)) });
  }
  return pts;
}

export function GreaseMark({ show, seed, gap = 9, width = 3.4 }: { show: boolean; seed: string; gap?: number; width?: number }) {
  const ref = useRef<SVGSVGElement>(null);
  const maskPath = useRef<SVGPathElement>(null);
  const maskId = useId();
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const animated = useRef(false);

  useLayoutEffect(() => {
    const host = ref.current?.parentElement;
    if (!host) return;
    const measure = () => setSize({ w: host.clientWidth, h: host.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  const shape = useMemo(() => {
    if (!size || !size.w) return null;
    const pts = loopPoints(size.w, size.h, seed, gap);
    return {
      outline: outlineToSvgPath(strokeOutline({ width, isHighlighter: false, points: pts })),
      center: pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' '),
    };
  }, [size, seed, gap, width]);
  const hasShape = !!shape;

  // Draw the mark in the first time it appears; later resizes just redraw it whole.
  useEffect(() => {
    if (!show) {
      animated.current = false;
      return;
    }
    const el = maskPath.current;
    if (!el || !hasShape || animated.current) return;
    animated.current = true;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let cancel = () => {};
    let alive = true;
    void import('animejs').then(({ animate, svg }) => {
      if (!alive) return;
      const [drawable] = svg.createDrawable(el);
      const anim = animate(drawable, { draw: ['0 0', '0 1'], duration: 360, ease: 'outCubic' });
      cancel = () => anim.cancel();
    });
    return () => {
      alive = false;
      cancel();
    };
  }, [show, hasShape]);

  const pad = gap * 2 + 8;
  return (
    <svg
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none absolute left-0 top-0 overflow-visible"
      width={size?.w ?? 0}
      height={size?.h ?? 0}
      viewBox={size ? `0 0 ${size.w} ${size.h}` : undefined}
      style={{ opacity: show ? 1 : 0, transition: 'opacity 140ms ease' }}
    >
      {show && shape ? (
        <>
          <defs>
            <mask id={maskId} maskUnits="userSpaceOnUse" x={-pad} y={-pad} width={(size?.w ?? 0) + pad * 2} height={(size?.h ?? 0) + pad * 2}>
              <path ref={maskPath} d={shape.center} fill="none" stroke="#fff" strokeWidth={width * 4} strokeLinecap="round" strokeLinejoin="round" />
            </mask>
          </defs>
          <path d={shape.outline} fill="var(--grease)" mask={`url(#${maskId})`} />
        </>
      ) : null}
    </svg>
  );
}
