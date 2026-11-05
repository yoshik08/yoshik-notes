import type { CanvasElement, StrokeElement } from '@/lib/db/models';
import { nanoid } from '@/lib/id';
import { CameraMotion, MAX_ZOOM, MIN_ZOOM, fitCamera, rubberZoom, screenToWorld, worldToScreen, zoomAround, type Camera } from './camera';
import { liveStrokePath, strokeOutline, outlineToSvgPath } from './ink';
import {
  ImageCache,
  drawElement,
  drawElements,
  drawPaper,
  elementBounds,
  hitTest,
  intersects,
  unionBounds,
  type Paper,
  type Rect,
} from './scene';

// The editor engine: the only thing that changes a page. Every edit goes
// through commit(), so undo/redo covers everything and sync gets exact
// element-level changes. Pointer input follows the Pencil-first model: the
// pencil draws, fingers navigate; with no pencil seen, touch draws too.

export type Tool = 'select' | 'pen' | 'highlighter' | 'eraser' | 'hand' | 'line' | 'arrow' | 'rectangle' | 'ellipse' | 'text' | 'image';
export interface Ink {
  color: string;
  width: number;
}

export interface TextEdit {
  id: string;
  isNew: boolean;
  /** World position of the text's top-left. */
  wx: number;
  wy: number;
  fontSize: number;
  color: string;
  text: string;
  width?: number;
}

export interface EngineState {
  tool: Tool;
  pen: Ink;
  highlighter: Ink;
  shape: Ink;
  selection: readonly string[];
  canUndo: boolean;
  canRedo: boolean;
  zoom: number;
  pencilMode: boolean;
  textEdit: TextEdit | null;
  panning: boolean;
  elementCount: number;
  /** A page has been loaded into the engine. */
  loaded: boolean;
}

export interface Change {
  upserts: CanvasElement[];
  deletes: string[];
}

export interface EngineHooks {
  /** A committed edit (also fired for undo/redo) with the exact element changes. */
  onCommit(change: Change): void;
  onPencilDetected?(): void;
  /** The image tool was used at a world point; the UI opens a file picker. */
  onPickImage?(at: { x: number; y: number }): void;
}

interface HistoryItem {
  id: string;
  before: CanvasElement | null;
  beforeIndex: number;
  after: CanvasElement | null;
}

type Gesture =
  | { kind: 'stroke'; pointerId: number; stroke: StrokeElement; predicted: { x: number; y: number; pressure: number }[]; startedAt: number; lastSx: number; lastSy: number }
  | { kind: 'erase'; pointerId: number; erased: Set<string>; last: { x: number; y: number } }
  | { kind: 'shape'; pointerId: number; start: { x: number; y: number }; shape: CanvasElement }
  | { kind: 'lasso'; pointerId: number; points: { x: number; y: number }[]; additive: boolean }
  | { kind: 'move'; pointerId: number; start: { x: number; y: number }; dx: number; dy: number; ids: string[]; moved: boolean }
  | { kind: 'scale'; pointerId: number; anchor: { x: number; y: number }; start: { x: number; y: number }; box: Rect; sx: number; sy: number; ids: string[] }
  | { kind: 'pan'; pointerId: number; last: { x: number; y: number }; samples: { x: number; y: number; t: number }[] };

const GREASE = '#ff4d3a';
const HANDLE_HIT = 22;

const SHAPES = new Set<Tool>(['line', 'arrow', 'rectangle', 'ellipse']);
const round = (n: number) => Math.round(n * 100) / 100;

// ------------------------------------------------------------------ element transforms

function translate(el: CanvasElement, dx: number, dy: number): CanvasElement {
  switch (el.type) {
    case 'stroke':
      return { ...el, x: round(el.x + dx), y: round(el.y + dy), points: el.points.map((p) => ({ ...p, x: round(p.x + dx), y: round(p.y + dy) })) };
    case 'line':
    case 'arrow':
      return { ...el, x: round(el.x + dx), y: round(el.y + dy), x2: round(el.x2 + dx), y2: round(el.y2 + dy) };
    default:
      return { ...el, x: round(el.x + dx), y: round(el.y + dy) };
  }
}

function scaleEl(el: CanvasElement, ax: number, ay: number, sx: number, sy: number): CanvasElement {
  const X = (x: number) => round(ax + (x - ax) * sx);
  const Y = (y: number) => round(ay + (y - ay) * sy);
  const s = Math.sqrt(Math.abs(sx * sy)) || 1;
  switch (el.type) {
    case 'stroke':
      return { ...el, x: X(el.x), y: Y(el.y), width: Math.max(0.5, round(el.width * s)), points: el.points.map((p) => ({ ...p, x: X(p.x), y: Y(p.y) })) };
    case 'line':
    case 'arrow':
      return { ...el, x: X(el.x), y: Y(el.y), x2: X(el.x2), y2: Y(el.y2) };
    case 'rectangle':
    case 'ellipse':
    case 'image':
      return { ...el, x: X(el.x), y: Y(el.y), width: round(el.width * sx), height: round(el.height * sy) };
    case 'text':
      return { ...el, x: X(el.x), y: Y(el.y), fontSize: Math.max(4, round(el.fontSize * s)), ...(el.width ? { width: round(el.width * Math.abs(sx)) } : {}) };
  }
}

function pointInPolygon(x: number, y: number, poly: { x: number; y: number }[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y || 1e-9) + a.x) inside = !inside;
  }
  return inside;
}

