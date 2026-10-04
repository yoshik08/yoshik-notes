// Strict validation for imported note JSON. Never trust input:
// malformed, wrong-typed, or oversized payloads are rejected with an error.

import type { CanvasElement, ElementType, NoteDoc } from '@/lib/db/models';

export interface ImportedNote {
  title: string;
  elements: CanvasElement[];
  appState?: NoteDoc['appState'];
  canvasSettings?: NoteDoc['canvasSettings'];
}

export interface ValidationResult {
  ok: boolean;
  note?: ImportedNote;
  error?: string;
}

const ELEMENT_TYPES: readonly ElementType[] = [
  'stroke',
  'line',
  'arrow',
  'rectangle',
  'ellipse',
  'text',
  'image',
];

const BACKGROUNDS = ['#ffffff', '#000000', 'grid', 'dots', 'ruled'] as const;

// Abuse guards
const MAX_ELEMENTS = 20_000;
const MAX_TITLE_LEN = 200;
const MAX_TEXT_LEN = 50_000;
const MAX_POINTS_PER_STROKE = 10_000;
const MAX_SRC_LEN = 5_000_000; // image data-URL cap

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isStr(v: unknown): v is string {
  return typeof v === 'string';
}

function isBool(v: unknown): v is boolean {
  return typeof v === 'boolean';
}

function opt<T>(v: unknown, guard: (x: unknown) => x is T): v is T | undefined {
  return v === undefined || guard(v);
}

function fail(error: string): ValidationResult {
  return { ok: false, error };
}

interface ValidElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  rotation?: number;
  opacity?: number;
}

function validateBase(el: Record<string, unknown>): ValidElement | string {
  if (!isStr(el.id) || el.id.length === 0 || el.id.length > 100) {
    return 'element missing valid id';
  }
  if (!isStr(el.type) || !(ELEMENT_TYPES as readonly string[]).includes(el.type)) {
    return `element "${el.id}" has invalid type`;
  }
  if (!isNum(el.x) || !isNum(el.y)) {
    return `element "${el.id}" has invalid position`;
  }
  const out: ValidElement = {
    id: el.id,
    type: el.type as ElementType,
    x: el.x,
    y: el.y,
  };
  if (el.rotation !== undefined) {
    if (!isNum(el.rotation)) return `element "${el.id}" has invalid rotation`;
    out.rotation = el.rotation;
  }
  if (el.opacity !== undefined) {
    if (!isNum(el.opacity) || el.opacity < 0 || el.opacity > 1) {
      return `element "${el.id}" has invalid opacity`;
    }
    out.opacity = el.opacity;
  }
  return out;
}

