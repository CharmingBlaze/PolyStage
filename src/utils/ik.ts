import type { BoneConstraint, CADBone, Vector3D } from '../types/cad';
import * as THREE from 'three';
import { getBoneWorldMatrices } from './rigging';

const cloneV = (v: Vector3D): Vector3D => ({ x: v.x, y: v.y, z: v.z });

function eulerFromQuat(q: THREE.Quaternion): Vector3D {
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
  return { x: e.x, y: e.y, z: e.z };
}

function getWorldPosition(bones: CADBone[], boneId: string): THREE.Vector3 {
  const matrices = getBoneWorldMatrices(bones, false);
  const m = matrices.get(boneId);
  return m ? new THREE.Vector3().setFromMatrixPosition(m) : new THREE.Vector3();
}

function getChain(bones: CADBone[], tipId: string, chainLength: number): CADBone[] {
  const chain: CADBone[] = [];
  let cursor: CADBone | undefined = bones.find((b) => b.id === tipId);
  while (cursor && chain.length < chainLength) {
    chain.push(cursor);
    cursor = cursor.parentId ? bones.find((b) => b.id === cursor!.parentId) : undefined;
  }
  return chain; // [tip, ..., rootOfChain]
}

/**
 * CCD IK: rotate bones in the chain so the tip approaches the world-space target.
 * Returns updated bones array (pose only).
 */
export function solveCcdIk(
  bones: CADBone[],
  tipBoneId: string,
  targetWorld: Vector3D,
  chainLength = 3,
  iterations = 12,
  threshold = 0.001,
): CADBone[] {
  let result = bones.map((b) => ({
    ...b,
    position: cloneV(b.position),
    rotation: cloneV(b.rotation),
    scale: cloneV(b.scale),
  }));

  const chain = getChain(result, tipBoneId, Math.max(1, chainLength));
  if (chain.length < 2) return result;

  const target = new THREE.Vector3(targetWorld.x, targetWorld.y, targetWorld.z);

  for (let iter = 0; iter < iterations; iter += 1) {
    const tipPos = getWorldPosition(result, tipBoneId);
    if (tipPos.distanceTo(target) < threshold) break;

    // Rotate from parent of tip toward root (skip tip itself for rotation source).
    for (let i = 1; i < chain.length; i += 1) {
      const bone = chain[i];
      if (bone.locked) continue;

      const boneWorldPos = getWorldPosition(result, bone.id);
      const toTip = tipPos.clone().sub(boneWorldPos).normalize();
      const toTarget = target.clone().sub(boneWorldPos).normalize();
      if (toTip.lengthSq() < 1e-8 || toTarget.lengthSq() < 1e-8) continue;

      const delta = new THREE.Quaternion().setFromUnitVectors(toTip, toTarget);
      const matrices = getBoneWorldMatrices(result, false);
      const worldMatrix = matrices.get(bone.id) || new THREE.Matrix4();
      const parent = bone.parentId ? result.find((b) => b.id === bone.parentId) : null;
      const parentWorld = parent
        ? matrices.get(parent.id) || new THREE.Matrix4()
        : new THREE.Matrix4();

      const worldQuat = new THREE.Quaternion().setFromRotationMatrix(worldMatrix);
      const newWorldQuat = delta.multiply(worldQuat);
      const parentQuat = new THREE.Quaternion().setFromRotationMatrix(parentWorld);
      const localQuat = parentQuat.clone().invert().multiply(newWorldQuat);

      const idx = result.findIndex((b) => b.id === bone.id);
      if (idx >= 0) {
        result[idx] = { ...result[idx], rotation: eulerFromQuat(localQuat) };
      }

      // Refresh tip after each bone rotation
      tipPos.copy(getWorldPosition(result, tipBoneId));
      if (tipPos.distanceTo(target) < threshold) break;
    }
  }

  return result;
}

function clampAxis(value: number, min?: number, max?: number): number {
  let v = value;
  if (typeof min === 'number') v = Math.max(min, v);
  if (typeof max === 'number') v = Math.min(max, v);
  return v;
}

