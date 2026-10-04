import { useRef, useCallback } from 'react';
import type { CanvasElement } from '@/lib/db/models';

export interface ViewState {
  x: number; // world x at screen center
  y: number; // world y at screen center
  zoom: number;
}

export function useCanvasView(initial: ViewState = { x: 0, y: 0, zoom: 1 }) {
  const view = useRef<ViewState>({ ...initial });
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const getCanvas = useCallback(() => canvasRef.current, []);

  // World → Screen
  const worldToScreen = useCallback((wx: number, wy: number): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const { x, y, zoom } = view.current;
    return {
      x: (wx - x) * zoom + rect.width / 2,
      y: (wy - y) * zoom + rect.height / 2,
    };
  }, []);

  // Screen → World
  const screenToWorld = useCallback((sx: number, sy: number): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const { x, y, zoom } = view.current;
    return {
      x: (sx - rect.width / 2) / zoom + x,
      y: (sy - rect.height / 2) / zoom + y,
    };
  }, []);

  const setView = useCallback((v: Partial<ViewState>) => {
    Object.assign(view.current, v);
  }, []);

  const getView = useCallback(() => ({ ...view.current }), []);

  // Zoom at a screen point (keeps that point stable)
  const zoomAt = useCallback((sx: number, sy: number, factor: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const before = screenToWorld(sx, sy);
    const newZoom = Math.min(10, Math.max(0.1, view.current.zoom * factor));
    view.current.zoom = newZoom;
    const after = screenToWorld(sx, sy);
    view.current.x += before.x - after.x;
    view.current.y += before.y - after.y;
  }, [screenToWorld]);

  // Pan by screen pixels
  const panBy = useCallback((dx: number, dy: number) => {
    view.current.x -= dx / view.current.zoom;
    view.current.y -= dy / view.current.zoom;
  }, []);

  return { canvasRef, view, getCanvas, worldToScreen, screenToWorld, setView, getView, zoomAt, panBy };
}
