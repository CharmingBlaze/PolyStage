import { describe, it, expect } from 'vitest';
import { parseOBJ, parseSTL, parsePLY, import3DModelFile, parseProjectOrBbmodel } from './importers';
import { exportToOBJ, exportToSTL, exportToGLTF, exportToBlockbench } from './exporters';
import { createPrimitiveMesh } from './topology/primitives';

describe('3D Importers & Exporters', () => {
  it('exports and parses Wavefront .OBJ files with UVs, normals, and MTL', () => {
    const cube = createPrimitiveMesh('cube');
    const { obj, mtl } = exportToOBJ(cube);

    expect(obj).toContain('o Cube_Primitive');
    expect(obj).toContain('v ');
    expect(obj).toContain('vt ');
    expect(obj).toContain('vn ');
    expect(obj).toContain('f ');
    expect(mtl).toContain('newmtl default_material');

    const imported = parseOBJ(obj, 'Imported_Cube');
    expect(imported.vertices.length).toBe(cube.vertices.length);
    expect(imported.faces.length).toBe(cube.faces.length);
  });

  it('exports to 3D printing STL format with facet normals', () => {
    const cube = createPrimitiveMesh('cube');
    const stl = exportToSTL(cube);

    expect(stl).toContain('solid Cube_Primitive');
    expect(stl).toMatch(/facet normal [-\d.]+ [-\d.]+ [-\d.]+/);
    expect(stl).toContain('endsolid Cube_Primitive');

    const imported = parseSTL(stl, 'Imported_STL');
    expect(imported.vertices.length).toBeGreaterThan(0);
  });

  it('exports to valid glTF 2.0 JSON via Three.js', async () => {
    const sphere = createPrimitiveMesh('sphere');
    const gltfStr = await exportToGLTF(sphere);
    const gltf = JSON.parse(gltfStr);

    expect(gltf.asset.version).toBe('2.0');
    expect(gltf.meshes?.length).toBeGreaterThan(0);
    const nodeNames = (gltf.nodes || []).map((n: { name?: string }) => n.name);
    expect(nodeNames).toContain('Sphere Primitive');
  });

  it('exports Blockbench .bbmodel with PolyStage mesh round-trip', () => {
    const cube = createPrimitiveMesh('cube');
    const bbStr = exportToBlockbench(cube);
    const bb = JSON.parse(bbStr);

    expect(bb.meta.format_version).toBe('4.5');
    expect(bb.elements.length).toBe(1);
    expect(bb.polystage_mesh.vertices.length).toBe(cube.vertices.length);

    const reimported = parseProjectOrBbmodel(bbStr, 'RoundTrip');
    expect(reimported).not.toBeNull();
    expect(reimported?.vertices.length).toBe(cube.vertices.length);
    expect(reimported?.faces.length).toBe(cube.faces.length);
  });

  it('auto-detects and imports 3D model files via import3DModelFile', () => {
    const cube = createPrimitiveMesh('cube');
    const { obj } = exportToOBJ(cube);

    const imported = import3DModelFile('my_model.obj', obj);
    expect(imported).not.toBeNull();
    expect(imported?.vertices.length).toBe(cube.vertices.length);
  });

  it('parses ASCII PLY', () => {
    const ply = `ply
format ascii 1.0
element vertex 3
property float x
property float y
property float z
element face 1
property list uchar int vertex_indices
end_header
0 0 0
1 0 0
0 1 0
3 0 1 2
`;
    const mesh = parsePLY(ply, 'Tri');
    expect(mesh.vertices.length).toBe(3);
    expect(mesh.faces.length).toBe(1);
  });
});
