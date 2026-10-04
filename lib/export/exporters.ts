// Export helpers for yoshik-notes: PNG (raster), SVG (vector), JSON (editable document).
// All exports render in world coordinates; PNG uses an offscreen canvas at 2x.

import type { CanvasElement, NoteDoc } from '@/lib/db/models';
import { getBounds } from '@/lib/canvas/renderer';

export interface ExportOptions {
  /** Pixel scale factor. Default 2 (high-DPI). */
  scale?: number;
  /** World-space padding around the content bounding box. Default 24. */
  padding?: number;
  /** Background fill. Default '#ffffff'. */
  background?: string;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function unionBounds(elements: CanvasElement[]): Box | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let found = false;
  for (const el of elements) {
    const b = getBounds(el);
    if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) continue;
    if (b.width <= 0 && b.height <= 0) continue;
    found = true;
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  if (!found) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// Mirror of renderer.renderElements, but draws loaded images instead of
// the dashed placeholder. Images that failed to load fall back to the placeholder.
function renderForExport(
  ctx: CanvasRenderingContext2D,
  elements: CanvasElement[],
  images: Map<string, HTMLImageElement>
) {
  for (const el of elements) {
    ctx.save();
    if (el.opacity != null && el.opacity < 1) ctx.globalAlpha = el.opacity;
    if (el.rotation) {
      ctx.translate(el.x, el.y);
      ctx.rotate(el.rotation);
      ctx.translate(-el.x, -el.y);
    }

    switch (el.type) {
      case 'stroke':
        renderStrokeExport(ctx, el);
        break;
      case 'line':
        ctx.strokeStyle = el.color;
        ctx.lineWidth = el.width;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(el.x, el.y);
        ctx.lineTo(el.x2, el.y2);
        ctx.stroke();
        break;
      case 'arrow':
        renderArrowExport(ctx, el);
        break;
      case 'rectangle': {
        const x = Math.min(el.x, el.x + el.width);
        const y = Math.min(el.y, el.y + el.height);
        const w = Math.abs(el.width);
        const h = Math.abs(el.height);
        if (el.fill) {
          ctx.fillStyle = el.fill;
          ctx.fillRect(x, y, w, h);
        }
        ctx.strokeStyle = el.color;
        ctx.lineWidth = el.strokeWidth;
        ctx.strokeRect(x, y, w, h);
        break;
      }
      case 'ellipse':
        ctx.beginPath();
        ctx.ellipse(
          el.x + el.width / 2,
          el.y + el.height / 2,
          Math.abs(el.width) / 2,
          Math.abs(el.height) / 2,
          0,
          0,
          Math.PI * 2
        );
        if (el.fill) {
          ctx.fillStyle = el.fill;
          ctx.fill();
        }
        ctx.strokeStyle = el.color;
        ctx.lineWidth = el.strokeWidth;
        ctx.stroke();
        break;
      case 'text':
        renderTextExport(ctx, el);
        break;
      case 'image': {
        const img = images.get(el.id);
        if (img) {
          ctx.drawImage(img, el.x, el.y, el.width, el.height);
        } else {
          ctx.strokeStyle = '#888';
          ctx.setLineDash([4, 4]);
          ctx.strokeRect(el.x, el.y, el.width, el.height);
          ctx.setLineDash([]);
        }
        break;
      }
    }
    ctx.restore();
  }
}

function renderStrokeExport(
  ctx: CanvasRenderingContext2D,
  el: Extract<CanvasElement, { type: 'stroke' }>
) {
  if (el.points.length === 0) return;
  ctx.strokeStyle = el.color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (el.isHighlighter) {
    ctx.globalAlpha *= 0.4;
    ctx.lineWidth = el.width * 3;
    ctx.beginPath();
    ctx.moveTo(el.points[0].x, el.points[0].y);
    for (let i = 1; i < el.points.length; i++) ctx.lineTo(el.points[i].x, el.points[i].y);
    ctx.stroke();
    return;
  }

  if (el.points.some((p) => p.pressure != null)) {
    for (let i = 1; i < el.points.length; i++) {
      const p0 = el.points[i - 1];
      const p1 = el.points[i];
      ctx.lineWidth = el.width * (0.5 + (p1.pressure ?? 0.5));
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }
  } else {
    ctx.lineWidth = el.width;
    ctx.beginPath();
    ctx.moveTo(el.points[0].x, el.points[0].y);
    for (let i = 1; i < el.points.length; i++) ctx.lineTo(el.points[i].x, el.points[i].y);
    ctx.stroke();
  }
}

function renderArrowExport(
  ctx: CanvasRenderingContext2D,
  el: Extract<CanvasElement, { type: 'arrow' }>
) {
  ctx.strokeStyle = el.color;
  ctx.fillStyle = el.color;
  ctx.lineWidth = el.width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(el.x, el.y);
  ctx.lineTo(el.x2, el.y2);
  ctx.stroke();

  const angle = Math.atan2(el.y2 - el.y, el.x2 - el.x);
  const headLen = Math.max(12, el.width * 4);
  ctx.beginPath();
  ctx.moveTo(el.x2, el.y2);
  ctx.lineTo(
    el.x2 - headLen * Math.cos(angle - Math.PI / 6),
    el.y2 - headLen * Math.sin(angle - Math.PI / 6)
  );
  ctx.lineTo(
    el.x2 - headLen * Math.cos(angle + Math.PI / 6),
    el.y2 - headLen * Math.sin(angle + Math.PI / 6)
  );
  ctx.closePath();
  ctx.fill();
}

function renderTextExport(
  ctx: CanvasRenderingContext2D,
  el: Extract<CanvasElement, { type: 'text' }>
) {
  ctx.font = `${el.italic ? 'italic ' : ''}${el.bold ? 'bold ' : ''}${el.fontSize}px ${el.fontFamily || 'system-ui, sans-serif'}`;
  ctx.fillStyle = el.color;
  ctx.textBaseline = 'top';
  const lineHeight = el.fontSize * 1.3;
  if (el.width && el.width > 0) {
    const words = el.text.split(' ');
    let line = '';
    let y = el.y;
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > el.width && line) {
        ctx.fillText(line, el.x, y);
        line = word;
        y += lineHeight;
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, el.x, y);
  } else {
    el.text.split('\n').forEach((ln, i) => ctx.fillText(ln, el.x, el.y + i * lineHeight));
  }
}

