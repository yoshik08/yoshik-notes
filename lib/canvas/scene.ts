import type { CanvasElement, StrokeElement } from '@/lib/db/models';
import { strokePath } from './ink';
import type { Camera } from './camera';

// Drawing a page: paper, pattern, and elements. Shared by the live canvas,
// thumbnails, and PNG export, so what you see is what you export.

export interface Paper {
  background: '#ffffff' | '#000000';
  pattern: 'none' | 'dots' | 'grid' | 'ruled';
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const PAPER_LIGHT = '#ffffff';
export const PAPER_DARK = '#000000';

/**
 * Black and white ink adapt to the paper (black writes white on dark paper,
 * and the reverse), like ink in a dark-mode notebook. Stored colours never change.
 */
export function inkColor(color: string, paper: Paper['background']): string {
  const c = color.trim().toLowerCase();
  const isBlack = c === '#000' || c === '#000000' || c === 'black';
  const isWhite = c === '#fff' || c === '#ffffff' || c === 'white';
  if (paper === PAPER_DARK && isBlack) return '#f5f5f2';
  if (paper === PAPER_LIGHT && isWhite) return '#161616';
  return color;
}

// ------------------------------------------------------------------ images

type ImageEntry = { img: HTMLImageElement; ok: boolean; failed: boolean };

/** Decodes image sources once; calls onLoad so the canvas can redraw. */
export class ImageCache {
  private map = new Map<string, ImageEntry>();
  constructor(private onLoad: () => void = () => {}) {}
  get(src: string): HTMLImageElement | null {
    let entry = this.map.get(src);
    if (!entry) {
      const img = new Image();
      img.decoding = 'async';
      if (/^https?:/i.test(src)) img.crossOrigin = 'anonymous';
      entry = { img, ok: false, failed: false };
      this.map.set(src, entry);
      const e = entry;
      img.onload = () => {
        e.ok = true;
        this.onLoad();
      };
      img.onerror = () => {
        e.failed = true;
        this.onLoad();
      };
      img.src = src;
    }
    return entry.ok ? entry.img : null;
  }
  failed(src: string) {
    return this.map.get(src)?.failed ?? false;
  }
  /** Resolves once every listed source has loaded or failed (for export). */
  async ready(srcs: string[]) {
    await Promise.all(
      srcs.map(
        (s) =>
          new Promise<void>((resolve) => {
            this.get(s);
            const e = this.map.get(s)!;
            if (e.ok || e.failed) return resolve();
            e.img.addEventListener('load', () => resolve(), { once: true });
            e.img.addEventListener('error', () => resolve(), { once: true });
          }),
      ),
    );
  }
}

// ------------------------------------------------------------------ text

let textFamily = 'system-ui, -apple-system, sans-serif';
/** Typed text uses the interface face (Geist); resolved once from CSS. */
export function setTextFamily(family: string) {
  if (family) textFamily = family;
}

function fontFor(el: Extract<CanvasElement, { type: 'text' }>) {
  return `${el.italic ? 'italic ' : ''}${el.bold ? '600 ' : '400 '}${el.fontSize}px ${el.fontFamily || textFamily}`;
}

let measureCtx: CanvasRenderingContext2D | null = null;
function measure(): CanvasRenderingContext2D | null {
  if (!measureCtx && typeof document !== 'undefined') measureCtx = document.createElement('canvas').getContext('2d');
  return measureCtx;
}

/** Lines of a text element after explicit newlines and optional wrapping. */
export function textLines(el: Extract<CanvasElement, { type: 'text' }>): string[] {
  const raw = el.text.split('\n');
  if (!el.width || el.width <= 0) return raw;
  const ctx = measure();
  if (!ctx) return raw;
  ctx.font = fontFor(el);
  const out: string[] = [];
  for (const para of raw) {
    let line = '';
    for (const word of para.split(' ')) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > el.width && line) {
        out.push(line);
        line = word;
      } else line = test;
    }
    out.push(line);
  }
  return out;
}

// ------------------------------------------------------------------ bounds and hits

const boundsCache = new WeakMap<CanvasElement, Rect>();

