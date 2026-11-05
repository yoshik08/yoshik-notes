// Ink colours. "Ink" (#000000) adapts to the paper: black on white paper,
// white on black paper. The rest read well on both papers.

export interface Swatch {
  name: string;
  value: string;
}

export const PEN_COLORS: Swatch[] = [
  { name: 'Ink', value: '#000000' },
  { name: 'Amber', value: '#f2a43a' },
  { name: 'Vermilion', value: '#f0503c' },
  { name: 'Cobalt', value: '#3d7bff' },
  { name: 'Moss', value: '#2fb36b' },
  { name: 'Violet', value: '#9b6bff' },
  { name: 'Graphite', value: '#8a8f98' },
];

export const HIGHLIGHTER_COLORS: Swatch[] = [
  { name: 'Yellow', value: '#ffd23f' },
  { name: 'Lime', value: '#9be15d' },
  { name: 'Pink', value: '#ff7eb6' },
  { name: 'Sky', value: '#5cc8ff' },
  { name: 'Orange', value: '#ff9f43' },
];

export const PEN_WIDTHS = [1.5, 3, 5, 9];
export const HIGHLIGHTER_WIDTHS = [4, 6, 9, 14];
export const SHAPE_WIDTHS = [2, 3, 5, 8];
