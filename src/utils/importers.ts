import type { CADMesh, Vertex, Face, Vector3D } from '../types/cad';
import { generateId, createEdgesFromFaces } from './meshUtils';
import { finalizeEditableMesh } from './topology/validate';

/**
 * Parses Wavefront .OBJ file content into an editable CADMesh polygon model.
 * Preserves vertex UVs and quad / n-gon face topology.
 */
export function parseOBJ(objContent: string, meshName: string = 'Imported_Mesh'): CADMesh {
  const lines = objContent.split('\n');
  const rawVertices: Vector3D[] = [];
  const rawUVs: { u: number; v: number }[] = [];

  const vertices: Vertex[] = [];
  const vertIdMap = new Map<number, string>(); // 1-indexed OBJ vert index -> CADMesh vertex ID

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

        // Handle negative 1-based indexing
        const actualVIdx = vIdx > 0 ? vIdx : rawVertices.length + vIdx + 1;
        const mappedId = vertIdMap.get(actualVIdx);
        if (mappedId) {
          faceVertIds.push(mappedId);
        }

        // Texture UV index
        if (indices.length > 1 && indices[1]) {
          const vtIdx = parseInt(indices[1], 10);
          const actualVtIdx = vtIdx > 0 ? vtIdx : rawUVs.length + vtIdx + 1;
          const uv = rawUVs[actualVtIdx - 1];
          if (uv) {
            faceUVs.push(uv);
          } else {
            faceUVs.push({ u: 0, v: 0 });
          }
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

  const baseMesh: CADMesh = {
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
  };

  return finalizeEditableMesh(baseMesh);
}

/**
 * Parses ASCII STL file format.
 */
export function parseSTL(stlContent: string, meshName: string = 'Imported_STL'): CADMesh {
  const lines = stlContent.split('\n');
  const vertices: Vertex[] = [];
  const faces: Face[] = [];
  const vertMap = new Map<string, string>(); // 'x,y,z' -> vertId

  let currentFacetVerts: string[] = [];

  for (let line of lines) {
    line = line.trim();
    if (line.startsWith('vertex')) {
      const parts = line.split(/\s+/);
      const x = parseFloat(parts[1]) || 0;
      const y = parseFloat(parts[2]) || 0;
      const z = parseFloat(parts[3]) || 0;
      const key = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;

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

/**
 * Parses ASCII PLY file format.
 */
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

  // Read vertices
  for (let i = 0; i < vertCount && lineIdx < lines.length; i++, lineIdx++) {
    const parts = lines[lineIdx].trim().split(/\s+/);
    const x = parseFloat(parts[0]) || 0;
    const y = parseFloat(parts[1]) || 0;
    const z = parseFloat(parts[2]) || 0;
    const id = generateId();
    vertices.push({ id, x, y, z });
    vertIdList.push(id);
  }

  // Read faces
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

/**
 * Auto-detects and imports 3D model files (.obj, .stl, .ply, .json, .bbmodel).
 */
export function import3DModelFile(filename: string, content: string): CADMesh | null {
  const ext = filename.toLowerCase().split('.').pop();
  const nameWithoutExt = filename.replace(/\.[^/.]+$/, '');

  if (ext === 'obj') {
    return parseOBJ(content, nameWithoutExt);
  } else if (ext === 'stl') {
    return parseSTL(content, nameWithoutExt);
  } else if (ext === 'ply') {
    return parsePLY(content, nameWithoutExt);
  } else if (ext === 'json' || ext === 'bbmodel') {
    try {
      const parsed = JSON.parse(content);
      if (parsed.mesh && Array.isArray(parsed.mesh.vertices)) {
        return finalizeEditableMesh({
          ...parsed.mesh,
          id: generateId(),
          name: nameWithoutExt,
        });
      }
    } catch {
      return null;
    }
  }

  // Fallback to OBJ parser if extension unknown
  return parseOBJ(content, nameWithoutExt);
}
