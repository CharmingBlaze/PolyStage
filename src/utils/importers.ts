import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { CADMesh, Vertex, Face, Vector3D } from '../types/cad';
import { generateId, createEdgesFromFaces } from './meshUtils';
import { finalizeEditableMesh } from './topology/validate';

function emptyMesh(name: string): CADMesh {
  return finalizeEditableMesh({
    id: generateId(),
    name,
    type: 'custom',
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    visible: true,
    vertices: [],
    faces: [],
    edges: [],
  });
}

function weldKey(x: number, y: number, z: number) {
  return `${x.toFixed(5)},${y.toFixed(5)},${z.toFixed(5)}`;
}

/**
 * Parses Wavefront .OBJ file content into an editable CADMesh polygon model.
 * Preserves vertex UVs and quad / n-gon face topology.
 */
export function parseOBJ(objContent: string, meshName: string = 'Imported_Mesh'): CADMesh {
  const lines = objContent.split('\n');
  const rawVertices: Vector3D[] = [];
  const rawUVs: { u: number; v: number }[] = [];

  const vertices: Vertex[] = [];
  const vertIdMap = new Map<number, string>();

  const faces: Face[] = [];

  for (let line of lines) {
    line = line.trim();
    if (line.startsWith('#') || line === '') continue;

    const parts = line.split(/\s+/);
    const type = parts[0];

    if (type === 'v') {
      const x = parseFloat(parts[1]) || 0;
      const y = parseFloat(parts[2]) || 0;
      const z = parseFloat(parts[3]) || 0;
      rawVertices.push({ x, y, z });
      const id = generateId();
      vertices.push({ id, x, y, z });
      vertIdMap.set(rawVertices.length, id);
    } else if (type === 'vt') {
      const u = parseFloat(parts[1]) || 0;
      const v = parseFloat(parts[2]) || 0;
      rawUVs.push({ u, v });
    } else if (type === 'f') {
      const faceVertIds: string[] = [];
      const faceUVs: { u: number; v: number }[] = [];

      for (let i = 1; i < parts.length; i++) {
        const indices = parts[i].split('/');
        const vIdx = parseInt(indices[0], 10);
        if (isNaN(vIdx)) continue;

        const actualVIdx = vIdx > 0 ? vIdx : rawVertices.length + vIdx + 1;
        const mappedId = vertIdMap.get(actualVIdx);
        if (mappedId) faceVertIds.push(mappedId);

        if (indices.length > 1 && indices[1]) {
          const vtIdx = parseInt(indices[1], 10);
          const actualVtIdx = vtIdx > 0 ? vtIdx : rawUVs.length + vtIdx + 1;
          const uv = rawUVs[actualVtIdx - 1];
          faceUVs.push(uv ? { ...uv } : { u: 0, v: 0 });
        } else {
          faceUVs.push({ u: 0, v: 0 });
        }
      }

      if (faceVertIds.length >= 3) {
        faces.push({
          id: generateId(),
          vertexIds: faceVertIds,
          uvs: faceUVs,
        });
      }
    }
  }

  return finalizeEditableMesh({
    id: generateId(),
    name: meshName,
    type: 'custom',
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    visible: true,
    vertices,
    faces,
    edges: createEdgesFromFaces(faces),
  });
}