function makeShape(tool: Tool, a: { x: number; y: number }, b: { x: number; y: number }, ink: Ink, constrain: boolean, id = nanoid()): CanvasElement {
  let { x, y } = b;
  if (constrain && (tool === 'line' || tool === 'arrow')) {
    const ang = Math.round(Math.atan2(y - a.y, x - a.x) / (Math.PI / 4)) * (Math.PI / 4);
    const len = Math.hypot(x - a.x, y - a.y);
    x = a.x + Math.cos(ang) * len;
    y = a.y + Math.sin(ang) * len;
  } else if (constrain) {
    const side = Math.max(Math.abs(x - a.x), Math.abs(y - a.y));
    x = a.x + Math.sign(x - a.x || 1) * side;
    y = a.y + Math.sign(y - a.y || 1) * side;
  }
  if (tool === 'line' || tool === 'arrow') return { id, type: tool, x: round(a.x), y: round(a.y), x2: round(x), y2: round(y), color: ink.color, width: ink.width };
  return {
    id,
    type: tool as 'rectangle' | 'ellipse',
    x: round(Math.min(a.x, x)),
    y: round(Math.min(a.y, y)),
    width: round(Math.abs(x - a.x)),
    height: round(Math.abs(y - a.y)),
    color: ink.color,
    strokeWidth: ink.width,
  };
}

// ------------------------------------------------------------------ engine

export class Engine {
  private els: CanvasElement[] = [];
  private index = new Map<string, number>();
  paper: Paper = { background: '#ffffff', pattern: 'none' };
  cam: Camera = { x: 0, y: 0, zoom: 1 };

  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private layer: HTMLCanvasElement | null = null;
  private layerCam: Camera | null = null;
  private layerValid = false;
  private layerMs = 0;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private dpr = 1;
  private w = 0;
  private h = 0;
  private raf = 0;
  private lastT = 0;
  private ro: ResizeObserver | null = null;
  private images = new ImageCache(() => this.invalidate());
  private motion = new CameraMotion();

  private gesture: Gesture | null = null;
  private touches = new Map<number, { x: number; y: number }>();
  private pinch: { dist: number; mid: { x: number; y: number }; cam: Camera } | null = null;
  private hover: { x: number; y: number } | null = null;
  private spaceHeld = false;

  private undoStack: HistoryItem[][] = [];
  private redoStack: HistoryItem[][] = [];
  private listeners = new Set<() => void>();
  private st: EngineState;

  constructor(private hooks: EngineHooks) {
    this.st = {
      tool: 'pen',
      pen: { color: '#000000', width: 3 },
      highlighter: { color: '#ffd23f', width: 6 },
      shape: { color: '#000000', width: 3 },
      selection: [],
      canUndo: false,
      canRedo: false,
      zoom: 1,
      pencilMode: false,
      textEdit: null,
      panning: false,
      elementCount: 0,
      loaded: false,
    };
  }

  // ---------------------------------------------------------------- state store

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getState = () => this.st;
  private set(patch: Partial<EngineState>) {
    this.st = { ...this.st, ...patch };
    for (const l of this.listeners) l();
  }

  get elements(): readonly CanvasElement[] {
    return this.els;
  }

  // ---------------------------------------------------------------- lifecycle

