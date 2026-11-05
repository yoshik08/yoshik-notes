// Hand-off between the library and the editor for the enlarger transition:
// the frame you tap grows into the page, and going back shrinks it home.
// Each hand-off stays readable for a moment rather than being consumed on
// first read, so a page that mounts twice still gets its transition.

export interface OpeningFrame {
  id: string;
  rect: { x: number; y: number; width: number; height: number };
  image: string | null;
  paper: '#ffffff' | '#000000';
}

const WINDOW_MS = 2000;
let opening: { frame: OpeningFrame; at: number } | null = null;
let returning: { id: string; at: number } | null = null;

const fresh = (at: number) => Date.now() - at < WINDOW_MS;

export const frameTransition = {
  open(frame: OpeningFrame) {
    opening = { frame, at: Date.now() };
    returning = null;
  },
  /** The frame being opened, if the editor for `id` was reached by tapping it just now. */
  takeOpening(id: string): OpeningFrame | null {
    return opening && opening.frame.id === id && fresh(opening.at) ? opening.frame : null;
  },
  back(id: string) {
    returning = { id, at: Date.now() };
    opening = null;
  },
  /** The note just closed, if the library was reached by leaving it just now. */
  takeReturning(): string | null {
    return returning && fresh(returning.at) ? returning.id : null;
  },
};

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
