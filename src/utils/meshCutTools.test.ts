import { describe, it, expect } from 'vitest';
import { createPrimitiveMesh } from './topology/primitives';
import {
  findEdgeLoop,
  applyLoopCut,
  applyKnifeCut,
  loopCutFactors,
  type KnifeHit,
} from './meshCutTools';
import { edgeKey } from './topology/ids';

describe('meshCutTools', () => {
  it('finds a closed 4-edge loop on a cube', () => {
    const cube = createPrimitiveMesh('cube');
    // Pick a vertical-ish edge: any edge works; loop through quads should be 4
    const edge = cube.edges[0];
    expect(edge).toBeTruthy();
    const loop = findEdgeLoop(cube, edge!.id);
    expect(loop.length).toBe(4);
    expect(new Set(loop).size).toBe(4);
  });

  it('loop cut at 0.5 increases face count on a cube', () => {
    const cube = createPrimitiveMesh('cube');
    const loop = findEdgeLoop(cube, cube.edges[0]!.id);
    const cut = applyLoopCut(cube, loop, [0.5]);
    expect(cut.faces.length).toBeGreaterThan(cube.faces.length);
    expect(cut.vertices.length).toBeGreaterThan(cube.vertices.length);
    // All faces still valid polygons
    cut.faces.forEach((f) => expect(f.vertexIds.length).toBeGreaterThanOrEqual(3));
  });

  it('loopCutFactors spaces multiple cuts', () => {
    expect(loopCutFactors(1)).toEqual([0.5]);
    expect(loopCutFactors(3)).toEqual([0.25, 0.5, 0.75]);
  });

  it('knife splits a quad between two opposite edge midpoints', () => {
    const cube = createPrimitiveMesh('cube');
    const face = cube.faces.find((f) => f.vertexIds.length === 4)!;
    const n = face.vertexIds.length;
    const e0 = cube.edges.find(
      (e) => edgeKey(e.v1Id, e.v2Id) === edgeKey(face.vertexIds[0], face.vertexIds[1]),
    )!;
    const e2 = cube.edges.find(
      (e) => edgeKey(e.v1Id, e.v2Id) === edgeKey(face.vertexIds[2], face.vertexIds[3]),
    )!;
    const vmap = new Map(cube.vertices.map((v) => [v.id, v]));
    const mid = (e: typeof e0) => {
      const a = vmap.get(e.v1Id)!;
      const b = vmap.get(e.v2Id)!;
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
    };
    const hits: KnifeHit[] = [
      { faceId: face.id, edgeId: e0.id, t: 0.5, point: mid(e0) },
      { faceId: face.id, edgeId: e2.id, t: 0.5, point: mid(e2) },
    ];
    const cut = applyKnifeCut(cube, hits);
    expect(cut.faces.length).toBe(cube.faces.length + 1); // one face → two
    expect(cut.faces.some((f) => f.id === face.id)).toBe(false);
  });
});
