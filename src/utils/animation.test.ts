import { describe, expect, it } from 'vitest';
import {
  createDefaultClip,
  evaluateClipAtTime,
  sampleChannel,
  wrapTime,
  insertKeyframe,
  rebaseClipTracksToScene,
  ensureClipTracksForScene,
} from './animation';
import { createBone, createHumanoidRig, autoWeightMesh, deformMeshWithBones, getBoneWorldMatrices } from './rigging';
import { solveCcdIk, evaluateConstraints, applyLimitRotation } from './ik';
import { buildExportSceneGraph } from './glbExport';
import type { AnimationClip, CADMesh } from '../types/cad';

const mesh: CADMesh = {
  id: 'mesh',
  name: 'Mesh',
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  vertices: [
    { id: 'a', x: 0, y: 0, z: 0 },
    { id: 'b', x: 0, y: 2, z: 0 },
  ],
  edges: [],
  faces: [],
};

describe('animation sampling', () => {
  it('samples linear channels between keys', () => {
    const value = sampleChannel(
      [
        { id: '1', time: 0, value: { x: 0, y: 0, z: 0 } },
        { id: '2', time: 1, value: { x: 2, y: 0, z: 0 } },
      ],
      0.5,
      'linear',
    );
    expect(value?.x).toBeCloseTo(1);
  });

  it('wraps loop time and clamps once', () => {
    expect(wrapTime(2.5, 2, 'loop')).toBeCloseTo(0.5);
    expect(wrapTime(2.5, 2, 'once')).toBeCloseTo(2);
  });

  it('evaluates bone pose from clip', () => {
    const root = createBone('Root', null, { x: 0, y: 0, z: 0 });
    const clip: AnimationClip = {
      id: 'c',
      name: 'Test',
      duration: 1,
      fps: 24,
      loopMode: 'once',
      interpolation: 'linear',
      tracks: [
        {
          targetId: root.id,
          targetName: root.name,
          targetType: 'bone',
          posKeyframes: [
            { id: 'p0', time: 0, value: { x: 0, y: 0, z: 0 } },
            { id: 'p1', time: 1, value: { x: 2, y: 0, z: 0 } },
          ],
          rotKeyframes: [],
          sclKeyframes: [],
        },
      ],
    };
    const posed = evaluateClipAtTime(clip, 0.5, [root], [mesh]);
    expect(posed.bones[0].position.x).toBeCloseTo(1);
  });

  it('inserts keyframes sorted by time', () => {
    let clip = createDefaultClip([mesh], []);
    clip = insertKeyframe(clip, mesh.id, 'mesh', 'pos', 0.5, { x: 1, y: 2, z: 3 });
    const track = clip.tracks.find((t) => t.targetId === mesh.id);
    expect(track?.posKeyframes.some((kf) => Math.abs(kf.time - 0.5) < 1e-4)).toBe(true);
  });

  it('rebases clip tracks when model rest transform changes', () => {
    let clip = createDefaultClip([mesh], []);
    clip = insertKeyframe(clip, mesh.id, 'mesh', 'pos', 1, { x: 2, y: 0, z: 0 });
    const moved = { ...mesh, position: { x: 5, y: 0, z: 0 } };
    const rebased = rebaseClipTracksToScene(clip, [moved], []);
    const track = rebased.tracks.find((t) => t.targetId === mesh.id)!;
    expect(track.posKeyframes[0].value.x).toBeCloseTo(5);
    expect(track.posKeyframes.find((k) => Math.abs(k.time - 1) < 1e-4)?.value.x).toBeCloseTo(7);
  });

  it('ensures and rebases tracks for every scene object type', () => {
    const clip = createDefaultClip([mesh], []);
    const bone = {
      id: 'bone1',
      name: 'Root',
      parentId: null,
      position: { x: 0, y: 1, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      length: 1,
      assignedMeshIds: [],
    };
    const camera = {
      id: 'cam1',
      name: 'Cam',
      position: { x: 3, y: 2, z: 5 },
      rotation: { x: -20, y: 30, z: 0 },
      fov: 50,
      near: 0.1,
      far: 1000,
    };
    const light = {
      id: 'light1',
      name: 'Key',
      type: 'point' as const,
      position: { x: 1, y: 2, z: 3 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      color: '#ffffff',
      intensity: 1,
      distance: 8,
      decay: 2,
      angle: 0.5,
      penumbra: 0.2,
      castShadow: false,
    };
    const withTracks = ensureClipTracksForScene(clip, {
      meshes: [mesh],
      bones: [bone],
      cameras: [camera],
      lights: [light],
      particles: [],
    });
    expect(withTracks.tracks.some((t) => t.targetType === 'bone' && t.targetId === bone.id)).toBe(true);
    expect(withTracks.tracks.some((t) => t.targetType === 'camera' && t.targetId === camera.id)).toBe(true);
    expect(withTracks.tracks.some((t) => t.targetType === 'light' && t.targetId === light.id)).toBe(true);

    const movedCam = { ...camera, position: { x: 8, y: 2, z: 5 } };
    const rebased = rebaseClipTracksToScene(withTracks, {
      meshes: [mesh],
      bones: [bone],
      cameras: [movedCam],
      lights: [light],
    });
    const camTrack = rebased.tracks.find((t) => t.targetId === camera.id)!;
    expect(camTrack.posKeyframes[0].value.x).toBeCloseTo(8);
  });
});

describe('CCD IK', () => {
  it('moves tip toward target', () => {
    const root = createBone('Root', null, { x: 0, y: 0, z: 0 }, 1);
    const mid = createBone('Mid', root.id, { x: 0, y: 1, z: 0 }, 1);
    const tip = createBone('Tip', mid.id, { x: 0, y: 1, z: 0 }, 1);
    const bones = [root, mid, tip];
    const solved = solveCcdIk(bones, tip.id, { x: 1, y: 1, z: 0 }, 3, 20);
    // Tip world Y should still be near chain length; X should move toward target
    const tipWorld = getBoneWorldMatrices(solved, false).get(tip.id)!;
    const tipPos = { x: tipWorld.elements[12], y: tipWorld.elements[13], z: tipWorld.elements[14] };
    expect(tipPos.x).toBeGreaterThan(0.2);
  });

  it('applies rotation limits', () => {
    const bone = createBone('Root', null);
    bone.rotation = { x: 2, y: 0, z: 0 };
    bone.constraints = [
      {
        type: 'limit-rotation',
        enabled: true,
        min: { x: -0.5, y: -1, z: -1 },
        max: { x: 0.5, y: 1, z: 1 },
      },
    ];
    const limited = applyLimitRotation([bone]);
    expect(limited[0].rotation.x).toBeCloseTo(0.5);
  });

  it('evaluateConstraints runs without throwing on humanoid', () => {
    const bones = createHumanoidRig();
    const hand = bones.find((b) => b.name === 'Hand.L')!;
    const target = bones.find((b) => b.name === 'Foot.L')!;
    hand.constraints = [
      { type: 'ik', enabled: true, targetBoneId: target.id, chainLength: 3 },
    ];
    const result = evaluateConstraints(bones);
    expect(result.length).toBe(bones.length);
  });
});

describe('GLB export graph', () => {
  it('builds skinned scene with animations', () => {
    const bones = createHumanoidRig();
    const weighted = autoWeightMesh(mesh, bones);
    const clip = createDefaultClip([weighted], bones, 'Idle');
    const { scene, animations, boneCount } = buildExportSceneGraph([weighted], bones, [clip]);
    expect(boneCount).toBe(bones.length);
    expect(scene.children.length).toBeGreaterThan(0);
    expect(animations.length).toBe(1);
    expect(animations[0].name).toBe('Idle');
  });

  it('deforms with segment auto-weights', () => {
    const root = createBone('Root', null, { x: 0, y: 0, z: 0 }, 2);
    const tip = createBone('Tip', root.id, { x: 0, y: 2, z: 0 }, 1);
    const weighted = autoWeightMesh(mesh, [root, tip]);
    tip.position.x = 1;
    const deformed = deformMeshWithBones(weighted, [root, tip]);
    expect(deformed.vertices[1].x).not.toBeCloseTo(0);
  });
});
