// Test data shared by specs.

export const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/** Elements exactly as the previous app saved them: every type, pressure, highlighter, image. */
export const LEGACY_ELEMENTS = [
  { id: 'l-stroke', type: 'stroke', x: 10, y: 10, points: [{ x: 10, y: 10, pressure: 0.4 }, { x: 30, y: 20, pressure: 0.6 }, { x: 60, y: 25, pressure: 0.5 }], color: '#000000', width: 4, isHighlighter: false },
  { id: 'l-hl', type: 'stroke', x: 0, y: 40, points: [{ x: 0, y: 40, pressure: 0.5 }, { x: 120, y: 40, pressure: 0.5 }], color: '#E9A13B', width: 6, isHighlighter: true },
  { id: 'l-line', type: 'line', x: 0, y: 80, x2: 100, y2: 120, color: '#ef4444', width: 2 },
  { id: 'l-arrow', type: 'arrow', x: 0, y: 140, x2: 140, y2: 140, color: '#3b82f6', width: 4 },
  { id: 'l-rect', type: 'rectangle', x: 200, y: 10, width: 120, height: 80, color: '#22c55e', strokeWidth: 4 },
  { id: 'l-ellipse', type: 'ellipse', x: 200, y: 120, width: 90, height: 60, color: '#a855f7', strokeWidth: 2 },
  { id: 'l-text', type: 'text', x: 20, y: 200, text: 'Fourier: f(x) = Σ aₙ cos(nx)', fontSize: 24, color: '#000000' },
  { id: 'l-img', type: 'image', x: 360, y: 10, width: 64, height: 64, src: PNG_1PX },
];
