import { describe, expect, it, vi } from 'vitest';
import { createPaintStrokeController } from './paintStrokeController';

function makeCaptureEl() {
  const el = new EventTarget() as EventTarget & {
    setPointerCapture: ReturnType<typeof vi.fn>;
    releasePointerCapture: ReturnType<typeof vi.fn>;
  };
  el.setPointerCapture = vi.fn();
  el.releasePointerCapture = vi.fn();
  return el;
}

function pointerEvent(
  type: string,
  init: { pointerId: number; clientX: number; clientY: number },
): Event {
  const ev = new Event(type, { bubbles: true, cancelable: true }) as Event & {
    pointerId: number;
    clientX: number;
    clientY: number;
  };
  ev.pointerId = init.pointerId;
  ev.clientX = init.clientX;
  ev.clientY = init.clientY;
  return ev;
}

function mouseEvent(
  type: string,
  init: { clientX: number; clientY: number; button?: number },
): Event {
  const ev = new Event(type, { bubbles: true, cancelable: true }) as Event & {
    clientX: number;
    clientY: number;
    button: number;
  };
  ev.clientX = init.clientX;
  ev.clientY = init.clientY;
  ev.button = init.button ?? 0;
  return ev;
}

describe('createPaintStrokeController', () => {
  it('fires begin, move segments, then end on pointerup', () => {
    const root = new EventTarget();
    const el = makeCaptureEl();
    const onBegin = vi.fn();
    const onSegment = vi.fn();
    const onEnd = vi.fn();
    const ctl = createPaintStrokeController(() => [root]);

    ctl.begin(7, { x: 10, y: 20 }, el, { onBegin, onSegment, onEnd });
    expect(ctl.active).toBe(true);
    expect(onBegin).toHaveBeenCalledWith({ x: 10, y: 20 });
    expect(el.setPointerCapture).not.toHaveBeenCalled();

    root.dispatchEvent(pointerEvent('pointermove', { pointerId: 7, clientX: 40, clientY: 20 }));
    expect(onSegment).toHaveBeenCalled();
    expect(onSegment.mock.calls[0][1].x).toBeGreaterThan(10);

    root.dispatchEvent(pointerEvent('pointerup', { pointerId: 7, clientX: 40, clientY: 20 }));
    expect(ctl.active).toBe(false);
    expect(onEnd).toHaveBeenCalledTimes(1);

    onSegment.mockClear();
    root.dispatchEvent(pointerEvent('pointermove', { pointerId: 7, clientX: 80, clientY: 20 }));
    expect(onSegment).not.toHaveBeenCalled();
    ctl.dispose();
  });

  it('ignores moves from a different pointer id', () => {
    const root = new EventTarget();
    const el = makeCaptureEl();
    const onSegment = vi.fn();
    const ctl = createPaintStrokeController(() => [root]);
    ctl.begin(1, { x: 0, y: 0 }, el, {
      onBegin: () => {},
      onSegment,
      onEnd: () => {},
    });
    root.dispatchEvent(pointerEvent('pointermove', { pointerId: 99, clientX: 50, clientY: 0 }));
    expect(onSegment).not.toHaveBeenCalled();
    ctl.dispose();
  });

  it('survives pointercancel and continues via mousemove (dots-only fix)', () => {
    const root = new EventTarget();
    const el = makeCaptureEl();
    const onSegment = vi.fn();
    const onEnd = vi.fn();
    const onCancelNoise = vi.fn();
    const ctl = createPaintStrokeController(() => [root]);
    ctl.begin(3, { x: 0, y: 0 }, el, {
      onBegin: () => {},
      onSegment,
      onEnd,
      onCancelNoise,
    });

    root.dispatchEvent(pointerEvent('pointermove', { pointerId: 3, clientX: 8, clientY: 0 }));
    expect(onSegment).toHaveBeenCalledTimes(1);

    root.dispatchEvent(pointerEvent('pointercancel', { pointerId: 3, clientX: 8, clientY: 0 }));
    expect(ctl.active).toBe(true);
    expect(onEnd).not.toHaveBeenCalled();
    expect(onCancelNoise).toHaveBeenCalledTimes(1);

    onSegment.mockClear();
    root.dispatchEvent(mouseEvent('mousemove', { clientX: 40, clientY: 0 }));
    root.dispatchEvent(mouseEvent('mousemove', { clientX: 80, clientY: 0 }));
    expect(onSegment.mock.calls.length).toBeGreaterThanOrEqual(2);

    root.dispatchEvent(mouseEvent('mouseup', { clientX: 80, clientY: 0, button: 0 }));
    expect(ctl.active).toBe(false);
    expect(onEnd).toHaveBeenCalledTimes(1);
    ctl.dispose();
  });

  it('falls back to mousemove when pointermove never arrives', () => {
    const root = new EventTarget();
    const el = makeCaptureEl();
    const onSegment = vi.fn();
    const onEnd = vi.fn();
    const ctl = createPaintStrokeController(() => [root]);
    ctl.begin(1, { x: 0, y: 0 }, el, {
      onBegin: () => {},
      onSegment,
      onEnd,
    });

    root.dispatchEvent(mouseEvent('mousemove', { clientX: 30, clientY: 0 }));
    expect(onSegment).toHaveBeenCalled();
    root.dispatchEvent(mouseEvent('mouseup', { clientX: 30, clientY: 0, button: 0 }));
    expect(ctl.active).toBe(false);
    expect(onEnd).toHaveBeenCalledTimes(1);
    ctl.dispose();
  });

  it('dedupes identical pointer+mouse coords to a single segment', () => {
    const root = new EventTarget();
    const el = makeCaptureEl();
    const onSegment = vi.fn();
    const ctl = createPaintStrokeController(() => [root]);
    ctl.begin(1, { x: 0, y: 0 }, el, {
      onBegin: () => {},
      onSegment,
      onEnd: () => {},
    });

    root.dispatchEvent(pointerEvent('pointermove', { pointerId: 1, clientX: 20, clientY: 0 }));
    root.dispatchEvent(mouseEvent('mousemove', { clientX: 20, clientY: 0 }));
    expect(onSegment).toHaveBeenCalledTimes(1);
    ctl.dispose();
  });

  it('commits multiple move segments across a hold-drag', () => {
    const root = new EventTarget();
    const el = makeCaptureEl();
    const stamps: number[] = [];
    const ctl = createPaintStrokeController(() => [root]);

    ctl.begin(1, { x: 0, y: 0 }, el, {
      onBegin: () => {},
      onSegment: (_from, to) => {
        stamps.push(to.x);
      },
      onEnd: () => {},
    });

    for (let x = 10; x <= 100; x += 10) {
      root.dispatchEvent(pointerEvent('pointermove', { pointerId: 1, clientX: x, clientY: 0 }));
    }
    root.dispatchEvent(pointerEvent('pointerup', { pointerId: 1, clientX: 100, clientY: 0 }));

    expect(stamps.length).toBeGreaterThanOrEqual(5);
    expect(stamps[stamps.length - 1]).toBeGreaterThan(50);
    expect(ctl.active).toBe(false);
    ctl.dispose();
  });
});
