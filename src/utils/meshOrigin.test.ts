import { describe, expect, it } from 'vitest';
import { generatePrimitive, recenterMeshOrigin } from './meshUtils';
import {
  originToBottom,
  originToSelection,
  originToWorldZero,
  setMeshOriginWorld,
} from './meshOrigin';
import { vectorPathsToMesh, vectorSnapshotToCADMesh } from './vectorBlockout';

function worldVerts(mesh: { vertices: Array<{ x: number; y: number; z: number }>; position: { x: number; y: number; z: number } }) {
  return mesh.vertices.map((v) => ({
    x: v.x + mesh.position.x,
    y: v.y + mesh.position.y,
    z: v.z + mesh.position.z,
  }));
}

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

describe('origin workflow', () => {
  it('moves origin in world without shifting unrotated verts', () => {
    const mesh = generatePrimitive('cube');
    const before = worldVerts(mesh);
    const next = setMeshOriginWorld(mesh, { x: 0.5, y: 0, z: 0 });
    expect(next.position.x).toBeCloseTo(0.5, 5);
    const after = worldVerts(next);
    before.forEach((p, i) => {
      expect(after[i].x).toBeCloseTo(p.x, 5);
      expect(after[i].y).toBeCloseTo(p.y, 5);
      expect(after[i].z).toBeCloseTo(p.z, 5);
    });
  });

  it('keeps world verts when origin goes to world zero', () => {
    const mesh = {
      ...generatePrimitive('cube'),
      position: { x: 2, y: 1, z: -1 },
    };
    const before = worldVerts(mesh);
    const next = originToWorldZero(mesh);
    expect(next.position.x).toBeCloseTo(0, 5);
    expect(next.position.y).toBeCloseTo(0, 5);
    expect(next.position.z).toBeCloseTo(0, 5);
    const after = worldVerts(next);
    before.forEach((p, i) => {
      expect(after[i].x).toBeCloseTo(p.x, 5);
      expect(after[i].y).toBeCloseTo(p.y, 5);
      expect(after[i].z).toBeCloseTo(p.z, 5);
    });
  });

  it('puts origin on the selected vertex', () => {
    const mesh = generatePrimitive('cube');
    const v = mesh.vertices[0];
    const next = originToSelection(mesh, [v.id]);
    expect(next.position.x).toBeCloseTo(v.x + mesh.position.x, 5);
    expect(next.position.y).toBeCloseTo(v.y + mesh.position.y, 5);
    expect(next.position.z).toBeCloseTo(v.z + mesh.position.z, 5);
    const moved = next.vertices.find((vert) => vert.id === v.id)!;
    expect(moved.x).toBeCloseTo(0, 5);
    expect(moved.y).toBeCloseTo(0, 5);
    expect(moved.z).toBeCloseTo(0, 5);
  });

  it('puts origin at the local bbox floor', () => {
    const mesh = generatePrimitive('cube');
    const next = originToBottom(mesh);
    const ys = next.vertices.map((v) => v.y);
    expect(Math.min(...ys)).toBeCloseTo(0, 5);
    expect(next.position.y).toBeCloseTo(mesh.position.y + Math.min(...mesh.vertices.map((v) => v.y)), 5);
  });
});

