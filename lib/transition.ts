// The enlarger: the frame you tap grows into the page, and going back shrinks
// it home.
//
// Opening starts growing the frame the moment it is tapped, on a cover that
// lives on <body> (outside React), so it keeps going while the note's route
// loads and the library unmounts. The editor finds it with takeOpening(),
// waits for it to finish growing, and dissolves it once the page is drawn
// underneath. The cover changes its real size rather than being scaled, so the
// thumbnail inside keeps its shape and lands exactly where the page starts.

import { gsap } from 'gsap';

export interface OpeningFrame {
  id: string;
  rect: { x: number; y: number; width: number; height: number };
  image: string | null;
  paper: '#ffffff' | '#000000';
}

const GROW_S = 0.5;
const DISSOLVE_S = 0.24;
/** A cover nobody picks up (the route failed, the tap was abandoned) clears itself. */
const UNCLAIMED_MS = 10_000;
/** Even a claimed cover never outstays this. */
const MAX_MS = 20_000;
const RETURN_WINDOW_MS = 2000;

interface Cover {
  frame: OpeningFrame;
  el: HTMLDivElement;
  grown: boolean;
  leaving: boolean;
  claimed: boolean;
  onGrown: Set<() => void>;
  onGone: (() => void)[];
  timers: ReturnType<typeof setTimeout>[];
}

let cover: Cover | null = null;
let returning: { id: string; at: number } | null = null;

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function makeCover(frame: OpeningFrame): HTMLDivElement {
  const { x, y, width, height } = frame.rect;
  const el = document.createElement('div');
  el.setAttribute('aria-hidden', 'true');
  el.dataset.enlarger = frame.id;
  Object.assign(el.style, {
    position: 'fixed',
    left: `${x}px`,
    top: `${y}px`,
    width: `${width}px`,
    height: `${height}px`,
    zIndex: '60',
    overflow: 'hidden',
    borderRadius: '3px',
    background: frame.paper,
    // Black paper frames carry a hairline so they read on the black ground.
    boxShadow: frame.paper === '#000000' ? '0 0 0 1px rgba(255,255,255,0.14)' : 'none',
    // Swallow taps while it grows so a second frame can't be opened underneath.
    pointerEvents: 'auto',
  } satisfies Partial<CSSStyleDeclaration>);
  if (frame.image) {
    const img = document.createElement('img');
    img.alt = '';
    img.draggable = false;
    img.src = frame.image;
    // Same 3:2 image the frame showed; "contain" matches the frame at the start
    // and the page's first camera (thumbnailCamera) at full size.
    Object.assign(img.style, { display: 'block', width: '100%', height: '100%', objectFit: 'contain' });
    el.appendChild(img);
  }
  document.body.appendChild(el);
  return el;
}

function markGrown(c: Cover) {
  c.grown = true;
  // Full size from here on follows the window (rotation, resize).
  Object.assign(c.el.style, { left: '0px', top: '0px', width: '100%', height: '100%', borderRadius: '0px', boxShadow: 'none', pointerEvents: 'none' });
  for (const f of [...c.onGrown]) f();
  c.onGrown.clear();
}

function remove(c: Cover, duration: number, blur: boolean) {
  if (c.leaving) return;
  c.leaving = true;
  c.timers.forEach(clearTimeout);
  gsap.killTweensOf(c.el);
  c.el.style.pointerEvents = 'none';
  // Anyone waiting for the grow stops waiting; the cover fades from wherever it is.
  for (const f of [...c.onGrown]) f();
  c.onGrown.clear();
  const done = () => {
    c.el.remove();
    if (cover === c) cover = null;
    for (const f of c.onGone) f();
    c.onGone = [];
  };
  if (duration <= 0) done();
  else gsap.to(c.el, { opacity: 0, filter: blur ? 'blur(6px)' : 'none', duration, ease: 'power1.out', onComplete: done });
}

let listening = false;
function listenOnce() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  // Back/forward while the note is still opening: drop the cover, show what the URL says.
  window.addEventListener('popstate', () => frameTransition.dismiss());
}

export const frameTransition = {
  /** Start growing `frame` into the page. Call right before navigating to the note. */
  open(frame: OpeningFrame) {
    if (typeof document === 'undefined') return;
    listenOnce();
    returning = null;
    if (cover) remove(cover, 0, false);
    const el = makeCover(frame);
    const c: Cover = { frame, el, grown: false, leaving: false, claimed: false, onGrown: new Set(), onGone: [], timers: [] };
    cover = c;
    c.timers.push(setTimeout(() => !c.claimed && remove(c, 0.2, false), UNCLAIMED_MS));
    c.timers.push(setTimeout(() => remove(c, 0.2, false), MAX_MS));

    if (prefersReducedMotion()) {
      // Glides become cuts.
      markGrown(c);
      return;
    }
    gsap.to(el, {
      left: 0,
      top: 0,
      width: window.innerWidth,
      height: window.innerHeight,
      borderRadius: 0,
      boxShadow: frame.paper === '#000000' ? '0 0 0 0px rgba(255,255,255,0)' : 'none',
      duration: GROW_S,
      ease: 'power4.out',
      onComplete: () => markGrown(c),
    });
  },

  /** The frame being opened, if the editor for `id` was reached by tapping it. Safe to call more than once. */
  takeOpening(id: string): OpeningFrame | null {
    if (!cover || cover.leaving || cover.frame.id !== id) return null;
    cover.claimed = true;
    return cover.frame;
  },

  /** Calls `f` once the cover has finished growing (right away if it has, or if there is none). Returns an unsubscribe. */
  whenGrown(f: () => void): () => void {
    const c = cover;
    if (!c || c.grown) {
      f();
      return () => {};
    }
    c.onGrown.add(f);
    return () => void c.onGrown.delete(f);
  },

  /** The page is drawn underneath: dissolve the enlarged frame into it. `onDone` runs when it is gone. */
  dissolve(onDone?: () => void) {
    const c = cover;
    if (!c) {
      onDone?.();
      return;
    }
    if (onDone) c.onGone.push(onDone);
    remove(c, DISSOLVE_S, true);
  },

  /** Drop the cover without ceremony (navigation went elsewhere). */
  dismiss() {
    if (cover) remove(cover, 0.15, false);
  },

  back(id: string) {
    this.dismiss();
    returning = { id, at: Date.now() };
  },

  /** The note just closed, if the library was reached by leaving it just now. */
  takeReturning(): string | null {
    return returning && Date.now() - returning.at < RETURN_WINDOW_MS ? returning.id : null;
  },
};
