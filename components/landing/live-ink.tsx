'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { StrokeElement } from '@/lib/db/models';
import { liveStrokePath, strokePath } from '@/lib/canvas/ink';
import { PAPER_LIGHT, inkColor } from '@/lib/canvas/scene';
import { nanoid } from '@/lib/id';

// The live frame on the landing page: write right now, with real pencil
// pressure. What you write is kept on this device and offered as your first
// note after you sign in.

export const LANDING_INK_KEY = 'notes:landing-ink';

function load(): StrokeElement[] {
  try {
    const raw = localStorage.getItem(LANDING_INK_KEY);
    const v = raw ? (JSON.parse(raw) as { strokes: StrokeElement[] }) : null;
    return Array.isArray(v?.strokes) ? v!.strokes : [];
  } catch {
    return [];
  }
}

export function LiveInk({ onFirstStroke, hint }: { onFirstStroke?: () => void; hint?: Array<{ points: Array<{ x: number; y: number; pressure?: number }> }> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<StrokeElement[]>([]);
  const current = useRef<StrokeElement | null>(null);
  const [count, setCount] = useState(0);
  const raf = useRef(0);
  const hintRef = useRef(hint);

  const draw = useCallback(() => {
    raf.current = 0;
    const c = canvasRef.current;
    if (!c) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * dpr)) c.width = Math.round(w * dpr);
    if (c.height !== Math.round(h * dpr)) c.height = Math.round(h * dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    // Faint page lines, so the frame reads as paper.
    ctx.strokeStyle = 'rgba(0,0,0,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const lineGap = Math.max(22, h / 9);
    for (let y = lineGap; y < h; y += lineGap) {
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(w, Math.round(y) + 0.5);
    }
    ctx.stroke();
    // Stored in frame-relative units (0..1000 wide) so it survives resizes.
    const s = w / 1000;
    ctx.setTransform(dpr * s, 0, 0, dpr * s, 0, 0);
    const ghost = hintRef.current;
    if (ghost && !strokes.current.length && !current.current) {
      ctx.fillStyle = 'rgba(0,0,0,0.13)';
      for (const g of ghost) ctx.fill(liveStrokePath({ id: '', type: 'stroke', x: 0, y: 0, points: g.points, color: '#000', width: 6 }));
    }
    ctx.fillStyle = inkColor('#000000', PAPER_LIGHT);
    for (const st of strokes.current) ctx.fill(strokePath(st));
    if (current.current) ctx.fill(liveStrokePath(current.current));
  }, []);

  const request = useCallback(() => {
    if (!raf.current) raf.current = requestAnimationFrame(draw);
  }, [draw]);

  // The ghost hint arrives with the examples data; show it once it does.
  useEffect(() => {
    hintRef.current = hint;
    request();
  }, [hint, request]);

  useEffect(() => {
    strokes.current = load();
    setCount(strokes.current.length);
    const c = canvasRef.current!;
    const ro = new ResizeObserver(() => request());
    ro.observe(c);
    return () => ro.disconnect();
  }, [request]);

  const persist = () => {
    try {
      localStorage.setItem(LANDING_INK_KEY, JSON.stringify({ strokes: strokes.current, at: Date.now() }));
    } catch {
      /* only a convenience */
    }
  };

  const point = (e: PointerEvent | React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const s = 1000 / r.width;
    return { x: Math.round((e.clientX - r.left) * s * 10) / 10, y: Math.round((e.clientY - r.top) * s * 10) / 10, pressure: e.pointerType === 'pen' ? Math.round((e.pressure || 0.5) * 100) / 100 : 0.5 };
  };

  return (
    <div className="relative size-full">
      <canvas
        ref={canvasRef}
        aria-label="Try writing here"
        className="block size-full cursor-crosshair rounded-[3px]"
        style={{ touchAction: 'none' }}
        onPointerDown={(e) => {
          if (e.button !== 0 && e.pointerType === 'mouse') return;
          e.currentTarget.setPointerCapture(e.pointerId);
          const p = point(e);
          current.current = { id: nanoid(), type: 'stroke', x: p.x, y: p.y, points: [p], color: '#000000', width: 4.2 };
          request();
        }}
        onPointerMove={(e) => {
          const st = current.current;
          if (!st) return;
          const events = typeof e.nativeEvent.getCoalescedEvents === 'function' ? e.nativeEvent.getCoalescedEvents() : [e.nativeEvent];
          for (const ev of events.length ? events : [e.nativeEvent]) st.points.push(point(ev));
          request();
        }}
        onPointerUp={() => {
          const st = current.current;
          current.current = null;
          if (!st) return;
          strokes.current = [...strokes.current, st];
          if (strokes.current.length === 1) onFirstStroke?.();
          setCount(strokes.current.length);
          persist();
          request();
        }}
        onPointerCancel={() => {
          current.current = null;
          request();
        }}
      />
      {count > 0 ? (
        <button
          type="button"
          onClick={() => {
            strokes.current = [];
            setCount(0);
            persist();
            request();
          }}
          className="pressable absolute right-3 top-3 rounded-full bg-black/[0.06] px-3 py-1.5 text-[12.5px] font-medium text-black/70 hover:bg-black/10"
        >
          Clear
        </button>
      ) : null}
    </div>
  );
}

/** Strokes written on the landing page, converted to note elements in world units. */
export function takeLandingInk(): StrokeElement[] {
  const strokes = load();
  return strokes.map((s) => ({ ...s, id: nanoid(), width: 3 }));
}

export function clearLandingInk() {
  try {
    localStorage.removeItem(LANDING_INK_KEY);
  } catch {
    /* ignore */
  }
}
