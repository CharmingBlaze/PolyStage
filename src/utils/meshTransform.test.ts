import { describe, expect, it } from 'vitest';
import { generatePrimitive, flipMesh, rotateMesh90 } from './meshUtils';

describe('flipMesh / rotateMesh90', () => {
  it('flips vertices across X and reverses winding', () => {
    const cube = generatePrimitive('cube');
    const flipped = flipMesh(cube, 'x');
    const orig = cube.vertices.find((v) => v.x > 0)!;
    const match = flipped.vertices.find((v) => v.id === orig.id)!;
    expect(match.x).toBeCloseTo(-orig.x, 5);
    expect(flipped.faces[0].vertexIds).toEqual([...cube.faces[0].vertexIds].reverse());
  });

  it('rotates 90 degrees around Y about the selection center', () => {
    const cube = generatePrimitive('cube');
    const rotated = rotateMesh90(cube, 'y', false);
    expect(rotated.vertices).toHaveLength(cube.vertices.length);
    const moved = rotated.vertices.some((v, i) => Math.abs(v.x - cube.vertices[i].x) > 1e-6);
    expect(moved).toBe(true);
  });
});
