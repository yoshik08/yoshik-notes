// Keyboard shortcut labels in the platform's own notation: ⇧⌘Z on Apple devices, Ctrl+Shift+Z elsewhere.

export const isApple = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** A text field has the keyboard: letters are typing, not shortcuts. */
export function isTextField(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

/** An open menu or dialog has the keyboard: its keys must not reach the page behind it. */
export function inLayer(target: EventTarget | null) {
  const el = target as Element | null;
  return !!el?.closest?.('[role=dialog],[role=alertdialog],[role=menu]');
}

export function shortcut(key: string, opts: { mod?: boolean; shift?: boolean } = {}): string {
  if (isApple()) return `${opts.shift ? '⇧' : ''}${opts.mod ? '⌘' : ''}${key}`;
  return [opts.mod && 'Ctrl', opts.shift && 'Shift', key].filter(Boolean).join('+');
}