function validateElement(raw: unknown): CanvasElement | string {
  if (!isRecord(raw)) return 'element is not an object';
  const base = validateBase(raw);
  if (typeof base === 'string') return base;
  const id = base.id;

  const color = (key: string, fallback?: string): string | undefined => {
    const v = raw[key];
    if (v === undefined) return fallback;
    if (!isStr(v) || v.length === 0 || v.length > 64) return undefined;
    return v;
  };
  const num = (key: string): number | undefined => {
    const v = raw[key];
    return isNum(v) ? v : undefined;
  };

  switch (base.type) {
    case 'stroke': {
      const points = raw.points;
      if (!Array.isArray(points) || points.length > MAX_POINTS_PER_STROKE) {
        return `stroke "${id}" has invalid points`;
      }
      const clean: { x: number; y: number; pressure?: number }[] = [];
      for (const p of points) {
        if (!isRecord(p) || !isNum(p.x) || !isNum(p.y)) {
          return `stroke "${id}" has malformed point`;
        }
        const pt: { x: number; y: number; pressure?: number } = { x: p.x, y: p.y };
        if (p.pressure !== undefined) {
          if (!isNum(p.pressure)) return `stroke "${id}" has invalid pressure`;
          pt.pressure = Math.min(1, Math.max(0, p.pressure));
        }
        clean.push(pt);
      }
      const c = color('color');
      const w = num('width');
      if (c === undefined || w === undefined || w <= 0 || w > 500) {
        return `stroke "${id}" has invalid color/width`;
      }
      const isHighlighter = raw.isHighlighter;
      if (!opt(isHighlighter, isBool)) return `stroke "${id}" has invalid isHighlighter`;
      return {
        ...base,
        type: 'stroke' as const,
        points: clean,
        color: c,
        width: w,
        ...(isHighlighter !== undefined ? { isHighlighter } : {}),
      };
    }
    case 'line':
    case 'arrow': {
      const x2 = num('x2');
      const y2 = num('y2');
      const c = color('color');
      const w = num('width');
      if (x2 === undefined || y2 === undefined || c === undefined || w === undefined || w <= 0 || w > 500) {
        return `${base.type} "${id}" has invalid geometry/style`;
      }
      return { ...base, type: base.type as 'line' | 'arrow', x2, y2, color: c, width: w };
    }
    case 'rectangle':
    case 'ellipse': {
      const w = num('width');
      const h = num('height');
      const sw = num('strokeWidth');
      const c = color('color');
      if (w === undefined || h === undefined || sw === undefined || c === undefined) {
        return `${base.type} "${id}" has invalid geometry/style`;
      }
      if (sw <= 0 || sw > 500) return `${base.type} "${id}" has invalid strokeWidth`;
      const fill = color('fill');
      return {
        ...base,
        type: base.type as 'rectangle' | 'ellipse',
        width: w,
        height: h,
        strokeWidth: sw,
        color: c,
        ...(fill !== undefined ? { fill } : {}),
      };
    }
    case 'text': {
      const text = raw.text;
      if (!isStr(text) || text.length > MAX_TEXT_LEN) {
        return `text "${id}" has invalid text`;
      }
      const fontSize = num('fontSize');
      const c = color('color');
      if (fontSize === undefined || fontSize <= 0 || fontSize > 1000 || c === undefined) {
        return `text "${id}" has invalid fontSize/color`;
      }
      const out: Extract<CanvasElement, { type: 'text' }> = {
        ...base,
        type: 'text',
        text,
        fontSize,
        color: c,
      };
      if (raw.fontFamily !== undefined) {
        if (!isStr(raw.fontFamily) || raw.fontFamily.length > 200) {
          return `text "${id}" has invalid fontFamily`;
        }
        out.fontFamily = raw.fontFamily;
      }
      if (raw.bold !== undefined) {
        if (!isBool(raw.bold)) return `text "${id}" has invalid bold`;
        out.bold = raw.bold;
      }
      if (raw.italic !== undefined) {
        if (!isBool(raw.italic)) return `text "${id}" has invalid italic`;
        out.italic = raw.italic;
      }
      if (raw.width !== undefined) {
        if (!isNum(raw.width) || raw.width < 0) return `text "${id}" has invalid width`;
        out.width = raw.width;
      }
      return out;
    }
    case 'image': {
      const w = num('width');
      const h = num('height');
      const src = raw.src;
      if (w === undefined || h === undefined || w <= 0 || h <= 0) {
        return `image "${id}" has invalid size`;
      }
      if (!isStr(src) || src.length === 0 || src.length > MAX_SRC_LEN) {
        return `image "${id}" has invalid src`;
      }
      // Only allow data URLs or http(s) — no javascript:, file:, etc.
      if (!/^(data:image\/|https?:\/\/)/i.test(src)) {
        return `image "${id}" has disallowed src scheme`;
      }
      const out: Extract<CanvasElement, { type: 'image' }> = {
        ...base,
        type: 'image',
        width: w,
        height: h,
        src,
      };
      if (raw.storageKey !== undefined) {
        if (!isStr(raw.storageKey) || raw.storageKey.length > 500) {
          return `image "${id}" has invalid storageKey`;
        }
        out.storageKey = raw.storageKey;
      }
      return out;
    }
  }
}

/**
 * Validate parsed JSON as an importable note.
 * Accepts the yoshik-notes export envelope ({format, title, elements})
 * or a bare {title, elements} document.
 */
export function validateImport(data: unknown): ValidationResult {
  if (!isRecord(data)) return fail('File is not a JSON object');

  const title = data.title;
  if (!isStr(title)) return fail('Missing or invalid "title"');
  const cleanTitle = title.trim().slice(0, MAX_TITLE_LEN) || 'Untitled';

  const elements = data.elements;
  if (!Array.isArray(elements)) return fail('Missing or invalid "elements" array');
  if (elements.length > MAX_ELEMENTS) {
    return fail(`Too many elements (${elements.length} > ${MAX_ELEMENTS})`);
  }

  const seen = new Set<string>();
  const clean: CanvasElement[] = [];
  for (let i = 0; i < elements.length; i++) {
    const res = validateElement(elements[i]);
    if (typeof res === 'string') return fail(`Element ${i}: ${res}`);
    if (seen.has(res.id)) return fail(`Duplicate element id "${res.id}"`);
    seen.add(res.id);
    clean.push(res);
  }

  const note: ImportedNote = { title: cleanTitle, elements: clean };

  // Optional appState
  if (data.appState !== undefined) {
    if (
      !isRecord(data.appState) ||
      !isNum(data.appState.viewX) ||
      !isNum(data.appState.viewY) ||
      !isNum(data.appState.zoom) ||
      data.appState.zoom <= 0
    ) {
      return fail('Invalid "appState"');
    }
    note.appState = {
      viewX: data.appState.viewX,
      viewY: data.appState.viewY,
      zoom: data.appState.zoom,
    };
  }

  // Optional canvasSettings
  if (data.canvasSettings !== undefined) {
    if (
      !isRecord(data.canvasSettings) ||
      !isStr(data.canvasSettings.background) ||
      !(BACKGROUNDS as readonly string[]).includes(data.canvasSettings.background)
    ) {
      return fail('Invalid "canvasSettings"');
    }
    note.canvasSettings = {
      background: data.canvasSettings.background as (typeof BACKGROUNDS)[number],
    };
  }

  return { ok: true, note };
}
