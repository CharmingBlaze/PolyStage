import { describe, expect, it } from 'vitest';
import type { CADMesh } from '../types/cad';
import { generatePrimitive } from './meshUtils';
import { finalizeEditableMesh } from './topology/validate';
import { createEdgesFromFaces } from './topology/edges';
import {
  applySelectionIntent,
  buildTopologyIndex,
  convertSelection,
  edgesFullyInVertices,
  edgesOfFaces,
  facesFullyInVertices,
  growSelection,
  intentFromModifiers,
  invertSelection,
  pruneSelection,
  selectEdgeLoop,
  selectEdgeRing,
  selectLinked,
  selectionCounts,
  shrinkSelection,
  verticesOfEdges,
  verticesOfFaces,
} from './selection';

const cube = generatePrimitive('cube');

/** Two disjoint quads so the "linked" tests have more than one island. */
function twoIslands(): CADMesh {
  const mk = (prefix: string, offsetX: number) => ({
    vertices: [
      { id: `${prefix}0`, x: offsetX, y: 0, z: 0 },
      { id: `${prefix}1`, x: offsetX + 1, y: 0, z: 0 },
      { id: `${prefix}2`, x: offsetX + 1, y: 1, z: 0 },
      { id: `${prefix}3`, x: offsetX, y: 1, z: 0 },
    ],
    face: {
      id: `${prefix}f`,
      vertexIds: [`${prefix}0`, `${prefix}1`, `${prefix}2`, `${prefix}3`],
      uvs: [
        { u: 0, v: 0 },
        { u: 1, v: 0 },
        { u: 1, v: 1 },
        { u: 0, v: 1 },
      ],
    },
  });
  const a = mk('a', 0);
  const b = mk('b', 10);
  const faces = [a.face, b.face];
  return finalizeEditableMesh({
    id: 'islands',
    name: 'Islands',
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    vertices: [...a.vertices, ...b.vertices],
    faces,
    edges: createEdgesFromFaces(faces),
  });
}

/** A 3x1 strip of quads, used for ring/loop walks. */
function quadStrip(count: number): CADMesh {
  const vertices = [];
  for (let i = 0; i <= count; i++) {
    vertices.push({ id: `v${i}b`, x: i, y: 0, z: 0 });
    vertices.push({ id: `v${i}t`, x: i, y: 1, z: 0 });
  }
  const faces = [];
  for (let i = 0; i < count; i++) {
    faces.push({
      id: `f${i}`,
      vertexIds: [`v${i}b`, `v${i + 1}b`, `v${i + 1}t`, `v${i}t`],
      uvs: [
        { u: 0, v: 0 },
        { u: 1, v: 0 },
        { u: 1, v: 1 },
        { u: 0, v: 1 },
      ],
    });
  }
  return finalizeEditableMesh({
    id: 'strip',
    name: 'Strip',
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    vertices,
    faces,
    edges: createEdgesFromFaces(faces),
  });
}

describe('topology index', () => {
  it('indexes a cube edge as shared by exactly two faces', () => {
    const index = buildTopologyIndex(cube);
    expect(index.edgeById.size).toBe(12);
    expect(index.faceById.size).toBe(6);
    index.facesByEdgeKey.forEach((faces) => expect(faces.length).toBe(2));
  });

  it('gives every cube vertex 3 edges and 3 faces', () => {
    const index = buildTopologyIndex(cube);
    cube.vertices.forEach((v) => {
      expect(index.edgesByVertex.get(v.id)!.length).toBe(3);
      expect(index.facesByVertex.get(v.id)!.length).toBe(3);
    });
  });
});

describe('component derivation', () => {
  it('a cube face has 4 corner vertices and 4 boundary edges', () => {
    const face = cube.faces[0];
    expect(verticesOfFaces(cube, [face.id])).toHaveLength(4);
    expect(edgesOfFaces(cube, [face.id])).toHaveLength(4);
  });

  it('an edge yields its two endpoints', () => {
    const edge = cube.edges[0];
    expect(verticesOfEdges(cube, [edge.id]).sort()).toEqual([edge.v1Id, edge.v2Id].sort());
  });

  it('only counts edges whose both ends are selected', () => {
    const face = cube.faces[0];
    const corners = verticesOfFaces(cube, [face.id]);
    // All 4 boundary edges qualify; edges leaving the face do not.
    expect(edgesFullyInVertices(cube, corners)).toHaveLength(4);
    expect(edgesFullyInVertices(cube, corners.slice(0, 1))).toHaveLength(0);
  });

  it('only counts faces whose every corner is selected', () => {
    const face = cube.faces[0];
    const corners = verticesOfFaces(cube, [face.id]);
    expect(facesFullyInVertices(cube, corners)).toEqual([face.id]);
    expect(facesFullyInVertices(cube, corners.slice(0, 3))).toEqual([]);
  });
});

