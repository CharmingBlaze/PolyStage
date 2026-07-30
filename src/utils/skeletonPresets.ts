import * as THREE from 'three';
import type { CADBone, CADMesh, Vector3D } from '../types/cad';
import {
  createBone,
  createHumanoidRig,
  createQuadrupedRig,
  getBoneWorldMatrices,
} from './rigging';

const v = (x = 0, y = 0, z = 0): Vector3D => ({ x, y, z });

export type SkeletonPresetId = 'human' | 'bird' | 'dog' | 'fish';

export interface SkeletonPresetMeta {
  id: SkeletonPresetId;
  label: string;
  description: string;
  boneCount: number;
}

export const SKELETON_PRESETS: SkeletonPresetMeta[] = [
  { id: 'human', label: 'Human', description: 'Biped: hips, spine, arms, legs, head.', boneCount: 20 },
  { id: 'bird', label: 'Bird', description: 'Body + wings + 2 legs + head + tail.', boneCount: 13 },
  { id: 'dog', label: 'Dog / Quadruped', description: 'Spine, four legs, neck, head, tail.', boneCount: 22 },
  { id: 'fish', label: 'Fish', description: 'Head-to-tail chain for swimming deformation.', boneCount: 8 },
];

/** Bird skeleton matching GLB Animator-style hierarchy (~13 bones). */
export function createBirdRig(size = 1.6): CADBone[] {
  const s = size;
  const body = createBone('Body', null, v(0, s * 0.55, 0), s * 0.45);
  body.color = '#f472b6';
  const neck = createBone('Neck', body.id, v(0, s * 0.2, s * 0.28), s * 0.28);
  neck.color = '#60a5fa';
  const head = createBone('Head', neck.id, v(0, s * 0.12, s * 0.2), s * 0.22);
  head.color = '#fbbf24';

  const tailBase = createBone('TailBase', body.id, v(0, s * 0.05, -s * 0.35), s * 0.28);
  tailBase.color = '#34d399';
  const tailTip = createBone('TailTip', tailBase.id, v(0, -s * 0.02, -s * 0.28), s * 0.22);
  tailTip.color = '#a78bfa';

  const wingL = createBone('WingL_Upper', body.id, v(-s * 0.15, s * 0.12, s * 0.05), s * 0.4);
  wingL.rotation.z = Math.PI / 2;
  wingL.restRotation = { ...wingL.rotation };
  wingL.color = '#38bdf8';
  const wingLTip = createBone('WingL_Tip', wingL.id, v(0, s * 0.4, 0), s * 0.35);
  wingLTip.color = '#818cf8';

  const wingR = createBone('WingR_Upper', body.id, v(s * 0.15, s * 0.12, s * 0.05), s * 0.4);
  wingR.rotation.z = -Math.PI / 2;
  wingR.restRotation = { ...wingR.rotation };
  wingR.color = '#38bdf8';
  const wingRTip = createBone('WingR_Tip', wingR.id, v(0, s * 0.4, 0), s * 0.35);
  wingRTip.color = '#818cf8';
  wingL.mirrorBoneId = wingR.id;
  wingR.mirrorBoneId = wingL.id;
  wingLTip.mirrorBoneId = wingRTip.id;
  wingRTip.mirrorBoneId = wingLTip.id;

  const legL = createBone('LegL', body.id, v(-s * 0.12, -s * 0.05, s * 0.05), s * 0.35);
  legL.rotation.z = Math.PI;
  legL.restRotation = { ...legL.rotation };
  legL.color = '#fb923c';
  const footL = createBone('FootL', legL.id, v(0, s * 0.35, s * 0.08), s * 0.18);
  footL.color = '#f97316';

  const legR = createBone('LegR', body.id, v(s * 0.12, -s * 0.05, s * 0.05), s * 0.35);
  legR.rotation.z = Math.PI;
  legR.restRotation = { ...legR.rotation };
  legR.color = '#fb923c';
  const footR = createBone('FootR', legR.id, v(0, s * 0.35, s * 0.08), s * 0.18);
  footR.color = '#f97316';
  legL.mirrorBoneId = legR.id;
  legR.mirrorBoneId = legL.id;
  footL.mirrorBoneId = footR.id;
  footR.mirrorBoneId = footL.id;

  return [body, neck, head, tailBase, tailTip, wingL, wingLTip, wingR, wingRTip, legL, footL, legR, footR];
}

