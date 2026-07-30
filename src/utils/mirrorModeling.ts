import type { CADBone, CADMesh, Face, MeshModifier, MirrorAxis, Vertex } from '../types/cad';
import { generateId, createEdgesFromFaces } from './meshUtils';
import { finalizeEditableMesh } from './topology/validate';
import { applySimpleSubdivideLevels, catmullClarkSubdivide } from './subdivision';

const axisCoord = (v: { x: number; y: number; z: number }, axis: MirrorAxis) =>
  axis === 'x' ? v.x : axis === 'y' ? v.y : v.z;

const setAxisCoord = <T extends { x: number; y: number; z: number }>(v: T, axis: MirrorAxis, value: number): T => {
  if (axis === 'x') return { ...v, x: value };
  if (axis === 'y') return { ...v, y: value };
  return { ...v, z: value };
};

export const flipAxis = <T extends { x: number; y: number; z: number }>(v: T, axis: MirrorAxis): T => {
  if (axis === 'x') return { ...v, x: -v.x };
  if (axis === 'y') return { ...v, y: -v.y };
  return { ...v, z: -v.z };
};

export type { MirrorAxis };

/** Clip mesh to the negative side of the mirror plane and weld verts near the plane. */
export function clipMeshToMirrorPlane(
  mesh: CADMesh,
  axis: MirrorAxis,
  threshold = 0.001,
): CADMesh {
  const keepVert = new Map<string, Vertex>();
  const idMap = new Map<string, string>();

  mesh.vertices.forEach((v) => {
    const c = axisCoord(v, axis);
    if (c > threshold) return;
    if (Math.abs(c) <= threshold) {
      const weldedPos = setAxisCoord({ x: v.x, y: v.y, z: v.z }, axis, 0);
      const existing = [...keepVert.values()].find((o) =>
        Math.abs(o.x - weldedPos.x) < threshold
        && Math.abs(o.y - weldedPos.y) < threshold
        && Math.abs(o.z - weldedPos.z) < threshold,
      );
      if (existing) {
        idMap.set(v.id, existing.id);
        return;
      }
      const welded: Vertex = { ...v, id: generateId(), ...weldedPos };
      keepVert.set(welded.id, welded);
      idMap.set(v.id, welded.id);
      return;
    }
    const nv = { ...v, id: generateId() };
    keepVert.set(nv.id, nv);
    idMap.set(v.id, nv.id);
  });

  const faces: Face[] = [];
  mesh.faces.forEach((f) => {
    const mapped = f.vertexIds.map((id) => idMap.get(id)).filter(Boolean) as string[];
    if (mapped.length !== f.vertexIds.length) return;
    if (new Set(mapped).size < 3) return;
    faces.push({
      ...f,
      id: generateId(),
      vertexIds: mapped,
      uvs: f.uvs.map((uv) => ({ ...uv })),
    });
  });

  return finalizeEditableMesh({
    ...mesh,
    vertices: [...keepVert.values()],
    faces,
    edges: createEdgesFromFaces(faces),
  });
}

/**
 * Blender-like Mirror: optionally clip, then duplicate flipped across axis and merge plane verts.
 */
