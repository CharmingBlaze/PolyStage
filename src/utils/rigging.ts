import type { CADBone, CADMesh, Vector3D } from '../types/cad';
import * as THREE from 'three';
import { RIG_FORMAT } from '../brand';

const v = (x = 0, y = 0, z = 0): Vector3D => ({ x, y, z });

export function createBone(name: string, parentId: string | null, position = v(), length = 0.8): CADBone {
  return {
    id: `bone_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    parentId,
    position: { ...position },
    rotation: v(),
    scale: v(1, 1, 1),
    restPosition: { ...position },
    restRotation: v(),
    restScale: v(1, 1, 1),
    length,
    assignedMeshIds: [],
    color: '#ed7300',
    deform: true,
    inheritRotation: true,
    visible: true,
    locked: false,
    mirrorBoneId: null,
    constraints: [],
  };
}

export function createsCycle(bones: CADBone[], boneId: string, parentId: string | null): boolean {
  let cursor = parentId;
  const visited = new Set<string>();
  while (cursor) {
    if (cursor === boneId || visited.has(cursor)) return true;
    visited.add(cursor);
    cursor = bones.find((bone) => bone.id === cursor)?.parentId || null;
  }
  return false;
}

export function getBoneDepth(bones: CADBone[], boneId: string): number {
  let depth = 0;
  let cursor = bones.find((bone) => bone.id === boneId)?.parentId || null;
  const visited = new Set<string>();
  while (cursor && !visited.has(cursor)) {
    visited.add(cursor);
    depth += 1;
    cursor = bones.find((bone) => bone.id === cursor)?.parentId || null;
  }
  return depth;
}

export function deleteBoneBranch(bones: CADBone[], boneId: string): CADBone[] {
  const removed = new Set([boneId]);
  let changed = true;
  while (changed) {
    changed = false;
    bones.forEach((bone) => {
      if (bone.parentId && removed.has(bone.parentId) && !removed.has(bone.id)) {
        removed.add(bone.id);
        changed = true;
      }
    });
  }
  return bones.filter((bone) => !removed.has(bone.id));
}

export function normalizeInfluences(influences: Array<{ boneId: string; weight: number }>, maxInfluences = 4) {
  const strongest = influences
    .filter((item) => Number.isFinite(item.weight) && item.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, maxInfluences);
  const total = strongest.reduce((sum, item) => sum + item.weight, 0);
  if (!total) return [];
  return strongest.map((item) => ({ boneId: item.boneId, weight: item.weight / total }));
}

export function bindMeshRigid(mesh: CADMesh, bone: CADBone): CADMesh {
  const skinWeights = Object.fromEntries(mesh.vertices.map((vertex) => [
    vertex.id,
    [{ boneId: bone.id, weight: 1 }],
  ]));
  return { ...mesh, boneId: bone.id, skinWeights };
}

export function autoWeightMesh(
  mesh: CADMesh,
  bones: CADBone[],
  maxInfluences = 4,
  options?: { axialSigma?: number; radialSigma?: number },
): CADMesh {
  const deformBones = bones.filter((bone) => bone.deform !== false);
  if (!deformBones.length) return mesh;
  const worldMatrices = getBoneWorldMatrices(bones, true);
  const axialSigma = options?.axialSigma ?? 0.35;
  const radialSigma = options?.radialSigma ?? 0.18;

  const skinWeights = Object.fromEntries(mesh.vertices.map((vertex) => {
    // Vertices and bones share scene/bind space (mesh transform applied at draw time).
    const point = new THREE.Vector3(vertex.x, vertex.y, vertex.z);
    const weighted = deformBones.map((bone) => {
      const world = worldMatrices.get(bone.id) || new THREE.Matrix4();
      const joint = new THREE.Vector3().setFromMatrixPosition(world);
      const tip = new THREE.Vector3(0, bone.length || 0.01, 0).applyMatrix4(world);
      const axis = tip.clone().sub(joint);
      const len = Math.max(1e-5, axis.length());
      const dir = axis.multiplyScalar(1 / len);
      const toPoint = point.clone().sub(joint);
      const along = Math.max(0, Math.min(len, toPoint.dot(dir)));
      const closest = joint.clone().add(dir.clone().multiplyScalar(along));
      const radial = point.distanceTo(closest);
      // Anisotropic Gaussian: tighter perpendicular falloff separates limbs from body.
      const axialTerm = (along - len * 0.5) / (axialSigma * len + 1e-5);
      const radialTerm = radial / (radialSigma * Math.max(0.15, len) + 1e-5);
      const weight = Math.exp(-0.5 * (axialTerm * axialTerm + radialTerm * radialTerm));
      return { boneId: bone.id, weight: Math.max(1e-6, weight) };
    });
    return [vertex.id, normalizeInfluences(weighted, maxInfluences)];
  }));
  return { ...mesh, boneId: null, skinWeights };
}

/** Bind ON: compute anisotropic weights from the current rest skeleton. */
export function bindSkinToSkeleton(mesh: CADMesh, bones: CADBone[]): CADMesh {
  return autoWeightMesh(mesh, bones, 4);
}

/** Bind OFF: clear skin so mesh shows in bind/rest shape while bones stay editable. */
export function unbindSkin(mesh: CADMesh): CADMesh {
  return clearSkin(mesh);
}

export function clearSkin(mesh: CADMesh): CADMesh {
  return { ...mesh, boneId: null, skinWeights: undefined };
}

export function getBoneWorldMatrices(bones: CADBone[], rest: boolean) {
  const matrices = new Map<string, THREE.Matrix4>();
  const resolve = (bone: CADBone, visiting = new Set<string>()): THREE.Matrix4 => {
    const cached = matrices.get(bone.id);
    if (cached) return cached;
    if (visiting.has(bone.id)) return new THREE.Matrix4();
    visiting.add(bone.id);
    const position = rest ? bone.restPosition || bone.position : bone.position;
    const rotation = rest ? bone.restRotation || bone.rotation : bone.rotation;
    const scale = rest ? bone.restScale || bone.scale : bone.scale;
    const local = new THREE.Matrix4().compose(
      new THREE.Vector3(position.x, position.y, position.z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation.x, rotation.y, rotation.z)),
      new THREE.Vector3(scale.x, scale.y, scale.z),
    );
    const parent = bone.parentId ? bones.find((candidate) => candidate.id === bone.parentId) : null;
    let world = local;
    if (parent) {
      const parentWorld = resolve(parent, visiting);
      if (bone.inheritRotation === false) {
        // Keep parent translation/scale chain, but ignore parent rotation for this bone.
        const parentPos = new THREE.Vector3();
        const parentQuat = new THREE.Quaternion();
        const parentScale = new THREE.Vector3();
        parentWorld.decompose(parentPos, parentQuat, parentScale);
        const parentTranslate = new THREE.Matrix4().compose(
          parentPos,
          new THREE.Quaternion(),
          parentScale,
        );
        world = parentTranslate.multiply(local);
      } else {
        world = parentWorld.clone().multiply(local);
      }
    }
    matrices.set(bone.id, world);
    visiting.delete(bone.id);
    return world;
  };
  bones.forEach((bone) => resolve(bone));
  return matrices;
}

export function deformMeshWithBones(mesh: CADMesh, bones: CADBone[]): CADMesh {
  if (!mesh.skinWeights || !bones.length) return mesh;
  const rest = getBoneWorldMatrices(bones, true);
  const pose = getBoneWorldMatrices(bones, false);
  const deltas = new Map<string, THREE.Matrix4>();
  bones.forEach((bone) => {
    if (bone.deform === false) return;
    const restMatrix = rest.get(bone.id);
    const poseMatrix = pose.get(bone.id);
    if (restMatrix && poseMatrix) deltas.set(bone.id, poseMatrix.clone().multiply(restMatrix.clone().invert()));
  });

  return {
    ...mesh,
    vertices: mesh.vertices.map((vertex) => {
      const influences = normalizeInfluences(
        (mesh.skinWeights?.[vertex.id] || []).filter((inf) => deltas.has(inf.boneId)),
      );
      if (!influences.length) return vertex;
      const source = new THREE.Vector3(vertex.x, vertex.y, vertex.z);
      const output = new THREE.Vector3();
      influences.forEach((influence) => {
        const delta = deltas.get(influence.boneId);
        if (delta) output.add(source.clone().applyMatrix4(delta).multiplyScalar(influence.weight));
      });
      return { ...vertex, x: output.x, y: output.y, z: output.z };
    }),
  };
}

/** Paint / adjust a single vertex influence for a bone, then normalize to max 4. */
export function paintVertexWeight(
  mesh: CADMesh,
  vertexId: string,
  boneId: string,
  mode: 'add' | 'subtract' | 'smooth' | 'replace',
  strength: number,
  neighborIds: string[] = [],
): CADMesh {
  const skinWeights = { ...(mesh.skinWeights || {}) };
  const current = [...(skinWeights[vertexId] || [])];
  const idx = current.findIndex((inf) => inf.boneId === boneId);
  const existing = idx >= 0 ? current[idx].weight : 0;

  let nextWeight = existing;
  if (mode === 'add') nextWeight = Math.min(1, existing + strength);
  else if (mode === 'subtract') nextWeight = Math.max(0, existing - strength);
  else if (mode === 'replace') nextWeight = Math.max(0, Math.min(1, strength));
  else if (mode === 'smooth') {
    const neighborAvg =
      neighborIds.length === 0
        ? existing
        : neighborIds.reduce((sum, nid) => {
            const w = skinWeights[nid]?.find((inf) => inf.boneId === boneId)?.weight || 0;
            return sum + w;
          }, 0) / neighborIds.length;
    nextWeight = existing + (neighborAvg - existing) * strength;
  }

  const without = current.filter((inf) => inf.boneId !== boneId);
  if (nextWeight > 1e-4) without.push({ boneId, weight: nextWeight });
  skinWeights[vertexId] = normalizeInfluences(without, 4);
  return { ...mesh, skinWeights, boneId: null };
}

export function createHumanoidRig(height = 3.2): CADBone[] {
  const unit = height / 8;
  const root = createBone('Root', null, v(0, 0, 0), unit);
  const hips = createBone('Hips', root.id, v(0, unit, 0), unit);
  const spine = createBone('Spine', hips.id, v(0, unit, 0), unit);
  const chest = createBone('Chest', spine.id, v(0, unit, 0), unit);
  const neck = createBone('Neck', chest.id, v(0, unit, 0), unit * 0.5);
  const head = createBone('Head', neck.id, v(0, unit * 0.5, 0), unit);
  const makeLimb = (side: 'L' | 'R', sign: number) => {
    const upperArm = createBone(`UpperArm.${side}`, chest.id, v(sign * unit * 0.65, unit * 0.75, 0), unit);
    upperArm.rotation.z = -sign * Math.PI / 2;
    upperArm.restRotation = { ...upperArm.rotation };
    const lowerArm = createBone(`LowerArm.${side}`, upperArm.id, v(0, unit, 0), unit);
    const hand = createBone(`Hand.${side}`, lowerArm.id, v(0, unit, 0), unit * 0.45);
    const upperLeg = createBone(`UpperLeg.${side}`, hips.id, v(sign * unit * 0.35, 0, 0), unit * 1.5);
    upperLeg.rotation.z = Math.PI;
    upperLeg.restRotation = { ...upperLeg.rotation };
    const lowerLeg = createBone(`LowerLeg.${side}`, upperLeg.id, v(0, unit * 1.5, 0), unit * 1.5);
    const foot = createBone(`Foot.${side}`, lowerLeg.id, v(0, unit * 1.5, 0), unit * 0.75);
    upperArm.mirrorBoneId = side === 'L' ? undefined : null;
    return [upperArm, lowerArm, hand, upperLeg, lowerLeg, foot];
  };
  const left = makeLimb('L', -1);
  const right = makeLimb('R', 1);
  for (let i = 0; i < left.length; i += 1) {
    left[i].mirrorBoneId = right[i].id;
    right[i].mirrorBoneId = left[i].id;
  }
  return [root, hips, spine, chest, neck, head, ...left, ...right];
}

export function createQuadrupedRig(size = 2.0): CADBone[] {
  const root = createBone('Root', null, v(0, 0, 0), size * 0.3);
  const spine = createBone('Spine', root.id, v(0, size * 0.5, -size * 0.2), size * 0.5);
  const chest = createBone('Chest', spine.id, v(0, 0, size * 0.5), size * 0.4);
  const neck = createBone('Neck', chest.id, v(0, size * 0.2, size * 0.3), size * 0.3);
  const head = createBone('Head', neck.id, v(0, size * 0.2, size * 0.2), size * 0.3);

  const makeLeg = (name: string, parentId: string, posX: number, posZ: number) => {
    const hip = createBone(`${name}_Hip`, parentId, v(posX, 0, posZ), size * 0.2);
    const legUpper = createBone(`${name}_Upper`, hip.id, v(0, -size * 0.1, 0), size * 0.4);
    const legLower = createBone(`${name}_Lower`, legUpper.id, v(0, -size * 0.4, 0), size * 0.4);
    const foot = createBone(`${name}_Foot`, legLower.id, v(0, -size * 0.4, 0), size * 0.2);
    return [hip, legUpper, legLower, foot];
  };

  const frontL = makeLeg('Front_L', chest.id, -size * 0.25, size * 0.1);
  const frontR = makeLeg('Front_R', chest.id, size * 0.25, size * 0.1);
  const backL = makeLeg('Back_L', spine.id, -size * 0.25, -size * 0.2);
  const backR = makeLeg('Back_R', spine.id, size * 0.25, -size * 0.2);

  const tail1 = createBone('Tail_1', spine.id, v(0, 0, -size * 0.3), size * 0.3);
  const tail2 = createBone('Tail_2', tail1.id, v(0, -size * 0.05, -size * 0.3), size * 0.3);

  return [root, spine, chest, neck, head, ...frontL, ...frontR, ...backL, ...backR, tail1, tail2];
}

export function createTailChainRig(count = 5, segmentLength = 0.5): CADBone[] {
  const root = createBone('Root', null, v(0, 0, 0), segmentLength);
  const bones: CADBone[] = [root];
  let currentParentId = root.id;
  for (let i = 1; i < count; i++) {
    const segment = createBone(`Segment_${i}`, currentParentId, v(0, segmentLength, 0), segmentLength);
    bones.push(segment);
    currentParentId = segment.id;
  }
  return bones;
}

export function resetPoseToRest(bones: CADBone[]): CADBone[] {
  return bones.map((bone) => ({
    ...bone,
    position: bone.restPosition ? { ...bone.restPosition } : { ...bone.position },
    rotation: bone.restRotation ? { ...bone.restRotation } : { ...bone.rotation },
    scale: bone.restScale ? { ...bone.restScale } : { ...bone.scale },
  }));
}

export function setRestToCurrentPose(bones: CADBone[]): CADBone[] {
  return bones.map((bone) => ({
    ...bone,
    restPosition: { ...bone.position },
    restRotation: { ...bone.rotation },
    restScale: { ...bone.scale },
  }));
}

export function validateRig(bones: CADBone[], meshes: CADMesh[]) {
  const ids = new Set(bones.map((bone) => bone.id));
  const missingParents = bones.filter((bone) => bone.parentId && !ids.has(bone.parentId)).length;
  const cycles = bones.filter((bone) => createsCycle(bones, bone.id, bone.parentId)).length;
  const unweightedVertices = meshes.reduce((count, mesh) =>
    count + mesh.vertices.filter((vertex) => !(mesh.skinWeights?.[vertex.id]?.length || mesh.boneId)).length, 0);
  const roots = bones.filter((bone) => !bone.parentId).length;
  return { missingParents, cycles, unweightedVertices, roots, valid: missingParents === 0 && cycles === 0 };
}

export function exportGameRig(bones: CADBone[], meshes: CADMesh[]): string {
  return JSON.stringify({
    format: RIG_FORMAT,
    version: 1,
    coordinateSystem: 'Y_UP_RIGHT_HANDED',
    maxInfluences: 4,
    bones: bones.map((bone) => ({
      id: bone.id,
      name: bone.name,
      parentId: bone.parentId,
      rest: {
        position: bone.restPosition || bone.position,
        rotation: bone.restRotation || bone.rotation,
        scale: bone.restScale || bone.scale,
      },
      pose: { position: bone.position, rotation: bone.rotation, scale: bone.scale },
      length: bone.length,
      deform: bone.deform !== false,
      constraints: bone.constraints || [],
    })),
    skins: meshes.map((mesh) => ({
      meshId: mesh.id,
      meshName: mesh.name,
      rigidBoneId: mesh.boneId || null,
      weights: mesh.skinWeights || {},
    })),
  }, null, 2);
}

