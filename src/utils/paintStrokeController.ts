/**
 * Imperative 3D paint stroke controller.
 *
 * Owns window/document move/up listeners so React re-renders cannot drop a drag.
 *
 * Why hold-drag used to produce only dots:
 * - WebGL canvases often fire `pointercancel` right after `pointerdown`.
 * - After cancel, `pointermove` for that pointerId stops.
 * - `setPointerCapture` makes cancel more likely (capture lost on React churn).
 * - `preventDefault(pointerdown)` suppresses compatibility mouse events.
 * Together: begin stamp fires, then silence until the next click.
 *
 * Rules:
 * - Never setPointerCapture.
 * - Never end on pointercancel.
 * - Accept pointermove OR mousemove (position-deduped).
 * - Callers must not preventDefault(pointerdown); stopImmediatePropagation only.
 */

export type PaintStrokeClient = { x: number; y: number };

export type PaintStrokeCallbacks = {
  onSegment: (from: PaintStrokeClient | null, to: PaintStrokeClient) => void;
  onBegin: (client: PaintStrokeClient) => void;
  onEnd: () => void;
  /** Clear stuck OrbitControls after cancel noise — stroke stays active. */
  onCancelNoise?: () => void;
};

export type PaintStrokeController = {
  readonly active: boolean;
  readonly pointerId: number | null;
  begin: (
    pointerId: number,
    client: PaintStrokeClient,
    captureEl: Element | EventTarget | null,
    cbs: PaintStrokeCallbacks,
  ) => void;
  end: (pointerId?: number | null) => void;
  dispose: () => void;
};

function defaultMoveRoots(): EventTarget[] {
  if (typeof window === 'undefined') return [];
  const roots: EventTarget[] = [window];
  if (typeof document !== 'undefined') roots.push(document);
  return roots;
}

function eventClient(ev: { clientX: number; clientY: number }): PaintStrokeClient {
  return { x: ev.clientX, y: ev.clientY };
}

function eventPointerId(ev: { pointerId?: number }): number | null {
  return typeof ev.pointerId === 'number' ? ev.pointerId : null;
}

export function createPaintStrokeController(
  getMoveRoots: () => EventTarget[] = defaultMoveRoots,
): PaintStrokeController {
  let active = false;
  let pointerId: number | null = null;
  let lastClient: PaintStrokeClient | null = null;
  let lastRaw: PaintStrokeClient | null = null;
  let cbs: PaintStrokeCallbacks | null = null;
  let boundRoots: EventTarget[] = [];

  let onPointerMove: ((ev: PointerEvent) => void) | null = null;
  let onPointerUp: ((ev: PointerEvent) => void) | null = null;
  let onPointerCancel: ((ev: PointerEvent) => void) | null = null;
  let onMouseMove: ((ev: MouseEvent) => void) | null = null;
  let onMouseUp: ((ev: MouseEvent) => void) | null = null;
  let onBlur: (() => void) | null = null;

  const unbind = () => {
    for (const root of boundRoots) {
      if (onPointerMove) root.removeEventListener('pointermove', onPointerMove as EventListener, true);
      if (onPointerUp) root.removeEventListener('pointerup', onPointerUp as EventListener, true);
      if (onPointerCancel) {
        root.removeEventListener('pointercancel', onPointerCancel as EventListener, true);
      }
      if (onMouseMove) root.removeEventListener('mousemove', onMouseMove as EventListener, true);
      if (onMouseUp) root.removeEventListener('mouseup', onMouseUp as EventListener, true);
    }
    if (onBlur && typeof window !== 'undefined') {
      window.removeEventListener('blur', onBlur);
    }
    onPointerMove = null;
    onPointerUp = null;
    onPointerCancel = null;
    onMouseMove = null;
    onMouseUp = null;
    onBlur = null;
    boundRoots = [];
  };

  const samePointer = (evId: number | null) => {
    if (evId == null || pointerId == null) return true;
    return evId === pointerId;
  };

  const stampMove = (raw: PaintStrokeClient) => {
    if (!active || !cbs) return;
    // Dedupe pointer+mouse twins before smoothing.
    if (lastRaw && Math.hypot(raw.x - lastRaw.x, raw.y - lastRaw.y) < 0.5) {
      return;
    }
    lastRaw = raw;

    const prev = lastClient;
    const alpha = 0.85;
    const to = prev
      ? { x: prev.x + (raw.x - prev.x) * alpha, y: prev.y + (raw.y - prev.y) * alpha }
      : raw;
    if (prev && Math.hypot(to.x - prev.x, to.y - prev.y) < 0.15) {
      return;
    }
    lastClient = to;
    cbs.onSegment(prev, to);
  };

  const end = (id?: number | null) => {
    if (!active) {
      unbind();
      return;
    }
    if (id != null && pointerId != null && id !== pointerId) return;

    const endingCbs = cbs;
    active = false;
    pointerId = null;
    lastClient = null;
    lastRaw = null;
    cbs = null;
    unbind();
    endingCbs?.onEnd();
  };

  const begin = (
    id: number,
    client: PaintStrokeClient,
    _el: Element | EventTarget | null,
    nextCbs: PaintStrokeCallbacks,
  ) => {
    if (active) end(pointerId);

    active = true;
    pointerId = id;
    lastClient = client;
    lastRaw = client;
    cbs = nextCbs;

    // Intentionally NO setPointerCapture — capture loss → pointercancel → dead drag.

    onPointerMove = (ev: PointerEvent) => {
      if (!active || !samePointer(eventPointerId(ev))) return;
      stampMove(eventClient(ev));
    };

    onPointerUp = (ev: PointerEvent) => {
      if (!samePointer(eventPointerId(ev))) return;
      end(eventPointerId(ev) ?? pointerId);
    };

    onPointerCancel = (ev: PointerEvent) => {
      if (!active || !samePointer(eventPointerId(ev))) return;
      // Keep stroke alive — mouse events continue the drag.
      cbs?.onCancelNoise?.();
    };

    onMouseMove = (ev: MouseEvent) => {
      if (!active) return;
      stampMove(eventClient(ev));
    };

    onMouseUp = (ev: MouseEvent) => {
      if (!active || ev.button !== 0) return;
      end(pointerId);
    };

    onBlur = () => {
      if (active) end(pointerId);
    };

    boundRoots = getMoveRoots();
    for (const root of boundRoots) {
      root.addEventListener('pointermove', onPointerMove as EventListener, { capture: true, passive: true });
      root.addEventListener('pointerup', onPointerUp as EventListener, { capture: true, passive: true });
      root.addEventListener('pointercancel', onPointerCancel as EventListener, { capture: true, passive: true });
      root.addEventListener('mousemove', onMouseMove as EventListener, { capture: true, passive: true });
      root.addEventListener('mouseup', onMouseUp as EventListener, { capture: true, passive: true });
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('blur', onBlur);
    }

    nextCbs.onBegin(client);
  };

  return {
    get active() {
      return active;
    },
    get pointerId() {
      return pointerId;
    },
    begin,
    end,
    dispose: () => end(pointerId),
  };
}
