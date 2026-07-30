import { describe, expect, it } from 'vitest';
import { generatePrimitive } from './meshUtils';
import { buildUvTopology, uvVertexId } from './uvTopology';

describe('face-corner UV topology', () => {
  it('gives every logical face corner an independent stable UV vertex', () => {
    const cube = generatePrimitive('cube');
    const topology = buildUvTopology(cube);

    expect(cube.faces).toHaveLength(6);
    expect(topology.vertices.size).toBe(24);
    expect(topology.edges.size).toBe(24);
    cube.faces.forEach((face) => {
      expect(topology.faces.get(face.id)?.uvVertexIds).toEqual(
        face.vertexIds.map((_, corner) => uvVertexId(face.id, corner)),
      );
    });
  });

  it('starts generated cubes with six visible non-overlapping UV islands', () => {
    const topology = buildUvTopology(generatePrimitive('cube'));
    expect(topology.islands.size).toBe(6);
    expect([...topology.islands.values()].every((island) => island.uvFaceIds.length === 1)).toBe(true);
  });

  it('keeps pin state on face-corner UV IDs', () => {
    const cube = generatePrimitive('cube');
    const pinnedId = uvVertexId(cube.faces[0].id, 0);
    const topology = buildUvTopology({ ...cube, uvPinnedVertexIds: [pinnedId] });
    expect(topology.vertices.get(pinnedId)?.pinned).toBe(true);
    expect([...topology.vertices.values()].filter((vertex) => vertex.pinned)).toHaveLength(1);
  });
});