export function elementBounds(el: CanvasElement): Rect {
  const cached = boundsCache.get(el);
  if (cached) return cached;
  let r: Rect;
  switch (el.type) {
    case 'stroke': {
      if (!el.points.length) {
        r = { x: el.x, y: el.y, width: 0, height: 0 };
        break;
      }
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of el.points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      const pad = (el.isHighlighter ? el.width * 3 : el.width * 1.6) / 2 + 1;
      r = { x: minX - pad, y: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 };
      break;
    }
    case 'line':
    case 'arrow': {
      const pad = el.width / 2 + (el.type === 'arrow' ? Math.max(12, el.width * 4) : 2);
      r = { x: Math.min(el.x, el.x2) - pad, y: Math.min(el.y, el.y2) - pad, width: Math.abs(el.x2 - el.x) + pad * 2, height: Math.abs(el.y2 - el.y) + pad * 2 };
      break;
    }
    case 'rectangle':
    case 'ellipse':
    case 'image': {
      const sw = el.type === 'image' ? 0 : el.strokeWidth / 2;
      r = { x: Math.min(el.x, el.x + el.width) - sw, y: Math.min(el.y, el.y + el.height) - sw, width: Math.abs(el.width) + sw * 2, height: Math.abs(el.height) + sw * 2 };
      break;
    }
    case 'text': {
      const lines = textLines(el);
      const ctx = measure();
      let w = el.width ?? 0;
      if (!w && ctx) {
        ctx.font = fontFor(el);
        for (const l of lines) w = Math.max(w, ctx.measureText(l).width);
      }
      if (!w) w = el.fontSize * el.text.length * 0.6;
      r = { x: el.x, y: el.y, width: Math.max(w, el.fontSize * 0.5), height: Math.max(1, lines.length) * el.fontSize * 1.3 };
      break;
    }
  }
  boundsCache.set(el, r);
  return r;
}

