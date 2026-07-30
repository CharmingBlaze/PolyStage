import { describe, expect, it } from 'vitest';
import type { CADMesh } from '../types/cad';
import {
  autoWeightMesh, bindMeshRigid, createBone, createHumanoidRig, deformMeshWithBones,
  createsCycle, deleteBoneBranch, normalizeInfluences, validateRig,
} from './rigging';
import { applySkeletonPreset, createBirdRig, createFishRig, fitSkeletonToMesh } from './skeletonPresets';
import { detectProcSpecies, evaluateProceduralBoneAnim } from './proceduralBoneAnim';

const mesh: CADMesh = {
  id: 'mesh', name: 'Mesh', position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
  vertices: [
    { id: 'a', x: 0, y: 0, z: 0 },
    { id: 'b', x: 0, y: 2, z: 0 },
  ],
  edges: [], faces: [],
};

describe('rigging core', () => {
  it('normalizes and limits game-ready influences', () => {
    const result = normalizeInfluences([
      { boneId: 'a', weight: 4 }, { boneId: 'b', weight: 3 },
      { boneId: 'c', weight: 2 }, { boneId: 'd', weight: 1 },
      { boneId: 'e', weight: .5 },
    ]);
    expect(result).toHaveLength(4);
    expect(result.reduce((sum, item) => sum + item.weight, 0)).toBeCloseTo(1);
  });

  it('detects cycles and deletes complete branches', () => {
    const root = createBone('Root', null);
    const child = createBone('Child', root.id);
    const tip = createBone('Tip', child.id);
    expect(createsCycle([root, child, tip], root.id, tip.id)).toBe(true);
    expect(deleteBoneBranch([root, child, tip], child.id).map((bone) => bone.id)).toEqual([root.id]);
  });

  it('creates normalized rigid and automatic weights', () => {
    const root = createBone('Root', null, { x: 0, y: 0, z: 0 });
    const tip = createBone('Tip', root.id, { x: 0, y: 2, z: 0 });
    expect(bindMeshRigid(mesh, root).skinWeights?.a).toEqual([{ boneId: root.id, weight: 1 }]);
    const weighted = autoWeightMesh(mesh, [root, tip]);
    expect(weighted.skinWeights?.a.reduce((sum, item) => sum + item.weight, 0)).toBeCloseTo(1);
    expect(weighted.skinWeights?.b[0].boneId).toBe(tip.id);
  });

  it('deforms weighted vertices from rest pose to pose', () => {
    const root = createBone('Root', null);
    const bound = bindMeshRigid(mesh, root);
    root.position.x = 1;
    const deformed = deformMeshWithBones(bound, [root]);
    expect(deformed.vertices[0].x).toBeCloseTo(1);
    expect(deformed.vertices[1].x).toBeCloseTo(1);
  });

  it('builds a valid mirrored humanoid hierarchy', () => {
    const bones = createHumanoidRig();
    const report = validateRig(bones, []);
    expect(bones.length).toBeGreaterThanOrEqual(18);
    expect(report.valid).toBe(true);
    expect(report.roots).toBe(1);
    expect(bones.find((bone) => bone.name === 'UpperArm.L')?.mirrorBoneId).toBeTruthy();
  });
});

describe('skeleton presets + procedural', () => {
  it('builds fish/bird presets and fits to mesh bounds', () => {
    const fish = createFishRig();
    const bird = createBirdRig();
    expect(fish.length).toBe(8);
    expect(bird.find((b) => b.name === 'WingL_Upper')).toBeTruthy();
    expect(detectProcSpecies(fish)).toBe('fish');
    expect(detectProcSpecies(bird)).toBe('bird');

    const box: CADMesh = {
      ...mesh,
      vertices: [
        { id: '1', x: -1, y: 0, z: -1 },
        { id: '2', x: 1, y: 2, z: 1 },
      ],
      position: { x: 3, y: 1, z: -2 },
    };
    const fitted = fitSkeletonToMesh(fish, box);
    const root = fitted.find((b) => !b.parentId)!;
    expect(root.position.x).toBeGreaterThan(0);
    expect(applySkeletonPreset('human', box).length).toBeGreaterThan(10);
  });

  it('evaluates fish/bird procedural animations from rest', () => {
    const fish = createFishRig();
    const posed = evaluateProceduralBoneAnim(fish, 'fish_swim_x', 0.3, 1);
    expect(posed[2].rotation.y).not.toBe(0);
    expect(posed[0].restRotation?.y ?? 0).toBe(0);

    const bird = createBirdRig();
    const flying = evaluateProceduralBoneAnim(bird, 'bird_fly_glide', 0.2, 1.5);
    const wing = flying.find((b) => b.name === 'WingL_Upper')!;
    const restZ = bird.find((b) => b.name === 'WingL_Upper')!.restRotation!.z;
    expect(wing.rotation.z).not.toBeCloseTo(restZ);
  });
});