/** ASCII STL parser. */
export function parseSTL(stlContent: string, meshName: string = 'Imported_STL'): CADMesh {
  const lines = stlContent.split('\n');
  const vertices: Vertex[] = [];
  const faces: Face[] = [];
  const vertMap = new Map<string, string>();

  let currentFacetVerts: string[] = [];

  for (let line of lines) {
    line = line.trim();
    if (line.startsWith('vertex')) {
      const parts = line.split(/\s+/);
      const x = parseFloat(parts[1]) || 0;
      const y = parseFloat(parts[2]) || 0;
      const z = parseFloat(parts[3]) || 0;
      const key = weldKey(x, y, z);

      let vId = vertMap.get(key);
      if (!vId) {
        vId = generateId();
        vertMap.set(key, vId);
        vertices.push({ id: vId, x, y, z });
      }
      currentFacetVerts.push(vId);
    } else if (line.startsWith('endloop')) {
      if (currentFacetVerts.length >= 3) {
        faces.push({
          id: generateId(),
          vertexIds: [...currentFacetVerts],
          uvs: currentFacetVerts.map((_, i) => ({ u: i % 2, v: Math.floor(i / 2) })),
        });
      }
      currentFacetVerts = [];
    }
  }

  return finalizeEditableMesh({
    id: generateId(),
    name: meshName,
    type: 'custom',
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    visible: true,
    vertices,
    faces,
    edges: createEdgesFromFaces(faces),
  });
}

/** Binary STL parser (ArrayBuffer). */
export function parseSTLBinary(buffer: ArrayBuffer, meshName: string = 'Imported_STL'): CADMesh {
  const view = new DataView(buffer);
  if (view.byteLength < 84) return emptyMesh(meshName);

  const triCount = view.getUint32(80, true);
  const expected = 84 + triCount * 50;
  if (triCount <= 0 || view.byteLength < expected) {
    // Might actually be ASCII saved with wrong reader — try text fallback.
    const text = new TextDecoder().decode(buffer);
    if (text.trimStart().toLowerCase().startsWith('solid')) {
      return parseSTL(text, meshName);
    }
    return emptyMesh(meshName);
  }

  const vertices: Vertex[] = [];
  const faces: Face[] = [];
  const vertMap = new Map<string, string>();

  const getVert = (x: number, y: number, z: number) => {
    const key = weldKey(x, y, z);
    let id = vertMap.get(key);
    if (!id) {
      id = generateId();
      vertMap.set(key, id);
      vertices.push({ id, x, y, z });
    }
    return id;
  };

  let offset = 84;
  for (let i = 0; i < triCount; i++) {
    offset += 12; // skip normal
    const ids: string[] = [];
    for (let k = 0; k < 3; k++) {
      const x = view.getFloat32(offset, true);
      const y = view.getFloat32(offset + 4, true);
      const z = view.getFloat32(offset + 8, true);
      offset += 12;
      ids.push(getVert(x, y, z));
    }
    offset += 2; // attribute byte count
    faces.push({
      id: generateId(),
      vertexIds: ids,
      uvs: [
        { u: 0, v: 0 },
        { u: 1, v: 0 },
        { u: 0.5, v: 1 },
      ],
    });
  }

  return finalizeEditableMesh({
    id: generateId(),
    name: meshName,
    type: 'custom',
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    visible: true,
    vertices,
    faces,
    edges: createEdgesFromFaces(faces),
  });
}