export function applyMirrorSymmetry(
  mesh: CADMesh,
  axis: MirrorAxis = 'x',
  options: { clip?: boolean; mergeThreshold?: number } = {},
): CADMesh {
  const threshold = options.mergeThreshold ?? 0.001;
  let base = mesh;
  if (options.clip) {
    base = clipMeshToMirrorPlane(mesh, axis, threshold);
  }

  const vertMap = new Map<string, string>();
  const newVerts: Vertex[] = [...base.vertices];
  const planeVerts = new Set<string>();

  base.vertices.forEach((v) => {
    const c = axisCoord(v, axis);
    if (Math.abs(c) <= threshold) {
      vertMap.set(v.id, v.id);
      planeVerts.add(v.id);
      return;
    }
    const mirroredId = generateId();
    vertMap.set(v.id, mirroredId);
    newVerts.push({
      ...flipAxis({ x: v.x, y: v.y, z: v.z }, axis),
      id: mirroredId,
      boneId: v.boneId,
      normal: v.normal ? flipAxis(v.normal, axis) : undefined,
    });
  });

  const newFaces: Face[] = [...base.faces];
  base.faces.forEach((face) => {
    const allOnPlane = face.vertexIds.every((id) => planeVerts.has(id));
    if (allOnPlane) return;
    const mirroredVIds = face.vertexIds.map((vId) => vertMap.get(vId)!).reverse();
    newFaces.push({
      id: generateId(),
      vertexIds: mirroredVIds,
      uvs: [...face.uvs].reverse().map((uv) => ({ ...uv })),
      color: face.color,
      materialId: face.materialId,
      textureIndex: face.textureIndex,
    });
  });

  let skinWeights = base.skinWeights ? { ...base.skinWeights } : undefined;
  if (skinWeights) {
    const next: NonNullable<typeof skinWeights> = { ...skinWeights };
    Object.entries(skinWeights).forEach(([vid, weights]) => {
      const mid = vertMap.get(vid);
      if (mid && mid !== vid) next[mid] = weights.map((w) => ({ ...w }));
    });
    skinWeights = next;
  }

  return finalizeEditableMesh({
    ...base,
    vertices: newVerts,
    faces: newFaces,
    edges: createEdgesFromFaces(newFaces),
    skinWeights,
    revision: (base.revision || 0) + 1,
  });
}

export function syncSymmetricalVertices(
  mesh: CADMesh,
  modifiedVertIds: string[],
  axis: MirrorAxis = 'x',
  threshold = 0.05,
): CADMesh {
  const modified = new Set(modifiedVertIds);

  const updatedVertices = mesh.vertices.map((v) => {
    if (modified.has(v.id)) return v;

    const match = mesh.vertices.find((other) => {
      if (other.id === v.id || !modified.has(other.id)) return false;
      if (axis === 'x') {
        return Math.abs(other.x + v.x) < threshold
          && Math.abs(other.y - v.y) < threshold
          && Math.abs(other.z - v.z) < threshold;
      }
      if (axis === 'y') {
        return Math.abs(other.y + v.y) < threshold
          && Math.abs(other.x - v.x) < threshold
          && Math.abs(other.z - v.z) < threshold;
      }
      return Math.abs(other.z + v.z) < threshold
        && Math.abs(other.x - v.x) < threshold
        && Math.abs(other.y - v.y) < threshold;
    });

    if (!match) return v;
    return { ...v, ...flipAxis(match, axis), id: v.id };
  });

  return { ...mesh, vertices: updatedVertices, revision: (mesh.revision || 0) + 1 };
}

/** Mirror a bone (and optionally its children) across an axis — Blender armature mirror. */
export function mirrorBones(
  bones: CADBone[],
  rootBoneId: string,
  axis: MirrorAxis = 'x',
  options: { includeChildren?: boolean } = {},
): { bones: CADBone[]; newSelectionId: string } {
  const includeChildren = options.includeChildren ?? true;
  const toMirror = new Set<string>();
  const collect = (id: string) => {
    toMirror.add(id);
    if (!includeChildren) return;
    bones.forEach((b) => {
      if (b.parentId === id) collect(b.id);
    });
  };
  collect(rootBoneId);

  const idMap = new Map<string, string>();
  toMirror.forEach((id) => idMap.set(id, generateId()));

  const rename = (name: string) => {
    if (name.endsWith('.L')) return name.replace(/\.L$/, '.R');
    if (name.endsWith('.R')) return name.replace(/\.R$/, '.L');
    if (name.endsWith('_L')) return name.replace(/_L$/, '_R');
    if (name.endsWith('_R')) return name.replace(/_R$/, '_L');
    return `${name}.mirror`;
  };

  const flipRot = (r: { x: number; y: number; z: number }) => {
    if (axis === 'x') return { x: r.x, y: -r.y, z: -r.z };
    if (axis === 'y') return { x: -r.x, y: r.y, z: -r.z };
    return { x: -r.x, y: -r.y, z: r.z };
  };

  const mirrored: CADBone[] = [];
  bones.forEach((bone) => {
    if (!toMirror.has(bone.id)) return;
    const newId = idMap.get(bone.id)!;
    const parentId = bone.parentId ? (idMap.get(bone.parentId) || bone.parentId) : null;
    mirrored.push({
      ...bone,
      id: newId,
      name: rename(bone.name),
      parentId,
      position: flipAxis(bone.position, axis),
      rotation: flipRot(bone.rotation),
      restPosition: bone.restPosition ? flipAxis(bone.restPosition, axis) : flipAxis(bone.position, axis),
      restRotation: bone.restRotation ? flipRot(bone.restRotation) : flipRot(bone.rotation),
      mirrorBoneId: bone.id,
      constraints: bone.constraints?.map((c) => ({
        ...c,
        targetBoneId: c.targetBoneId ? (idMap.get(c.targetBoneId) || c.targetBoneId) : c.targetBoneId,
      })),
    });
  });

  const next = bones.map((b) => {
    if (!toMirror.has(b.id)) return b;
    const twin = idMap.get(b.id);
    return twin ? { ...b, mirrorBoneId: twin } : b;
  });

  return {
    bones: [...next, ...mirrored],
    newSelectionId: idMap.get(rootBoneId) || rootBoneId,
  };
}