describe('convertSelection', () => {
  const face = cube.faces[0];

  it('is a no-op when the mode does not change', () => {
    const sel = { vertexIds: ['a'], edgeIds: [], faceIds: [] };
    expect(convertSelection(cube, 'vertex', 'vertex', sel)).toBe(sel);
  });

  it('widens face -> vertex to the face corners', () => {
    const next = convertSelection(cube, 'face', 'vertex', {
      vertexIds: [],
      edgeIds: [],
      faceIds: [face.id],
    });
    expect(next.vertexIds).toHaveLength(4);
    expect(next.faceIds).toEqual([]);
  });

  it('keeps the face boundary when going face -> edge', () => {
    const next = convertSelection(cube, 'face', 'edge', {
      vertexIds: [],
      edgeIds: [],
      faceIds: [face.id],
    });
    expect(next.edgeIds.sort()).toEqual(edgesOfFaces(cube, [face.id]).sort());
  });

  it('round-trips face -> vertex -> face without losing the face', () => {
    const toVerts = convertSelection(cube, 'face', 'vertex', {
      vertexIds: [],
      edgeIds: [],
      faceIds: [face.id],
    });
    const back = convertSelection(cube, 'vertex', 'face', toVerts);
    expect(back.faceIds).toEqual([face.id]);
  });

  it('narrows vertex -> face only for fully enclosed faces', () => {
    const partial = verticesOfFaces(cube, [face.id]).slice(0, 2);
    const next = convertSelection(cube, 'vertex', 'face', {
      vertexIds: partial,
      edgeIds: [],
      faceIds: [],
    });
    expect(next.faceIds).toEqual([]);
  });

  it('returns an empty selection when there is nothing to carry over', () => {
    const next = convertSelection(cube, 'face', 'vertex', {
      vertexIds: [],
      edgeIds: [],
      faceIds: [],
    });
    expect(next).toEqual({ vertexIds: [], edgeIds: [], faceIds: [] });
  });
});

describe('invertSelection', () => {
  it('returns the complement in mesh order', () => {
    const first = cube.vertices[0].id;
    const inverted = invertSelection(cube, 'vertex', [first]);
    expect(inverted).toHaveLength(cube.vertices.length - 1);
    expect(inverted).not.toContain(first);
    expect(inverted).toEqual(cube.vertices.slice(1).map((v) => v.id));
  });

  it('inverting twice restores the original set', () => {
    const start = [cube.faces[0].id, cube.faces[2].id];
    const once = invertSelection(cube, 'face', start);
    const twice = invertSelection(cube, 'face', once);
    expect(twice.sort()).toEqual(start.sort());
  });
});

describe('modifier intent', () => {
  it('maps plain / shift / ctrl / alt consistently', () => {
    expect(intentFromModifiers({})).toBe('replace');
    expect(intentFromModifiers({ shiftKey: true })).toBe('add');
    expect(intentFromModifiers({ ctrlKey: true })).toBe('remove');
    expect(intentFromModifiers({ metaKey: true })).toBe('remove');
    expect(intentFromModifiers({ altKey: true })).toBe('remove');
  });

  it('lets remove win over add when both are held', () => {
    expect(intentFromModifiers({ shiftKey: true, ctrlKey: true })).toBe('remove');
  });

  it('applies each intent to the current selection', () => {
    expect(applySelectionIntent(['a', 'b'], ['c'], 'replace')).toEqual(['c']);
    expect(applySelectionIntent(['a'], ['b'], 'add').sort()).toEqual(['a', 'b']);
    expect(applySelectionIntent(['a', 'b'], ['b'], 'remove')).toEqual(['a']);
    expect(applySelectionIntent(['a', 'b'], ['b', 'c'], 'toggle').sort()).toEqual(['a', 'c']);
  });

  it('respects a supplied ordering', () => {
    const out = applySelectionIntent(['c'], ['a'], 'add', ['a', 'b', 'c']);
    expect(out).toEqual(['a', 'c']);
  });
});

