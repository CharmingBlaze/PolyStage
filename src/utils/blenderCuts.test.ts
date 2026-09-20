import { describe, expect, it } from 'vitest';
import { createPrimitiveMesh } from './topology/primitives';
import {
  DEFAULT_LOOP_CUT_SETTINGS,
  KNIFE_COLORS,
  LOOP_CUT_COLORS,
  LOOP_CUT_MAX_CUTS,
  adjustLoopCutCount,
  clampLoopCutCount,
  cycleKnifeAngleConstraint,
  knifeSnapT,
  knifeStartNewCut,
  knifeStatusText,
  loopCutCountFromKey,
  loopCutCrossedEdgeIds,
  loopCutFactorsFor,
  loopCutSlideFromRay,
  snapScreenAngle,
  type LoopCutSettings,
} from './blenderCuts';

const settings = (overrides: Partial<LoopCutSettings> = {}): LoopCutSettings => ({
  ...DEFAULT_LOOP_CUT_SETTINGS,
  ...overrides,
});

describe('Loop Cut: Number of Cuts', () => {
  it('clamps the count the way Blender bounds the wheel', () => {
    expect(clampLoopCutCount(0)).toBe(1);
    expect(clampLoopCutCount(2.4)).toBe(2);
    expect(clampLoopCutCount(99)).toBe(LOOP_CUT_MAX_CUTS);
    expect(clampLoopCutCount(Number.NaN)).toBe(1);
    expect(adjustLoopCutCount(1, -1)).toBe(1);
    expect(adjustLoopCutCount(1, 1)).toBe(2);
  });

  it('accepts Wheel / PageUp / PageDown and typed digits during step 1', () => {
    expect(loopCutCountFromKey('PageUp', 3)).toBe(4);
    expect(loopCutCountFromKey('PageDown', 3)).toBe(2);
    expect(loopCutCountFromKey('5', 1)).toBe(5);
    expect(loopCutCountFromKey('0', 1)).toBeNull();
    expect(loopCutCountFromKey('a', 1)).toBeNull();
  });
});

describe('Loop Cut: slide factors', () => {
  it('places a single cut wherever the mouse is', () => {
    expect(loopCutFactorsFor(settings({ count: 1, slide: 0.5 }))).toEqual([0.5]);
    expect(loopCutFactorsFor(settings({ count: 1, slide: 0.25 }))).toEqual([0.25]);
  });

  it('distributes multiple cuts evenly around the mouse position', () => {
    const two = loopCutFactorsFor(settings({ count: 2, slide: 0.5 }));
    expect(two[0]).toBeCloseTo(1 / 3, 9);
    expect(two[1]).toBeCloseTo(2 / 3, 9);

    const three = loopCutFactorsFor(settings({ count: 3, slide: 0.5 }));
    expect(three[0]).toBeCloseTo(0.25, 9);
    expect(three[1]).toBeCloseTo(0.5, 9);
    expect(three[2]).toBeCloseTo(0.75, 9);

    // A slide of 0.4 keeps the group centred on the cursor.
    const offset = loopCutFactorsFor(settings({ count: 3, slide: 0.4 }));
    expect(offset[1]).toBeCloseTo(0.4, 6);
    expect(offset[1] - offset[0]).toBeCloseTo(0.25, 6);
  });

  it('Clamp keeps the whole group inside the boundary', () => {
    const clamped = loopCutFactorsFor(settings({ count: 2, slide: 0, clamp: true }));
    expect(clamped[0]).toBeCloseTo(0.02, 6);
    // Spacing is preserved because the group was moved, not squashed.
    expect(clamped[1] - clamped[0]).toBeCloseTo(1 / 3, 6);
  });

  it('with Clamp off the outer cuts squash against the boundary', () => {
    const loose = loopCutFactorsFor(settings({ count: 2, slide: 0, clamp: false }));
    expect(loose[0]).toBeCloseTo(0.02, 6);
    expect(loose[1]).toBeLessThan(0.2);
    expect(loose[1] - loose[0]).toBeLessThan(1 / 3);
  });

  it('never leaves a factor that could invert a quad', () => {
    for (const count of [1, 2, 4, 8]) {
      for (const slide of [0, 0.17, 0.5, 0.9, 1]) {
        loopCutFactorsFor(settings({ count, slide })).forEach((factor) => {
          expect(factor).toBeGreaterThan(0);
          expect(factor).toBeLessThan(1);
        });
      }
    }
  });

  it('Even snaps the group to even spacing (E)', () => {
    const even = loopCutFactorsFor(settings({ count: 2, slide: 0.4, clamp: false, even: true }));
    expect(even[0]).toBeCloseTo(1 / 6, 9);
    expect(even[1]).toBeCloseTo(1 / 2, 9);
  });

  it('Flipped measures the even distance from the other edge (F)', () => {
    expect(loopCutFactorsFor(settings({ count: 1, slide: 0.3, clamp: false, flipped: true })))
      .toEqual([0.7]);
  });
});

