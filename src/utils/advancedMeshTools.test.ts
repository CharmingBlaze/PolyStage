import { describe, it, expect } from 'vitest';
import { createPrimitiveMesh } from './topology/primitives';
import {
  subdivideFaces,
  mergeSelectedVertices,
  fillSelectedVerticesFace,
  loopCutMesh,
  bevelSelectedEdges,
} from './advancedMeshTools';

describe('Advanced Mesh Tools (Blockbench / Blender style)', () => {
  it('subdivides quad faces into 4 sub-quads', () => {
    const cube = createPrimitiveMesh('cube');
    const initialFaceCount = cube.faces.length;
    const subdivided = subdivideFaces(cube);

    expect(subdivided.faces.length).toBe(initialFaceCount * 4);
    expect(subdivided.vertices.length).toBeGreaterThan(cube.vertices.length);
  });

  it('merges selected vertices to centroid', () => {
    const cube = createPrimitiveMesh('cube');
    const targetVerts = [cube.vertices[0].id, cube.vertices[1].id];
    const merged = mergeSelectedVertices(cube, targetVerts, 'center');

    expect(merged.vertices.length).toBe(cube.vertices.length - 1);
  });

  it('fills face from selected vertices (F2)', () => {
    const plane = createPrimitiveMesh('plane');
    const newVerts = [
      { id: 'v1', x: 0, y: 5, z: 0 },
      { id: 'v2', x: 1, y: 5, z: 0 },
      { id: 'v3', x: 1, y: 5, z: 1 },
    ];
    const meshWithVerts = {
      ...plane,
      vertices: [...plane.vertices, ...newVerts],
    };
    const filled = fillSelectedVerticesFace(meshWithVerts, ['v1', 'v2', 'v3']);

    expect(filled.faces.length).toBe(plane.faces.length + 1);
  });

  it('performs loop cut on edge connected faces', () => {
    const cube = createPrimitiveMesh('cube');
    const initialFaces = cube.faces.length;
    const cut = loopCutMesh(cube, cube.edges[0]?.id);

    expect(cut.faces.length).toBeGreaterThan(initialFaces);
  });

  it('bevels selected edges', () => {
    const cube = createPrimitiveMesh('cube');
    const initialFaces = cube.faces.length;
    const beveled = bevelSelectedEdges(cube, [cube.edges[0]?.id || '']);

    expect(beveled.faces.length).toBeGreaterThan(initialFaces);
  });
});
