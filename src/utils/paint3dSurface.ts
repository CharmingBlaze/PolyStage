/**
 * Module-level 3D paint surface.
 *
 * Viewport stamps here during a hold-drag stroke. React remounts, pushHistory,
 * and layers updates cannot null this API or wipe in-progress pixels — the
 * stroke locks a target canvas element at begin and keeps stamping it until end.
 * Hosts only supply callbacks; they never own the stroke lifecycle.
 */

import { floodFill, hexToRgba, rgbaToHex } from './pixelPaint';
import {
  collectBrushTexels,
  texelInUvBounds,
  type UvBounds,
} from './paintStroke';
import { StrokeTexelMask } from './strokeTexelMask';
import {
  getLiveTextureCanvas,
  notifyTexturePreview,
  setLiveTextureCanvas,
} from './texturePreviewBus';

export type Paint3DTool =
  | 'pencil'
  | 'eraser'
  | 'fill'
  | 'picker'
  | 'dither'
  | 'spray'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'hand'
  | 'select'
  | 'wand'
  | 'move'
  | 'shade'
  | 'lighten'
  | 'noise'
  | 'gradient'
  | 'dodge'
  | 'burn'
  | string;

export type Paint3DBridge = {
  paintUv: (
    uvU: number,
    uvV: number,
    color: string,
    brushSize: number,
    paintTool: Paint3DTool,
    opacity: number,
    faceId?: string | null,
  ) => void;
  endStroke: () => void;
};

/** Host callbacks — may be swapped anytime; stroke state lives in this module. */
export type Paint3DHost = {
  /** Active layer (or direct texture) canvas to stamp into. */
  getTargetCanvas: () => HTMLCanvasElement | null;
  /** Optional composite used for color picking / live preview source. */
  refreshPreview?: () => void;
  /** Called once when a stroke becomes active (undo baseline, etc.). */
  onStrokeBegin?: () => void;
  /** Called once when the stroke ends (persist / undo commit). */
  onStrokeEnd?: () => void;
  getMirrorU?: () => boolean;
  getIslandBounds?: (faceId: string | null) => UvBounds | null;
  onPickColor?: (hex: string) => void;
};

type LockedStroke = {
  target: HTMLCanvasElement;
  mask: StrokeTexelMask;
  lastUv: { u: number; v: number } | null;
  faceId: string | null;
  fillDone: boolean;
};

let host: Paint3DHost | null = null;
let hostId = 0;
let pendingDetachId: number | null = null;
let locked: LockedStroke | null = null;

/** Fallback canvas when no host is bound (non-paint workspace / tests). */
let fallbackCanvas: HTMLCanvasElement | null = null;

function ensureFallback(w = 64, h = 64): HTMLCanvasElement {
  if (!fallbackCanvas || fallbackCanvas.width !== w || fallbackCanvas.height !== h) {
    fallbackCanvas = typeof document !== 'undefined'
      ? document.createElement('canvas')
      : ({
          width: w,
          height: h,
          getContext: () => null,
        } as unknown as HTMLCanvasElement);
    if (typeof document !== 'undefined') {
      fallbackCanvas.width = w;
      fallbackCanvas.height = h;
      const ctx = fallbackCanvas.getContext('2d');
      if (ctx) {
        ctx.imageSmoothingEnabled = false;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
      }
    }
  }
  return fallbackCanvas;
}

function resolveTarget(): HTMLCanvasElement | null {
  if (locked?.target) return locked.target;
  const fromHost = host?.getTargetCanvas() ?? null;
  if (fromHost) return fromHost;
  return ensureFallback();
}

function beginLocked(target: HTMLCanvasElement) {
  locked = {
    target,
    mask: new StrokeTexelMask(target.width, target.height),
    lastUv: null,
    faceId: null,
    fillDone: false,
  };
  host?.onStrokeBegin?.();
}

