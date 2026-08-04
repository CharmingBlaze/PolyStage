import { useEffect } from 'react';

/**
 * Returns true if the currently focused element is an editable text input,
 * textarea, select box, or content-editable node.
 */
export function isInputFocused(): boolean {
  const active = document.activeElement as HTMLElement | null;
  if (!active) return false;
  const tag = active.tagName.toLowerCase();
  return (
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select' ||
    Boolean(active.isContentEditable)
  );
}

export type KeyHandler = (e: KeyboardEvent) => void;

/**
 * Registers a global window keydown listener that automatically suppresses
 * execution whenever an interactive text element has input focus.
 */
export function useGlobalShortcut(
  handler: KeyHandler,
  deps: React.DependencyList = [],
  options?: { capture?: boolean; allowInInputs?: boolean }
) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!options?.allowInInputs && isInputFocused()) {
        return;
      }
      handler(e);
    };

    window.addEventListener('keydown', onKey, options?.capture);
    return () => window.removeEventListener('keydown', onKey, options?.capture);
  }, deps);
}
