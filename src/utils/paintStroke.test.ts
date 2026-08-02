import { describe, expect, it } from 'vitest';
import { collectBrushTexels, smoothPaintPoint, walkUvTexels } from './paintStroke';

describe('walkUvTexels', () => {
  it('fills a continuous horizontal texel run (no gaps)', () => {
    const path = walkUvTexels(0.1, 0.5, 0.4, 0.5, 32, { skipStart: false });
    expect(path.length).toBeGreaterThan(5);
    // Every step should move at most 1 texel in chessboard distance.
    for (let i = 1; i < path.length; i++) {
      const dx = Math.abs(path[i].px - path[i - 1].px);
      const dy = Math.abs(path[i].py - path[i - 1].py);
      expect(Math.max(dx, dy)).toBeLessThanOrEqual(1);
      expect(dx + dy).toBeGreaterThan(0);
    }
  });

  it('skipStart omits the first texel so callers can chain segments', () => {
    const full = walkUvTexels(0, 0, 0.25, 0, 16, { skipStart: false });
    const skipped = walkUvTexels(0, 0, 0.25, 0, 16, { skipStart: true });
    expect(skipped.length).toBe(full.length - 1);
    expect(skipped[0]?.px).toBe(full[1]?.px);
  });
});

describe('collectBrushTexels', () => {
  it('keeps 1px brushes as a single hard texel', () => {
    expect(collectBrushTexels(4, 4, 1, true)).toEqual([{ x: 4, y: 4, strength: 1 }]);
  });

  it('builds a soft circular footprint when soft=true', () => {
    const texels = collectBrushTexels(8, 8, 5, true);
    expect(texels.length).toBeGreaterThan(5);
    const center = texels.find((t) => t.x === 8 && t.y === 8);
    expect(center?.strength).toBe(1);
    expect(texels.some((t) => t.strength < 1)).toBe(true);
  });

  it('defaults to a hard square footprint (pixel-art pencil)', () => {
    const texels = collectBrushTexels(8, 8, 3);
    expect(texels.every((t) => t.strength === 1)).toBe(true);
    expect(texels.length).toBe(9);
  });
});

describe('smoothPaintPoint', () => {
  it('blends toward the next sample', () => {
    const next = smoothPaintPoint({ x: 0, y: 0 }, { x: 10, y: 0 }, 0.5);
    expect(next.x).toBe(5);
    expect(next.y).toBe(0);
  });
});
