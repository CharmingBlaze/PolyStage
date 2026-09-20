import { describe, expect, it } from 'vitest';
import { amountAlongProjectedAxis } from './axisGrab';

describe('amountAlongProjectedAxis', () => {
  it('maps a 100px drag along a 100px projected unit axis to 1', () => {
    const origin = { x: 0, y: 0 };
    const tip = { x: 0.2, y: 0 };
    const viewW = 1000;
    const viewH = 1000;
    const start = { x: 500, y: 500 };
    const now = { x: 500 + 100, y: 500 };
    const amount = amountAlongProjectedAxis(origin, tip, start, now, viewW, viewH);
    expect(amount).toBeCloseTo(1, 5);
  });

  it('ignores motion perpendicular to the projected axis', () => {
    const origin = { x: 0, y: 0 };
    const tip = { x: 0.2, y: 0 };
    const amount = amountAlongProjectedAxis(origin, tip, { x: 500, y: 500 }, { x: 500, y: 400 }, 1000, 1000);
    expect(amount).toBeCloseTo(0, 5);
  });
});
