// Export a note as PNG (what you see), SVG (vector ink), or JSON (re-importable).

import type { CanvasElement, NoteDoc } from '@/lib/db/models';
import { outlineToSvgPath, strokeOutline } from '@/lib/canvas/ink';
import { inkColor, renderPage, textLines, unionBounds, type Paper } from '@/lib/canvas/scene';

export async function exportPNG(elements: CanvasElement[], paper: Paper): Promise<Blob> {
  const canvas = await renderPage(elements, paper, { scale: 2, padding: 32 });
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'));
}

const n = (v: number) => (Number.isFinite(v) ? (Math.round(v * 100) / 100).toString() : '0');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function elementToSVG(el: CanvasElement, paper: Paper): string {
  const bg = paper.background;
  const tr = el.rotation ? ` transform="rotate(${n((el.rotation * 180) / Math.PI)} ${n(el.x)} ${n(el.y)})"` : '';
  const op = el.opacity != null && el.opacity < 1 ? ` opacity="${n(el.opacity)}"` : '';
  switch (el.type) {
    case 'stroke': {
      if (!el.points.length) return '';
      const d = outlineToSvgPath(strokeOutline(el));
      const alpha = el.isHighlighter ? ` fill-opacity="${bg === '#000000' ? 0.42 : 0.36}"` : '';
      return `<path d="${d}" fill="${esc(inkColor(el.color, bg))}"${alpha}${op}${tr}/>`;
    }
    case 'line':
    case 'arrow': {
      const c = esc(inkColor(el.color, bg));
      let s = `<line x1="${n(el.x)}" y1="${n(el.y)}" x2="${n(el.x2)}" y2="${n(el.y2)}" stroke="${c}" stroke-width="${n(el.width)}" stroke-linecap="round"/>`;
      if (el.type === 'arrow') {
        const a = Math.atan2(el.y2 - el.y, el.x2 - el.x);
        const len = Math.max(12, el.width * 4);
        s += `<polygon points="${n(el.x2)},${n(el.y2)} ${n(el.x2 - len * Math.cos(a - Math.PI / 6))},${n(el.y2 - len * Math.sin(a - Math.PI / 6))} ${n(el.x2 - len * Math.cos(a + Math.PI / 6))},${n(el.y2 - len * Math.sin(a + Math.PI / 6))}" fill="${c}"/>`;
      }
      return `<g${op}${tr}>${s}</g>`;
    }
    case 'rectangle': {
      const fill = el.fill ? esc(inkColor(el.fill, bg)) : 'none';
      return `<rect x="${n(Math.min(el.x, el.x + el.width))}" y="${n(Math.min(el.y, el.y + el.height))}" width="${n(Math.abs(el.width))}" height="${n(Math.abs(el.height))}" fill="${fill}" stroke="${esc(inkColor(el.color, bg))}" stroke-width="${n(el.strokeWidth)}" stroke-linejoin="round"${op}${tr}/>`;
    }
    case 'ellipse': {
      const fill = el.fill ? esc(inkColor(el.fill, bg)) : 'none';
      return `<ellipse cx="${n(el.x + el.width / 2)}" cy="${n(el.y + el.height / 2)}" rx="${n(Math.abs(el.width) / 2)}" ry="${n(Math.abs(el.height) / 2)}" fill="${fill}" stroke="${esc(inkColor(el.color, bg))}" stroke-width="${n(el.strokeWidth)}"${op}${tr}/>`;
    }
    case 'text': {
      const lines = textLines(el)
        .map((ln, i) => `<tspan x="${n(el.x)}" y="${n(el.y + i * el.fontSize * 1.3)}">${esc(ln)}</tspan>`)
        .join('');
      const style = `font-size:${n(el.fontSize)}px;${el.bold ? 'font-weight:600;' : ''}${el.italic ? 'font-style:italic;' : ''}`;
      return `<text fill="${esc(inkColor(el.color, bg))}" font-family="${esc(el.fontFamily || 'Geist, system-ui, sans-serif')}" style="${style}" dominant-baseline="hanging"${op}${tr}>${lines}</text>`;
    }
    case 'image':
      return `<image x="${n(el.x)}" y="${n(el.y)}" width="${n(el.width)}" height="${n(el.height)}" href="${esc(el.src)}" preserveAspectRatio="none"${op}${tr}/>`;
  }
}

export function exportSVG(elements: CanvasElement[], paper: Paper): string {
  const b = unionBounds(elements) ?? { x: -400, y: -300, width: 800, height: 600 };
  const pad = 32;
  const vx = b.x - pad, vy = b.y - pad, vw = b.width + pad * 2, vh = b.height + pad * 2;
  const body = elements.map((e) => elementToSVG(e, paper)).filter(Boolean).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(vx)} ${n(vy)} ${n(vw)} ${n(vh)}" width="${n(vw)}" height="${n(vh)}">\n<rect x="${n(vx)}" y="${n(vy)}" width="${n(vw)}" height="${n(vh)}" fill="${paper.background}"/>\n${body}\n</svg>`;
}

export interface ExportedNote {
  format: 'yoshik-notes';
  version: 1;
  title: string;
  elements: CanvasElement[];
  canvasSettings?: NoteDoc['canvasSettings'];
  exportedAt: string;
}

export function exportJSON(note: { title: string; elements: CanvasElement[]; canvasSettings?: NoteDoc['canvasSettings'] }): string {
  const doc: ExportedNote = { format: 'yoshik-notes', version: 1, title: note.title, elements: note.elements, exportedAt: new Date().toISOString() };
  if (note.canvasSettings) doc.canvasSettings = note.canvasSettings;
  return JSON.stringify(doc, null, 2);
}

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

export function safeFilename(title: string): string {
  const base = title.trim().slice(0, 80) || 'untitled';
  return base.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'untitled';
}
