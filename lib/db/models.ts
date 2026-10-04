import { ObjectId } from 'mongodb';

// ============ Users ============

export interface UserDoc {
  _id?: ObjectId;
  googleId: string;
  email: string;
  name: string;
  avatar?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ============ Canvas Elements ============

export type ElementType =
  | 'stroke'
  | 'line'
  | 'arrow'
  | 'rectangle'
  | 'ellipse'
  | 'text'
  | 'image';

interface BaseElement {
  id: string;
  type: ElementType;
  x: number; // world coords
  y: number;
  rotation?: number;
  opacity?: number;
}

export interface StrokeElement extends BaseElement {
  type: 'stroke';
  points: { x: number; y: number; pressure?: number }[];
  color: string;
  width: number;
  isHighlighter?: boolean;
}

export interface LineElement extends BaseElement {
  type: 'line';
  x2: number;
  y2: number;
  color: string;
  width: number;
}

export interface ArrowElement extends BaseElement {
  type: 'arrow';
  x2: number;
  y2: number;
  color: string;
  width: number;
}

export interface RectangleElement extends BaseElement {
  type: 'rectangle';
  width: number;
  height: number;
  color: string;
  strokeWidth: number;
  fill?: string;
}

export interface EllipseElement extends BaseElement {
  type: 'ellipse';
  width: number;
  height: number;
  color: string;
  strokeWidth: number;
  fill?: string;
}

export interface TextElement extends BaseElement {
  type: 'text';
  text: string;
  fontSize: number;
  color: string;
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
  width?: number; // bounding box for wrapping
}

export interface ImageElement extends BaseElement {
  type: 'image';
  width: number;
  height: number;
  src: string; // URL or data URL (small images only)
  storageKey?: string; // external storage reference for large images
}

export type CanvasElement =
  | StrokeElement
  | LineElement
  | ArrowElement
  | RectangleElement
  | EllipseElement
  | TextElement
  | ImageElement;

// ============ Notes ============

export interface CanvasSettings {
  background: '#ffffff' | '#000000' | 'grid' | 'dots' | 'ruled';
}

export interface AppState {
  viewX: number;
  viewY: number;
  zoom: number;
}

export interface NoteDoc {
  _id?: ObjectId;
  ownerId: string; // googleId of owner
  title: string;
  elements: CanvasElement[];
  appState: AppState;
  canvasSettings: CanvasSettings;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

export function newNote(ownerId: string, title = 'Untitled'): Omit<NoteDoc, '_id'> {
  const now = new Date();
  return {
    ownerId,
    title,
    elements: [],
    appState: { viewX: 0, viewY: 0, zoom: 1 },
    canvasSettings: { background: '#ffffff' },
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
}