/**
 * Render elements to a PNG blob on an offscreen canvas.
 * Uses the union of element bounds (with padding) as the crop region.
 */
export async function exportPNG(
  elements: CanvasElement[],
  opts: ExportOptions = {}
): Promise<Blob> {
  const scale = opts.scale ?? 2;
  const padding = opts.padding ?? 24;
  const bg = opts.background ?? '#ffffff';

  const bounds = unionBounds(elements) ?? { x: -400, y: -300, width: 800, height: 600 };

  // Load image elements first (failures fall back to placeholder)
  const images = new Map<string, HTMLImageElement>();
  const imageEls = elements.filter(
    (e): e is Extract<CanvasElement, { type: 'image' }> => e.type === 'image'
  );
  const loaded = await Promise.all(imageEls.map((el) => loadImage(el.src)));
  imageEls.forEach((el, i) => {
    const img = loaded[i];
    if (img) images.set(el.id, img);
  });

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil((bounds.width + padding * 2) * scale));
  canvas.height = Math.max(1, Math.ceil((bounds.height + padding * 2) * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);
  ctx.translate(padding - bounds.x, padding - bounds.y);

  renderForExport(ctx, elements, images);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('PNG encoding failed'));
    }, 'image/png');
  });
}

// ============ SVG ============

function n(v: number): string {
  return Number.isFinite(v) ? (Math.round(v * 100) / 100).toString() : '0';
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrap(el: CanvasElement, inner: string): string {
  const attrs: string[] = [];
  if (el.opacity != null && el.opacity < 1) attrs.push(`opacity="${n(el.opacity)}"`);
  if (el.rotation) {
    const deg = (el.rotation * 180) / Math.PI;
    attrs.push(`transform="rotate(${n(deg)} ${n(el.x)} ${n(el.y)})"`);
  }
  if (attrs.length === 0) return inner;
  return `<g ${attrs.join(' ')}>${inner}</g>`;
}

function strokePath(
  points: { x: number; y: number }[],
  color: string,
  width: number,
  opacity?: number
): string {
  if (points.length === 0) return '';
  const d =
    `M ${n(points[0].x)} ${n(points[0].y)}` +
    points.slice(1).map((p) => ` L ${n(p.x)} ${n(p.y)}`).join('');
  const extra = opacity != null && opacity < 1 ? ` opacity="${n(opacity)}"` : '';
  return `<path d="${d}" fill="none" stroke="${escapeXml(color)}" stroke-width="${n(width)}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`;
}

function elementToSVG(el: CanvasElement): string {
  switch (el.type) {
    case 'stroke': {
      if (el.points.length === 0) return '';
      if (el.isHighlighter) {
        return wrap(el, strokePath(el.points, el.color, el.width * 3, 0.4));
      }
      if (el.points.some((p) => p.pressure != null)) {
        // Pressure-varying strokes: one path per segment with its own width
        const segs: string[] = [];
        for (let i = 1; i < el.points.length; i++) {
          const w = el.width * (0.5 + (el.points[i].pressure ?? 0.5));
          segs.push(strokePath([el.points[i - 1], el.points[i]], el.color, w));
        }
        return wrap(el, segs.join(''));
      }
      return wrap(el, strokePath(el.points, el.color, el.width));
    }
    case 'line':
      return wrap(
        el,
        `<line x1="${n(el.x)}" y1="${n(el.y)}" x2="${n(el.x2)}" y2="${n(el.y2)}" stroke="${escapeXml(el.color)}" stroke-width="${n(el.width)}" stroke-linecap="round"/>`
      );
    case 'arrow': {
      const angle = Math.atan2(el.y2 - el.y, el.x2 - el.x);
      const headLen = Math.max(12, el.width * 4);
      const h1x = el.x2 - headLen * Math.cos(angle - Math.PI / 6);
      const h1y = el.y2 - headLen * Math.sin(angle - Math.PI / 6);
      const h2x = el.x2 - headLen * Math.cos(angle + Math.PI / 6);
      const h2y = el.y2 - headLen * Math.sin(angle + Math.PI / 6);
      const c = escapeXml(el.color);
      return wrap(
        el,
        `<line x1="${n(el.x)}" y1="${n(el.y)}" x2="${n(el.x2)}" y2="${n(el.y2)}" stroke="${c}" stroke-width="${n(el.width)}" stroke-linecap="round"/>` +
          `<polygon points="${n(el.x2)},${n(el.y2)} ${n(h1x)},${n(h1y)} ${n(h2x)},${n(h2y)}" fill="${c}"/>`
      );
    }
    case 'rectangle': {
      const x = Math.min(el.x, el.x + el.width);
      const y = Math.min(el.y, el.y + el.height);
      const fill = el.fill ? ` fill="${escapeXml(el.fill)}"` : ' fill="none"';
      return wrap(
        el,
        `<rect x="${n(x)}" y="${n(y)}" width="${n(Math.abs(el.width))}" height="${n(Math.abs(el.height))}"${fill} stroke="${escapeXml(el.color)}" stroke-width="${n(el.strokeWidth)}"/>`
      );
    }
    case 'ellipse': {
      const fill = el.fill ? ` fill="${escapeXml(el.fill)}"` : ' fill="none"';
      return wrap(
        el,
        `<ellipse cx="${n(el.x + el.width / 2)}" cy="${n(el.y + el.height / 2)}" rx="${n(Math.abs(el.width) / 2)}" ry="${n(Math.abs(el.height) / 2)}"${fill} stroke="${escapeXml(el.color)}" stroke-width="${n(el.strokeWidth)}"/>`
      );
    }
    case 'text': {
      const style: string[] = [`font-size:${n(el.fontSize)}px`];
      if (el.bold) style.push('font-weight:bold');
      if (el.italic) style.push('font-style:italic');
      const ff = escapeXml(el.fontFamily || 'system-ui, sans-serif');
      const lines = el.text.split('\n');
      const tspans = lines
        .map(
          (ln, i) =>
            `<tspan x="${n(el.x)}" dy="${i === 0 ? '0' : n(el.fontSize * 1.3)}">${escapeXml(ln)}</tspan>`
        )
        .join('');
      return wrap(
        el,
        `<text x="${n(el.x)}" y="${n(el.y)}" fill="${escapeXml(el.color)}" font-family="${ff}" style="${style.join(';')}">${tspans}</text>`
      );
    }
    case 'image':
      return wrap(
        el,
        `<image x="${n(el.x)}" y="${n(el.y)}" width="${n(el.width)}" height="${n(el.height)}" href="${escapeXml(el.src)}"/>`
      );
  }
}

/** Generate a valid standalone SVG document string for the given elements. */
export function exportSVG(elements: CanvasElement[]): string {
  const bounds = unionBounds(elements) ?? { x: -400, y: -300, width: 800, height: 600 };
  const pad = 24;
  const vx = bounds.x - pad;
  const vy = bounds.y - pad;
  const vw = bounds.width + pad * 2;
  const vh = bounds.height + pad * 2;
  const body = elements.map(elementToSVG).filter((s) => s.length > 0).join('\n');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(vx)} ${n(vy)} ${n(vw)} ${n(vh)}" width="${n(vw)}" height="${n(vh)}">\n` +
    `<rect x="${n(vx)}" y="${n(vy)}" width="${n(vw)}" height="${n(vh)}" fill="#ffffff"/>\n` +
    body +
    `\n</svg>`
  );
}

// ============ JSON ============

export interface ExportedNote {
  format: 'yoshik-notes';
  version: 1;
  title: string;
  elements: CanvasElement[];
  appState?: NoteDoc['appState'];
  canvasSettings?: NoteDoc['canvasSettings'];
  exportedAt: string;
}

/** Serialize the full note document (structured, editable) for re-import. */
export function exportJSON(note: {
  title: string;
  elements: CanvasElement[];
  appState?: NoteDoc['appState'];
  canvasSettings?: NoteDoc['canvasSettings'];
}): string {
  const doc: ExportedNote = {
    format: 'yoshik-notes',
    version: 1,
    title: note.title,
    elements: note.elements,
    exportedAt: new Date().toISOString(),
  };
  if (note.appState) doc.appState = note.appState;
  if (note.canvasSettings) doc.canvasSettings = note.canvasSettings;
  return JSON.stringify(doc, null, 2);
}

// ============ Downloads ============

export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(text: string, filename: string, mime: string): void {
  download(new Blob([text], { type: `${mime};charset=utf-8` }), filename);
}

/** Sanitize a note title for use as a filename. */
export function safeFilename(title: string): string {
  const base = title.trim().slice(0, 80) || 'untitled';
  return base.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'untitled';
}
