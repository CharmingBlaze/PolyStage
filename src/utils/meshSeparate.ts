import type { CADMesh, Face, Vertex } from '../types/cad';
import { generateId, createEdgesFromFaces, recenterMeshOrigin } from './meshUtils';
import { finalizeEditableMesh } from './topology/validate';

export type SeparateResult = {
  /** Source mesh with selected faces removed. Null if nothing remains. */
  remaining: CADMesh | null;
  /** New independent object(s) created from the selection / islands. */
  separated: CADMesh[];
};

function remapFacesToNewVerts(
  sourceFaces: Face[],
  sourceVerts: Vertex[],
  name: string,
  transform: CADMesh,
): CADMesh {
  const used = new Set<string>();
  sourceFaces.forEach((f) => f.vertexIds.forEach((id) => used.add(id)));
  const idMap = new Map<string, string>();
  const vertices: Vertex[] = sourceVerts
    .filter((v) => used.has(v.id))
    .map((v) => {
      const id = generateId();
      idMap.set(v.id, id);
      return { ...v, id };
    });
  const faces: Face[] = sourceFaces.map((f) => ({
    ...f,
    id: generateId(),
    vertexIds: f.vertexIds.map((id) => idMap.get(id) || id),
    uvs: f.uvs.map((uv) => ({ ...uv })),
  }));

  const skinWeights = transform.skinWeights
    ? Object.fromEntries(
        Object.entries(transform.skinWeights)
          .filter(([vid]) => idMap.has(vid))
          .map(([vid, weights]) => [idMap.get(vid)!, weights.map((w) => ({ ...w }))]),
      )
    : undefined;

  return finalizeEditableMesh({
    id: generateId(),
    name,
    groupId: transform.groupId,
    boneId: transform.boneId,
    position: { ...transform.position },
    rotation: { ...transform.rotation },
    scale: { ...transform.scale },
    vertices,
    faces,
    edges: createEdgesFromFaces(faces),
    visible: transform.visible !== false,
    locked: false,
    revision: 1,
    doubleSided: transform.doubleSided,
    skinWeights,
  });
}

function meshWithoutFaces(mesh: CADMesh, removeFaceIds: Set<string>): CADMesh | null {
  const faces = mesh.faces.filter((f) => !removeFaceIds.has(f.id));
  if (faces.length === 0) return null;
  const used = new Set<string>();
  faces.forEach((f) => f.vertexIds.forEach((id) => used.add(id)));
  const vertices = mesh.vertices.filter((v) => used.has(v.id));
  const skinWeights = mesh.skinWeights
    ? Object.fromEntries(
        Object.entries(mesh.skinWeights).filter(([vid]) => used.has(vid)),
      )
    : undefined;
  return finalizeEditableMesh({
    ...mesh,
    vertices,
    faces,
    edges: createEdgesFromFaces(faces),
    skinWeights,
    revision: (mesh.revision || 0) + 1,
  });
}

function finalizeSeparated(mesh: CADMesh): CADMesh {
  return recenterMeshOrigin(mesh);
}

/**
 * Blender-style Separate Selection: move selected faces into a new object.
 * Boundary verts are duplicated onto the new mesh (no shared topology).
 */
export function separateSelectedFaces(
  mesh: CADMesh,
  selectedFaceIds: string[],
): SeparateResult | null {
  if (!selectedFaceIds.length) return null;
  const idSet = new Set(selectedFaceIds);
  const selectedFaces = mesh.faces.filter((f) => idSet.has(f.id));
  if (!selectedFaces.length) return null;
  if (selectedFaces.length === mesh.faces.length) {
    // Separating everything → new object; original is removed.
    return {
      remaining: null,
      separated: [finalizeSeparated(remapFacesToNewVerts(mesh.faces, mesh.vertices, `${mesh.name}.sep`, mesh))],
    };
  }

  const separated = finalizeSeparated(
    remapFacesToNewVerts(selectedFaces, mesh.vertices, `${mesh.name}.sep`, mesh),
  );
  const remaining = meshWithoutFaces(mesh, idSet);
  return {
    remaining: remaining ? finalizeSeparated(remaining) : null,
    separated: [separated],
  };
}

/**
 * Connected face islands via shared vertices (loose parts).
 * Returns one mesh per island when there are 2+ islands.
 */
export function separateLooseParts(mesh: CADMesh): SeparateResult | null {
  if (mesh.faces.length < 2) return null;

  const faceById = new Map(mesh.faces.map((f) => [f.id, f]));
  const vertToFaces = new Map<string, string[]>();
  mesh.faces.forEach((f) => {
    f.vertexIds.forEach((vid) => {
      const list = vertToFaces.get(vid) || [];
      list.push(f.id);
      vertToFaces.set(vid, list);
    });
  });

  const visited = new Set<string>();
  const islands: Face[][] = [];

  mesh.faces.forEach((seed) => {
    if (visited.has(seed.id)) return;
    const island: Face[] = [];
    const stack = [seed.id];
    visited.add(seed.id);
    while (stack.length) {
      const fid = stack.pop()!;
      const face = faceById.get(fid);
      if (!face) continue;
      island.push(face);
      face.vertexIds.forEach((vid) => {
        (vertToFaces.get(vid) || []).forEach((nid) => {
          if (visited.has(nid)) return;
          visited.add(nid);
          stack.push(nid);
        });
      });
    }
    islands.push(island);
  });

  if (islands.length < 2) return null;

  // Keep the largest island on the original object; peel the rest off.
  islands.sort((a, b) => b.length - a.length);
  const [keep, ...rest] = islands;
  const keepIds = new Set(keep.map((f) => f.id));
  const remaining = meshWithoutFaces(mesh, new Set(mesh.faces.map((f) => f.id).filter((id) => !keepIds.has(id))));
  const separated = rest.map((faces, i) =>
    finalizeSeparated(
      remapFacesToNewVerts(faces, mesh.vertices, `${mesh.name}.part${i + 1}`, mesh),
    ),
  );

  return {
    remaining: finalizeSeparated(
      remaining ?? remapFacesToNewVerts(keep, mesh.vertices, mesh.name, mesh),
    ),
    separated,
  };
}
