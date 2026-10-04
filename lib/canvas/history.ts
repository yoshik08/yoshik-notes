import { useCallback, useRef } from 'react';
import type { CanvasElement } from '@/lib/db/models';

// Command-based undo/redo. Each command knows how to apply and revert itself
// as a transformation on the elements array.

export interface Command {
  label: string;
  do(els: CanvasElement[]): CanvasElement[];
  undo(els: CanvasElement[]): CanvasElement[];
}

export function useHistory(
  elements: CanvasElement[],
  onChange: (els: CanvasElement[], dirty?: boolean) => void
) {
  const undoStack = useRef<Command[]>([]);
  const redoStack = useRef<Command[]>([]);
  const elementsRef = useRef(elements);
  elementsRef.current = elements;

  const execute = useCallback((cmd: Command) => {
    const next = cmd.do(elementsRef.current);
    undoStack.current.push(cmd);
    redoStack.current = [];
    if (undoStack.current.length > 100) undoStack.current.shift();
    onChange(next, true);
  }, [onChange]);

  const undo = useCallback(() => {
    const cmd = undoStack.current.pop();
    if (!cmd) return;
    const next = cmd.undo(elementsRef.current);
    redoStack.current.push(cmd);
    onChange(next, true);
  }, [onChange]);

  const redo = useCallback(() => {
    const cmd = redoStack.current.pop();
    if (!cmd) return;
    const next = cmd.do(elementsRef.current);
    undoStack.current.push(cmd);
    onChange(next, true);
  }, [onChange]);

  const canUndo = undoStack.current.length > 0;
  const canRedo = redoStack.current.length > 0;

  return { execute, undo, redo, canUndo, canRedo };
}

// Command factories

export function addElementsCmd(els: CanvasElement[]): Command {
  const ids = new Set(els.map((e) => e.id));
  return {
    label: `add ${els.length}`,
    do: (cur) => [...cur, ...els],
    undo: (cur) => cur.filter((e) => !ids.has(e.id)),
  };
}

export function deleteElementsCmd(ids: string[]): Command {
  const idSet = new Set(ids);
  let removed: CanvasElement[] = [];
  return {
    label: `delete ${ids.length}`,
    do: (cur) => {
      removed = cur.filter((e) => idSet.has(e.id));
      return cur.filter((e) => !idSet.has(e.id));
    },
    undo: (cur) => [...cur, ...removed],
  };
}

export function moveElementsCmd(ids: string[], dx: number, dy: number): Command {
  const idSet = new Set(ids);
  return {
    label: `move ${ids.length}`,
    do: (cur) => cur.map((e) => (idSet.has(e.id) ? { ...e, x: e.x + dx, y: e.y + dy } : e)),
    undo: (cur) => cur.map((e) => (idSet.has(e.id) ? { ...e, x: e.x - dx, y: e.y - dy } : e)),
  };
}