/** Fish chain along +Z for swimming. */
export function createFishRig(length = 2.2): CADBone[] {
  const seg = length / 7;
  const head = createBone('Head', null, v(0, length * 0.15, length * 0.35), seg);
  head.color = '#38bdf8';
  const mid1 = createBone('Mid1', head.id, v(0, 0, -seg), seg);
  mid1.color = '#60a5fa';
  const mid2 = createBone('Mid2', mid1.id, v(0, 0, -seg), seg);
  mid2.color = '#818cf8';
  const mid3 = createBone('Mid3', mid2.id, v(0, 0, -seg), seg);
  mid3.color = '#a78bfa';
  const mid4 = createBone('Mid4', mid3.id, v(0, 0, -seg), seg);
  mid4.color = '#c084fc';
  const tail1 = createBone('Tail1', mid4.id, v(0, 0, -seg), seg * 0.9);
  tail1.color = '#e879f9';
  const tail2 = createBone('Tail2', tail1.id, v(0, 0, -seg * 0.9), seg * 0.8);
  tail2.color = '#f472b6';
  const fin = createBone('TailFin', tail2.id, v(0, 0, -seg * 0.7), seg * 0.6);
  fin.color = '#fb7185';
  return [head, mid1, mid2, mid3, mid4, tail1, tail2, fin];
}

export function createDogRig(size = 2): CADBone[] {
  return createQuadrupedRig(size);
}

export function createPresetSkeleton(id: SkeletonPresetId, sizeHint = 2): CADBone[] {
  switch (id) {
    case 'human':
      return createHumanoidRig(Math.max(1.6, sizeHint * 1.4));
    case 'bird':
      return createBirdRig(Math.max(0.8, sizeHint));
    case 'dog':
      return createDogRig(Math.max(1.0, sizeHint));
    case 'fish':
      return createFishRig(Math.max(1.2, sizeHint * 1.2));
    default:
      return createHumanoidRig(sizeHint);
  }
}

export function meshBounds(mesh: CADMesh): { min: THREE.Vector3; max: THREE.Vector3; center: THREE.Vector3; size: THREE.Vector3 } {
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  mesh.vertices.forEach((vertex) => {
    const wx = vertex.x * mesh.scale.x + mesh.position.x;
    const wy = vertex.y * mesh.scale.y + mesh.position.y;
    const wz = vertex.z * mesh.scale.z + mesh.position.z;
    min.min(new THREE.Vector3(wx, wy, wz));
    max.max(new THREE.Vector3(wx, wy, wz));
  });
  if (!Number.isFinite(min.x)) {
    min.set(-0.5, 0, -0.5);
    max.set(0.5, 1, 0.5);
  }
  const center = min.clone().add(max).multiplyScalar(0.5);
  const size = max.clone().sub(min);
  return { min, max, center, size };
}

/** Scale + translate a preset so its bone AABB matches the mesh AABB (centered). */
export function fitSkeletonToMesh(bones: CADBone[], mesh: CADMesh): CADBone[] {
  if (!bones.length || !mesh.vertices.length) return bones;
  const { center: meshCenter, size: meshSize } = meshBounds(mesh);

  const matrices = getBoneWorldMatrices(bones, true);
  const boneMin = new THREE.Vector3(Infinity, Infinity, Infinity);
  const boneMax = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  bones.forEach((bone) => {
    const world = matrices.get(bone.id) || new THREE.Matrix4();
    const joint = new THREE.Vector3().setFromMatrixPosition(world);
    const tip = new THREE.Vector3(0, bone.length || 0.01, 0).applyMatrix4(world);
    boneMin.min(joint).min(tip);
    boneMax.max(joint).max(tip);
  });
  const boneCenter = boneMin.clone().add(boneMax).multiplyScalar(0.5);
  const boneSize = boneMax.clone().sub(boneMin);
  const sx = boneSize.x > 1e-4 ? meshSize.x / boneSize.x : 1;
  const sy = boneSize.y > 1e-4 ? meshSize.y / boneSize.y : 1;
  const sz = boneSize.z > 1e-4 ? meshSize.z / boneSize.z : 1;
  const scale = Math.max(0.15, Math.min(sx, sy, sz) * 0.92);

  return bones.map((bone) => {
    const isRoot = !bone.parentId;
    const position = isRoot
      ? {
          x: (bone.position.x - boneCenter.x) * scale + meshCenter.x,
          y: (bone.position.y - boneCenter.y) * scale + meshCenter.y,
          z: (bone.position.z - boneCenter.z) * scale + meshCenter.z,
        }
      : {
          x: bone.position.x * scale,
          y: bone.position.y * scale,
          z: bone.position.z * scale,
        };
    const length = Math.max(0.05, bone.length * scale);
    return {
      ...bone,
      position,
      restPosition: { ...position },
      length,
      restScale: { ...(bone.restScale || bone.scale) },
    };
  });
}

export function applySkeletonPreset(id: SkeletonPresetId, mesh: CADMesh | null): CADBone[] {
  const hint = mesh ? Math.max(meshBounds(mesh).size.length() * 0.55, 0.8) : 2;
  const raw = createPresetSkeleton(id, hint);
  return mesh ? fitSkeletonToMesh(raw, mesh) : raw;
}