export function applyLimitRotation(bones: CADBone[]): CADBone[] {
  return bones.map((bone) => {
    const limit = bone.constraints?.find((c) => c.type === 'limit-rotation' && c.enabled);
    if (!limit) return bone;
    return {
      ...bone,
      rotation: {
        x: clampAxis(bone.rotation.x, limit.min?.x, limit.max?.x),
        y: clampAxis(bone.rotation.y, limit.min?.y, limit.max?.y),
        z: clampAxis(bone.rotation.z, limit.min?.z, limit.max?.z),
      },
    };
  });
}

export function applyCopyRotation(bones: CADBone[]): CADBone[] {
  return bones.map((bone) => {
    const copy = bone.constraints?.find((c) => c.type === 'copy-rotation' && c.enabled && c.targetBoneId);
    if (!copy?.targetBoneId) return bone;
    const source = bones.find((b) => b.id === copy.targetBoneId);
    if (!source) return bone;
    const influence = copy.influence ?? 1;
    return {
      ...bone,
      rotation: {
        x: bone.rotation.x + (source.rotation.x - bone.rotation.x) * influence,
        y: bone.rotation.y + (source.rotation.y - bone.rotation.y) * influence,
        z: bone.rotation.z + (source.rotation.z - bone.rotation.z) * influence,
      },
    };
  });
}

export function applyLookAt(bones: CADBone[]): CADBone[] {
  return bones.map((bone) => {
    const look = bone.constraints?.find((c) => c.type === 'look-at' && c.enabled && c.targetBoneId);
    if (!look?.targetBoneId) return bone;
    const targetPos = getWorldPosition(bones, look.targetBoneId);
    const bonePos = getWorldPosition(bones, bone.id);
    const dir = targetPos.clone().sub(bonePos);
    if (dir.lengthSq() < 1e-8) return bone;

    const parent = bone.parentId ? bones.find((b) => b.id === bone.parentId) : null;
    const matrices = getBoneWorldMatrices(bones, false);
    const parentWorld = parent ? matrices.get(parent.id) || new THREE.Matrix4() : new THREE.Matrix4();
    const parentQuat = new THREE.Quaternion().setFromRotationMatrix(parentWorld);

    const worldQuat = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      dir.normalize(),
    );
    const localQuat = parentQuat.clone().invert().multiply(worldQuat);
    const influence = look.influence ?? 1;
    const targetEuler = eulerFromQuat(localQuat);
    return {
      ...bone,
      rotation: {
        x: bone.rotation.x + (targetEuler.x - bone.rotation.x) * influence,
        y: bone.rotation.y + (targetEuler.y - bone.rotation.y) * influence,
        z: bone.rotation.z + (targetEuler.z - bone.rotation.z) * influence,
      },
    };
  });
}

/**
 * Evaluate all bone constraints. IK bones use their constraint target as the effector goal.
 * For IK: the bone that owns the constraint is the tip; targetBoneId is the goal bone/effector.
 */
export function evaluateConstraints(bones: CADBone[]): CADBone[] {
  let result: CADBone[] = bones.map((b) => ({
    ...b,
    position: cloneV(b.position),
    rotation: cloneV(b.rotation),
    scale: cloneV(b.scale),
    ...(b.constraints ? { constraints: [...b.constraints] } : {}),
  }));

  // Solve IK first
  result.forEach((bone) => {
    const ik = bone.constraints?.find((c: BoneConstraint) => c.type === 'ik' && c.enabled && c.targetBoneId);
    if (!ik?.targetBoneId) return;
    const targetPos = getWorldPosition(result, ik.targetBoneId);
    result = solveCcdIk(
      result,
      bone.id,
      { x: targetPos.x, y: targetPos.y, z: targetPos.z },
      ik.chainLength ?? 3,
    );
  });

  result = applyCopyRotation(result);
  result = applyLookAt(result);
  result = applyLimitRotation(result);
  return result;
}
