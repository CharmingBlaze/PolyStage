import { describe, it, expect } from 'vitest';
import { parseOBJ, parseSTL, parsePLY, import3DModelFile } from './importers';
import { exportToOBJ, exportToSTL, exportToGLTF, exportToBlockbench } from './exporters';
import { createPrimitiveMesh } from './topology/primitives';

describe('3D Importers & Exporters', () => {
  it('exports and parses Wavefront .OBJ files with UVs and MTL', () => {
    const cube = createPrimitiveMesh('cube');
    const { obj, mtl } = exportToOBJ(cube);

    expect(obj).toContain('o Cube');
    expect(obj).toContain('v ');
    expect(obj).toContain('vt ');
    expect(obj).toContain('f ');
    expect(mtl).toContain('newmtl default_material');

    const imported = parseOBJ(obj, 'Imported_Cube');
    expect(imported.vertices.length).toBe(cube.vertices.length);
    expect(imported.faces.length).toBe(cube.faces.length);
  });

  it('exports to 3D printing STL format', () => {
    const cube = createPrimitiveMesh('cube');
    const stl = exportToSTL(cube);

    expect(stl).toContain('solid Cube');
    expect(stl).toContain('facet normal');
    expect(stl).toContain('endsolid Cube');

    const imported = parseSTL(stl, 'Imported_STL');
    expect(imported.vertices.length).toBeGreaterThan(0);
  });

  it('exports to glTF 2.0 format', () => {
    const sphere = createPrimitiveMesh('sphere');
    const gltfStr = exportToGLTF(sphere);
    const gltf = JSON.parse(gltfStr);

    expect(gltf.asset.version).toBe('2.0');
    expect(gltf.nodes[0].name).toBe('Sphere Primitive');
  });

  it('exports to Blockbench .bbmodel format', () => {
    const cube = createPrimitiveMesh('cube');
    const bbStr = exportToBlockbench(cube);
    const bb = JSON.parse(bbStr);

    expect(bb.meta.format_version).toBe('4.0');
    expect(bb.elements.length).toBe(1);
  });

  it('auto-detects and imports 3D model files via import3DModelFile', () => {
    const cube = createPrimitiveMesh('cube');
    const { obj } = exportToOBJ(cube);

    const imported = import3DModelFile('my_model.obj', obj);
    expect(imported).not.toBeNull();
    expect(imported?.vertices.length).toBe(cube.vertices.length);
  });
});
