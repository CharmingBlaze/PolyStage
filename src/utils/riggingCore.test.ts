import { describe, expect, it } from 'vitest';
import type { CADBone, CADMesh } from '../types/cad';
import {
  boneTailOffset,
  createBone,
  createHumanoidRig,
  getBoneDepths,
  getBoneWorldMatrices,
  pruneBoneReferences,
  validateRig,
} from './rigging';
import { evaluateConstraints, solveCcdIk } from './ik';
import {
  SKELETON_PRESETS,
  createBirdRig,
  createDogRig,
  createFishRig,
  meshBounds,
} from './skeletonPresets';
import { detectProcSpecies } from './proceduralBoneAnim';

const twoVerts = (overrides: Partial<CADMesh> = {}): CADMesh => ({
  id: 'm',
  name: 'M',
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  vertices: [
    { id: 'a', x: 1, y: 0, z: 0 },
    { id: 'b', x: -1, y: 0, z: 0 },
  ],
  edges: [],
  faces: [],
  ...overrides,
});

const chain = (): CADBone[] => {
  const root = createBone('Root', null, { x: 0, y: 0, z: 0 }, 1);
  const mid = createBone('Mid', root.id, { x: 0, y: 1, z: 0 }, 1);
  const tip = createBone('Tip', mid.id, { x: 0, y: 1, z: 0 }, 1);
  return [root, mid, tip];
};

/** World-space tail of a bone: what Blender's IK moves onto the target. */
function tailWorld(bones: CADBone[], boneId: string) {
  const bone = bones.find((b) => b.id === boneId)!;
  const e = getBoneWorldMatrices(bones, false).get(boneId)!.elements;
  const y = Math.max(bone.length || 0.01, 1e-4);
  return { x: e[4] * y + e[12], y: e[5] * y + e[13], z: e[6] * y + e[14] };
}

const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe('boneTailOffset', () => {
  it('returns the straight length vector for an unrotated bone', () => {
    const bone = createBone('B', null, { x: 0, y: 0, z: 0 }, 2);
    expect(boneTailOffset(bone)).toEqual({ x: 0, y: 2, z: 0 });
  });

  it('follows the bone rotation so children land on the tip', () => {
    const bone = createBone('B', null, { x: 0, y: 0, z: 0 }, 1);
    bone.rotation = { x: 0, y: 0, z: -Math.PI / 2 };
    const offset = boneTailOffset(bone);
    expect(offset.x).toBeCloseTo(1, 6);
    expect(offset.y).toBeCloseTo(0, 6);
  });

  it('applies the bone scale on the length axis', () => {
    const bone = createBone('B', null, { x: 0, y: 0, z: 0 }, 1);
    bone.scale = { x: 1, y: 3, z: 1 };
    expect(boneTailOffset(bone).y).toBeCloseTo(3, 6);
  });
});

describe('getBoneDepths', () => {
  it('numbers the hierarchy from the root', () => {
    const bones = chain();
    const depths = getBoneDepths(bones);
    expect(depths.get(bones[0].id)).toBe(0);
    expect(depths.get(bones[1].id)).toBe(1);
    expect(depths.get(bones[2].id)).toBe(2);
  });

  it('survives a parent cycle without hanging', () => {
    const a = createBone('A', null);
    const b = createBone('B', a.id);
    a.parentId = b.id;
    expect(getBoneDepths([a, b]).size).toBe(2);
  });
});

describe('pruneBoneReferences', () => {
  it('clears parent, mirror and constraint links to missing bones', () => {
    const keeper = createBone('Keep', null);
    keeper.mirrorBoneId = 'ghost';
    keeper.constraints = [
      { type: 'ik', enabled: true, targetBoneId: 'ghost', chainLength: 2 },
      { type: 'limit-rotation', enabled: true, min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } },
    ];
    const orphan = createBone('Orphan', 'ghost');

    const pruned = pruneBoneReferences([keeper, orphan]);
    expect(pruned[0].mirrorBoneId).toBeNull();
    expect(pruned[0].constraints).toHaveLength(1);
    expect(pruned[0].constraints![0].type).toBe('limit-rotation');
    expect(pruned[1].parentId).toBeNull();
  });

  it('keeps healthy references untouched', () => {
    const bones = chain();
    expect(pruneBoneReferences(bones)[1].parentId).toBe(bones[0].id);
  });
});