describe('Loop Cut: slide follows the cursor across the surface', () => {
  const a = { x: 0, y: 0, z: 0 };
  const b = { x: 0, y: 0, z: 10 };

  it('projects the pointer ray onto the crossed edge', () => {
    expect(loopCutSlideFromRay(a, b, { x: 0, y: 5, z: 2.5 }, { x: 0, y: -1, z: 0 })).toBeCloseTo(0.25, 6);
    expect(loopCutSlideFromRay(a, b, { x: 0, y: 5, z: 7.5 }, { x: 0, y: -1, z: 0 })).toBeCloseTo(0.75, 6);
  });

  it('falls back safely for a parallel ray or a zero-length edge', () => {
    expect(loopCutSlideFromRay(a, b, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 })).toBeCloseTo(0.02, 6);
    expect(loopCutSlideFromRay(a, a, { x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 })).toBe(0.5);
  });

  it('keeps the slide inside the edge when Clamp is on', () => {
    const beyond = loopCutSlideFromRay(a, b, { x: 0, y: 5, z: 50 }, { x: 0, y: -1, z: 0 }, true);
    expect(beyond).toBeCloseTo(0.98, 6);
    const free = loopCutSlideFromRay(a, b, { x: 0, y: 5, z: 50 }, { x: 0, y: -1, z: 0 }, false);
    expect(free).toBeGreaterThan(1);
  });
});

describe('Loop Cut: crossed edge ring', () => {
  it('walks the ring of edges the cut passes through', () => {
    const cube = createPrimitiveMesh('cube');
    const ring = loopCutCrossedEdgeIds(cube, cube.edges[0].id);
    expect(ring.length).toBe(4);
    expect(ring).toContain(cube.edges[0].id);
  });

  it('returns nothing for an unknown edge', () => {
    expect(loopCutCrossedEdgeIds(createPrimitiveMesh('cube'), 'nope')).toEqual([]);
  });
});

describe('Knife: angle constraint', () => {
  it('cycles off -> 45 -> 30 -> 90 -> off on C', () => {
    expect(cycleKnifeAngleConstraint(0)).toBe(45);
    expect(cycleKnifeAngleConstraint(45)).toBe(30);
    expect(cycleKnifeAngleConstraint(30)).toBe(90);
    expect(cycleKnifeAngleConstraint(90)).toBe(0);
  });

  it('snaps the cut direction to the constraint increment', () => {
    const flat = snapScreenAngle(10, 1, 45);
    expect(Math.hypot(flat.dx, flat.dy)).toBeCloseTo(Math.hypot(10, 1), 6);
    expect(flat.dy).toBeCloseTo(0, 6);

    const diagonal = snapScreenAngle(10, 9, 45);
    expect(diagonal.dx).toBeCloseTo(diagonal.dy, 6);

    expect(snapScreenAngle(10, 1, 0)).toEqual({ dx: 10, dy: 1 });
  });
});

describe('Knife: snapping', () => {
  it('snaps to vertices near the ends and to midpoints on Shift', () => {
    expect(knifeSnapT(0.4)).toBeCloseTo(0.4, 6);
    expect(knifeSnapT(0.05)).toBe(0);
    expect(knifeSnapT(0.97)).toBe(1);
    expect(knifeSnapT(0.4, { midpoint: true })).toBe(0.5);
    expect(knifeSnapT(Number.NaN)).toBe(0.5);
  });

  it('Ctrl ignores snapping so the point lands under the cursor', () => {
    expect(knifeSnapT(0.05, { ignoreSnapping: true })).toBeCloseTo(0.05, 6);
    expect(knifeSnapT(0.4, { ignoreSnapping: true, midpoint: true })).toBeCloseTo(0.4, 6);
  });

  it('E starts a new cut with no points', () => {
    expect(knifeStartNewCut()).toEqual([]);
  });
});

describe('Blender overlay colours and HUD', () => {
  it('previews the loop cut with a yellow line', () => {
    expect(LOOP_CUT_COLORS.line).toBe(0xffee00);
  });

  it('keeps the knife overlay distinct from the loop cut', () => {
    expect(KNIFE_COLORS.line).not.toBe(LOOP_CUT_COLORS.line);
    expect(KNIFE_COLORS.point).not.toBe(KNIFE_COLORS.line);
  });

  it('reports the knife state in the status text', () => {
    const text = knifeStatusText({
      points: 2,
      angleConstraint: 45,
      cutThrough: true,
      midpointSnap: false,
      ignoreSnapping: false,
    });
    expect(text).toContain('2 points');
    expect(text).toContain('Angle 45°');
    expect(text).toContain('Cut Through');
    expect(text).not.toContain('Midpoint Snap');
  });
});