export function unionBounds(elements: CanvasElement[]): Rect | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const el of elements) {
    const b = elementBounds(el);
    if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) continue;
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  return minX === Infinity ? null : { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export const intersects = (a: Rect, b: Rect) => a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay;
  const len = dx * dx + dy * dy;
  let t = len ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Does a circle of radius r at (x, y) touch the element's ink? */
export function hitTest(el: CanvasElement, x: number, y: number, r = 6): boolean {
  const b = elementBounds(el);
  if (x < b.x - r || x > b.x + b.width + r || y < b.y - r || y > b.y + b.height + r) return false;
  switch (el.type) {
    case 'stroke': {
      const reach = r + (el.isHighlighter ? el.width * 1.5 : el.width * 0.8);
      const pts = el.points;
      if (pts.length === 1) return Math.hypot(x - pts[0].x, y - pts[0].y) <= reach;
      for (let i = 1; i < pts.length; i++) if (distToSegment(x, y, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y) <= reach) return true;
      return false;
    }
    case 'line':
    case 'arrow':
      return distToSegment(x, y, el.x, el.y, el.x2, el.y2) <= r + el.width / 2 + 2;
    case 'rectangle': {
      if (el.fill) return true;
      const x0 = Math.min(el.x, el.x + el.width), y0 = Math.min(el.y, el.y + el.height);
      const x1 = x0 + Math.abs(el.width), y1 = y0 + Math.abs(el.height);
      const edge = r + el.strokeWidth / 2 + 2;
      const inside = x > x0 + edge && x < x1 - edge && y > y0 + edge && y < y1 - edge;
      return !inside;
    }
    case 'ellipse': {
      const rx = Math.abs(el.width) / 2, ry = Math.abs(el.height) / 2;
      if (rx < 1 || ry < 1) return true;
      const cx = el.x + el.width / 2, cy = el.y + el.height / 2;
      const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
      if (el.fill) return d <= 1.05;
      const tol = (r + el.strokeWidth / 2 + 2) / Math.min(rx, ry);
      return Math.abs(d - 1) <= tol;
    }
    default:
      return true; // text and images: anywhere in their box
  }
}

// ------------------------------------------------------------------ drawing

export interface DrawOptions {
  paper: Paper;
  images: ImageCache;
  /** Visible world rect; elements outside it are skipped. */
  viewport?: Rect;
  /** Elements to draw faded (being erased). */
  fading?: Set<string>;
  /** Elements to skip (being dragged, drawn separately). */
  hidden?: Set<string>;
}

/** Paper colour and pattern, drawn in screen space so lines stay crisp at any zoom. */
export function drawPaper(ctx: CanvasRenderingContext2D, cam: Camera, w: number, h: number, paper: Paper) {
  ctx.fillStyle = paper.background === PAPER_DARK ? PAPER_DARK : PAPER_LIGHT;
  ctx.fillRect(0, 0, w, h);
  if (paper.pattern === 'none') return;
  const dark = paper.background === PAPER_DARK;
  let spacing = 32;
  while (spacing * cam.zoom < 14) spacing *= 2; // keep the pattern legible when zoomed out
  const left = cam.x - w / 2 / cam.zoom, top = cam.y - h / 2 / cam.zoom;
  const sx = (wx: number) => (wx - cam.x) * cam.zoom + w / 2;
  const sy = (wy: number) => (wy - cam.y) * cam.zoom + h / 2;
  const x0 = Math.floor(left / spacing) * spacing, y0 = Math.floor(top / spacing) * spacing;
  const x1 = left + w / cam.zoom, y1 = top + h / cam.zoom;
  ctx.save();
  if (paper.pattern === 'dots') {
    ctx.fillStyle = dark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.2)';
    const rad = Math.max(0.8, Math.min(1.6, 1.2 * cam.zoom));
    for (let x = x0; x <= x1; x += spacing) for (let y = y0; y <= y1; y += spacing) ctx.fillRect(sx(x) - rad / 2, sy(y) - rad / 2, rad, rad);
  } else {
    ctx.strokeStyle = dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.09)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (paper.pattern === 'grid') {
      for (let x = x0; x <= x1; x += spacing) {
        const X = Math.round(sx(x)) + 0.5;
        ctx.moveTo(X, 0);
        ctx.lineTo(X, h);
      }
    }
    for (let y = y0; y <= y1; y += spacing) {
      const Y = Math.round(sy(y)) + 0.5;
      ctx.moveTo(0, Y);
      ctx.lineTo(w, Y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawArrowHead(ctx: CanvasRenderingContext2D, el: Extract<CanvasElement, { type: 'arrow' }>) {
  const angle = Math.atan2(el.y2 - el.y, el.x2 - el.x);
  const len = Math.max(12, el.width * 4);
  ctx.beginPath();
  ctx.moveTo(el.x2, el.y2);
  ctx.lineTo(el.x2 - len * Math.cos(angle - Math.PI / 6), el.y2 - len * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(el.x2 - len * Math.cos(angle + Math.PI / 6), el.y2 - len * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
}

export function drawElement(ctx: CanvasRenderingContext2D, el: CanvasElement, opts: DrawOptions, livePath?: Path2D) {
  const bg = opts.paper.background;
  ctx.save();
  if (el.opacity != null && el.opacity < 1) ctx.globalAlpha *= el.opacity;
  if (opts.fading?.has(el.id)) ctx.globalAlpha *= 0.18;
  if (el.rotation) {
    ctx.translate(el.x, el.y);
    ctx.rotate(el.rotation);
    ctx.translate(-el.x, -el.y);
  }
  switch (el.type) {
    case 'stroke': {
      if (!el.points.length) break;
      ctx.fillStyle = inkColor(el.color, bg);
      if (el.isHighlighter) ctx.globalAlpha *= bg === PAPER_DARK ? 0.42 : 0.36;
      ctx.fill(livePath ?? strokePath(el as StrokeElement));
      break;
    }
    case 'line':
    case 'arrow': {
      const color = inkColor(el.color, bg);
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = el.width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(el.x, el.y);
      ctx.lineTo(el.x2, el.y2);
      ctx.stroke();
      if (el.type === 'arrow') drawArrowHead(ctx, el);
      break;
    }
    case 'rectangle': {
      const x = Math.min(el.x, el.x + el.width), y = Math.min(el.y, el.y + el.height);
      const w = Math.abs(el.width), h = Math.abs(el.height);
      if (el.fill) {
        ctx.fillStyle = inkColor(el.fill, bg);
        ctx.fillRect(x, y, w, h);
      }
      ctx.strokeStyle = inkColor(el.color, bg);
      ctx.lineWidth = el.strokeWidth;
      ctx.lineJoin = 'round';
      ctx.strokeRect(x, y, w, h);
      break;
    }
    case 'ellipse': {
      ctx.beginPath();
      ctx.ellipse(el.x + el.width / 2, el.y + el.height / 2, Math.abs(el.width) / 2, Math.abs(el.height) / 2, 0, 0, Math.PI * 2);
      if (el.fill) {
        ctx.fillStyle = inkColor(el.fill, bg);
        ctx.fill();
      }
      ctx.strokeStyle = inkColor(el.color, bg);
      ctx.lineWidth = el.strokeWidth;
      ctx.stroke();
      break;
    }
    case 'text': {
      ctx.font = fontFor(el);
      ctx.fillStyle = inkColor(el.color, bg);
      ctx.textBaseline = 'top';
      textLines(el).forEach((line, i) => ctx.fillText(line, el.x, el.y + i * el.fontSize * 1.3));
      break;
    }
    case 'image': {
      const img = opts.images.get(el.src);
      if (img) {
        ctx.drawImage(img, el.x, el.y, el.width, el.height);
      } else {
        // Loading (or unavailable): a quiet frame where the image will be.
        ctx.fillStyle = bg === PAPER_DARK ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)';
        ctx.fillRect(el.x, el.y, el.width, el.height);
        if (opts.images.failed(el.src)) {
          ctx.strokeStyle = bg === PAPER_DARK ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.25)';
          ctx.setLineDash([6, 6]);
          ctx.strokeRect(el.x, el.y, el.width, el.height);
        }
      }
      break;
    }
  }
  ctx.restore();
}

/** All elements in z-order; the context must already carry the world transform. */
export function drawElements(ctx: CanvasRenderingContext2D, elements: CanvasElement[], opts: DrawOptions) {
  for (const el of elements) {
    if (opts.hidden?.has(el.id)) continue;
    if (opts.viewport && !intersects(elementBounds(el), opts.viewport)) continue;
    drawElement(ctx, el, opts);
  }
}

/** Render a whole page to a new canvas (thumbnails and PNG export). */
export async function renderPage(
  elements: CanvasElement[],
  paper: Paper,
  size: { width: number; height: number } | { scale: number; padding: number },
): Promise<HTMLCanvasElement> {
  const images = new ImageCache();
  await images.ready(elements.filter((e): e is Extract<CanvasElement, { type: 'image' }> => e.type === 'image').map((e) => e.src));
  const content = unionBounds(elements);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  let cam: Camera;
  if ('width' in size) {
    canvas.width = size.width;
    canvas.height = size.height;
    const pad = Math.min(size.width, size.height) * 0.08;
    if (content) {
      const zoom = Math.min((size.width - pad * 2) / Math.max(content.width, 1), (size.height - pad * 2) / Math.max(content.height, 1), 1.6);
      cam = { x: content.x + content.width / 2, y: content.y + content.height / 2, zoom };
    } else cam = { x: 0, y: 0, zoom: 1 };
  } else {
    const box = content ?? { x: -400, y: -300, width: 800, height: 600 };
    canvas.width = Math.max(1, Math.ceil((box.width + size.padding * 2) * size.scale));
    canvas.height = Math.max(1, Math.ceil((box.height + size.padding * 2) * size.scale));
    cam = { x: box.x + box.width / 2, y: box.y + box.height / 2, zoom: size.scale };
  }
  drawPaper(ctx, cam, canvas.width, canvas.height, paper);
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-cam.x, -cam.y);
  drawElements(ctx, elements, { paper, images });
  return canvas;
}

/** Library previews are 3:2, like a frame of 35mm film. */
export const THUMB = { width: 480, height: 320 } as const;

/**
 * The camera that shows a page exactly as its thumbnail framed it, scaled to a
 * viewport (the thumbnail is shown object-fit: contain there). Used so the
 * enlarger transition dissolves into the page without a jump.
 */
export function thumbnailCamera(elements: CanvasElement[], viewW: number, viewH: number): Camera | null {
  const content = unionBounds(elements);
  if (!content || !viewW || !viewH) return null;
  const pad = Math.min(THUMB.width, THUMB.height) * 0.08;
  const zoom = Math.min((THUMB.width - pad * 2) / Math.max(content.width, 1), (THUMB.height - pad * 2) / Math.max(content.height, 1), 1.6);
  const s = Math.min(viewW / THUMB.width, viewH / THUMB.height);
  return { x: content.x + content.width / 2, y: content.y + content.height / 2, zoom: Math.min(8, Math.max(0.1, zoom * s)) };
}

/** The server keeps previews up to 96 KB; as a data URL that is about 128,000 characters. */
const THUMB_MAX_CHARS = 125_000;

/** A small preview image for the library (3:2, like a frame of film). Null if it can't be made small enough. */
export async function renderThumbnail(elements: CanvasElement[], paper: Paper): Promise<string | null> {
  try {
    const canvas = await renderPage(elements, paper, THUMB);
    const webp = canvas.toDataURL('image/webp', 0.82);
    if (webp.startsWith('data:image/webp') && webp.length < THUMB_MAX_CHARS) return webp;
    for (const quality of [0.82, 0.6, 0.4]) {
      const jpeg = canvas.toDataURL('image/jpeg', quality);
      if (jpeg.length < THUMB_MAX_CHARS) return jpeg;
    }
    return null;
  } catch {
    return null;
  }
}
