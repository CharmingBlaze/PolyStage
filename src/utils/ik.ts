import type { BoneConstraint, CADBone, Vector3D } from '../types/cad';
import * as THREE from 'three';
import { getBoneWorldMatrices } from './rigging';

const cloneV = (v: Vector3D): Vector3D => ({ x: v.x, y: v.y, z: v.z });

function eulerFromQuat(q: THREE.Quaternion): Vector3D {
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
  return { x: e.x, y: e.y, z: e.z };
}

/** World-space head (joint) of a bone, falling back to its local pose when unknown. */
export function worldPositionOf(
  bones: CADBone[],
  matrices: Map<string, THREE.Matrix4>,
  boneId: string,
): THREE.Vector3 {
  const matrix = matrices.get(boneId);
  if (matrix) return new THREE.Vector3().setFromMatrixPosition(matrix);
  const bone = bones.find((b) => b.id === boneId);
  const p = bone?.position ?? { x: 0, y: 0, z: 0 };
  return new THREE.Vector3(p.x, p.y, p.z);
}

export function getWorldPosition(
  bones: CADBone[],
  boneId: string,
): THREE.Vector3 {
  const matrices = getBoneWorldMatrices(bones, false);
  return worldPositionOf(bones, matrices, boneId);
}

/** World-space tail of a bone (head + its local +Y length), Blender's IK effector. */
function worldTailOf(
  matrices: Map<string, THREE.Matrix4>,
  bone: CADBone | undefined,
): THREE.Vector3 {
  if (!bone) return new THREE.Vector3();
  const matrix = matrices.get(bone.id);
  if (!matrix) return new THREE.Vector3();
  return new THREE.Vector3(0, Math.max(bone.length || 0.01, 1e-4), 0).applyMatrix4(matrix);
}

