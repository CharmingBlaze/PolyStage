import { describe, it, expect } from 'vitest';
import { generatePrimitive } from './meshUtils';
import { createDefaultClip } from './animation';
import { createBone } from './rigging';
import {
  buildProjectDocument,
  parseProjectDocument,
  serializeProject,
  PROJECT_FORMAT,
} from './projectDocument';
import { prepareMeshesForExport } from './exportPrepare';
import { meshHasPaintableUVs, ensurePaintableUVs } from './uvAdvanced';
import { ensureBindPose, sanitizeMeshSkinWeights } from './rigging';
import { bakeAnimationClip } from './animation';
import { buildExportSceneGraph, buildTriangulatedBuffers } from './glbExport';
import { autoFixMeshIntegrity } from './meshValidator';
import type { CADScene } from '../types/cad';

function sceneFromMesh(): CADScene {
  const mesh = generatePrimitive('cube');
  return {
    id: 'scene_main',
    name: 'Main',
    meshes: [mesh],
    groups: [],
    bones: [createBone('Root', null)],
  };
}

describe('project document', () => {
  it('round-trips a multi-mesh scene', () => {
    const scene = sceneFromMesh();
    const json = serializeProject(buildProjectDocument({
      scenes: [scene],
      activeSceneId: scene.id,
    }));
    const { project } = parseProjectDocument(json);
    expect(project.format).toBe(PROJECT_FORMAT);
    expect(project.scenes[0].meshes[0].vertices.length).toBe(scene.meshes[0].vertices.length);
    expect(project.scenes[0].bones[0].name).toBe('Root');
  });

  it('hydrates legacy single-mesh JSON', () => {
    const mesh = generatePrimitive('cube');
    const { project, legacy } = parseProjectDocument(JSON.stringify({ version: '2.1.0', app: 'PolyStage', mesh }));
    expect(legacy).toBe(true);
    expect(project.scenes[0].meshes[0].faces.length).toBe(mesh.faces.length);
  });
});

describe('export prepare + GLB graph', () => {
  it('unwraps, binds rest pose, and emits UV attributes', () => {
    const mesh = generatePrimitive('cube');
    mesh.faces = mesh.faces.map((face) => ({ ...face, uvs: [] }));
    expect(meshHasPaintableUVs(mesh)).toBe(false);

    const bone = createBone('Root', null, { x: 0, y: 0, z: 0 }, 1);
    delete bone.restPosition;
    const clip = createDefaultClip([mesh], [bone], 'Idle');
    const prepared = prepareMeshesForExport([mesh], [bone], [clip]);

    expect(meshHasPaintableUVs(prepared.meshes[0])).toBe(true);
    expect(prepared.bones[0].restPosition).toEqual(bone.position);
    expect(prepared.clips[0].tracks[0].posKeyframes.length).toBeGreaterThan(1);

    const buffers = buildTriangulatedBuffers(prepared.meshes[0]);
    expect(buffers.uvs.length).toBe(buffers.positions.length / 3 * 2);
    expect(buffers.indices.length).toBeGreaterThan(0);

    const graph = buildExportSceneGraph(prepared.meshes, prepared.bones, prepared.clips, { prepare: false });
    const exported = graph.scene.children.find((child) => child.type === 'Mesh' || child.type === 'SkinnedMesh');
    expect(exported).toBeTruthy();
    expect(graph.animations[0].name).toBe('Idle');
  });

  it('drops unknown bone influences', () => {
    const mesh = generatePrimitive('cube');
    mesh.skinWeights = {
      [mesh.vertices[0].id]: [{ boneId: 'missing', weight: 1 }],
    };
    const live = createBone('Root', null);
    const cleaned = sanitizeMeshSkinWeights(mesh, [live]);
    expect(cleaned.skinWeights?.[mesh.vertices[0].id] || []).toEqual([]);
  });

  it('ensures bind pose copies current pose', () => {
    const bone = createBone('Root', null, { x: 1, y: 2, z: 3 }, 1);
    delete bone.restPosition;
    const next = ensureBindPose([bone]);
    expect(next[0].restPosition).toEqual({ x: 1, y: 2, z: 3 });
  });

  it('bakes clip channels at fps', () => {
    const mesh = generatePrimitive('cube');
    const clip = createDefaultClip([mesh], [], 'Move');
    clip.duration = 1;
    clip.fps = 4;
    const baked = bakeAnimationClip(clip);
    expect(baked.tracks[0].posKeyframes.length).toBe(5);
  });

  it('auto-fixes orphan vertices', () => {
    const mesh = generatePrimitive('cube');
    mesh.vertices = [...mesh.vertices, { id: 'orphan', x: 9, y: 9, z: 9 }];
    const fixed = autoFixMeshIntegrity(mesh);
    expect(fixed.vertices.some((v) => v.id === 'orphan')).toBe(false);
  });

  it('smart unwraps a mesh with collapsed UVs', () => {
    const mesh = generatePrimitive('cube');
    mesh.faces = mesh.faces.map((face) => ({
      ...face,
      uvs: face.vertexIds.map(() => ({ u: 0, v: 0 })),
    }));
    const next = ensurePaintableUVs(mesh);
    expect(meshHasPaintableUVs(next)).toBe(true);
  });
});