describe('grow / shrink', () => {
  it('growing one cube vertex reaches its 3 neighbours', () => {
    const v = cube.vertices[0].id;
    expect(growSelection(cube, 'vertex', [v])).toHaveLength(4);
  });

  it('growing a cube face selects every face sharing a corner', () => {
    const grown = growSelection(cube, 'face', [cube.faces[0].id]);
    // On a cube every other face touches the start face's corners except the opposite one.
    expect(grown).toHaveLength(5);
  });

  it('grow then shrink returns to the original face', () => {
    const start = [cube.faces[0].id];
    const grown = growSelection(cube, 'face', start);
    expect(shrinkSelection(cube, 'face', grown)).toEqual(start);
  });

  it('shrinking a full selection keeps it full', () => {
    const all = cube.vertices.map((v) => v.id);
    expect(shrinkSelection(cube, 'vertex', all)).toEqual(all);
  });

  it('shrinking an isolated vertex clears it', () => {
    expect(shrinkSelection(cube, 'vertex', [cube.vertices[0].id])).toEqual([]);
  });

  it('leaves an empty selection untouched', () => {
    expect(growSelection(cube, 'vertex', [])).toEqual([]);
    expect(shrinkSelection(cube, 'edge', [])).toEqual([]);
  });
});

describe('selectLinked', () => {
  const mesh = twoIslands();

  it('selects the whole island and nothing from the other one', () => {
    const linked = selectLinked(mesh, 'vertex', ['a0']);
    expect(linked.sort()).toEqual(['a0', 'a1', 'a2', 'a3']);
  });

  it('selects only the seeded island in face mode', () => {
    expect(selectLinked(mesh, 'face', ['bf'])).toEqual(['bf']);
  });

  it('selects the whole cube from any single vertex', () => {
    expect(selectLinked(cube, 'vertex', [cube.vertices[0].id])).toHaveLength(8);
  });

  it('returns an empty result for an empty seed', () => {
    expect(selectLinked(mesh, 'vertex', [])).toEqual([]);
  });
});

describe('edge ring and loop', () => {
  const strip = quadStrip(3);

  it('walks a ring across the strip through opposite quad edges', () => {
    // The vertical edge between the first two quads rings across all 4 verticals.
    const vertical = strip.edges.find(
      (e) =>
        (e.v1Id === 'v1b' && e.v2Id === 'v1t') || (e.v1Id === 'v1t' && e.v2Id === 'v1b'),
    )!;
    const ring = selectEdgeRing(strip, vertical.id);
    expect(ring).toHaveLength(4);
  });

  it('returns a full ring of 4 edges around a cube', () => {
    const ring = selectEdgeRing(cube, cube.edges[0].id);
    expect(ring).toHaveLength(4);
    expect(ring).toContain(cube.edges[0].id);
  });

  it('follows a cube edge loop through 4 edges', () => {
    // Every cube vertex has valence 3, so the loop walk cannot continue.
    const loop = selectEdgeLoop(cube, cube.edges[0].id);
    expect(loop).toEqual([cube.edges[0].id]);
  });

  it('returns nothing for an unknown edge', () => {
    expect(selectEdgeRing(cube, 'nope')).toEqual([]);
    expect(selectEdgeLoop(cube, 'nope')).toEqual([]);
  });
});

describe('counts and pruning', () => {
  it('reports selected vs total for the readout', () => {
    expect(selectionCounts(cube, 'vertex', [cube.vertices[0].id])).toEqual({
      selected: 1,
      total: 8,
    });
    expect(selectionCounts(cube, 'face', [])).toEqual({ selected: 0, total: 6 });
  });

  it('ignores stale IDs left over from a topology edit', () => {
    expect(selectionCounts(cube, 'vertex', ['gone', cube.vertices[0].id]).selected).toBe(1);
  });

  it('handles a missing mesh', () => {
    expect(selectionCounts(undefined, 'vertex', ['a'])).toEqual({ selected: 0, total: 0 });
  });

  it('prunes IDs that no longer exist', () => {
    const pruned = pruneSelection(cube, {
      vertexIds: [cube.vertices[0].id, 'stale'],
      edgeIds: ['stale'],
      faceIds: [cube.faces[0].id],
    });
    expect(pruned.vertexIds).toEqual([cube.vertices[0].id]);
    expect(pruned.edgeIds).toEqual([]);
    expect(pruned.faceIds).toEqual([cube.faces[0].id]);
  });
});