/** Walk from the tip up the hierarchy; `[tip, ..., rootOfChain]`. */
function getChainIds(bones: CADBone[], tipId: string, chainLength: number): string[] {
  const byId = new Map(bones.map((bone) => [bone.id, bone]));
  const chain: string[] = [];
  let cursor = byId.get(tipId);
  const guard = new Set<string>();
  while (cursor && chain.length < chainLength && !guard.has(cursor.id)) {
    guard.add(cursor.id);
    chain.push(cursor.id);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return chain;
}

/**
 * CCD IK: rotate the chain so the tip bone's TAIL reaches the world-space target.
 *
 * Matches Blender's IK constraint: the constrained bone is the tip, its tail is
 * the effector, and `chainLength` counts bones from the tip upward (so
 * `chainLength = 2` rotates the tip plus its parent).
 */
export function solveCcdIk(
  bones: CADBone[],
  tipBoneId: string,
  targetWorld: Vector3D,
  chainLength = 3,
  iterations = 12,
  threshold = 0.001,
): CADBone[] {
  const result = bones.map((b) => ({
    ...b,
    position: cloneV(b.position),
    rotation: cloneV(b.rotation),
    scale: cloneV(b.scale),
  }));

  const target = new THREE.Vector3(targetWorld.x, targetWorld.y, targetWorld.z);
  if (![target.x, target.y, target.z].every(Number.isFinite)) return result;

  const chainIds = getChainIds(result, tipBoneId, Math.max(1, Math.round(chainLength)));
  if (chainIds.length === 0) return result;

  const poseOf = (id: string) => result.find((b) => b.id === id);

  for (let iter = 0; iter < Math.max(1, iterations); iter += 1) {
    let matrices = getBoneWorldMatrices(result, false);
    let effector = worldTailOf(matrices, poseOf(tipBoneId));
    if (effector.distanceTo(target) < threshold) break;

    // Nearest-to-effector first: tip, then its parent, up to the chain root.
    for (let i = 0; i < chainIds.length; i += 1) {
      const bone = poseOf(chainIds[i]);
      if (!bone || bone.locked) continue;

      const worldMatrix = matrices.get(bone.id);
      if (!worldMatrix) continue;
      const joint = new THREE.Vector3().setFromMatrixPosition(worldMatrix);
      const toEffector = effector.clone().sub(joint);
      const toTarget = target.clone().sub(joint);
      if (toEffector.lengthSq() < 1e-10 || toTarget.lengthSq() < 1e-10) continue;

      const delta = new THREE.Quaternion().setFromUnitVectors(
        toEffector.normalize(),
        toTarget.normalize(),
      );
      const worldQuat = new THREE.Quaternion().setFromRotationMatrix(worldMatrix);
      const newWorldQuat = delta.multiply(worldQuat);

      const parent = bone.parentId ? poseOf(bone.parentId) : null;
      const parentMatrix = parent ? matrices.get(parent.id) : null;
      const parentQuat = parentMatrix
        ? new THREE.Quaternion().setFromRotationMatrix(parentMatrix)
        : new THREE.Quaternion();
      const localQuat = parentQuat.clone().invert().multiply(newWorldQuat);

      const idx = result.findIndex((b) => b.id === bone.id);
      if (idx < 0) continue;
      result[idx] = { ...result[idx], rotation: eulerFromQuat(localQuat) };

      // Refresh the effector so the next bone solves against the moved tail.
      matrices = getBoneWorldMatrices(result, false);
      effector = worldTailOf(matrices, poseOf(tipBoneId));
      if (effector.distanceTo(target) < threshold) return result;
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
  const byId = new Map(bones.map((bone) => [bone.id, bone]));
  return bones.map((bone) => {
    const copy = bone.constraints?.find((c) => c.type === 'copy-rotation' && c.enabled && c.targetBoneId);
    if (!copy?.targetBoneId || copy.targetBoneId === bone.id) return bone;
    const source = byId.get(copy.targetBoneId);
    if (!source) return bone;
    const influence = Math.max(0, Math.min(1, copy.influence ?? 1));
    if (influence <= 0) return bone;
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

/**
 * Look-at constraint: aim the bone's local +Y at the target bone.
 *
 * World matrices are rebuilt only when a bone actually changes, so a rig with no
 * look-at constraints costs a single cheap check.
 */
export function applyLookAt(bones: CADBone[]): CADBone[] {
  const result = bones.map((bone) => ({ ...bone, rotation: cloneV(bone.rotation) }));
  let matrices: Map<string, THREE.Matrix4> | null = null;

  for (let i = 0; i < result.length; i += 1) {
    const bone = result[i];
    const look = bone.constraints?.find((c) => c.type === 'look-at' && c.enabled && c.targetBoneId);
    if (!look?.targetBoneId || look.targetBoneId === bone.id) continue;

    matrices ??= getBoneWorldMatrices(result, false);
    const targetPos = worldPositionOf(result, matrices, look.targetBoneId);
    const bonePos = worldPositionOf(result, matrices, bone.id);
    const dir = targetPos.clone().sub(bonePos);
    if (dir.lengthSq() < 1e-10) continue;

    const parentWorld = bone.parentId ? matrices.get(bone.parentId) ?? null : null;
    const parentQuat = parentWorld
      ? new THREE.Quaternion().setFromRotationMatrix(parentWorld)
      : new THREE.Quaternion();

    const worldQuat = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      dir.normalize(),
    );
    const localQuat = parentQuat.clone().invert().multiply(worldQuat);
    const influence = Math.max(0, Math.min(1, look.influence ?? 1));
    const targetEuler = eulerFromQuat(localQuat);
    result[i] = {
      ...bone,
      rotation: {
        x: bone.rotation.x + (targetEuler.x - bone.rotation.x) * influence,
        y: bone.rotation.y + (targetEuler.y - bone.rotation.y) * influence,
        z: bone.rotation.z + (targetEuler.z - bone.rotation.z) * influence,
      },
    };
    matrices = null;
  }

  return result;
}

/** Blend two poses by slerping each bone's rotation (IK influence). */
export function blendRotation(from: CADBone[], to: CADBone[], t: number): CADBone[] {
  const fromById = new Map(from.map((bone) => [bone.id, bone]));
  return to.map((bone) => {
    const prev = fromById.get(bone.id);
    if (!prev) return bone;
    const a = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(prev.rotation.x, prev.rotation.y, prev.rotation.z),
    );
    const b = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(bone.rotation.x, bone.rotation.y, bone.rotation.z),
    );
    return { ...bone, rotation: eulerFromQuat(a.slerp(b, t)) };
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

  // Collect IK jobs before solving so a solved parent cannot corrupt a pending
  // constraint's target pose mid-iteration.
  const ikJobs: Array<{ boneId: string; constraint: BoneConstraint }> = [];
  result.forEach((bone) => {
    if (bone.locked) return;
    (bone.constraints || []).forEach((constraint) => {
      if (constraint.type === 'ik' && constraint.enabled && constraint.targetBoneId) {
        ikJobs.push({ boneId: bone.id, constraint });
      }
    });
  });

  ikJobs.forEach(({ boneId, constraint }) => {
    const influence = Math.max(0, Math.min(1, constraint.influence ?? 1));
    if (influence <= 0) return;
    const targetId = constraint.targetBoneId;
    if (!targetId) return;
    const targetPos = worldPositionOf(result, getBoneWorldMatrices(result, false), targetId);
    if (![targetPos.x, targetPos.y, targetPos.z].every(Number.isFinite)) return;
    const solved = solveCcdIk(
      result,
      boneId,
      { x: targetPos.x, y: targetPos.y, z: targetPos.z },
      constraint.chainLength ?? 3,
    );
    // Influence 0-1 blends between the unsolved pose and the IK result.
    result = influence >= 1 ? solved : blendRotation(result, solved, influence);
  });

  result = applyCopyRotation(result);
  result = applyLookAt(result);
  result = applyLimitRotation(result);
  return result;
}
