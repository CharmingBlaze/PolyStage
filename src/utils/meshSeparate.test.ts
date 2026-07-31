import { describe, expect, it } from 'vitest';
import { generatePrimitive } from './meshUtils';
import { separateLooseParts, separateSelectedFaces } from './meshSeparate';
import { combineCADMeshes } from './vectorBlockout';

describe('meshSeparate', () => {
  it('separates selected faces into a new object and leaves the rest', () => {
    const mesh = generatePrimitive('cube');
    const take = mesh.faces.slice(0, 2).map((f) => f.id);
    const result = separateSelectedFaces(mesh, take);
    expect(result).not.toBeNull();
    expect(result!.separated).toHaveLength(1);
    expect(result!.separated[0].faces).toHaveLength(2);
    expect(result!.remaining).not.toBeNull();
    expect(result!.remaining!.faces).toHaveLength(mesh.faces.length - 2);
    // New object uses fresh vertex ids (no shared topology).
    const remIds = new Set(result!.remaining!.vertices.map((v) => v.id));
    expect(result!.separated[0].vertices.every((v) => !remIds.has(v.id))).toBe(true);
  });

  it('removes the original when separating all faces', () => {
    const mesh = generatePrimitive('cube');
    const result = separateSelectedFaces(
      mesh,
      mesh.faces.map((f) => f.id),
    );
    expect(result).not.toBeNull();
    expect(result!.remaining).toBeNull();
    expect(result!.separated[0].faces).toHaveLength(mesh.faces.length);
    expect(result!.separated[0].id).not.toBe(mesh.id);
  });

  it('separates loose mesh islands into parts', () => {
    const a = generatePrimitive('cube');
    const b = generatePrimitive('cube');
    b.vertices = b.vertices.map((v) => ({ ...v, x: v.x + 3 }));
    const combined = combineCADMeshes([a, b], 'Twin');
    const result = separateLooseParts(combined);
    expect(result).not.toBeNull();
    expect(result!.separated.length).toBeGreaterThanOrEqual(1);
    const totalFaces =
      (result!.remaining?.faces.length || 0) +
      result!.separated.reduce((n, m) => n + m.faces.length, 0);
    expect(totalFaces).toBe(combined.faces.length);
  });
});
