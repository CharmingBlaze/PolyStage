import { describe, expect, it, beforeEach } from 'vitest';
import {
  isPanGesture,
  isPenEraser,
  isPrimaryAction,
  notePointerActivity,
  paintPressure,
  pointerKind,
  pointerSnapPx,
  pressureBrushSize,
  resetPointerInputForTests,
  shouldIgnorePointer,
} from './pointerInput';

beforeEach(() => resetPointerInputForTests());

describe('pointerKind', () => {
  it('classifies pen, mouse, and touch', () => {
    expect(pointerKind({ pointerType: 'pen' })).toBe('pen');
    expect(pointerKind({ pointerType: 'mouse' })).toBe('mouse');
    expect(pointerKind({ pointerType: 'touch' })).toBe('touch');
  });
});

describe('buttons', () => {
  it('treats mouse LMB and pen tip as primary', () => {
    expect(isPrimaryAction({ button: 0, pointerType: 'mouse' })).toBe(true);
    expect(isPrimaryAction({ button: 0, pointerType: 'pen' })).toBe(true);
    expect(isPrimaryAction({ button: 2, pointerType: 'mouse' })).toBe(false);
  });

  it('detects the Windows pen eraser button', () => {
    expect(isPenEraser({ pointerType: 'pen', button: 5 })).toBe(true);
    expect(isPenEraser({ pointerType: 'pen', buttons: 32 })).toBe(true);
    expect(isPenEraser({ pointerType: 'mouse', button: 5 })).toBe(false);
  });

  it('pans on RMB, MMB, and Space+LMB', () => {
    expect(isPanGesture({ button: 2 })).toBe(true);
    expect(isPanGesture({ button: 1 })).toBe(true);
    expect(isPanGesture({ button: 0, getModifierState: (k) => k === 'Space' })).toBe(true);
    expect(isPanGesture({ button: 0 })).toBe(false);
  });
});

describe('pressure', () => {
  it('uses full pressure for a mouse so click-drag does not thin out', () => {
    expect(paintPressure({ pointerType: 'mouse', pressure: 0.5 })).toBe(1);
    expect(paintPressure({ pointerType: 'mouse', pressure: 0 })).toBe(1);
  });

  it('passes through stylus pressure with a floor so a tap still stamps', () => {
    expect(paintPressure({ pointerType: 'pen', pressure: 0.8 })).toBeCloseTo(0.8);
    expect(paintPressure({ pointerType: 'pen', pressure: 0 })).toBeGreaterThan(0);
  });

  it('scales brush size down for a light pen press', () => {
    expect(pressureBrushSize(8, 1)).toBe(8);
    expect(pressureBrushSize(8, 0.5)).toBe(5);
    expect(pressureBrushSize(1, 0.2)).toBe(1);
  });
});

describe('palm rejection', () => {
  it('ignores a finger while a stylus is down', () => {
    notePointerActivity({ pointerType: 'pen', pointerId: 7, type: 'pointerdown' });
    expect(shouldIgnorePointer({ pointerType: 'touch', pointerId: 3, isPrimary: true })).toBe(true);
    expect(shouldIgnorePointer({ pointerType: 'pen', pointerId: 7 })).toBe(false);
  });

  it('ignores non-primary touches', () => {
    expect(shouldIgnorePointer({ pointerType: 'touch', isPrimary: false })).toBe(true);
  });
});

describe('snap radius', () => {
  it('gives stylus and touch a larger handle than a mouse', () => {
    expect(pointerSnapPx({ pointerType: 'mouse' })).toBeLessThan(pointerSnapPx({ pointerType: 'pen' }));
    expect(pointerSnapPx({ pointerType: 'pen' })).toBeLessThan(pointerSnapPx({ pointerType: 'touch' }));
  });
});
