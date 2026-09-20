import { describe, expect, it } from 'vitest';
import type { CADMesh, Face } from '../types/cad';
import { createPrimitiveMesh } from './topology/primitives';
import { finalizeEditableMesh } from './topology/validate';
import {
  beginEdgeExtrude,
  beginVertexBevel,
  beginVertexExtrude,
  boundaryEdgeIds,
  fillTargets,
  mirrorTargets,
  orderEdgeLoops,
  resolveOperatorTargets,
  subdivideTargets,
} from './meshOperators';

const cube = () => createPrimitiveMesh('cube');
const plane = () => createPrimitiveMesh('plane');

/** Edge ids that form the boundary of a face. */
function edgesOfFace(mesh: CADMesh, face: Face): string[] {
  const n = face.vertexIds.length;
  return mesh.edges
    .filter((e) => {
      for (let i = 0; i < n; i++) {
        const a = face.vertexIds[i];
        const b = face.vertexIds[(i + 1) % n];
        if ((e.v1Id === a && e.v2Id === b) || (e.v1Id === b && e.v2Id === a)) return true;
      }
      return false;
    })
    .map((e) => e.id);
}

function faceSizes(mesh: CADMesh): number[] {
  return mesh.faces.map((f) => f.vertexIds.length).sort((a, b) => a - b);
}

describe('resolveOperatorTargets', () => {
  it('expands a face selection to its corners and boundary edges', () => {
    const mesh = cube();
    const face = mesh.faces[0];
    const targets = resolveOperatorTargets(mesh, 'face', {
      vertexIds: [],
      edgeIds: [],
      faceIds: [face.id],
    });
    expect(targets.faceIds).toEqual([face.id]);
    expect(targets.vertexIds).toHaveLength(4);
    expect(targets.edgeIds).toHaveLength(4);
  });

  it('expands a closed edge ring to the face it encloses', () => {
    const mesh = cube();
    const face = mesh.faces[0];
    const targets = resolveOperatorTargets(mesh, 'edge', {
      vertexIds: [],
      edgeIds: edgesOfFace(mesh, face),
      faceIds: [],
    });
    expect(targets.faceIds).toEqual([face.id]);
    expect(targets.vertexIds).toHaveLength(4);
  });

  it('does not let a single edge grab a whole face', () => {
    const mesh = cube();
    const edge = mesh.edges[0];
    const targets = resolveOperatorTargets(mesh, 'edge', {
      vertexIds: [],
      edgeIds: [edge.id],
      faceIds: [],
    });
    expect(targets.faceIds).toEqual([]);
    expect([...targets.vertexIds].sort()).toEqual([edge.v1Id, edge.v2Id].sort());
  });

  it('expands a vertex selection to fully enclosed edges and faces', () => {
    const mesh = cube();
    const face = mesh.faces[0];
    const targets = resolveOperatorTargets(mesh, 'vertex', {
      vertexIds: [...face.vertexIds],
      edgeIds: [],
      faceIds: [],
    });
    expect(targets.faceIds).toEqual([face.id]);
    expect(targets.edgeIds).toHaveLength(4);
  });

  it('drops stale ids left over from an earlier topology edit', () => {
    const mesh = cube();
    const targets = resolveOperatorTargets(mesh, 'face', {
      vertexIds: ['gone'],
      edgeIds: ['gone'],
      faceIds: ['gone'],
    });
    expect(targets).toEqual({ faceIds: [], edgeIds: [], vertexIds: [], mode: 'face' });
  });
});

describe('edge extrude (Blender E in edge/vertex mode)', () => {
  it('bridges an open border with a new quad strip', () => {
    const mesh = plane();
    const session = beginEdgeExtrude(mesh, [mesh.edges[0].id]);

    expect(session).not.toBeNull();
    expect(session!.mesh.faces).toHaveLength(mesh.faces.length + 1);
    expect(session!.mesh.vertices).toHaveLength(mesh.vertices.length + 2);
    expect(session!.movers).toHaveLength(2);
    // The bridged edge becomes interior; the strip contributes three new border
    // edges, so 4 - 1 + 3 = 6.
    expect(boundaryEdgeIds(session!.mesh)).toHaveLength(6);
  });

  it('returns null when nothing is selected', () => {
    expect(beginEdgeExtrude(plane(), [])).toBeNull();
  });
});

