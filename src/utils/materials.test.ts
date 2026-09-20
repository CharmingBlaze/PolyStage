import { describe, expect, it } from 'vitest';
import type { CADMesh } from '../types/cad';
import { cloneDefaultMaterials, createMaterial, materialForMesh } from './materials';

const mesh = (materialId?: string): CADMesh => ({
  id: 'mesh_1',
  name: 'Mesh',
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  vertices: [],
  edges: [],
  faces: [{ id: 'face_1', vertexIds: [], uvs: [], materialId }],
  materialId,
});

describe('material assets', () => {
  it('clones defaults so scenes do not share mutable material objects', () => {
    const first = cloneDefaultMaterials();
    const second = cloneDefaultMaterials();
    first[0].name = 'Changed';
    expect(second[0].name).toBe('Studio White');
  });

  it('resolves a linked reusable material from a mesh', () => {
    const materials = cloneDefaultMaterials();
    expect(materialForMesh(mesh('mat_uv_grid'), materials)?.source).toBe('uv');
  });

  it('creates a unique editable color material', () => {
    const first = createMaterial('Paint A');
    const second = createMaterial('Paint B');
    expect(first.name).toBe('Paint A');
    expect(first.source).toBe('color');
    expect(first.id).not.toBe(second.id);
  });
});
