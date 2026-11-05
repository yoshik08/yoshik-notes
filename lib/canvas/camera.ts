// The view onto the infinite page: which world point sits at the screen
// centre, and the zoom. Programmatic moves use critically damped springs (they
// start from the live value and can be interrupted by any gesture); flicks
// carry momentum with Apple's scroll deceleration.

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;

export function screenToWorld(c: Camera, sx: number, sy: number, w: number, h: number) {
  return { x: (sx - w / 2) / c.zoom + c.x, y: (sy - h / 2) / c.zoom + c.y };
}

export function worldToScreen(c: Camera, wx: number, wy: number, w: number, h: number) {
  return { x: (wx - c.x) * c.zoom + w / 2, y: (wy - c.y) * c.zoom + h / 2 };
}

/** Zoom by `factor` keeping the screen point (sx, sy) fixed. */
export function zoomAround(c: Camera, sx: number, sy: number, factor: number, w: number, h: number, clamp = true): Camera {
  let zoom = c.zoom * factor;
  if (clamp) zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
  const before = screenToWorld(c, sx, sy, w, h);
  const next = { ...c, zoom };
  const after = screenToWorld(next, sx, sy, w, h);
  return { x: c.x + before.x - after.x, y: c.y + before.y - after.y, zoom };
}

/** Rubber-band a zoom past its limits: the further past, the less it follows. */
export function rubberZoom(zoom: number) {
  if (zoom > MAX_ZOOM) return MAX_ZOOM * (1 + Math.log(zoom / MAX_ZOOM) * 0.18);
  if (zoom < MIN_ZOOM) return MIN_ZOOM / (1 + Math.log(MIN_ZOOM / zoom) * 0.18);
  return zoom;
}

export function fitCamera(bounds: { x: number; y: number; width: number; height: number } | null, w: number, h: number, padding = 64): Camera {
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return { x: 0, y: 0, zoom: 1 };
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min((w - padding * 2) / bounds.width, (h - padding * 2) / bounds.height, 2)));
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, zoom };
}

interface Spring {
  value: number;
  velocity: number;
  target: number;
}

/**
 * Animates the camera with three independent critically damped springs
 * (x, y, log-zoom). Response is in seconds; there is no fixed duration.
 */
export class CameraMotion {
  private springs: { x: Spring; y: Spring; z: Spring } | null = null;
  private momentum: { vx: number; vy: number } | null = null;
  private omega = (2 * Math.PI) / 0.38;

  get active() {
    return this.springs !== null || this.momentum !== null;
  }

  stop() {
    this.springs = null;
    this.momentum = null;
  }

  animateTo(from: Camera, to: Camera, response = 0.38) {
    this.momentum = null;
    this.omega = (2 * Math.PI) / response;
    const prev = this.springs;
    this.springs = {
      x: { value: from.x, velocity: prev?.x.velocity ?? 0, target: to.x },
      y: { value: from.y, velocity: prev?.y.velocity ?? 0, target: to.y },
      z: { value: Math.log(from.zoom), velocity: prev?.z.velocity ?? 0, target: Math.log(to.zoom) },
    };
  }

  /** Screen-space velocity in px/ms at release. */
  fling(vx: number, vy: number) {
    this.springs = null;
    if (Math.hypot(vx, vy) > 0.05) this.momentum = { vx, vy };
  }

  /** Advance by dt ms; returns the new camera, or null when settled. */
  step(c: Camera, dtMs: number): Camera | null {
    const dt = Math.min(dtMs, 64);
    if (this.momentum) {
      const decay = Math.pow(0.998, dt);
      const { vx, vy } = this.momentum;
      const next = { ...c, x: c.x - (vx * dt) / c.zoom, y: c.y - (vy * dt) / c.zoom };
      this.momentum = { vx: vx * decay, vy: vy * decay };
      if (Math.hypot(this.momentum.vx, this.momentum.vy) < 0.01) this.momentum = null;
      return next;
    }
    if (!this.springs) return null;
    const s = this.springs;
    const w = this.omega;
    // Semi-implicit Euler in small sub-steps for stability.
    const steps = Math.ceil(dt / 4);
    const h = dt / 1000 / steps;
    for (let i = 0; i < steps; i++) {
      for (const k of ['x', 'y', 'z'] as const) {
        const sp = s[k];
        const accel = -2 * w * sp.velocity - w * w * (sp.value - sp.target);
        sp.velocity += accel * h;
        sp.value += sp.velocity * h;
      }
    }
    const settled = (['x', 'y', 'z'] as const).every((k) => {
      const sp = s[k];
      const tol = k === 'z' ? 0.0005 : 0.05;
      return Math.abs(sp.value - sp.target) < tol && Math.abs(sp.velocity) < tol * 4;
    });
    if (settled) {
      this.springs = null;
      return { x: s.x.target, y: s.y.target, zoom: Math.exp(s.z.target) };
    }
    return { x: s.x.value, y: s.y.value, zoom: Math.exp(s.z.value) };
  }
}