describe('vertex extrude (Blender E in vertex mode)', () => {
  it('duplicates verts with stem edges and no new faces', () => {
    const mesh = cube();
    const ids = mesh.faces[0].vertexIds;
    const session = beginVertexExtrude(mesh, ids);
    expect(session).not.toBeNull();
    expect(session!.mesh.faces).toHaveLength(mesh.faces.length);
    expect(session!.mesh.vertices).toHaveLength(mesh.vertices.length + ids.length);
    expect(session!.movers).toHaveLength(ids.length);
    expect(session!.resultFaceIds).toHaveLength(0);
    expect(session!.resultVertexIds).toHaveLength(ids.length);
    expect(session!.resultEdgeIds).toHaveLength(ids.length);
  });

  it('returns null when nothing is selected', () => {
    expect(beginVertexExtrude(cube(), [])).toBeNull();
  });
});

describe('vertex bevel (Blender Ctrl+Shift+B)', () => {
  it('chamfers the edges incident to the selected corner', () => {
    const mesh = cube();
    const session = beginVertexBevel(mesh, [mesh.vertices[0].id], 1);
    expect(session).not.toBeNull();
    expect(session!.movers.length).toBeGreaterThan(0);
    expect(session!.mesh.faces.length).toBeGreaterThan(mesh.faces.length);
  });

  it('returns null for vertices with no incident edges', () => {
    expect(beginVertexBevel(cube(), ['ghost'], 1)).toBeNull();
  });
});

describe('subdivide', () => {
  it('quad-splits a selected face and lets neighbours absorb the midpoint', () => {
    const mesh = cube();
    const targets = resolveOperatorTargets(mesh, 'face', {
      vertexIds: [],
      edgeIds: [],
      faceIds: [mesh.faces[0].id],
    });
    const result = subdivideTargets(mesh, targets, 1);
    // 4 new quads replace the face; 4 neighbours become 5-gons; opposite stays.
    expect(result.faces).toHaveLength(9);
    expect(faceSizes(result).filter((n) => n === 5)).toHaveLength(4);
    expect(boundaryEdgeIds(result)).toHaveLength(0);
  });

  it('splits the faces that touch a selected edge ring', () => {
    const mesh = cube();
    const targets = resolveOperatorTargets(mesh, 'edge', {
      vertexIds: [],
      edgeIds: edgesOfFace(mesh, mesh.faces[0]),
      faceIds: [],
    });
    // The selected face becomes 4 quads and each of the 4 neighbours splits in
    // two, which is what Blender does when edges (not faces) are selected.
    expect(subdivideTargets(mesh, targets, 1).faces).toHaveLength(13);
  });

  it('splits a single selected edge into a triangle and a quad', () => {
    const mesh = plane();
    const targets = resolveOperatorTargets(mesh, 'edge', {
      vertexIds: [],
      edgeIds: [mesh.edges[0].id],
      faceIds: [],
    });
    const result = subdivideTargets(mesh, targets, 1);
    expect(result.faces).toHaveLength(2);
    expect(faceSizes(result)).toEqual([3, 4]);
    expect(result.vertices).toHaveLength(5);
  });

  it('keeps the mesh watertight around the cut', () => {
    const mesh = plane();
    const targets = resolveOperatorTargets(mesh, 'edge', {
      vertexIds: [],
      edgeIds: [mesh.edges[0].id],
      faceIds: [],
    });
    // 4 border edges, one of them split into two -> 5
    expect(boundaryEdgeIds(subdivideTargets(mesh, targets, 1))).toHaveLength(5);
  });

  it('applies the requested number of subdivision passes', () => {
    const mesh = plane();
    const targets = resolveOperatorTargets(mesh, 'edge', {
      vertexIds: [],
      edgeIds: [mesh.edges[0].id],
      faceIds: [],
    });
    const result = subdivideTargets(mesh, targets, 2);
    expect(result.faces).toHaveLength(4);
    // Each pass splits the segments produced by the previous one.
    expect(boundaryEdgeIds(result)).toHaveLength(7);
  });

  it('is a no-op without a selection', () => {
    const mesh = cube();
    const targets = resolveOperatorTargets(mesh, 'edge', { vertexIds: [], edgeIds: [], faceIds: [] });
    expect(subdivideTargets(mesh, targets, 1)).toBe(mesh);
  });
});

