import type { CanvasElement } from '@/lib/db/models';

// Structural validation for elements written through the API. It rejects
// anything the renderer could choke on (wrong types, non-finite numbers,
// oversized payloads) but passes unknown extra fields through untouched, so a
// newer client's data is never silently dropped.

export const LIMITS = {
  elements: 50_000,
  pointsPerStroke: 20_000,
  textLength: 50_000,
  imageSrc: 3_000_000,
  idLength: 100,
  colorLength: 64,
} as const;

const TYPES = new Set(['stroke', 'line', 'arrow', 'rectangle', 'ellipse', 'text', 'image']);

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const optFinite = (v: unknown) => v === undefined || finite(v);
const colorOk = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= LIMITS.colorLength;

/** Returns null when the element is safe to store, else a short reason. */
export function checkElement(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'element is not an object';
  const el = raw as Record<string, unknown>;
  if (typeof el.id !== 'string' || !el.id || el.id.length > LIMITS.idLength) return 'element id is invalid';
  if (typeof el.type !== 'string' || !TYPES.has(el.type)) return `element ${el.id} has an unknown type`;
  if (!finite(el.x) || !finite(el.y)) return `element ${el.id} has an invalid position`;
  if (!optFinite(el.rotation) || !optFinite(el.opacity)) return `element ${el.id} has invalid rotation/opacity`;

  switch (el.type) {
    case 'stroke': {
      const pts = el.points;
      if (!Array.isArray(pts) || pts.length > LIMITS.pointsPerStroke) return `stroke ${el.id} has invalid points`;
      for (const p of pts) {
        if (!p || typeof p !== 'object') return `stroke ${el.id} has a malformed point`;
        const q = p as Record<string, unknown>;
        if (!finite(q.x) || !finite(q.y) || !optFinite(q.pressure)) return `stroke ${el.id} has a malformed point`;
      }
      if (!colorOk(el.color) || !finite(el.width) || el.width <= 0) return `stroke ${el.id} has invalid color/width`;
      return null;
    }
    case 'line':
    case 'arrow':
      if (!finite(el.x2) || !finite(el.y2) || !colorOk(el.color) || !finite(el.width)) return `${el.type} ${el.id} is invalid`;
      return null;
    case 'rectangle':
    case 'ellipse':
      if (!finite(el.width) || !finite(el.height) || !colorOk(el.color) || !finite(el.strokeWidth)) return `${el.type} ${el.id} is invalid`;
      if (el.fill !== undefined && !colorOk(el.fill)) return `${el.type} ${el.id} has an invalid fill`;
      return null;
    case 'text':
      if (typeof el.text !== 'string' || el.text.length > LIMITS.textLength) return `text ${el.id} is invalid`;
      if (!finite(el.fontSize) || el.fontSize <= 0 || !colorOk(el.color) || !optFinite(el.width)) return `text ${el.id} is invalid`;
      return null;
    case 'image':
      if (!finite(el.width) || !finite(el.height) || el.width <= 0 || el.height <= 0) return `image ${el.id} has an invalid size`;
      if (typeof el.src !== 'string' || el.src.length > LIMITS.imageSrc) return `image ${el.id} is too large`;
      if (!/^(data:image\/(png|jpe?g|webp|gif);base64,|https:\/\/)/i.test(el.src)) return `image ${el.id} has an unsupported source`;
      return null;
  }
  return `element ${el.id} has an unknown type`;
}

export function checkElements(list: unknown[]): string | null {
  if (list.length > LIMITS.elements) return `too many elements (${list.length})`;
  for (const el of list) {
    const problem = checkElement(el);
    if (problem) return problem;
  }
  return null;
}

export type ValidElement = CanvasElement;
