'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { CanvasElement, StrokeElement } from '@/lib/db/models';
import { useCanvasView } from '@/lib/canvas/use-canvas-view';
import { renderElements, getBounds, hitTest } from '@/lib/canvas/renderer';
import { nanoid } from '@/lib/id';

export type Tool = 'pen' | 'highlighter' | 'eraser' | 'select' | 'hand' | 'line' | 'arrow' | 'rectangle' | 'ellipse' | 'text' | 'image';

interface CanvasProps {
  elements: CanvasElement[];
  onElementsChange: (els: CanvasElement[]) => void;
  tool: Tool;
  penColor: string;
  penWidth: number;
  background: '#ffffff' | '#000000' | 'grid' | 'dots' | 'ruled';
  onDirty: () => void;
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
}

export function InfiniteCanvas({
  elements, onElementsChange, tool, penColor, penWidth, background, onDirty,
  selectedIds, onSelectionChange,
}: CanvasProps) {
  const { canvasRef, worldToScreen, screenToWorld, setView, getView, zoomAt, panBy } = useCanvasView();
  const [pencilMode, setPencilMode] = useState(false);
  const [showPencilToast, setShowPencilToast] = useState(false);
  const elementsRef = useRef(elements);
  elementsRef.current = elements;

  // Transient drawing state (not in React state for performance)
  const drawState = useRef<{
    drawing: boolean;
    currentStroke: StrokeElement | null;
    panning: boolean;
    lastX: number;
    lastY: number;
    activePointers: Map<number, { x: number; y: number; type: string }>;
    pinchDist: number | null;
    // Shape tools
    shapeStart: { x: number; y: number } | null;
    shapePreview: CanvasElement | null;
    // Selection
    selectStart: { x: number; y: number } | null;
    marquee: { x: number; y: number; w: number; h: number } | null;
    movingIds: string[] | null;
    moveStart: { x: number; y: number } | null;
    moved: boolean;
  }>({
    drawing: false,
    currentStroke: null,
    panning: false,
    lastX: 0,
    lastY: 0,
    activePointers: new Map(),
    pinchDist: null,
    shapeStart: null,
    shapePreview: null,
    selectStart: null,
    marquee: null,
    movingIds: null,
    moveStart: null,
    moved: false,
  });

  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;

  // Render loop
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
    }

    const view = getView();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Background
    const bg = background === '#000000' ? '#000000' : '#ffffff';
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, rect.width, rect.height);

    // Grid/dots/ruled
    if (background === 'grid' || background === 'dots' || background === 'ruled') {
      drawBackgroundPattern(ctx, rect, view, background);
    }

    // World transform
    ctx.translate(rect.width / 2, rect.height / 2);
    ctx.scale(view.zoom, view.zoom);
    ctx.translate(-view.x, -view.y);

    renderElements(ctx, elementsRef.current, { selectedIds: selectedIdsRef.current });

    // Current in-progress stroke
    const cur = drawState.current.currentStroke;
    if (cur) renderElements(ctx, [cur]);

    // Shape preview
    if (drawState.current.shapePreview) renderElements(ctx, [drawState.current.shapePreview]);

    // Marquee selection
    if (drawState.current.marquee) {
      const m = drawState.current.marquee;
      const tl = worldToScreen(m.x, m.y);
      const br = worldToScreen(m.x + m.w, m.y + m.h);
      ctx.strokeStyle = '#E9A13B';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.fillStyle = 'rgba(233,161,59,0.08)';
      const rx = Math.min(tl.x, br.x), ry = Math.min(tl.y, br.y);
      const rw = Math.abs(br.x - tl.x), rh = Math.abs(br.y - tl.y);
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.setLineDash([]);
    }
  }, [background, getView, worldToScreen]);

  useEffect(() => {
    let raf: number;
    const loop = () => {
      render();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [render]);

  // Re-render when elements change (the loop handles it, but this ensures immediate)
  useEffect(() => { render(); }, [elements, render]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);

    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    const st = drawState.current;
    st.activePointers.set(e.pointerId, { x: sx, y: sy, type: e.pointerType });

    // Pen detection → pencil mode
    if (e.pointerType === 'pen' && !pencilMode) {
      setPencilMode(true);
      setShowPencilToast(true);
      setTimeout(() => setShowPencilToast(false), 3000);
    }

    // Two-finger gesture → pan/zoom
    if (st.activePointers.size === 2) {
      const pts = [...st.activePointers.values()];
      st.pinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      st.drawing = false;
      st.currentStroke = null;
      return;
    }

    // In pencil mode: pen draws, finger pans
    const isPen = e.pointerType === 'pen';
    const isFinger = e.pointerType === 'touch';

    if (pencilMode && isFinger) {
      st.panning = true;
      st.lastX = sx; st.lastY = sy;
      return;
    }

    if (tool === 'hand' || (pencilMode && isFinger)) {
      st.panning = true;
      st.lastX = sx; st.lastY = sy;
      return;
    }

    if (tool === 'pen' || tool === 'highlighter') {
      if (pencilMode && !isPen && e.pointerType === 'mouse') {
        // Mouse still draws in pencil mode
      } else if (pencilMode && !isPen) {
        return; // finger pans in pencil mode
      }
      const w = screenToWorld(sx, sy);
      const pressure = (e as unknown as { pressure?: number }).pressure ?? 0.5;
      st.drawing = true;
      st.currentStroke = {
        id: nanoid(),
        type: 'stroke',
        x: w.x, y: w.y,
        points: [{ x: w.x, y: w.y, pressure }],
        color: penColor,
        width: penWidth,
        isHighlighter: tool === 'highlighter',
      };
      return;
    }

    if (tool === 'eraser') {
      // Object eraser: delete on pointerdown hit
      const w = screenToWorld(sx, sy);
      const els = elementsRef.current;
      // Find topmost hit (reverse order)
      for (let i = els.length - 1; i >= 0; i--) {
        if (hitTest(els[i], w.x, w.y)) {
          onElementsChange(els.filter((el) => el.id !== els[i].id));
          onDirty();
          break;
        }
      }
      return;
    }

    // ---- Select tool ----
    if (tool === 'select') {
      const w = screenToWorld(sx, sy);
      const els = elementsRef.current;
      // Check if clicking on already-selected element → start move
      let hitId: string | null = null;
      for (let i = els.length - 1; i >= 0; i--) {
        if (hitTest(els[i], w.x, w.y)) { hitId = els[i].id; break; }
      }
      if (hitId && selectedIdsRef.current.has(hitId)) {
        st.movingIds = [...selectedIdsRef.current];
        st.moveStart = w;
        st.moved = false;
      } else if (hitId) {
        onSelectionChange(new Set([hitId]));
        st.movingIds = [hitId];
        st.moveStart = w;
        st.moved = false;
      } else {
        // Start marquee
        onSelectionChange(new Set());
        st.selectStart = w;
        st.marquee = { x: w.x, y: w.y, w: 0, h: 0 };
      }
      return;
    }

    // ---- Shape tools (line, arrow, rectangle, ellipse) ----
    if (tool === 'line' || tool === 'arrow' || tool === 'rectangle' || tool === 'ellipse') {
      const w = screenToWorld(sx, sy);
      st.shapeStart = w;
      st.shapePreview = makeShape(tool, w, w, penColor, penWidth);
      st.drawing = true;
      return;
    }

    // ---- Text tool ----
    if (tool === 'text') {
      const w = screenToWorld(sx, sy);
      const text = prompt('Enter text:');
      if (text) {
        const el: CanvasElement = {
          id: nanoid(), type: 'text', x: w.x, y: w.y,
          text, fontSize: 24, color: penColor,
        };
        onElementsChange([...elementsRef.current, el]);
        onDirty();
      }
      return;
    }

    // ---- Image tool ----
    if (tool === 'image') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return;
        if (file.size > 2_000_000) { alert('Image must be under 2MB'); return; }
        const reader = new FileReader();
        reader.onload = () => {
          const img = new Image();
          img.onload = () => {
            const w = screenToWorld(sx, sy);
            const maxDim = 400;
            const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
            const el: CanvasElement = {
              id: nanoid(), type: 'image', x: w.x, y: w.y,
              width: img.width * scale, height: img.height * scale,
              src: reader.result as string,
            };
            onElementsChange([...elementsRef.current, el]);
            onDirty();
          };
          img.src = reader.result as string;
        };
        reader.readAsDataURL(file);
      };
      input.click();
      return;
    }
  }, [tool, penColor, penWidth, pencilMode, screenToWorld, onElementsChange, onDirty, onSelectionChange]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    const st = drawState.current;
    const prev = st.activePointers.get(e.pointerId);
    if (prev) st.activePointers.set(e.pointerId, { x: sx, y: sy, type: e.pointerType });

    // Two-finger pan/zoom
    if (st.activePointers.size === 2 && st.pinchDist != null) {
      const pts = [...st.activePointers.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const cx = (pts[0].x + pts[1].x) / 2;
      const cy = (pts[0].y + pts[1].y) / 2;
      if (prev) {
        const pcx = (prev.x + (pts[0].x === prev.x ? pts[1].x : pts[0].x)) / 2;
        const pcy = (prev.y + (pts[0].y === prev.y ? pts[1].y : pts[0].y)) / 2;
        panBy(sx - prev.x, sy - prev.y); // approximate pan
      }
      if (dist > 0 && st.pinchDist > 0) {
        zoomAt(cx, cy, dist / st.pinchDist);
      }
      st.pinchDist = dist;
      return;
    }

    if (st.panning) {
      panBy(sx - st.lastX, sy - st.lastY);
      st.lastX = sx; st.lastY = sy;
      return;
    }

    // Shape preview update
    if (st.drawing && st.shapeStart && (tool === 'line' || tool === 'arrow' || tool === 'rectangle' || tool === 'ellipse')) {
      const w = screenToWorld(sx, sy);
      st.shapePreview = makeShape(tool, st.shapeStart, w, penColor, penWidth);
      return;
    }

    // Marquee update
    if (st.selectStart && st.marquee) {
      const w = screenToWorld(sx, sy);
      st.marquee = {
        x: Math.min(st.selectStart.x, w.x),
        y: Math.min(st.selectStart.y, w.y),
        w: Math.abs(w.x - st.selectStart.x),
        h: Math.abs(w.y - st.selectStart.y),
      };
      return;
    }

    // Moving selected elements
    if (st.movingIds && st.moveStart) {
      const w = screenToWorld(sx, sy);
      const dx = w.x - st.moveStart.x;
      const dy = w.y - st.moveStart.y;
      if (Math.abs(dx) + Math.abs(dy) > 1) {
        st.moved = true;
        const idSet = new Set(st.movingIds);
        onElementsChange(elementsRef.current.map((el) =>
          idSet.has(el.id) ? { ...el, x: el.x + dx, y: el.y + dy,
            ...(el.type === 'line' || el.type === 'arrow' ? { x2: (el as { x2: number }).x2 + dx, y2: (el as { y2: number }).y2 + dy } : {}),
            ...(el.type === 'stroke' ? { points: (el as StrokeElement).points.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })) } : {}),
          } : el
        ));
        st.moveStart = w;
      }
      return;
    }

    if (st.drawing && st.currentStroke) {
      const w = screenToWorld(sx, sy);
      const pressure = (e as unknown as { pressure?: number }).pressure ?? 0.5;
      // Coalesced events for smoother strokes
      const native = e.nativeEvent as PointerEvent;
      const events = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [native];
      for (const ev of events) {
        const ex = ev.clientX - rect.left;
        const ey = ev.clientY - rect.top;
        const ww = screenToWorld(ex, ey);
        st.currentStroke.points.push({
          x: ww.x, y: ww.y,
          pressure: (ev as unknown as { pressure?: number }).pressure ?? pressure,
        });
      }
      // Also add the main event if coalesced didn't include it
      if (events.length === 0) {
        st.currentStroke.points.push({ x: w.x, y: w.y, pressure });
      }
    }
  }, [screenToWorld, panBy, zoomAt]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    const st = drawState.current;
    st.activePointers.delete(e.pointerId);
    if (st.activePointers.size < 2) st.pinchDist = null;
    st.panning = false;

    // Commit shape
    if (st.drawing && st.shapeStart && st.shapePreview) {
      const preview = st.shapePreview;
      st.drawing = false;
      st.shapeStart = null;
      st.shapePreview = null;
      // Only commit if it has meaningful size
      const b = getBounds(preview);
      if (b.width > 4 || b.height > 4) {
        onElementsChange([...elementsRef.current, { ...preview, id: nanoid() }]);
        onDirty();
      }
      return;
    }

    // Finalize marquee selection
    if (st.selectStart && st.marquee) {
      const m = st.marquee;
      const ids = new Set<string>();
      for (const el of elementsRef.current) {
        const b = getBounds(el);
        const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
        if (cx >= m.x && cx <= m.x + m.w && cy >= m.y && cy <= m.y + m.h) {
          ids.add(el.id);
        }
      }
      onSelectionChange(ids);
      st.selectStart = null;
      st.marquee = null;
      return;
    }

    // End move
    if (st.movingIds) {
      if (st.moved) onDirty();
      st.movingIds = null;
      st.moveStart = null;
      st.moved = false;
      return;
    }

    if (st.drawing && st.currentStroke) {
      const stroke = st.currentStroke;
      st.drawing = false;
      st.currentStroke = null;
      // Only commit if it has meaningful points
      if (stroke.points.length > 1) {
        onElementsChange([...elementsRef.current, stroke]);
        onDirty();
      }
    }
  }, [onElementsChange, onDirty]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    if (e.ctrlKey || e.metaKey) {
      // Pinch zoom (trackpad)
      zoomAt(sx, sy, Math.exp(-e.deltaY * 0.01));
    } else {
      // Pan
      panBy(-e.deltaX, -e.deltaY);
    }
  }, [zoomAt, panBy]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      <canvas
        ref={canvasRef}
        className="h-full w-full"
        style={{ touchAction: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
      />
      {showPencilToast && (
        <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-white px-4 py-2 text-sm font-medium text-black shadow-lg">
          Apple Pencil detected — pencil draws · fingers pan
        </div>
      )}
      {pencilMode && (
        <div className="pointer-events-none absolute bottom-4 left-4 rounded-full bg-white/10 px-3 py-1 text-xs text-white/70">
          ✏️ Pencil mode
        </div>
      )}
    </div>
  );
}

