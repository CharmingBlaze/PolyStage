import type { CADBone, CADMesh, Face, Vertex } from '../types/cad';
import { generateId, createEdgesFromFaces } from './meshUtils';
import { finalizeEditableMesh } from './topology/validate';

export type ClipboardPayload =
  | {
      kind: 'faces';
      vertices: Vertex[];
      faces: Face[];
    }
  | {
      kind: 'objects';
      meshes: CADMesh[];
    }
  | {
      kind: 'bones';
      bones: CADBone[];
    };

let activeClipboard: ClipboardPayload | null = null;

export function getClipboard(): ClipboardPayload | null {
  return activeClipboard;
}

export function copySelectedGeometry(mesh: CADMesh, selectedFaceIds: string[]): boolean {
  if (selectedFaceIds.length === 0) return false;

  const targetFaces = mesh.faces.filter((f) => selectedFaceIds.includes(f.id));
  const referencedVertIds = new Set<string>();
  targetFaces.forEach((f) => f.vertexIds.forEach((vId) => referencedVertIds.add(vId)));

  activeClipboard = {
    kind: 'faces',
    vertices: JSON.parse(JSON.stringify(mesh.vertices.filter((v) => referencedVertIds.has(v.id)))),
    faces: JSON.parse(JSON.stringify(targetFaces)),
  };
  return true;
}

export function copySelectedVertices(mesh: CADMesh, selectedVertexIds: string[]): boolean {
  if (selectedVertexIds.length === 0) return false;
  const idSet = new Set(selectedVertexIds);
  // Prefer faces fully contained in selection; else copy verts as point cloud faces skipped
  const faces = mesh.faces.filter((f) => f.vertexIds.every((id) => idSet.has(id)));
  if (faces.length > 0) return copySelectedGeometry(mesh, faces.map((f) => f.id));
  activeClipboard = {
    kind: 'faces',
    vertices: JSON.parse(JSON.stringify(mesh.vertices.filter((v) => idSet.has(v.id)))),
    faces: [],
  };
  return true;
}

export function copyMeshes(meshes: CADMesh[]): boolean {
  if (meshes.length === 0) return false;
  activeClipboard = {
    kind: 'objects',
    meshes: JSON.parse(JSON.stringify(meshes)),
  };
  return true;
}

export function copyBones(bones: CADBone[]): boolean {
  if (bones.length === 0) return false;
  activeClipboard = {
    kind: 'bones',
    bones: JSON.parse(JSON.stringify(bones)),
  };
  return true;
}

export function pasteClipboardGeometry(
  mesh: CADMesh,
  offset: { x: number; y: number; z: number } = { x: 0.2, y: 0.2, z: 0.2 },
): { mesh: CADMesh; newFaceIds: string[]; newVertexIds: string[] } {
  if (!activeClipboard || activeClipboard.kind !== 'faces') {
    return { mesh, newFaceIds: [], newVertexIds: [] };
  }

  const idMap = new Map<string, string>();
  const pastedVerts: Vertex[] = [];
  const newVertexIds: string[] = [];

  activeClipboard.vertices.forEach((v) => {
    const newId = generateId();
    idMap.set(v.id, newId);
    newVertexIds.push(newId);
    pastedVerts.push({
      ...v,
      id: newId,
      x: v.x + offset.x,
      y: v.y + offset.y,
      z: v.z + offset.z,
    });
  });

  const newFaceIds: string[] = [];
  const pastedFaces: Face[] = activeClipboard.faces.map((f) => {
    const id = generateId();
    newFaceIds.push(id);
    return {
      ...f,
      id,
      vertexIds: f.vertexIds.map((oldId) => idMap.get(oldId) || oldId),
      uvs: f.uvs.map((uv) => ({ ...uv })),
    };
  });

  const updatedVerts = [...mesh.vertices, ...pastedVerts];
  const updatedFaces = [...mesh.faces, ...pastedFaces];

  return {
    mesh: finalizeEditableMesh({
      ...mesh,
      vertices: updatedVerts,
      faces: updatedFaces,
      edges: createEdgesFromFaces(updatedFaces),
      revision: (mesh.revision || 0) + 1,
    }),
    newFaceIds,
    newVertexIds,
  };
}

export function pasteClipboardMeshes(
  existing: CADMesh[],
  offset = 0.5,
): { meshes: CADMesh[]; newIds: string[] } {
  if (!activeClipboard || activeClipboard.kind !== 'objects') {
    return { meshes: existing, newIds: [] };
  }
  const newIds: string[] = [];
  const clones = activeClipboard.meshes.map((source, i) => {
    const vertexMap = new Map(source.vertices.map((v) => [v.id, generateId()]));
    const mapV = (id: string) => vertexMap.get(id) || id;
    const id = generateId();
    newIds.push(id);
    return {
      ...source,
      id,
      name: `${source.name}_copy`,
      position: {
        x: source.position.x + offset + i * 0.15,
        y: source.position.y,
        z: source.position.z + offset,
      },
      vertices: source.vertices.map((v) => ({ ...v, id: mapV(v.id) })),
      faces: source.faces.map((f) => ({
        ...f,
        id: generateId(),
        vertexIds: f.vertexIds.map(mapV),
        uvs: f.uvs.map((uv) => ({ ...uv })),
      })),
      edges: [],
      modifiers: source.modifiers ? JSON.parse(JSON.stringify(source.modifiers)) : undefined,
      skinWeights: source.skinWeights
        ? Object.fromEntries(
            Object.entries(source.skinWeights).map(([vid, w]) => [mapV(vid), w.map((x) => ({ ...x }))]),
          )
        : undefined,
    } as CADMesh;
  }).map((m) => finalizeEditableMesh({ ...m, edges: createEdgesFromFaces(m.faces) }));

  return { meshes: [...existing, ...clones], newIds };
}

export function pasteClipboardBones(existing: CADBone[]): { bones: CADBone[]; newSelectionId: string | null } {
  if (!activeClipboard || activeClipboard.kind !== 'bones') {
    return { bones: existing, newSelectionId: null };
  }
  const idMap = new Map<string, string>();
  activeClipboard.bones.forEach((b) => idMap.set(b.id, generateId()));
  const clones = activeClipboard.bones.map((b) => ({
    ...b,
    id: idMap.get(b.id)!,
    name: `${b.name}.copy`,
    parentId: b.parentId ? (idMap.get(b.parentId) || b.parentId) : null,
    position: { x: b.position.x + 0.15, y: b.position.y, z: b.position.z },
    mirrorBoneId: b.mirrorBoneId ? (idMap.get(b.mirrorBoneId) || null) : null,
    constraints: b.constraints?.map((c) => ({
      ...c,
      targetBoneId: c.targetBoneId ? (idMap.get(c.targetBoneId) || c.targetBoneId) : c.targetBoneId,
    })),
  }));
  return {
    bones: [...existing, ...clones],
    newSelectionId: clones[0]?.id || null,
  };
}