/** ASCII PLY parser. */
export function parsePLY(plyContent: string, meshName: string = 'Imported_PLY'): CADMesh {
  const lines = plyContent.split('\n');
  let headerEnded = false;
  let vertCount = 0;
  let faceCount = 0;

  const vertices: Vertex[] = [];
  const faces: Face[] = [];
  const vertIdList: string[] = [];

  let lineIdx = 0;
  for (; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx].trim();
    if (line.startsWith('element vertex')) {
      vertCount = parseInt(line.split(/\s+/)[2], 10) || 0;
    } else if (line.startsWith('element face')) {
      faceCount = parseInt(line.split(/\s+/)[2], 10) || 0;
    } else if (line === 'end_header') {
      lineIdx++;
      headerEnded = true;
      break;
    }
  }

  if (!headerEnded) return parseOBJ(plyContent, meshName);

  for (let i = 0; i < vertCount && lineIdx < lines.length; i++, lineIdx++) {
    const parts = lines[lineIdx].trim().split(/\s+/);
    const x = parseFloat(parts[0]) || 0;
    const y = parseFloat(parts[1]) || 0;
    const z = parseFloat(parts[2]) || 0;
    const id = generateId();
    vertices.push({ id, x, y, z });
    vertIdList.push(id);
  }

  for (let i = 0; i < faceCount && lineIdx < lines.length; i++, lineIdx++) {
    const parts = lines[lineIdx].trim().split(/\s+/);
    const numVerts = parseInt(parts[0], 10);
    if (numVerts >= 3) {
      const faceVIds: string[] = [];
      for (let j = 1; j <= numVerts; j++) {
        const vIdx = parseInt(parts[j], 10);
        if (vertIdList[vIdx]) faceVIds.push(vertIdList[vIdx]);
      }
      if (faceVIds.length >= 3) {
        faces.push({
          id: generateId(),
          vertexIds: faceVIds,
          uvs: faceVIds.map((_, k) => ({ u: k % 2, v: Math.floor(k / 2) })),
        });
      }
    }
  }

  return finalizeEditableMesh({
    id: generateId(),
    name: meshName,
    type: 'custom',
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    visible: true,
    vertices,
    faces,
    edges: createEdgesFromFaces(faces),
  });
}

function threeGeometryToCADMesh(geometry: THREE.BufferGeometry, name: string, transform?: THREE.Matrix4): CADMesh {
  const geo = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  if (transform) geo.applyMatrix4(transform);
  geo.computeVertexNormals();

  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const uvAttr = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (!pos || pos.count < 3) return emptyMesh(name);

  const vertices: Vertex[] = [];
  const faces: Face[] = [];
  const vertMap = new Map<string, string>();

  const getId = (i: number) => {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const key = weldKey(x, y, z);
    let id = vertMap.get(key);
    if (!id) {
      id = generateId();
      vertMap.set(key, id);
      vertices.push({ id, x, y, z });
    }
    return id;
  };

  for (let i = 0; i + 2 < pos.count; i += 3) {
    const ids = [getId(i), getId(i + 1), getId(i + 2)];
    const uvs = [0, 1, 2].map((k) => {
      if (!uvAttr) return { u: k === 1 ? 1 : 0, v: k === 2 ? 1 : 0 };
      return { u: uvAttr.getX(i + k), v: uvAttr.getY(i + k) };
    });
    faces.push({ id: generateId(), vertexIds: ids, uvs });
  }

  return finalizeEditableMesh({
    id: generateId(),
    name,
    type: 'custom',
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    visible: true,
    vertices,
    faces,
    edges: createEdgesFromFaces(faces),
  });
}

/** Import glTF / GLB via Three.js GLTFLoader → editable CADMesh list. */
export async function parseGLTF(
  data: ArrayBuffer | string,
  meshName: string = 'Imported_glTF',
): Promise<CADMesh[]> {
  const loader = new GLTFLoader();
  const gltf = await new Promise<Awaited<ReturnType<typeof loader.parseAsync>>>((resolve, reject) => {
    try {
      if (typeof data === 'string') {
        loader.parse(data, '', resolve, reject);
      } else {
        loader.parse(data, '', resolve, reject);
      }
    } catch (err) {
      reject(err);
    }
  });

  const meshes: CADMesh[] = [];
  let idx = 0;
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((obj) => {
    if (!(obj as THREE.Mesh).isMesh) return;
    const meshObj = obj as THREE.Mesh;
    const geom = meshObj.geometry as THREE.BufferGeometry;
    if (!geom?.getAttribute('position')) return;
    const name = meshObj.name || `${meshName}_${idx + 1}`;
    meshes.push(threeGeometryToCADMesh(geom, name, meshObj.matrixWorld.clone()));
    idx += 1;
  });

  if (meshes.length === 0) return [emptyMesh(meshName)];
  return meshes;
}