describe('fill (Blender F)', () => {
  it('orders a closed edge ring', () => {
    const mesh = plane();
    const rings = orderEdgeLoops(mesh, mesh.edges.map((e) => e.id));
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(4);
  });

  it('fills a hole from the selected edges', () => {
    const source = plane();
    const open = { ...source, faces: [] };
    const targets = resolveOperatorTargets(open, 'edge', {
      vertexIds: [],
      edgeIds: open.edges.map((e) => e.id),
      faceIds: [],
    });
    expect(fillTargets(open, targets, 'edge').faces).toHaveLength(1);
  });

  it('closes the hole bounded by the selected faces', () => {
    const source = cube();
    const open = { ...source, faces: source.faces.filter((f) => f.id !== source.faces[0].id) };
    const targets = resolveOperatorTargets(open, 'face', {
      vertexIds: [],
      edgeIds: [],
      faceIds: open.faces.map((f) => f.id),
    });
    const filled = fillTargets(open, targets, 'face');
    expect(filled.faces).toHaveLength(6);
    expect(boundaryEdgeIds(filled)).toHaveLength(0);
  });

  it('builds a face from selected vertices', () => {
    const source = plane();
    const open = { ...source, faces: [] };
    const ring = source.faces[0].vertexIds;
    const filled = fillTargets(
      open,
      { faceIds: [], edgeIds: [], vertexIds: [...ring], mode: 'vertex' },
      'vertex',
    );
    expect(filled.faces).toHaveLength(1);
  });
});

describe('mirror (Blender Ctrl+M)', () => {
  it('duplicates only the selected faces, flipped across the axis', () => {
    const mesh = plane();
    const targets = resolveOperatorTargets(mesh, 'face', {
      vertexIds: [],
      edgeIds: [],
      faceIds: [mesh.faces[0].id],
    });
    const mirrored = mirrorTargets(mesh, 'x', targets);
    expect(mirrored.vertices).toHaveLength(mesh.vertices.length * 2);
    expect(mirrored.faces).toHaveLength(2);
    expect(new Set(mirrored.faces[1].vertexIds).size).toBe(4);
  });

  it('welds the vertices that already sit on the mirror plane', () => {
    // Quad straddling x = 0: corners a and d are on the plane, b and c are not.
    const mesh = finalizeEditableMesh({
      id: 'straddle',
      name: 'Straddle',
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      vertices: [
        { id: 'a', x: 0, y: 0, z: 0 },
        { id: 'b', x: 1, y: 0, z: 0 },
        { id: 'c', x: 1, y: 0, z: 1 },
        { id: 'd', x: 0, y: 0, z: 1 },
      ],
      faces: [
        {
          id: 'f',
          vertexIds: ['a', 'b', 'c', 'd'],
          uvs: [
            { u: 0, v: 0 },
            { u: 1, v: 0 },
            { u: 1, v: 1 },
            { u: 0, v: 1 },
          ],
        },
      ],
    });
    const targets = resolveOperatorTargets(mesh, 'face', {
      vertexIds: [],
      edgeIds: [],
      faceIds: ['f'],
    });
    const mirrored = mirrorTargets(mesh, 'x', targets);
    // Only b and c are duplicated; a and d stay welded on the plane.
    expect(mirrored.vertices).toHaveLength(6);
    expect(mirrored.faces).toHaveLength(2);
    const copy = mirrored.faces[1];
    expect(copy.vertexIds).toContain('a');
    expect(copy.vertexIds).toContain('d');
  });

  it('does nothing without a face selection', () => {
    const mesh = plane();
    const targets = resolveOperatorTargets(mesh, 'vertex', { vertexIds: [], edgeIds: [], faceIds: [] });
    expect(mirrorTargets(mesh, 'x', targets)).toBe(mesh);
  });
});