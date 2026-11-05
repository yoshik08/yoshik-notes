'use client';

import { useEffect, useRef, useState } from 'react';
import type { Engine, TextEdit } from '@/lib/canvas/engine';
import { inkColor } from '@/lib/canvas/scene';

/** Typing on the page: a text field pinned to the text's spot on the canvas. */
export function TextOverlay({ engine, edit }: { engine: Engine; edit: TextEdit }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(edit.text);
  const done = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
    // Follow the page while it pans or zooms.
    let raf = 0;
    const place = () => {
      const p = engine.screenPoint(edit.wx, edit.wy);
      const z = engine.cam.zoom;
      el.style.transform = `translate(${p.x}px, ${p.y}px)`;
      el.style.fontSize = `${edit.fontSize * z}px`;
      raf = requestAnimationFrame(place);
    };
    place();
    return () => cancelAnimationFrame(raf);
  }, [edit, engine]);

  const finish = () => {
    if (done.current) return;
    done.current = true;
    engine.commitText(value);
  };

  return (
    <textarea
      ref={ref}
      value={value}
      aria-label="Type on the page"
      rows={Math.max(1, value.split('\n').length)}
      onChange={(e) => setValue(e.target.value)}
      onBlur={finish}
      onKeyDown={(e) => {
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
          e.preventDefault();
          ref.current?.blur();
        }
        e.stopPropagation();
      }}
      spellCheck
      className="absolute left-0 top-0 z-10 m-0 min-w-[2ch] resize-none overflow-hidden whitespace-pre border-0 bg-transparent p-0 outline-none [field-sizing:content]"
      style={{
        color: inkColor(edit.color, engine.paper.background),
        lineHeight: 1.3,
        fontFamily: 'var(--font-geist), system-ui, sans-serif',
        caretColor: 'var(--grease)',
        transformOrigin: '0 0',
      }}
    />
  );
}
