import { describe, it, expect } from 'vitest';
import { generatePrimitive } from './meshUtils';
import { beginExtrude, beginInset, beginBevel, applyModalAmount } from './modalMeshOps';

describe('modal mesh sessions (Blender-style)', () => {
  it('extrude builds once then only moves verts', () => {
    const cube = generatePrimitive('cube');
    const faceId = cube.faces[0].id;
    const session = beginExtrude(cube, [faceId]);
    expect(session).toBeTruthy();
    const zero = applyModalAmount(session!, 0);
    const deep = applyModalAmount(session!, 0.5);
    expect(zero.mesh.faces.length).toBe(deep.mesh.faces.length);
    expect(zero.mesh.vertices.map((v) => v.id).join()).toBe(deep.mesh.vertices.map((v) => v.id).join());
    const moved = deep.mesh.vertices.filter((v) => session!.movers.some((m) => m.id === v.id));
    expect(moved.length).toBeGreaterThan(0);
    expect(moved.some((v) => Math.abs(v.x) + Math.abs(v.y) + Math.abs(v.z) > 0.01)).toBe(true);
  });

  it('region inset shares boundary movers only', () => {
    const cube = generatePrimitive('cube');
    const f0 = cube.faces[0];
    const session = beginInset(cube, [f0.id]);
    expect(session).toBeTruthy();
    const inset = applyModalAmount(session!, 0.2);
    expect(inset.mesh.faces.length).toBeGreaterThan(cube.faces.length);
    expect(session!.movers.length).toBe(f0.vertexIds.length);
    const moved = inset.movers.map((m) => {
      const v = inset.mesh.vertices.find((x) => x.id === m.id)!;
      return Math.hypot(v.x - m.ox, v.y - m.oy, v.z - m.oz);
    });
    expect(Math.min(...moved)).toBeGreaterThan(0.05);
  });

  it('bevel session supports amount from movers', () => {
    const cube = generatePrimitive('cube');
    const edgeId = cube.edges[0].id;
    const session = beginBevel(cube, [edgeId], [], 1);
    expect(session).toBeTruthy();
    const a = applyModalAmount(session!, 0.1);
    expect(a.mesh.faces.length).toBeGreaterThan(cube.faces.length);
  });

  it('face bevel resolves to edge chamfer (not inset)', () => {
    const cube = generatePrimitive('cube');
    const faceId = cube.faces[0].id;
    const session = beginBevel(cube, [], [faceId], 1);
    expect(session).toBeTruthy();
    expect(session!.edgeIds!.length).toBeGreaterThan(0);
    const a = applyModalAmount(session!, 0.12);
    expect(a.mesh.faces.length).toBeGreaterThan(cube.faces.length);
    expect(a.movers.length).toBeGreaterThan(0);
  });
});