/** Pixel-art tools stamp hard squares. Soft circular falloff smears on low-res atlases. */
function shouldUseHardSquareStamp(paintTool: Paint3DTool): boolean {
  return (
    paintTool === 'pencil'
    || paintTool === 'eraser'
    || paintTool === 'dither'
    || paintTool === 'rect'
    || paintTool === 'ellipse'
    || paintTool === 'line'
    || paintTool === 'rectangle'
  );
}

let previewRaf = 0;
function schedulePreview() {
  const flush = () => {
    // Host composites layers → live canvas (PixelPaint) or publishes textureCanvasRef.
    host?.refreshPreview?.();
    // Fallback only when nothing is published yet (no host / tests) — never
    // overwrite a composite the host just set with the raw layer buffer.
    if (!getLiveTextureCanvas() && locked?.target) {
      setLiveTextureCanvas(locked.target);
    }
    // Sync notify so CanvasTexture.needsUpdate lands before the next render sample
    // (nested async rAF used to land after the renderer already drew).
    notifyTexturePreview({ sync: true });
  };
  // Node/tests: flush sync so stamp assertions see refreshPreview.
  if (typeof requestAnimationFrame !== 'function') {
    flush();
    return;
  }
  if (previewRaf) return;
  previewRaf = requestAnimationFrame(() => {
    previewRaf = 0;
    flush();
  });
}

function stampAt(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  cx: number,
  cy: number,
  color: string,
  size: number,
  paintTool: Paint3DTool,
  opacity: number,
  islandBounds: UvBounds | null,
) {
  // Deduplicate by brush center — densified UV walks still advance centers.
  if (!locked?.mask.add(cx, cy)) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.save();
  if (paintTool === 'eraser') ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = paintTool === 'eraser' ? '#000000' : color;
  if (paintTool === 'spray') {
    ctx.globalAlpha = opacity;
    const radius = Math.max(2, size * 1.8);
    for (let i = 0; i < Math.max(8, size * 5); i++) {
      const angle = Math.random() * Math.PI * 2;
      const distance = Math.sqrt(Math.random()) * radius;
      const sx = Math.round(cx + Math.cos(angle) * distance);
      const sy = Math.round(cy + Math.sin(angle) * distance);
      if (islandBounds && !texelInUvBounds(sx, sy, w, islandBounds)) continue;
      ctx.fillRect(sx, sy, 1, 1);
    }
  } else {
    // Match PixelPaintStudio: hard opaque squares. Soft+alpha looked like skewed
    // smears on the mesh (bilinear-looking blobs) while the UV editor stayed crisp.
    const soft = !shouldUseHardSquareStamp(paintTool) && size > 1;
    const alpha = Math.max(0, Math.min(1, opacity));
    for (const t of collectBrushTexels(cx, cy, size, soft)) {
      if (t.x < 0 || t.y < 0 || t.x >= w || t.y >= h) continue;
      if (islandBounds && !texelInUvBounds(t.x, t.y, w, islandBounds)) continue;
      if (paintTool === 'dither' && (t.x + t.y) % 2 !== 0) continue;
      ctx.globalAlpha = soft ? alpha * t.strength : alpha;
      ctx.fillRect(t.x, t.y, 1, 1);
    }
  }
  ctx.restore();
}

