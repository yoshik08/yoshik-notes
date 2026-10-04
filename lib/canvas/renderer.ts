import type { CanvasElement } from '@/lib/db/models';

// Render all elements to a canvas context.
// ctx must already be transformed: translate(center) scale(zoom) translate(-viewX, -viewY)
// All coordinates in world space.

export function renderElements(
  ctx: CanvasRenderingContext2D,
  elements: CanvasElement[],
  opts: { selectedIds?: Set<string>; forExport?: boolean } = {}
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
        renderStroke(ctx, el);
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
        renderArrow(ctx, el);
        break;
      case 'rectangle':
        if (el.fill) {
          ctx.fillStyle = el.fill;
          ctx.fillRect(el.x, el.y, el.width, el.height);
        }
        ctx.strokeStyle = el.color;
        ctx.lineWidth = el.strokeWidth;
        ctx.strokeRect(el.x, el.y, el.width, el.height);
        break;
      case 'ellipse':
        ctx.beginPath();
        ctx.ellipse(
          el.x + el.width / 2, el.y + el.height / 2,
          Math.abs(el.width) / 2, Math.abs(el.height) / 2,
          0, 0, Math.PI * 2
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
        renderText(ctx, el);
        break;
      case 'image':
        // Images rendered separately (async loading) — placeholder here
        ctx.strokeStyle = '#888';
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(el.x, el.y, el.width, el.height);
        ctx.setLineDash([]);
        break;
    }

    // Selection outline
    if (opts.selectedIds?.has(el.id)) {
      ctx.strokeStyle = '#E9A13B';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      const b = getBounds(el);
      ctx.strokeRect(b.x - 6, b.y - 6, b.width + 12, b.height + 12);
      ctx.setLineDash([]);
    }

    ctx.restore();
  }
}

function renderStroke(
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
    for (let i = 1; i < el.points.length; i++) {
      ctx.lineTo(el.points[i].x, el.points[i].y);
    }
    ctx.stroke();
    return;
  }

  // Pressure-sensitive width
  if (el.points.some((p) => p.pressure != null)) {
    for (let i = 1; i < el.points.length; i++) {
      const p0 = el.points[i - 1];
      const p1 = el.points[i];
      const w = el.width * (0.5 + (p1.pressure ?? 0.5));
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }
  } else {
    ctx.lineWidth = el.width;
    ctx.beginPath();
    ctx.moveTo(el.points[0].x, el.points[0].y);
    for (let i = 1; i < el.points.length; i++) {
      ctx.lineTo(el.points[i].x, el.points[i].y);
    }
    ctx.stroke();
  }
}

function renderArrow(
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

  // Arrowhead
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

function renderText(
  ctx: CanvasRenderingContext2D,
  el: Extract<CanvasElement, { type: 'text' }>
) {
  const font = `${el.italic ? 'italic ' : ''}${el.bold ? 'bold ' : ''}${el.fontSize}px ${el.fontFamily || 'system-ui, sans-serif'}`;
  ctx.font = font;
  ctx.fillStyle = el.color;
  ctx.textBaseline = 'top';

  if (el.width && el.width > 0) {
    // Word wrap
    const words = el.text.split(' ');
    let line = '';
    let y = el.y;
    const lineHeight = el.fontSize * 1.3;
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
    // Multi-line without wrapping
    const lines = el.text.split('\n');
    const lineHeight = el.fontSize * 1.3;
    lines.forEach((ln, i) => ctx.fillText(ln, el.x, el.y + i * lineHeight));
  }
}

export function getBounds(el: CanvasElement): { x: number; y: number; width: number; height: number } {
  switch (el.type) {
    case 'stroke': {
      if (el.points.length === 0) return { x: el.x, y: el.y, width: 0, height: 0 };
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of el.points) {
        minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
      }
      const pad = el.width / 2 + 2;
      return { x: minX - pad, y: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 };
    }
    case 'line':
    case 'arrow': {
      const pad = el.width / 2 + 2;
      return {
        x: Math.min(el.x, el.x2) - pad, y: Math.min(el.y, el.y2) - pad,
        width: Math.abs(el.x2 - el.x) + pad * 2, height: Math.abs(el.y2 - el.y) + pad * 2,
      };
    }
    case 'rectangle':
    case 'ellipse':
    case 'image':
      return { x: el.x, y: el.y, width: el.width, height: el.height };
    case 'text':
      // Approximate — measured at render time ideally
      return { x: el.x, y: el.y, width: el.width ?? el.fontSize * el.text.length * 0.6, height: el.fontSize * 1.3 };
  }
}

export function hitTest(el: CanvasElement, wx: number, wy: number): boolean {
  const b = getBounds(el);
  // Quick bbox reject
  if (wx < b.x || wx > b.x + b.width || wy < b.y || wy > b.y + b.height) return false;
  // For strokes, do distance-to-segment check
  if (el.type === 'stroke' && el.points.length > 1) {
    const threshold = Math.max(8, el.width);
    for (let i = 1; i < el.points.length; i++) {
      if (distToSegment(wx, wy, el.points[i - 1], el.points[i]) < threshold) return true;
    }
    return false;
  }
  return true;
}

function distToSegment(
  px: number, py: number,
  a: { x: number; y: number }, b: { x: number; y: number }
): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - a.x, py - a.y);
  let t = ((px - a.x) * dx + (py - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}
