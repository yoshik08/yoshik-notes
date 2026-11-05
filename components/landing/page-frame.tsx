'use client';

import { useEffect, useRef } from 'react';
import type { CanvasElement, StrokeElement } from '@/lib/db/models';
import { liveStrokePath } from '@/lib/canvas/ink';
import { ImageCache, drawElement, drawPaper, unionBounds, type Paper } from '@/lib/canvas/scene';
import { prefersReducedMotion } from '@/lib/transition';

/**
 * A note drawn by the app's own renderer, fitted into its frame. With `replay`,
 * the ink writes itself in, stroke by stroke, like a time-lapse of the page.
 */
export function PageFrame({ elements, paper, replay, label }: { elements: CanvasElement[]; paper: Paper; replay?: { delay: number; duration: number }; label: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const delay = replay?.delay;
  const duration = replay?.duration;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const animated = delay !== undefined && duration !== undefined && !prefersReducedMotion();
    let progress = animated ? 0 : 1;

    const draw = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
      if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
      const ctx = canvas.getContext('2d')!;
      const b = unionBounds(elements) ?? { x: 0, y: 0, width: 480, height: 320 };
      const pad = Math.min(w, h) * 0.07;
      const zoom = Math.min((w - pad * 2) / b.width, (h - pad * 2) / b.height);
      const cam = { x: b.x + b.width / 2, y: b.y + b.height / 2, zoom };
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawPaper(ctx, cam, w, h, paper);
      ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * (w / 2 - cam.x * zoom), dpr * (h / 2 - cam.y * zoom));
      const opts = { paper, images };
      const shown = progress * elements.length;
      const whole = Math.floor(shown);
      for (let i = 0; i < Math.min(whole, elements.length); i++) drawElement(ctx, elements[i], opts);
      const partial = elements[whole];
      if (partial && shown > whole) {
        const frac = shown - whole;
        if (partial.type === 'stroke') {
          const s = { ...partial, points: partial.points.slice(0, Math.max(1, Math.ceil(partial.points.length * frac))) } as StrokeElement;
          drawElement(ctx, s, opts, liveStrokePath(s));
        } else if (frac > 0.5) drawElement(ctx, partial, opts);
      }
    };
    const images = new ImageCache(draw);
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    draw();

    let alive = true;
    let cancel = () => {};
    if (animated) {
      void import('animejs').then(({ animate }) => {
        if (!alive) return;
        const state = { p: 0 };
        const anim = animate(state, {
          p: 1,
          delay,
          duration,
          ease: 'inOutSine',
          onUpdate: () => {
            progress = state.p;
            draw();
          },
        });
        cancel = () => anim.cancel();
      });
    }
    return () => {
      alive = false;
      cancel();
      ro.disconnect();
    };
  }, [elements, paper, delay, duration]);

  return <canvas ref={canvasRef} role="img" aria-label={label} className="block size-full" />;
}