export function syncMirroredBonePose(bones: CADBone[], editedBoneId: string, axis: MirrorAxis = 'x'): CADBone[] {
  const edited = bones.find((b) => b.id === editedBoneId);
  if (!edited?.mirrorBoneId) return bones;
  const twinId = edited.mirrorBoneId;
  const flipRot = (r: { x: number; y: number; z: number }) => {
    if (axis === 'x') return { x: r.x, y: -r.y, z: -r.z };
    if (axis === 'y') return { x: -r.x, y: r.y, z: -r.z };
    return { x: -r.x, y: -r.y, z: r.z };
  };
  return bones.map((b) => {
    if (b.id !== twinId) return b;
    return {
      ...b,
      position: flipAxis(edited.position, axis),
      rotation: flipRot(edited.rotation),
      scale: { ...edited.scale },
    };
  });
}

export function createMirrorModifier(
  axis: MirrorAxis = 'x',
  clip = true,
  mergeThreshold = 0.001,
): MeshModifier {
  return {
    id: generateId(),
    type: 'mirror',
    enabled: true,
    axis,
    clip,
    mergeThreshold,
    mirrorBones: false,
  };
}

export function createSubdivisionModifier(levels = 1): MeshModifier {
  return {
    id: generateId(),
    type: 'subdivision',
    enabled: true,
    levels: Math.max(0, Math.min(4, levels)),
    algorithm: 'catmullClark',
  };
}

/** Evaluate non-destructive modifiers for display (does not mutate source). */
export function evaluateMeshModifiers(mesh: CADMesh, maxSubdivLevels = 2): CADMesh {
  let current: CADMesh = {
    ...mesh,
    vertices: mesh.vertices.map((v) => ({ ...v })),
    faces: mesh.faces.map((f) => ({ ...f, vertexIds: [...f.vertexIds], uvs: f.uvs.map((u) => ({ ...u })) })),
    edges: [...mesh.edges],
    modifiers: undefined,
  };
  const mods = mesh.modifiers || [];
  for (const mod of mods) {
    if (!mod.enabled) continue;
    if (mod.type === 'mirror') {
      current = applyMirrorSymmetry(current, mod.axis, {
        clip: mod.clip,
        mergeThreshold: mod.mergeThreshold,
      });
    } else if (mod.type === 'subdivision') {
      const levels = Math.min(mod.levels, maxSubdivLevels);
      if (levels <= 0) continue;
      current = mod.algorithm === 'simple'
        ? applySimpleSubdivideLevels(current, levels)
        : catmullClarkSubdivide(current, levels);
    }
  }
  return {
    ...current,
    id: mesh.id,
    name: mesh.name,
    position: mesh.position,
    rotation: mesh.rotation,
    scale: mesh.scale,
    modifiers: mesh.modifiers,
    textureCanvasDataUrl: mesh.textureCanvasDataUrl,
    boneId: mesh.boneId,
    skinWeights: mesh.skinWeights,
  };
}

export function applyModifiersToMesh(mesh: CADMesh): CADMesh {
  const evaluated = evaluateMeshModifiers(mesh, 4);
  return {
    ...evaluated,
    modifiers: [],
    revision: (mesh.revision || 0) + 1,
  };
}