describe('validateRig', () => {
  it('accepts every shipped preset', () => {
    [createHumanoidRig(), createBirdRig(), createFishRig(), createDogRig()].forEach((rig) => {
      const report = validateRig(rig, []);
      expect(report.valid).toBe(true);
      expect(report.duplicateNames).toBe(0);
      expect(report.danglingReferences).toBe(0);
    });
  });

  it('flags duplicate bone names', () => {
    const report = validateRig([createBone('Arm', null), createBone('  arm ', null)], []);
    expect(report.duplicateNames).toBe(1);
    expect(report.valid).toBe(false);
  });

  it('flags dangling mirror and constraint targets', () => {
    const a = createBone('A', null);
    a.mirrorBoneId = 'ghost';
    a.constraints = [{ type: 'look-at', enabled: true, targetBoneId: 'ghost' }];
    const report = validateRig([a], []);
    expect(report.danglingReferences).toBe(2);
    expect(report.valid).toBe(false);
  });

  it('reports an empty rig without calling it broken', () => {
    const report = validateRig([], []);
    expect(report.emptyRig).toBe(true);
    expect(report.valid).toBe(true);
  });
});

describe('IK effector semantics', () => {
  it('drives the tip TAIL onto the target like Blender', () => {
    const bones = chain();
    const tip = bones[2];
    const target = { x: 1, y: 2, z: 0 };
    const before = dist(tailWorld(bones, tip.id), target);
    const solved = solveCcdIk(bones, tip.id, target, 3, 24, 0.001);
    const after = dist(tailWorld(solved, tip.id), target);
    expect(after).toBeLessThan(before * 0.5);
    expect(after).toBeLessThan(0.3);
  });

  it('supports a single-bone chain (chainLength 1 rotates only the tip)', () => {
    const bones = chain();
    const tip = bones[2];
    const solved = solveCcdIk(bones, tip.id, { x: 1, y: 2.5, z: 0 }, 1, 24, 0.001);
    expect(solved[0].rotation.x).toBeCloseTo(bones[0].rotation.x, 6);
    expect(solved[1].rotation.x).toBeCloseTo(bones[1].rotation.x, 6);
    expect(Math.abs(solved[2].rotation.x) + Math.abs(solved[2].rotation.z)).toBeGreaterThan(0.05);
  });

  it('ignores a non-finite target instead of corrupting the pose', () => {
    const bones = chain();
    const solved = solveCcdIk(bones, bones[2].id, { x: Number.NaN, y: 0, z: 0 }, 3);
    expect(solved[2].rotation).toEqual(bones[2].rotation);
  });

  it('blends between rest and the solved pose using influence', () => {
    const build = (influence: number): CADBone[] => {
      const base = chain();
      const effector = createBone('Tip.IK', base[1].id, { x: 1, y: 0, z: 0 }, 0.2);
      effector.deform = false;
      base[2].constraints = [
        { type: 'ik', enabled: true, targetBoneId: effector.id, influence, chainLength: 2 },
      ];
      return evaluateConstraints([...base, effector]);
    };
    const magnitude = (b: CADBone) =>
      Math.abs(b.rotation.x) + Math.abs(b.rotation.y) + Math.abs(b.rotation.z);
    const rest = build(0);
    const half = build(0.5);
    const full = build(1);
    expect(magnitude(rest[2])).toBeCloseTo(0, 6);
    expect(magnitude(half[2])).toBeGreaterThan(0);
    expect(magnitude(half[2])).toBeLessThan(magnitude(full[2]));
  });
});

describe('meshBounds', () => {
  it('follows mesh rotation, not just scale and translation', () => {
    const upright = meshBounds(twoVerts());
    expect(upright.size.x).toBeCloseTo(2, 6);
    expect(upright.size.y).toBeCloseTo(0, 6);

    const turned = meshBounds(twoVerts({ rotation: { x: 0, y: 0, z: Math.PI / 2 } }));
    expect(turned.size.x).toBeCloseTo(0, 6);
    expect(turned.size.y).toBeCloseTo(2, 6);
  });

  it('falls back to a unit box for an empty mesh', () => {
    const bounds = meshBounds(twoVerts({ vertices: [] }));
    expect(bounds.size.x).toBeCloseTo(1, 6);
    expect(bounds.size.y).toBeCloseTo(1, 6);
  });
});

describe('skeleton preset metadata', () => {
  it('advertises the real bone counts', () => {
    const byId = (id: string) => SKELETON_PRESETS.find((p) => p.id === id)!.boneCount;
    expect(byId('human')).toBe(createHumanoidRig().length);
    expect(byId('bird')).toBe(createBirdRig().length);
    expect(byId('fish')).toBe(createFishRig().length);
    expect(byId('dog')).toBe(createDogRig().length);
  });

  it('does not mistake a quadruped tail for a fish chain', () => {
    expect(detectProcSpecies(createDogRig())).toBe('other');
    expect(detectProcSpecies(createFishRig())).toBe('fish');
    expect(detectProcSpecies(createBirdRig())).toBe('bird');
  });
});