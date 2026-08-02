/**
 * Live paint preview without App setState.
 * Viewport (and others) subscribe; paint strokes notify after updating the live canvas.
 *
 * The live canvas identity can change (layer → composite) without a React render.
 * Subscribers must read getLiveTextureCanvas() and rebind CanvasTexture when it drifts.
 */

type Listener = () => void;

const listeners = new Set<Listener>();
let tick = 0;
let liveCanvas: HTMLCanvasElement | null = null;

export function getTexturePreviewTick() {
  return tick;
}

/** Source of truth for the canvas Three.js should sample during live paint. */
export function getLiveTextureCanvas(): HTMLCanvasElement | null {
  return liveCanvas;
}

export function setLiveTextureCanvas(canvas: HTMLCanvasElement | null) {
  liveCanvas = canvas;
}

export function subscribeTexturePreview(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function flushListeners() {
  tick += 1;
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore subscriber errors */
    }
  });
}

/** Call after mutating the live texture canvas. Coalesce to one notify per frame. */
let raf = 0;
export function notifyTexturePreview(opts?: { sync?: boolean }) {
  if (opts?.sync) {
    if (raf) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
      else clearTimeout(raf);
      raf = 0;
    }
    flushListeners();
    return;
  }
  if (raf) return;
  const schedule =
    typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0) as unknown as number;
  raf = schedule(() => {
    raf = 0;
    flushListeners();
  });
}

export function cancelTexturePreviewNotify() {
  if (!raf) return;
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
  else clearTimeout(raf);
  raf = 0;
}

/** Test helper */
export function __resetTexturePreviewBusForTests() {
  cancelTexturePreviewNotify();
  listeners.clear();
  liveCanvas = null;
  tick = 0;
}