function makeShape(
  tool: 'line' | 'arrow' | 'rectangle' | 'ellipse',
  start: { x: number; y: number },
  end: { x: number; y: number },
  color: string,
  width: number
): CanvasElement {
  const id = nanoid();
  switch (tool) {
    case 'line':
      return { id, type: 'line', x: start.x, y: start.y, x2: end.x, y2: end.y, color, width };
    case 'arrow':
      return { id, type: 'arrow', x: start.x, y: start.y, x2: end.x, y2: end.y, color, width };
    case 'rectangle':
      return {
        id, type: 'rectangle',
        x: Math.min(start.x, end.x), y: Math.min(start.y, end.y),
        width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y),
        color, strokeWidth: width,
      };
    case 'ellipse':
      return {
        id, type: 'ellipse',
        x: Math.min(start.x, end.x), y: Math.min(start.y, end.y),
        width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y),
        color, strokeWidth: width,
      };
  }
}

function drawBackgroundPattern(
  ctx: CanvasRenderingContext2D,
  rect: { width: number; height: number },
  view: { x: number; y: number; zoom: number },
  pattern: 'grid' | 'dots' | 'ruled'
) {
  const spacing = 32; // world units
  // Visible world bounds
  const left = view.x - rect.width / 2 / view.zoom;
  const right = view.x + rect.width / 2 / view.zoom;
  const top = view.y - rect.height / 2 / view.zoom;
  const bottom = view.y + rect.height / 2 / view.zoom;

  ctx.save();
  ctx.strokeStyle = 'rgba(0,0,0,0.08)';
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.lineWidth = 1 / view.zoom;

  if (pattern === 'grid') {
    ctx.beginPath();
    for (let x = Math.floor(left / spacing) * spacing; x <= right; x += spacing) {
      const sx = (x - view.x) * view.zoom + rect.width / 2;
      ctx.moveTo(sx, 0); ctx.lineTo(sx, rect.height);
    }
    for (let y = Math.floor(top / spacing) * spacing; y <= bottom; y += spacing) {
      const sy = (y - view.y) * view.zoom + rect.height / 2;
      ctx.moveTo(0, sy); ctx.lineTo(rect.width, sy);
    }
    ctx.stroke();
  } else if (pattern === 'dots') {
    for (let x = Math.floor(left / spacing) * spacing; x <= right; x += spacing) {
      for (let y = Math.floor(top / spacing) * spacing; y <= bottom; y += spacing) {
        const sx = (x - view.x) * view.zoom + rect.width / 2;
        const sy = (y - view.y) * view.zoom + rect.height / 2;
        ctx.beginPath();
        ctx.arc(sx, sy, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (pattern === 'ruled') {
    ctx.beginPath();
    for (let y = Math.floor(top / spacing) * spacing; y <= bottom; y += spacing) {
      const sy = (y - view.y) * view.zoom + rect.height / 2;
      ctx.moveTo(0, sy); ctx.lineTo(rect.width, sy);
    }
    ctx.stroke();
  }
  ctx.restore();
}
