import { describe, expect, it } from 'vitest';
import { generatePrimitive, recenterMeshOrigin } from './meshUtils';
import { vectorPathsToMesh, vectorSnapshotToCADMesh } from './vectorBlockout';

describe('recenterMeshOrigin', () => {
  it('moves the pivot to the bbox center without shifting world verts', () => {
    const mesh = generatePrimitive('cube');
    // Offset verts away from origin while leaving position at 0.
    const shifted = {
      ...mesh,
      position: { x: 0, y: 0, z: 0 },
      vertices: mesh.vertices.map((v) => ({ ...v, y: v.y + 2 })),
    };
    const beforeWorld = shifted.vertices.map((v) => ({
      x: v.x + shifted.position.x,
      y: v.y + shifted.position.y,
      z: v.z + shifted.position.z,
    }));
    const centered = recenterMeshOrigin(shifted);
    expect(centered.position.y).toBeCloseTo(2, 5);
    const afterWorld = centered.vertices.map((v) => ({
      x: v.x + centered.position.x,
      y: v.y + centered.position.y,
      z: v.z + centered.position.z,
    }));
    beforeWorld.forEach((p, i) => {
      expect(afterWorld[i].x).toBeCloseTo(p.x, 5);
      expect(afterWorld[i].y).toBeCloseTo(p.y, 5);
      expect(afterWorld[i].z).toBeCloseTo(p.z, 5);
    });
  });

  it('centers blockout CAD meshes so gizmos sit on the object', () => {
    const front = {
      id: 'f',
      plane: 'front' as const,
      name: 'front',
      closed: true,
      anchors: [
        { u: -0.5, v: 0 },
        { u: 0.5, v: 0 },
        { u: 0.5, v: 2 },
        { u: -0.5, v: 2 },
      ].map((point) => ({ point, handleIn: { ...point }, handleOut: { ...point } })),
    };
    const side = {
      id: 's',
      plane: 'side' as const,
      name: 'side',
      closed: true,
      anchors: [
        { u: -0.3, v: 0 },
        { u: 0.3, v: 0 },
        { u: 0.3, v: 2 },
        { u: -0.3, v: 2 },
      ].map((point) => ({ point, handleIn: { ...point }, handleOut: { ...point } })),
    };
    const snap = vectorPathsToMesh(front, side, 4, 8, null, {
      gameTopology: true,
      capStyle: 'pointed',
    });
    expect(snap).not.toBeNull();
    const mesh = vectorSnapshotToCADMesh(snap!, 'Part');
    expect(mesh.position.y).toBeGreaterThan(0.5);
    const minY = Math.min(...mesh.vertices.map((v) => v.y));
    const maxY = Math.max(...mesh.vertices.map((v) => v.y));
    expect(Math.abs(minY + maxY)).toBeLessThan(0.05);
  });
});