/** Parse PolyStage / legacy project JSON or bbmodel with embedded mesh. */
export function parseProjectOrBbmodel(content: string, meshName: string): CADMesh | null {
  try {
    const parsed = JSON.parse(content);
    const candidate =
      parsed.polystage_mesh ||
      parsed.mesh ||
      (parsed.meshes && Array.isArray(parsed.meshes) ? parsed.meshes[0] : null);
    if (candidate && Array.isArray(candidate.vertices) && Array.isArray(candidate.faces)) {
      return finalizeEditableMesh({
        ...candidate,
        id: generateId(),
        name: candidate.name || meshName,
        edges: candidate.edges?.length ? candidate.edges : createEdgesFromFaces(candidate.faces),
      });
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Sync text-based import (.obj, .stl ascii, .ply, .json, .bbmodel).
 * Prefer `import3DModelFromFile` for binary formats (.glb, binary .stl).
 */
export function import3DModelFile(filename: string, content: string): CADMesh | null {
  const ext = filename.toLowerCase().split('.').pop();
  const nameWithoutExt = filename.replace(/\.[^/.]+$/, '');

  if (ext === 'obj') return parseOBJ(content, nameWithoutExt);
  if (ext === 'stl') {
    if (content.trimStart().toLowerCase().startsWith('solid') && !content.includes('\0')) {
      return parseSTL(content, nameWithoutExt);
    }
    // Binary STL mis-read as text — caller should use ArrayBuffer path.
    return null;
  }
  if (ext === 'ply') return parsePLY(content, nameWithoutExt);
  if (ext === 'json' || ext === 'bbmodel' || ext === 'polystage' || ext === 'picocad2') {
    return parseProjectOrBbmodel(content, nameWithoutExt);
  }
  if (ext === 'gltf') {
    // Async path preferred; sync parse of embedded JSON glTF without buffers often fails.
    return null;
  }

  return parseOBJ(content, nameWithoutExt);
}

export type ImportResult = { meshes: CADMesh[]; error?: string };

/** Full file import supporting OBJ/STL/PLY/glTF/GLB/JSON/bbmodel. */
export async function import3DModelFromFile(file: File): Promise<ImportResult> {
  const ext = file.name.toLowerCase().split('.').pop() || '';
  const nameWithoutExt = file.name.replace(/\.[^/.]+$/, '');

  try {
    if (ext === 'glb' || ext === 'gltf') {
      const data = ext === 'gltf' ? await file.text() : await file.arrayBuffer();
      const meshes = await parseGLTF(data, nameWithoutExt);
      const usable = meshes.filter((m) => m.vertices.length > 0);
      if (!usable.length) return { meshes: [], error: 'glTF contained no mesh geometry.' };
      return { meshes: usable };
    }

    if (ext === 'stl') {
      const buffer = await file.arrayBuffer();
      const mesh = hasBinaryStlSignature(buffer)
        ? parseSTLBinary(buffer, nameWithoutExt)
        : parseSTL(new TextDecoder().decode(buffer), nameWithoutExt);
      if (!mesh.vertices.length) return { meshes: [], error: 'STL contained no triangles.' };
      return { meshes: [mesh] };
    }

    const text = await file.text();
    const mesh = import3DModelFile(file.name, text);
    if (!mesh || !mesh.vertices.length) {
      return { meshes: [], error: `Could not parse geometry from "${file.name}".` };
    }
    return { meshes: [mesh] };
  } catch (err) {
    return {
      meshes: [],
      error: err instanceof Error ? err.message : `Failed to import "${file.name}".`,
    };
  }
}

function hasBinaryStlSignature(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 84) return false;
  const view = new DataView(buffer);
  const triCount = view.getUint32(80, true);
  return triCount > 0 && buffer.byteLength >= 84 + triCount * 50;
}

export const SUPPORTED_IMPORT_EXTENSIONS = [
  '.obj',
  '.stl',
  '.ply',
  '.gltf',
  '.glb',
  '.json',
  '.bbmodel',
  '.polystage',
] as const;
