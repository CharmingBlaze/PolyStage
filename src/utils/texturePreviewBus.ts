/**
 * Live paint preview without App setState.
 * Viewport (and others) subscribe; paint strokes notify after updating textureCanvasRef.
 */

type Listener = () => void;

const listeners = new Set<Listener>();
let tick = 0;

export function getTexturePreviewTick() {
  return tick;
}

export function subscribeTexturePreview(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Call after mutating the live texture canvas. Coalesce to one notify per frame. */
let raf = 0;
export function notifyTexturePreview() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    tick += 1;
    listeners.forEach((fn) => {
      try {
        fn();
      } catch {
        /* ignore subscriber errors */
      }
    });
  });
}

export function cancelTexturePreviewNotify() {
  if (!raf) return;
  cancelAnimationFrame(raf);
  raf = 0;
}
