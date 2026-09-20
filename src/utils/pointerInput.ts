/**
 * Pointer / stylus / trackpad helpers for modeling and paint.
 *
 * Desktop mouse, laptop trackpad, and pen tablets all share the Pointer Events
 * API. These helpers keep button maps, palm rejection, and pressure consistent
 * across the 3D viewport, Pixel Paint, UVs, and Blockout.
 */

export type PointerKind = 'mouse' | 'pen' | 'touch' | 'unknown';

export interface PointerLike {
  pointerType?: string;
  pointerId?: number;
  isPrimary?: boolean;
  button?: number;
  buttons?: number;
  pressure?: number;
  clientX?: number;
  clientY?: number;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  /** Method syntax keeps DOM and React's narrower ModifierKey signatures assignable. */
  getModifierState?(key: string): boolean;
}

export function pointerKind(e: PointerLike): PointerKind {
  const type = e.pointerType;
  if (type === 'pen' || type === 'mouse' || type === 'touch') return type;
  return 'unknown';
}

/** W3C eraser button (Windows pen reverse / barrel eraser). */
export function isPenEraser(e: PointerLike): boolean {
  if (pointerKind(e) !== 'pen') return false;
  return e.button === 5 || ((e.buttons ?? 0) & 32) !== 0;
}

export function isSpaceHeld(e: PointerLike): boolean {
  return Boolean(e.getModifierState?.('Space'));
}

/**
 * Primary "use the tool" press: mouse LMB, pen tip, primary finger.
 * Pen eraser is not primary — callers that paint should check it separately.
 */
export function isPrimaryAction(e: PointerLike): boolean {
  if (e.isPrimary === false) return false;
  const button = e.button ?? 0;
  return button === 0 || button === -1;
}

/** RMB / MMB, or Space+LMB — pan the view without activating a tool. */
export function isPanGesture(e: PointerLike): boolean {
  const button = e.button ?? -1;
  if (button === 1 || button === 2) return true;
  if (isSpaceHeld(e) && isPrimaryAction(e)) return true;
  return false;
}

export function isOrbitModifier(e: PointerLike): boolean {
  return Boolean(e.altKey);
}

/**
 * Effective 0–1 paint pressure.
 * Mice report 0.5 in the spec (or 0 in some browsers); treat that as full press
 * so existing click-drag painting does not thin out.
 */
export function paintPressure(e: PointerLike): number {
  const kind = pointerKind(e);
  const raw = typeof e.pressure === 'number' ? e.pressure : 0.5;
  if (kind === 'pen') return clamp01(Math.max(0.05, raw));
  if (kind === 'touch') return clamp01(raw > 0 ? raw : 0.7);
  return 1;
}

/** Scale a brush so a light stylus tap is smaller, a firm press hits the set size. */
export function pressureBrushSize(base: number, pressure: number): number {
  const size = Math.max(1, base);
  if (size <= 1) return 1;
  return Math.max(1, Math.round(1 + (size - 1) * clamp01(pressure)));
}

export function pressureOpacity(base: number, pressure: number): number {
  return clamp01(base) * (0.4 + 0.6 * clamp01(pressure));
}

export function forEachCoalesced(
  e: PointerEvent,
  fn: (sample: PointerEvent) => void,
): void {
  const samples =
    typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : null;
  if (samples && samples.length > 0) {
    samples.forEach(fn);
    return;
  }
  fn(e);
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

const PALM_HOLD_MS = 420;
const activePens = new Set<number>();
let palmUntil = 0;

export function notePointerActivity(e: PointerLike & { type?: string }): void {
  if (pointerKind(e) !== 'pen') return;
  const id = e.pointerId ?? -1;
  const type = e.type;
  if (type === 'pointerup' || type === 'pointercancel' || type === 'lostpointercapture') {
    activePens.delete(id);
    palmUntil = now() + PALM_HOLD_MS;
    return;
  }
  activePens.add(id);
  palmUntil = now() + PALM_HOLD_MS;
}

/** True when a resting-hand touch would steal a stylus stroke. */
export function shouldIgnorePointer(e: PointerLike): boolean {
  if (e.isPrimary === false && pointerKind(e) === 'touch') return true;
  if (pointerKind(e) !== 'touch') return false;
  return activePens.size > 0 || now() < palmUntil;
}

export function bindPalmRejection(target: EventTarget = window): () => void {
  const down = (e: Event) => notePointerActivity(e as PointerEvent);
  const up = (e: Event) => notePointerActivity(e as PointerEvent);
  const opts: AddEventListenerOptions = { capture: true };
  target.addEventListener('pointerdown', down, opts);
  target.addEventListener('pointerup', up, opts);
  target.addEventListener('pointercancel', up, opts);
  return () => {
    target.removeEventListener('pointerdown', down, opts);
    target.removeEventListener('pointerup', up, opts);
    target.removeEventListener('pointercancel', up, opts);
  };
}

/** Screen-space snap radius: a bit larger for a stylus tip / finger. */
export function pointerSnapPx(e?: PointerLike): number {
  const kind = e ? pointerKind(e) : 'mouse';
  if (kind === 'touch') return 22;
  if (kind === 'pen') return 16;
  return 12;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Test-only: drop palm-guard state between cases. */
export function resetPointerInputForTests(): void {
  activePens.clear();
  palmUntil = 0;
}