function paintUvImpl(
  uvU: number,
  uvV: number,
  color: string,
  brushSize: number,
  paintTool: Paint3DTool,
  opacity: number,
  faceId: string | null = null,
) {
  if (paintTool === 'select' || paintTool === 'hand' || paintTool === 'move') return;

  const target = resolveTarget();
  if (!target) return;
  const ctx = target.getContext?.('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;

  const w = target.width;
  const h = target.height;
  const x = Math.max(0, Math.min(w - 1, Math.floor(uvU * w)));
  const y = Math.max(0, Math.min(h - 1, Math.floor(uvV * h)));

  if (paintTool === 'picker') {
    const sample = ctx.getImageData(x, y, 1, 1).data;
    if (sample[3]) host?.onPickColor?.(rgbaToHex(sample[0], sample[1], sample[2]));
    return;
  }

  if (!locked) beginLocked(target);
  else if (locked.target !== target) {
    // Host swapped canvases mid-stroke — keep stamping the locked element.
  }

  const canvas = locked!.target;
  const cctx = canvas.getContext('2d');
  if (!cctx) return;
  cctx.imageSmoothingEnabled = false;

  if (paintTool === 'fill') {
    if (locked!.fillDone) return;
    locked!.fillDone = true;
    const image = cctx.getImageData(0, 0, canvas.width, canvas.height);
    floodFill(image, x, y, hexToRgba(color, Math.round(opacity * 255)));
    cctx.putImageData(image, 0, 0);
    locked!.lastUv = { u: uvU, v: uvV };
    locked!.faceId = faceId;
    schedulePreview();
    return;
  }

  const islandBounds =
    host?.getIslandBounds?.(faceId ?? locked!.faceId) ?? null;
  const mirror = host?.getMirrorU?.() === true;

  // Screen-space sampling (samplePaintStrokeUvs) already densifies the stroke.
  // Never UV-Bresenham between samples — that paints texels the ray never hit
  // (GitHub main / PixelPaintStudio: fat blob at brush size 1).
  stampAt(cctx, canvas, x, y, color, brushSize, paintTool, opacity, islandBounds);
  if (mirror) {
    stampAt(
      cctx,
      canvas,
      canvas.width - 1 - x,
      y,
      color,
      brushSize,
      paintTool,
      opacity,
      islandBounds,
    );
  }

  locked!.lastUv = { u: uvU, v: uvV };
  locked!.faceId = faceId ?? locked!.faceId;
  // Coalesce preview to 1x/frame — sync refresh every pointermove froze the UI.
  schedulePreview();
}

function endStrokeImpl() {
  if (!locked) {
    // Still allow host commit for empty/picker-only gestures.
    host?.onStrokeEnd?.();
    flushPendingDetach();
    return;
  }
  locked = null;
  host?.onStrokeEnd?.();
  flushPendingDetach();
}

function flushPendingDetach() {
  if (pendingDetachId != null && pendingDetachId === hostId && !locked) {
    host = null;
    pendingDetachId = null;
  }
}

/** Stable API object — never replaced, never nulled. */
export const paint3dBridge: Paint3DBridge = {
  paintUv: paintUvImpl,
  endStroke: endStrokeImpl,
};

/** @deprecated alias — prefer paint3dBridge */
export const getPaint3DBridge = (): Paint3DBridge => paint3dBridge;

export function isPaint3DStrokeActive(): boolean {
  return locked != null;
}

/** Test/helper: how many texels marked in the current stroke mask. */
export function paint3dStrokeMaskCount(): number {
  if (!locked) return 0;
  let n = 0;
  const { mask } = locked;
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (mask.has(x, y)) n += 1;
    }
  }
  return n;
}

export function getPaint3DLockedCanvas(): HTMLCanvasElement | null {
  return locked?.target ?? null;
}

/**
 * Bind or replace host callbacks. Does NOT clear an in-flight stroke.
 * Returns unbind — deferred until stroke ends if one is active.
 */
export function bindPaint3DHost(next: Paint3DHost): () => void {
  host = next;
  const id = ++hostId;
  pendingDetachId = null;
  return () => {
    if (hostId !== id) return;
    if (locked) {
      pendingDetachId = id;
      return;
    }
    if (host === next) host = null;
  };
}

/** Reset module state (tests only). */
export function __resetPaint3DSurfaceForTests() {
  locked = null;
  host = null;
  hostId = 0;
  pendingDetachId = null;
  fallbackCanvas = null;
  if (previewRaf && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(previewRaf);
  }
  previewRaf = 0;
}