  attach(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { desynchronized: true }) ?? canvas.getContext('2d');
    this.layer = document.createElement('canvas');
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onCancel);
    canvas.addEventListener('pointerleave', this.onLeave);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('dblclick', this.onDoubleClick);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
  }

  detach() {
    const c = this.canvas;
    if (c) {
      c.removeEventListener('pointerdown', this.onDown);
      c.removeEventListener('pointermove', this.onMove);
      c.removeEventListener('pointerup', this.onUp);
      c.removeEventListener('pointercancel', this.onCancel);
      c.removeEventListener('pointerleave', this.onLeave);
      c.removeEventListener('wheel', this.onWheel);
      c.removeEventListener('dblclick', this.onDoubleClick);
    }
    this.ro?.disconnect();
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.canvas = null;
    this.ctx = null;
    this.listeners.clear();
  }

  private resize() {
    const c = this.canvas;
    if (!c) return;
    const rect = c.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.w = rect.width;
    this.h = rect.height;
    c.width = Math.max(1, Math.round(rect.width * this.dpr));
    c.height = Math.max(1, Math.round(rect.height * this.dpr));
    if (this.layer) {
      this.layer.width = c.width;
      this.layer.height = c.height;
    }
    this.invalidate();
  }

  get size() {
    return { width: this.w, height: this.h };
  }

  // ---------------------------------------------------------------- document

  private reindex() {
    this.index.clear();
    this.els.forEach((el, i) => this.index.set(el.id, i));
    if (this.st.elementCount !== this.els.length) this.set({ elementCount: this.els.length });
  }

  /** Replace the whole page (load, or a newer copy from the server). Keeps history ids valid. */
  load(elements: CanvasElement[], paper: Paper, view?: Camera | null) {
    this.els = elements.slice();
    this.reindex();
    this.paper = paper;
    if (view) this.cam = view;
    const sel = this.st.selection.filter((id) => this.index.has(id));
    this.set({ selection: sel, loaded: true, zoom: this.cam.zoom });
    this.invalidate();
  }

  /** Replace the UI callbacks (they may change between renders). */
  setHooks(hooks: Partial<EngineHooks>) {
    this.hooks = { ...this.hooks, ...hooks };
  }

  setPaper(paper: Paper) {
    this.paper = paper;
    this.invalidate();
  }

  get(id: string) {
    const i = this.index.get(id);
    return i == null ? undefined : this.els[i];
  }

  /** Apply an edit, record it for undo, and report it to sync. */
  commit(edit: { add?: CanvasElement[]; update?: CanvasElement[]; remove?: string[] }, select?: string[]) {
    const items: HistoryItem[] = [];
    for (const id of edit.remove ?? []) {
      const i = this.index.get(id);
      if (i != null) items.push({ id, before: this.els[i], beforeIndex: i, after: null });
    }
    for (const el of edit.update ?? []) {
      const i = this.index.get(el.id);
      if (i != null) items.push({ id: el.id, before: this.els[i], beforeIndex: i, after: el });
    }
    for (const el of edit.add ?? []) items.push({ id: el.id, before: null, beforeIndex: -1, after: el });
    if (!items.length) return;
    this.apply(items, 'forward');
    this.undoStack.push(items);
    if (this.undoStack.length > 300) this.undoStack.shift();
    this.redoStack = [];
    if (select) this.set({ selection: select });
    this.afterHistory();
    this.report(items, 'forward');
  }

  private apply(items: HistoryItem[], dir: 'forward' | 'back') {
    if (dir === 'forward') {
      const removed = new Set(items.filter((i) => !i.after).map((i) => i.id));
      const updated = new Map(items.filter((i) => i.before && i.after).map((i) => [i.id, i.after!]));
      const added = items.filter((i) => !i.before).map((i) => i.after!);
      this.els = this.els.filter((e) => !removed.has(e.id)).map((e) => updated.get(e.id) ?? e).concat(added);
    } else {
      const added = new Set(items.filter((i) => !i.before).map((i) => i.id));
      const reverted = new Map(items.filter((i) => i.before && i.after).map((i) => [i.id, i.before!]));
      const next = this.els.filter((e) => !added.has(e.id)).map((e) => reverted.get(e.id) ?? e);
      for (const it of items.filter((i) => i.before && !i.after).sort((a, b) => a.beforeIndex - b.beforeIndex)) {
        next.splice(Math.min(it.beforeIndex, next.length), 0, it.before!);
      }
      this.els = next;
    }
    this.reindex();
    this.invalidate();
  }

  private report(items: HistoryItem[], dir: 'forward' | 'back') {
    const upserts: CanvasElement[] = [];
    const deletes: string[] = [];
    for (const it of items) {
      const el = dir === 'forward' ? it.after : it.before;
      if (el) upserts.push(el);
      else deletes.push(it.id);
    }
    this.hooks.onCommit({ upserts, deletes });
  }

  private afterHistory() {
    const sel = this.st.selection.filter((id) => this.index.has(id));
    this.set({ canUndo: this.undoStack.length > 0, canRedo: this.redoStack.length > 0, selection: sel });
  }

  undo() {
    this.cancelGesture();
    const items = this.undoStack.pop();
    if (!items) return;
    this.apply(items, 'back');
    this.redoStack.push(items);
    this.afterHistory();
    this.report(items, 'back');
  }

  redo() {
    this.cancelGesture();
    const items = this.redoStack.pop();
    if (!items) return;
    this.apply(items, 'forward');
    this.undoStack.push(items);
    this.afterHistory();
    this.report(items, 'forward');
  }

  // ---------------------------------------------------------------- tools & ink

  setTool(tool: Tool) {
    if (this.st.textEdit) this.set({ textEdit: null });
    this.cancelGesture();
    this.set({ tool, ...(tool !== 'select' ? { selection: [] } : {}) });
    this.invalidate();
  }

  setInk(kind: 'pen' | 'highlighter' | 'shape', ink: Partial<Ink>) {
    this.set({ [kind]: { ...this.st[kind], ...ink } } as Partial<EngineState>);
    // Recolour the selection when there is one: a quick way to fix a colour.
    if (ink.color && this.st.selection.length && this.st.tool === 'select') {
      const update = this.st.selection
        .map((id) => this.get(id))
        .filter((el): el is CanvasElement => !!el && el.type !== 'image')
        .map((el) => ({ ...el, color: ink.color! }) as CanvasElement);
      if (update.length) this.commit({ update }, this.st.selection.slice());
    }
  }

  setSpaceHeld(held: boolean) {
    if (this.spaceHeld === held) return;
    this.spaceHeld = held;
    this.set({ panning: held });
  }

  // ---------------------------------------------------------------- selection commands

  select(ids: string[]) {
    this.set({ selection: ids.filter((id) => this.index.has(id)) });
    this.invalidate();
  }

  selectAll() {
    this.setTool('select');
    this.select(this.els.map((e) => e.id));
  }

  deleteSelection() {
    const ids = this.st.selection.slice();
    if (ids.length) this.commit({ remove: ids }, []);
  }

  duplicateSelection(offset = 24) {
    const copies = this.st.selection.map((id) => this.get(id)).filter(Boolean).map((el) => ({ ...translate(el!, offset / this.cam.zoom, offset / this.cam.zoom), id: nanoid() }) as CanvasElement);
    if (copies.length) this.commit({ add: copies }, copies.map((c) => c.id));
  }

  copySelection(): CanvasElement[] {
    return this.st.selection.map((id) => this.get(id)).filter((e): e is CanvasElement => !!e);
  }

  /** Paste elements centred on the view, with fresh ids. */
  paste(elements: CanvasElement[]) {
    if (!elements.length) return;
    const b = unionBounds(elements)!;
    const c = this.viewCenter();
    const dx = c.x - (b.x + b.width / 2), dy = c.y - (b.y + b.height / 2);
    const copies = elements.map((el) => ({ ...translate(el, dx, dy), id: nanoid() }) as CanvasElement);
    this.setTool('select');
    this.commit({ add: copies }, copies.map((e) => e.id));
  }

  selectionBounds(): Rect | null {
    if (!this.st.selection.length) return null;
    return unionBounds(this.st.selection.map((id) => this.get(id)).filter((e): e is CanvasElement => !!e));
  }

  // ---------------------------------------------------------------- text and images

  beginText(at: { x: number; y: number }, existing?: Extract<CanvasElement, { type: 'text' }>) {
    if (existing) {
      this.set({ textEdit: { id: existing.id, isNew: false, wx: existing.x, wy: existing.y, fontSize: existing.fontSize, color: existing.color, text: existing.text, width: existing.width } });
    } else {
      const fontSize = Math.round(Math.min(160, Math.max(8, 22 / this.cam.zoom)));
      this.set({ textEdit: { id: nanoid(), isNew: true, wx: round(at.x), wy: round(at.y - fontSize * 0.65), fontSize, color: this.st.pen.color, text: '' } });
    }
    this.invalidate();
  }

  commitText(text: string) {
    const t = this.st.textEdit;
    if (!t) return;
    this.set({ textEdit: null });
    const value = text.replace(/\s+$/, '');
    const existing = this.get(t.id);
    if (!value.trim()) {
      if (existing) this.commit({ remove: [t.id] });
    } else if (existing && existing.type === 'text') {
      if (existing.text !== value) this.commit({ update: [{ ...existing, text: value }] });
    } else {
      this.commit({ add: [{ id: t.id, type: 'text', x: t.wx, y: t.wy, text: value, fontSize: t.fontSize, color: t.color }] });
    }
    this.invalidate();
  }

  cancelText() {
    this.set({ textEdit: null });
    this.invalidate();
  }

  insertImage(src: string, natural: { width: number; height: number }, at?: { x: number; y: number }) {
    const c = at ?? this.viewCenter();
    const max = Math.min(560, (Math.min(this.w, this.h) * 0.6) / this.cam.zoom);
    const s = Math.min(1, max / Math.max(natural.width, natural.height));
    const width = round(natural.width * s), height = round(natural.height * s);
    const el: CanvasElement = { id: nanoid(), type: 'image', x: round(c.x - width / 2), y: round(c.y - height / 2), width, height, src };
    this.commit({ add: [el] }, [el.id]);
    if (this.st.tool !== 'select') this.set({ tool: 'select' });
  }

  // ---------------------------------------------------------------- camera

  viewCenter() {
    return { x: this.cam.x, y: this.cam.y };
  }

  screenPoint(wx: number, wy: number) {
    return worldToScreen(this.cam, wx, wy, this.w, this.h);
  }

  /** World point under a viewport position (e.g. where a file was dropped). */
  worldAt(clientX: number, clientY: number) {
    const r = this.canvas?.getBoundingClientRect();
    if (!r) return this.viewCenter();
    return screenToWorld(this.cam, clientX - r.left, clientY - r.top, this.w, this.h);
  }

  private setCam(c: Camera) {
    this.cam = c;
    if (Math.abs(this.st.zoom - c.zoom) > 0.0005) this.set({ zoom: c.zoom });
    this.requestRender();
  }

  zoomBy(factor: number, at?: { x: number; y: number }, response = 0.38) {
    const target = zoomAround(this.cam, at?.x ?? this.w / 2, at?.y ?? this.h / 2, factor, this.w, this.h);
    this.motion.animateTo(this.cam, target, response);
    this.requestRender();
  }

  zoomTo(zoom: number) {
    this.zoomBy(zoom / this.cam.zoom);
  }

  /** Glide the view somewhere (interruptible by any gesture). */
  glideTo(c: Camera) {
    this.motion.animateTo(this.cam, c, 0.6);
    this.requestRender();
  }

  fit(animate = true) {
    const target = fitCamera(unionBounds(this.els), this.w, this.h);
    if (animate) {
      this.motion.animateTo(this.cam, target);
      this.requestRender();
    } else this.setCam(target);
  }

  /** The writing view: content centred at 100% (or fitted if it is larger than the screen). */
  homeCamera(): Camera {
    const b = unionBounds(this.els);
    if (!b) return { x: 0, y: 0, zoom: 1 };
    const fitted = fitCamera(b, this.w, this.h);
    return { x: fitted.x, y: fitted.y, zoom: Math.min(1, fitted.zoom) };
  }

  home() {
    this.setCam(this.homeCamera());
  }

  // ---------------------------------------------------------------- pointer input

  private local(e: PointerEvent | WheelEvent | MouseEvent) {
    const r = this.canvas!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private toWorld(p: { x: number; y: number }) {
    return screenToWorld(this.cam, p.x, p.y, this.w, this.h);
  }

  private onDown = (e: PointerEvent) => {
    // Until a note is loaded there is no page to write on: ink drawn now would be replaced by the load.
    if (!this.canvas || !this.st.loaded) return;
    this.motion.stop(); // grab the page mid-flight
    const p = this.local(e);
    // Tapping the page finishes any typing (the title, or text on the page, which commits on blur).
    const active = document.activeElement as HTMLElement | null;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) active.blur();
    if (e.pointerType === 'pen' && !this.st.pencilMode) {
      this.set({ pencilMode: true });
      this.hooks.onPencilDetected?.();
    }
    if (e.pointerType === 'touch') {
      this.touches.set(e.pointerId, p);
      if (this.touches.size === 2) {
        // Two fingers always navigate; a stroke the first finger began is discarded.
        this.cancelGesture();
        this.startPinch();
        return;
      }
      if (this.touches.size > 2) return;
      if (this.st.pencilMode || this.st.tool === 'hand') return this.startPan(e, p);
    }
    if (e.pointerType === 'mouse' && e.button === 1) return this.startPan(e, p);
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (this.spaceHeld || this.st.tool === 'hand') return this.startPan(e, p);
    if (this.gesture) return; // ignore extra pointers mid-gesture

    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already gone */
    }
    const w = this.toWorld(p);
    const tool: Tool = e.pointerType === 'pen' && (e.buttons & 32) ? 'eraser' : this.st.tool;
    switch (tool) {
      case 'pen':
      case 'highlighter':
        return this.startStroke(e, w, p, tool === 'highlighter');
      case 'eraser':
        this.gesture = { kind: 'erase', pointerId: e.pointerId, erased: new Set(), last: w };
        this.eraseAt(w);
        return;
      case 'select':
        return this.startSelect(e, w, p);
      case 'text': {
        // Keep the browser from moving focus on mousedown, or the new text box blurs (and closes) at once.
        e.preventDefault();
        const hit = this.topHit(w, 6 / this.cam.zoom);
        if (hit?.type === 'text') this.beginText(w, hit);
        else this.beginText(w);
        return;
      }
      case 'image':
        this.hooks.onPickImage?.(w);
        return;
      default:
        if (SHAPES.has(tool)) {
          const ink = this.st.shape;
          this.gesture = { kind: 'shape', pointerId: e.pointerId, start: w, shape: makeShape(tool, w, w, ink, false) };
        }
    }
  };

  private onMove = (e: PointerEvent) => {
    const p = this.local(e);
    if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) {
      this.touches.set(e.pointerId, p);
      if (this.pinch && this.touches.size >= 2) return this.movePinch();
    }
    const g = this.gesture;
    if (!g) {
      if (e.pointerType !== 'touch') {
        this.hover = p;
        if (this.st.tool === 'pen' || this.st.tool === 'highlighter' || this.st.tool === 'eraser') this.requestRender();
      }
      return;
    }
    if (g.pointerId !== e.pointerId) return;
    this.hover = e.pointerType === 'touch' ? null : p;

    switch (g.kind) {
      case 'stroke': {
        const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
        for (const ce of events.length ? events : [e]) this.addPoint(g, ce);
        const predicted = typeof e.getPredictedEvents === 'function' ? e.getPredictedEvents() : [];
        g.predicted = predicted.slice(0, 2).map((pe) => {
          const q = this.toWorld(this.local(pe));
          return { x: q.x, y: q.y, pressure: pe.pointerType === 'pen' ? pe.pressure : 0.5 };
        });
        break;
      }
      case 'erase': {
        const w = this.toWorld(p);
        const step = 4 / this.cam.zoom;
        const d = Math.hypot(w.x - g.last.x, w.y - g.last.y);
        for (let t = step; t < d; t += step) this.eraseAt({ x: g.last.x + ((w.x - g.last.x) * t) / d, y: g.last.y + ((w.y - g.last.y) * t) / d });
        this.eraseAt(w);
        g.last = w;
        break;
      }
      case 'shape': {
        const w = this.toWorld(p);
        g.shape = makeShape(this.st.tool, g.start, w, this.st.shape, e.shiftKey, g.shape.id);
        break;
      }
      case 'lasso': {
        const w = this.toWorld(p);
        const last = g.points[g.points.length - 1];
        if (Math.hypot(w.x - last.x, w.y - last.y) * this.cam.zoom > 2) g.points.push(w);
        break;
      }
      case 'move': {
        const w = this.toWorld(p);
        g.dx = w.x - g.start.x;
        g.dy = w.y - g.start.y;
        if (!g.moved && Math.hypot(g.dx, g.dy) * this.cam.zoom > 3) {
          g.moved = true;
          this.invalidate(); // moving elements leave the cached layer
        }
        break;
      }
      case 'scale': {
        const w = this.toWorld(p);
        const bw = g.start.x - g.anchor.x || 1e-6, bh = g.start.y - g.anchor.y || 1e-6;
        let sx = (w.x - g.anchor.x) / bw, sy = (w.y - g.anchor.y) / bh;
        if (!e.shiftKey) {
          const s = Math.max(Math.abs(sx), Math.abs(sy));
          sx = Math.sign(sx || 1) * s;
          sy = Math.sign(sy || 1) * s;
        }
        g.sx = Math.abs(sx) < 0.02 ? 0.02 * Math.sign(sx || 1) : sx;
        g.sy = Math.abs(sy) < 0.02 ? 0.02 * Math.sign(sy || 1) : sy;
        break;
      }
      case 'pan': {
        const dx = p.x - g.last.x, dy = p.y - g.last.y;
        g.last = p;
        const now = performance.now();
        g.samples.push({ x: p.x, y: p.y, t: now });
        while (g.samples.length > 2 && now - g.samples[0].t > 90) g.samples.shift();
        this.setCam({ ...this.cam, x: this.cam.x - dx / this.cam.zoom, y: this.cam.y - dy / this.cam.zoom });
        return;
      }
    }
    this.requestRender();
  };

  private onUp = (e: PointerEvent) => {
    if (e.pointerType === 'touch') {
      this.touches.delete(e.pointerId);
      if (this.pinch) {
        if (this.touches.size < 2) this.endPinch();
        return;
      }
    }
    const g = this.gesture;
    if (!g || g.pointerId !== e.pointerId) return;
    this.gesture = null;
    switch (g.kind) {
      case 'stroke': {
        const s = g.stroke;
        if (s.points.length) this.commit({ add: [s] });
        break;
      }
      case 'erase':
        if (g.erased.size) this.commit({ remove: [...g.erased] });
        break;
      case 'shape': {
        const b = elementBounds(g.shape);
        if (Math.max(b.width, b.height) * this.cam.zoom > 6) this.commit({ add: [g.shape] });
        break;
      }
      case 'lasso':
        this.finishLasso(g);
        break;
      case 'move':
        if (g.moved) {
          const update = g.ids.map((id) => this.get(id)).filter((el): el is CanvasElement => !!el).map((el) => translate(el, g.dx, g.dy));
          this.commit({ update }, g.ids);
        }
        break;
      case 'scale': {
        const update = g.ids.map((id) => this.get(id)).filter((el): el is CanvasElement => !!el).map((el) => scaleEl(el, g.anchor.x, g.anchor.y, g.sx, g.sy));
        this.commit({ update }, g.ids);
        break;
      }
      case 'pan': {
        const s = g.samples;
        if (s.length >= 2 && e.pointerType === 'touch') {
          const a = s[0], b = s[s.length - 1];
          const dt = Math.max(1, b.t - a.t);
          this.motion.fling((b.x - a.x) / dt, (b.y - a.y) / dt);
        }
        this.set({ panning: this.spaceHeld });
        break;
      }
    }
    this.invalidate();
  };

  private onCancel = (e: PointerEvent) => {
    this.touches.delete(e.pointerId);
    if (this.pinch && this.touches.size < 2) this.endPinch();
    if (this.gesture?.pointerId === e.pointerId) this.cancelGesture();
  };

  private onLeave = (e: PointerEvent) => {
    if (e.pointerType !== 'touch' && !this.gesture) {
      this.hover = null;
      this.requestRender();
    }
  };

  private onDoubleClick = (e: MouseEvent) => {
    const w = this.toWorld(this.local(e));
    const hit = this.topHit(w, 6 / this.cam.zoom);
    if (hit?.type === 'text' && (this.st.tool === 'select' || this.st.tool === 'text')) this.beginText(w, hit);
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.motion.stop();
    const p = this.local(e);
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.h : 1;
    if (e.ctrlKey || e.metaKey) {
      // Trackpad pinch arrives as ctrl+wheel; mouse wheels with ctrl zoom too.
      const factor = Math.exp(-e.deltaY * unit * (e.deltaMode ? 0.003 : 0.0095));
      this.setCam(zoomAround(this.cam, p.x, p.y, factor, this.w, this.h));
    } else {
      const dx = (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * unit;
      const dy = (e.shiftKey && !e.deltaX ? 0 : e.deltaY) * unit;
      this.setCam({ ...this.cam, x: this.cam.x + dx / this.cam.zoom, y: this.cam.y + dy / this.cam.zoom });
    }
  };

  private startPan(e: PointerEvent, p: { x: number; y: number }) {
    if (this.gesture) this.cancelGesture();
    try {
      this.canvas?.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    this.gesture = { kind: 'pan', pointerId: e.pointerId, last: p, samples: [{ ...p, t: performance.now() }] };
    this.set({ panning: true });
  }

  private startPinch() {
    const [a, b] = [...this.touches.values()];
    this.pinch = { dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, cam: { ...this.cam } };
    this.set({ panning: true });
  }

  private movePinch() {
    const pinch = this.pinch!;
    const [a, b] = [...this.touches.values()];
    const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const zoom = rubberZoom(pinch.cam.zoom * (dist / pinch.dist));
    // Keep the world point under the starting midpoint under the fingers.
    const anchor = screenToWorld(pinch.cam, pinch.mid.x, pinch.mid.y, this.w, this.h);
    this.setCam({ zoom, x: anchor.x - (mid.x - this.w / 2) / zoom, y: anchor.y - (mid.y - this.h / 2) / zoom });
  }

  private endPinch() {
    this.pinch = null;
    this.gesture = null;
    this.set({ panning: this.spaceHeld });
    const z = this.cam.zoom;
    if (z > MAX_ZOOM || z < MIN_ZOOM) {
      const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
      this.motion.animateTo(this.cam, zoomAround(this.cam, this.w / 2, this.h / 2, clamped / z, this.w, this.h, false));
      this.requestRender();
    }
  }

  private startStroke(e: PointerEvent, w: { x: number; y: number }, p: { x: number; y: number }, highlighter: boolean) {
    const ink = highlighter ? this.st.highlighter : this.st.pen;
    const stroke: StrokeElement = {
      id: nanoid(),
      type: 'stroke',
      x: round(w.x),
      y: round(w.y),
      points: [{ x: round(w.x), y: round(w.y), pressure: e.pointerType === 'pen' ? round(e.pressure || 0.5) : 0.5 }],
      color: ink.color,
      width: ink.width,
      ...(highlighter ? { isHighlighter: true } : {}),
    };
    this.gesture = { kind: 'stroke', pointerId: e.pointerId, stroke, predicted: [], startedAt: performance.now(), lastSx: p.x, lastSy: p.y };
    this.hover = null;
    this.requestRender();
  }

  private addPoint(g: Extract<Gesture, { kind: 'stroke' }>, ev: PointerEvent) {
    const p = this.local(ev);
    // Keep a point every ~0.75 screen px: smooth ink, smaller saves.
    if (Math.hypot(p.x - g.lastSx, p.y - g.lastSy) < 0.75) return;
    g.lastSx = p.x;
    g.lastSy = p.y;
    const w = this.toWorld(p);
    g.stroke.points.push({ x: round(w.x), y: round(w.y), pressure: ev.pointerType === 'pen' ? round(ev.pressure || 0.5) : 0.5 });
  }

  private eraseAt(w: { x: number; y: number }) {
    const g = this.gesture;
    if (!g || g.kind !== 'erase') return;
    const r = 10 / this.cam.zoom;
    let changed = false;
    for (let i = this.els.length - 1; i >= 0; i--) {
      const el = this.els[i];
      if (!g.erased.has(el.id) && hitTest(el, w.x, w.y, r)) {
        g.erased.add(el.id);
        changed = true;
      }
    }
    if (changed) this.invalidate();
  }

  private topHit(w: { x: number; y: number }, r: number) {
    for (let i = this.els.length - 1; i >= 0; i--) if (hitTest(this.els[i], w.x, w.y, r)) return this.els[i];
    return null;
  }

  private handleAt(p: { x: number; y: number }) {
    const b = this.selectionBounds();
    if (!b) return null;
    const tl = this.screenPoint(b.x, b.y), br = this.screenPoint(b.x + b.width, b.y + b.height);
    const corners = [
      { sx: tl.x, sy: tl.y, ax: b.x + b.width, ay: b.y + b.height, cx: b.x, cy: b.y },
      { sx: br.x, sy: tl.y, ax: b.x, ay: b.y + b.height, cx: b.x + b.width, cy: b.y },
      { sx: tl.x, sy: br.y, ax: b.x + b.width, ay: b.y, cx: b.x, cy: b.y + b.height },
      { sx: br.x, sy: br.y, ax: b.x, ay: b.y, cx: b.x + b.width, cy: b.y + b.height },
    ];
    for (const c of corners) if (Math.hypot(p.x - c.sx, p.y - c.sy) <= HANDLE_HIT) return { anchor: { x: c.ax, y: c.ay }, start: { x: c.cx, y: c.cy }, box: b };
    return null;
  }

  private startSelect(e: PointerEvent, w: { x: number; y: number }, p: { x: number; y: number }) {
    const handle = this.handleAt(p);
    if (handle) {
      this.gesture = { kind: 'scale', pointerId: e.pointerId, ...handle, sx: 1, sy: 1, ids: this.st.selection.slice() };
      this.invalidate();
      return;
    }
    const sel = this.selectionBounds();
    const insideSelection = sel && w.x >= sel.x && w.x <= sel.x + sel.width && w.y >= sel.y && w.y <= sel.y + sel.height;
    const hit = this.topHit(w, (e.pointerType === 'mouse' ? 4 : 10) / this.cam.zoom);
    if (hit || insideSelection) {
      let ids = this.st.selection.slice();
      if (hit && !ids.includes(hit.id)) ids = e.shiftKey ? [...ids, hit.id] : [hit.id];
      else if (hit && e.shiftKey) ids = ids.filter((id) => id !== hit.id);
      this.set({ selection: ids });
      this.gesture = { kind: 'move', pointerId: e.pointerId, start: w, dx: 0, dy: 0, ids, moved: false };
    } else {
      if (!e.shiftKey) this.set({ selection: [] });
      this.gesture = { kind: 'lasso', pointerId: e.pointerId, points: [w], additive: e.shiftKey };
    }
    this.invalidate();
  }

  private lassoHits(points: { x: number; y: number }[]) {
    if (points.length < 3) return [];
    const box = unionBounds([{ id: '_', type: 'stroke', x: 0, y: 0, points, color: '', width: 0 }])!;
    const ids: string[] = [];
    for (const el of this.els) {
      const b = elementBounds(el);
      if (!intersects(b, box)) continue;
      let inside: boolean;
      if (el.type === 'stroke' && el.points.length > 2) {
        const step = Math.max(1, Math.floor(el.points.length / 24));
        let n = 0, hit = 0;
        for (let i = 0; i < el.points.length; i += step) {
          n++;
          if (pointInPolygon(el.points[i].x, el.points[i].y, points)) hit++;
        }
        inside = hit / n >= 0.6;
      } else inside = pointInPolygon(b.x + b.width / 2, b.y + b.height / 2, points);
      if (inside) ids.push(el.id);
    }
    return ids;
  }

  private finishLasso(g: Extract<Gesture, { kind: 'lasso' }>) {
    const hits = this.lassoHits(g.points);
    const ids = g.additive ? [...new Set([...this.st.selection, ...hits])] : hits;
    this.set({ selection: ids });
  }

  cancelGesture() {
    const g = this.gesture;
    this.gesture = null;
    if (g?.kind === 'pan') this.set({ panning: this.spaceHeld });
    this.invalidate();
  }

  // ---------------------------------------------------------------- rendering

  invalidate() {
    this.layerValid = false;
    this.requestRender();
  }

  requestRender() {
    if (!this.raf && typeof requestAnimationFrame !== 'undefined') this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (t: number) => {
    this.raf = 0;
    const dt = this.lastT ? t - this.lastT : 16;
    this.lastT = t;
    if (this.motion.active) {
      const next = this.motion.step(this.cam, dt);
      if (next) this.setCam(next);
    }
    this.draw();
    if (this.motion.active) this.requestRender();
    else this.lastT = 0;
  };

  private hiddenIds(): Set<string> | undefined {
    const g = this.gesture;
    if ((g?.kind === 'move' && g.moved) || g?.kind === 'scale') return new Set(g.ids);
    return undefined;
  }

  private viewport(): Rect {
    const tl = this.toWorld({ x: 0, y: 0 });
    return { x: tl.x, y: tl.y, width: this.w / this.cam.zoom, height: this.h / this.cam.zoom };
  }

  private worldTransform(ctx: CanvasRenderingContext2D) {
    const { dpr, cam } = this;
    ctx.setTransform(dpr * cam.zoom, 0, 0, dpr * cam.zoom, dpr * (this.w / 2 - cam.x * cam.zoom), dpr * (this.h / 2 - cam.y * cam.zoom));
  }

  private renderLayer() {
    const layer = this.layer!;
    const lctx = layer.getContext('2d')!;
    const t0 = performance.now();
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.clearRect(0, 0, layer.width, layer.height);
    this.worldTransform(lctx);
    const g = this.gesture;
    drawElements(lctx, this.els, {
      paper: this.paper,
      images: this.images,
      viewport: this.viewport(),
      fading: g?.kind === 'erase' ? g.erased : undefined,
      hidden: this.hiddenIds(),
    });
    this.layerCam = { ...this.cam };
    this.layerValid = true;
    this.layerMs = performance.now() - t0;
  }

  private draw() {
    const ctx = this.ctx;
    const layer = this.layer;
    if (!ctx || !layer || !this.w) return;
    const { dpr, cam } = this;
    const sameCam = this.layerCam && this.layerCam.x === cam.x && this.layerCam.y === cam.y && this.layerCam.zoom === cam.zoom;

    // Paper is cheap: always fresh, in screen space.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawPaper(ctx, cam, this.w, this.h, this.paper);

    if (this.layerValid && sameCam) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(layer, 0, 0);
    } else if (this.layerValid && this.layerCam && this.layerMs > 10 && (this.motion.active || this.gesture?.kind === 'pan' || this.pinch)) {
      // Heavy page in motion: move the last bitmap, re-render crisply once it settles.
      const L = this.layerCam;
      const k = cam.zoom / L.zoom;
      ctx.setTransform(k, 0, 0, k, dpr * ((this.w / 2) * (1 - k) + (L.x - cam.x) * cam.zoom), dpr * ((this.h / 2) * (1 - k) + (L.y - cam.y) * cam.zoom));
      ctx.drawImage(layer, 0, 0);
      if (this.settleTimer) clearTimeout(this.settleTimer);
      this.settleTimer = setTimeout(() => this.invalidate(), 140);
    } else {
      this.renderLayer();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(layer, 0, 0);
    }

    // Live gesture content in world space.
    this.worldTransform(ctx);
    const g = this.gesture;
    const opts = { paper: this.paper, images: this.images };
    if (g?.kind === 'stroke') {
      const s = g.predicted.length ? { ...g.stroke, points: [...g.stroke.points, ...g.predicted] } : g.stroke;
      drawElement(ctx, s, opts, liveStrokePath(s));
    } else if (g?.kind === 'shape') drawElement(ctx, g.shape, opts);
    else if (g?.kind === 'move' && g.moved) for (const id of g.ids) {
      const el = this.get(id);
      if (el) drawElement(ctx, translate(el, g.dx, g.dy), opts);
    } else if (g?.kind === 'scale') for (const id of g.ids) {
      const el = this.get(id);
      if (el) drawElement(ctx, scaleEl(el, g.anchor.x, g.anchor.y, g.sx, g.sy), opts);
    }

    // Marks and cursors in screen space.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (g?.kind === 'lasso') this.drawLasso(ctx, g.points);
    this.drawSelection(ctx);
    this.drawCursor(ctx);
  }

  /** The grease-pencil loop: a waxy red mark drawn the way you drew it. */
  private drawLasso(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[]) {
    if (pts.length < 2) return;
    const screen = pts.map((p) => this.screenPoint(p.x, p.y));
    ctx.save();
    ctx.beginPath();
    screen.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 77, 58, 0.07)';
    ctx.fill();
    const outline = strokeOutline({ width: 3.2, isHighlighter: false, points: screen.map((p) => ({ x: p.x, y: p.y, pressure: 0.5 })) }, true);
    ctx.fillStyle = GREASE;
    ctx.globalAlpha = 0.92;
    ctx.fill(new Path2D(outlineToSvgPath(outline)));
    ctx.restore();
  }

  private drawSelection(ctx: CanvasRenderingContext2D) {
    const g = this.gesture;
    let b = this.selectionBounds();
    if (!b) return;
    if (g?.kind === 'move' && g.moved) b = { ...b, x: b.x + g.dx, y: b.y + g.dy };
    if (g?.kind === 'scale') {
      const a = g.anchor;
      const x1 = a.x + (b.x - a.x) * g.sx, x2 = a.x + (b.x + b.width - a.x) * g.sx;
      const y1 = a.y + (b.y - a.y) * g.sy, y2 = a.y + (b.y + b.height - a.y) * g.sy;
      b = { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
    }
    const pad = 6;
    const tl = this.screenPoint(b.x, b.y), br = this.screenPoint(b.x + b.width, b.y + b.height);
    const x = tl.x - pad, y = tl.y - pad, w = br.x - tl.x + pad * 2, h = br.y - tl.y + pad * 2;
    ctx.save();
    ctx.strokeStyle = GREASE;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h));
    ctx.setLineDash([]);
    if (!g || g.kind === 'scale') {
      for (const [cx, cy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
        ctx.beginPath();
        ctx.arc(cx, cy, 5.5, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = GREASE;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawCursor(ctx: CanvasRenderingContext2D) {
    const h = this.hover;
    const t = this.st.tool;
    if (!h || this.gesture?.kind === 'pan' || this.spaceHeld) return;
    if (t !== 'pen' && t !== 'highlighter' && t !== 'eraser') return;
    const dark = this.paper.background === '#000000';
    ctx.save();
    if (t === 'eraser') {
      ctx.beginPath();
      ctx.arc(h.x, h.y, 10, 0, Math.PI * 2);
      ctx.strokeStyle = dark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 1.25;
      ctx.stroke();
    } else {
      const ink = t === 'pen' ? this.st.pen : this.st.highlighter;
      const r = Math.max(1.5, ((t === 'highlighter' ? ink.width * 3 : ink.width) * this.cam.zoom) / 2);
      ctx.beginPath();
      ctx.arc(h.x, h.y, r, 0, Math.PI * 2);
      ctx.strokeStyle = dark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();
  }
}
