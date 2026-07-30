import { describe, expect, it } from 'vitest';
import { buildThreeGeometry, createEdgesFromFaces, extrudeFaces, generatePrimitive } from '../meshUtils';
import { getMeshTopologyStats } from './stats';
import { makeEdgeId } from './ids';

describe('cube topology', () => {
  const cube = generatePrimitive('cube');
  const stats = getMeshTopologyStats(cube);

  it('has 8 vertices, 12 edges, 6 quads, 12 render triangles', () => {
    expect(stats.vertices).toBe(8);
    expect(stats.edges).toBe(12);
    expect(stats.polygons).toBe(6);
    expect(stats.quads).toBe(6);
    expect(stats.triangles).toBe(12);
  });

  it('every logical face has 4 corners', () => {
    cube.faces.forEach((f) => expect(f.vertexIds.length).toBe(4));
  });

  it('has no diagonal logical edges', () => {
    // Cube silhouette edges only — length of each edge should be side length (1)
    const vMap = new Map(cube.vertices.map((v) => [v.id, v]));
    cube.edges.forEach((e) => {
      const a = vMap.get(e.v1Id)!;
      const b = vMap.get(e.v2Id)!;
      const len = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      expect(len).toBeCloseTo(1, 5);
    });
  });

  it('maps each face to exactly 2 render triangles', () => {
    const geo = buildThreeGeometry(cube);
    const map = geo.userData.faceToTriangleIndices as Map<string, number[]>;
    expect(map.size).toBe(6);
    map.forEach((tris) => expect(tris.length).toBe(2));
    expect((geo.userData.triangleToFaceId as string[]).length).toBe(12);
  });

  it('UV loops are quads', () => {
    cube.faces.forEach((f) => {
      expect(f.uvs.length).toBe(4);
    });
  });
});

describe('plane topology', () => {
  const plane = generatePrimitive('plane');
  const stats = getMeshTopologyStats(plane);

  it('is a single quad', () => {
    expect(stats.vertices).toBe(4);
    expect(stats.edges).toBe(4);
    expect(stats.polygons).toBe(1);
    expect(stats.triangles).toBe(2);
  });
});

describe('cylinder topology', () => {
  const cyl = generatePrimitive('cylinder');
  const stats = getMeshTopologyStats(cyl);

  it('has N side quads + 2 n-gon caps', () => {
    expect(stats.quads).toBe(8);
    expect(stats.ngons).toBe(2);
    expect(stats.polygons).toBe(10);
    // No triangulation diagonals in edges: edge count = 8*4/2 sides wait —
    // sides: 8 vertical + 8 top rim + 8 bottom rim = 24 edges (shared)
    expect(stats.edges).toBe(24);
  });
});

describe('cone topology', () => {
  const cone = generatePrimitive('cone');
  it('has N side triangles + 1 base n-gon', () => {
    const stats = getMeshTopologyStats(cone);
    expect(stats.tris).toBe(8);
    expect(stats.ngons).toBe(1);
    expect(stats.polygons).toBe(9);
  });
});

describe('extrusion', () => {
  it('extrudes one cube face into cap + 4 sides', () => {
    const cube = generatePrimitive('cube');
    const faceId = cube.faces[0].id;
    const next = extrudeFaces(cube, [faceId], 0.5);
    const stats = getMeshTopologyStats(next);
    // 5 remaining original + 1 cap + 4 sides = 10
    expect(stats.polygons).toBe(10);
    expect(stats.quads).toBe(10);
  });

  it('region extrude of two adjacent faces has no internal wall', () => {
    const cube = generatePrimitive('cube');
    // Pick two faces that share an edge
    const f0 = cube.faces[0];
    const neighbor = cube.faces.find((f) => {
      if (f.id === f0.id) return false;
      const set = new Set(f0.vertexIds);
      let shared = 0;
      for (let i = 0; i < f.vertexIds.length; i++) {
        const a = f.vertexIds[i];
        const b = f.vertexIds[(i + 1) % f.vertexIds.length];
        if (set.has(a) && set.has(b)) shared++;
      }
      return shared >= 1;
    })!;
    expect(neighbor).toBeTruthy();
    const next = extrudeFaces(cube, [f0.id, neighbor.id], 0.5);
    // outer boundary for two adjacent cube faces: 6 edges → 6 side quads + 2 caps + 4 remaining = 12
    expect(getMeshTopologyStats(next).polygons).toBe(12);
  });
});

describe('edges from faces', () => {
  it('uses stable edge ids', () => {
    const a = 'aaa';
    const b = 'bbb';
    expect(makeEdgeId(a, b)).toBe(makeEdgeId(b, a));
    const faces = [
      { id: 'f', vertexIds: [a, b, 'ccc'], uvs: [{ u: 0, v: 0 }, { u: 1, v: 0 }, { u: 0.5, v: 1 }] },
    ];
    const edges = createEdgesFromFaces(faces);
    expect(edges).toHaveLength(3);
  });
});
