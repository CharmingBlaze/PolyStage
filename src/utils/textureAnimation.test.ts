import { describe, expect, it } from 'vitest';
import {
  activeTextureClipKey,
  createPresetTextureClips,
  magicWandSelect,
  resolveMeshTextureAtTime,
  sampleTextureFrameIndex,
  seedTextureAnimationFromStill,
} from './textureAnimation';
import { evaluateClipAtTime, insertTexFrameKeyframe, insertTextureClipKey, createDefaultClip } from './animation';
import type { AnimTrack, CADMesh, MeshTextureAnimation } from '../types/cad';

const meshBase: CADMesh = {
  id: 'mesh',
  name: 'Mesh',
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  vertices: [],
  edges: [],
  faces: [],
};

describe('textureAnimation', () => {
  it('seeds a still into a one-frame strip with Idle clip', () => {
    const anim = seedTextureAnimationFromStill(32, 32, 'data:image/png;base64,aaa');
    expect(anim.frames).toHaveLength(1);
    expect(anim.clips?.[0]?.name).toBe('Idle');
    expect(anim.defaultClipId).toBe(anim.clips![0].id);
  });

  it('builds Talk/Blink/Idle clips from tags', () => {
    const frames = [
      { id: 'a', name: '1', durationMs: 100, dataUrl: 'a', tags: ['idle'] },
      { id: 'b', name: '2', durationMs: 80, dataUrl: 'b', tags: ['talk'] },
      { id: 'c', name: '3', durationMs: 80, dataUrl: 'c', tags: ['talk'] },
      { id: 'd', name: '4', durationMs: 60, dataUrl: 'd', tags: ['blink'] },
    ];
    const clips = createPresetTextureClips(frames);
    expect(clips.find((c) => c.name === 'Talk')?.frameIds).toEqual(['b', 'c']);
    expect(clips.find((c) => c.name === 'Blink')?.loop).toBe(false);
  });

  it('samples held texture frame indices', () => {
    const idx = sampleTextureFrameIndex(
      [
        { id: '1', time: 0, value: { x: 0, y: 0, z: 0 } },
        { id: '2', time: 1, value: { x: 3, y: 0, z: 0 } },
      ],
      0.5,
    );
    expect(idx).toBe(0);
    expect(sampleTextureFrameIndex(
      [
        { id: '1', time: 0, value: { x: 0, y: 0, z: 0 } },
        { id: '2', time: 1, value: { x: 3, y: 0, z: 0 } },
      ],
      1.2,
    )).toBe(3);
  });

  it('picks active texture clip keys by time range', () => {
    const hit = activeTextureClipKey(
      [
        { id: 'a', time: 0.2, clipId: 'talk', holdUntil: 1.0 },
        { id: 'b', time: 1.5, clipId: 'blink', holdUntil: 1.8 },
      ],
      0.5,
    );
    expect(hit?.clipId).toBe('talk');
  });

  it('magic wand selects connected pixels', () => {
    const data = new Uint8ClampedArray(4 * 4 * 4);
    const image = { width: 4, height: 4, data } as ImageData;
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) {
        const i = (y * 4 + x) * 4;
        data[i] = 255;
        data[i + 3] = 255;
      }
    }
    const mask = magicWandSelect(image, 0, 0);
    expect(mask.size).toBe(4);
  });

  it('resolves mesh texture with frame key priority over clips', () => {
    const anim: MeshTextureAnimation = {
      width: 8,
      height: 8,
      frames: [
        { id: 'f0', name: '0', durationMs: 100, dataUrl: 'url0', tags: ['idle'] },
        { id: 'f1', name: '1', durationMs: 100, dataUrl: 'url1', tags: ['talk'] },
      ],
      clips: [{ id: 'talk', name: 'Talk', frameIds: ['f1'], loop: true }],
      defaultClipId: null,
    };
    const mesh = { ...meshBase, textureAnimation: anim, textureCanvasDataUrl: 'still' };
    const track: AnimTrack = {
      targetId: mesh.id,
      targetName: mesh.name,
      targetType: 'mesh',
      posKeyframes: [],
      rotKeyframes: [],
      sclKeyframes: [],
      texFrameKeyframes: [{ id: 'k', time: 0, value: { x: 0, y: 0, z: 0 } }],
      textureClipKeys: [{ id: 'ck', time: 0, clipId: 'talk', holdUntil: 2 }],
    };
    const resolved = resolveMeshTextureAtTime(mesh, track, 0.5);
    expect(resolved.dataUrl).toBe('url0');
  });

  it('evaluateClipAtTime applies texture frame onto mesh still', () => {
    const anim: MeshTextureAnimation = {
      width: 8,
      height: 8,
      frames: [
        { id: 'f0', name: '0', durationMs: 100, dataUrl: 'url0' },
        { id: 'f1', name: '1', durationMs: 100, dataUrl: 'url1' },
      ],
      clips: [],
    };
    const mesh = { ...meshBase, textureAnimation: anim, textureCanvasDataUrl: 'still' };
    let clip = createDefaultClip([mesh], []);
    clip = insertTexFrameKeyframe(clip, mesh.id, 0, 1);
    const posed = evaluateClipAtTime(clip, 0, [], [mesh]);
    expect(posed.meshes[0].textureCanvasDataUrl).toBe('url1');
  });

  it('insertTextureClipKey stores clip triggers on mesh tracks', () => {
    const mesh = { ...meshBase };
    let clip = createDefaultClip([mesh], []);
    clip = insertTextureClipKey(clip, mesh.id, 0.25, 'talk', 1.0);
    const track = clip.tracks.find((t) => t.targetId === mesh.id)!;
    expect(track.textureClipKeys?.[0]?.clipId).toBe('talk');
    expect(track.textureClipKeys?.[0]?.holdUntil).toBeCloseTo(1.0);
  });
});
