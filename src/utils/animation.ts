import type {
  AnimInterpolation,
  AnimKeyframe,
  AnimTrack,
  AnimationClip,
  CADBone,
  CADCamera,
  CADLight,
  CADMesh,
  ParticleEmitter,
  TextureClipKey,
  Vector3D,
} from '../types/cad';
import { generateId } from './meshUtils';
import { resolveMeshTextureAtTime } from './textureAnimation';

const cloneV = (v: Vector3D): Vector3D => ({ x: v.x, y: v.y, z: v.z });
const id = (prefix: string) => `${prefix}_${generateId()}`;

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function lerpVec(a: Vector3D, b: Vector3D, t: number): Vector3D {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) };
}

function applyEasing(t: number, mode: AnimInterpolation): number {
  const clamped = Math.max(0, Math.min(1, t));
  if (mode === 'smooth') return clamped * clamped * (3 - 2 * clamped);
  if (mode === 'bounce') return Math.sin(clamped * Math.PI * 0.5);
  if (mode === 'elastic') {
    if (clamped === 0 || clamped === 1) return clamped;
    return Math.pow(2, -10 * clamped) * Math.sin((clamped * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
  }
  return clamped;
}

/** Sample a sorted keyframe channel at time t. */
export function sampleChannel(
  keyframes: AnimKeyframe[],
  time: number,
  interpolation: AnimInterpolation = 'smooth',
): Vector3D | null {
  if (!keyframes.length) return null;
  const sorted = [...keyframes].sort((a, b) => a.time - b.time);
  if (time <= sorted[0].time) return cloneV(sorted[0].value);
  if (time >= sorted[sorted.length - 1].time) return cloneV(sorted[sorted.length - 1].value);

  for (let i = 0; i < sorted.length - 1; i += 1) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (time >= a.time && time <= b.time) {
      const span = Math.max(1e-6, b.time - a.time);
      const t = applyEasing((time - a.time) / span, interpolation);
      return lerpVec(a.value, b.value, t);
    }
  }
  return cloneV(sorted[sorted.length - 1].value);
}

export function createEmptyClip(name = 'New Clip', duration = 2, fps = 24): AnimationClip {
  return {
    id: id('clip'),
    name,
    duration,
    fps,
    loopMode: 'loop',
    tracks: [],
    interpolation: 'smooth',
  };
}

export function createDefaultClip(
  meshes: CADMesh[],
  bones: CADBone[],
  name = 'Idle',
): AnimationClip {
  const duration = 2;
  const tracks: AnimTrack[] = [
    ...meshes.map((m) => ({
      targetId: m.id,
      targetName: m.name,
      targetType: 'mesh' as const,
      posKeyframes: [
        { id: id('kf'), time: 0, value: cloneV(m.position) },
        { id: id('kf'), time: duration, value: cloneV(m.position) },
      ],
      rotKeyframes: [
        { id: id('kf'), time: 0, value: cloneV(m.rotation) },
        { id: id('kf'), time: duration, value: cloneV(m.rotation) },
      ],
      sclKeyframes: [
        { id: id('kf'), time: 0, value: cloneV(m.scale) },
        { id: id('kf'), time: duration, value: cloneV(m.scale) },
      ],
    })),
    ...bones.map((bone) => ({
      targetId: bone.id,
      targetName: bone.name,
      targetType: 'bone' as const,
      posKeyframes: [{ id: id('kf'), time: 0, value: cloneV(bone.position) }],
      rotKeyframes: [{ id: id('kf'), time: 0, value: cloneV(bone.rotation) }],
      sclKeyframes: [{ id: id('kf'), time: 0, value: cloneV(bone.scale) }],
    })),
  ];
  return {
    id: id('clip'),
    name,
    duration,
    fps: 24,
    loopMode: 'loop',
    tracks,
    interpolation: 'smooth',
  };
}

export type GameClipKind = 'idle' | 'walk' | 'run' | 'attack' | 'emote' | 'death';

export const GAME_CLIP_PRESETS: Array<{
  id: GameClipKind;
  label: string;
  hint: string;
  duration: number;
  loopMode: AnimationClip['loopMode'];
  fps: number;
}> = [
  { id: 'idle', label: 'Idle', hint: 'Looping stand / breathe', duration: 2, loopMode: 'loop', fps: 24 },
  { id: 'walk', label: 'Walk', hint: 'Looping walk cycle', duration: 1, loopMode: 'loop', fps: 30 },
  { id: 'run', label: 'Run', hint: 'Looping run cycle', duration: 0.7, loopMode: 'loop', fps: 30 },
  { id: 'attack', label: 'Attack', hint: 'One-shot action', duration: 0.85, loopMode: 'once', fps: 30 },
  { id: 'emote', label: 'Emote', hint: 'Gesture / reaction', duration: 2.5, loopMode: 'once', fps: 24 },
  { id: 'death', label: 'Death', hint: 'Hold final pose', duration: 1.5, loopMode: 'hold', fps: 24 },
];

/** Create a game-ready empty clip sized for the action type (keys at rest pose t=0). */
export function createGameClip(
  meshes: CADMesh[],
  bones: CADBone[],
  kind: GameClipKind = 'idle',
  name?: string,
): AnimationClip {
  const preset = GAME_CLIP_PRESETS.find((p) => p.id === kind) || GAME_CLIP_PRESETS[0];
  const clip = createDefaultClip(meshes, bones, name || preset.label);
  return {
    ...clip,
    duration: preset.duration,
    fps: preset.fps,
    loopMode: preset.loopMode,
    tracks: clip.tracks.map((track) => ({
      ...track,
      // Game clips start with a single rest key — animate forward from here.
      posKeyframes: track.posKeyframes.slice(0, 1),
      rotKeyframes: track.rotKeyframes.slice(0, 1),
      sclKeyframes: track.sclKeyframes.slice(0, 1),
    })),
  };
}

/** Duplicate a clip with fresh ids (for variants / takes). */
export function duplicateClip(clip: AnimationClip, name?: string): AnimationClip {
  const remapKf = (frames: typeof clip.tracks[0]['posKeyframes']) =>
    frames.map((kf) => ({ ...kf, id: id('kf'), value: { ...kf.value } }));
  return {
    ...clip,
    id: id('clip'),
    name: name || `${clip.name} Copy`,
    tracks: clip.tracks.map((track) => ({
      ...track,
      posKeyframes: remapKf(track.posKeyframes),
      rotKeyframes: remapKf(track.rotKeyframes),
      sclKeyframes: remapKf(track.sclKeyframes),
      texFrameKeyframes: track.texFrameKeyframes
        ? remapKf(track.texFrameKeyframes)
        : undefined,
      textureClipKeys: track.textureClipKeys?.map((kf) => ({
        ...kf,
        id: id('kf'),
      })),
    })),
  };
}

/** Insert rest-pose keys for every bone at time (quick “pose zero” for game anim). */
export function keyBonesAtRest(
  clip: AnimationClip,
  bones: CADBone[],
  time = 0,
): AnimationClip {
  let next = clip;
  bones.forEach((bone) => {
    const pos = bone.restPosition || bone.position;
    const rot = bone.restRotation || bone.rotation;
    const scl = bone.restScale || bone.scale;
    next = autoKeyTarget(next, bone.id, 'bone', bone.name, {
      position: pos,
      rotation: rot,
      scale: scl,
    }, time);
  });
  return next;
}

export function wrapTime(time: number, duration: number, loopMode: AnimationClip['loopMode']): number {
  if (duration <= 0) return 0;
  if (loopMode === 'loop') {
    const t = time % duration;
    return t < 0 ? t + duration : t;
  }
  return Math.max(0, Math.min(duration, time));
}

export interface EvaluatedPose {
  bones: CADBone[];
  meshes: CADMesh[];
  /** Always present; falls back to the unposed scene cameras when the clip has no camera tracks. */
  cameras: CADCamera[];
  /** Always present; falls back to the unposed scene lights when the clip has no light tracks. */
  lights: CADLight[];
}

/**
 * Evaluate a clip at time t and return posed bones/meshes/cameras/lights.
 * Only targets with keyframes are overwritten; others keep base transforms.
 */
export function evaluateClipAtTime(
  clip: AnimationClip,
  time: number,
  baseBones: CADBone[],
  baseMeshes: CADMesh[],
  baseCameras: CADCamera[] = [],
  baseLights: CADLight[] = [],
): EvaluatedPose {
  const t = wrapTime(time, clip.duration, clip.loopMode);
  const interp = clip.interpolation || 'smooth';

  const boneMap = new Map(baseBones.map((b) => [b.id, { ...b }]));
  const meshMap = new Map(baseMeshes.map((m) => [m.id, { ...m }]));
  const cameraMap = new Map(baseCameras.map((c) => [c.id, { ...c, position: { ...c.position }, rotation: { ...c.rotation } }]));
  const lightMap = new Map(baseLights.map((L) => [L.id, { ...L, position: { ...L.position }, rotation: { ...L.rotation }, scale: { ...L.scale } }]));

  clip.tracks.forEach((track) => {
    const pos = sampleChannel(track.posKeyframes, t, interp);
    const rot = sampleChannel(track.rotKeyframes, t, interp);
    const scl = sampleChannel(track.sclKeyframes, t, interp);

    if (track.targetType === 'bone') {
      const bone = boneMap.get(track.targetId);
      if (!bone) return;
      if (pos) bone.position = pos;
      if (rot) bone.rotation = rot;
      if (scl) bone.scale = scl;
      boneMap.set(track.targetId, bone);
    } else if (track.targetType === 'camera') {
      const cam = cameraMap.get(track.targetId);
      if (!cam) return;
      if (pos) cam.position = pos;
      if (rot) cam.rotation = rot;
      if (scl && typeof scl.x === 'number') {
        // Use scale.x as FOV offset channel optionally — keep FOV from scalar if present
      }
      const fov = sampleChannel(track.scalarKeyframes || [], t, interp);
      if (fov) cam.fov = Math.max(10, Math.min(120, fov.x));
      cameraMap.set(track.targetId, cam);
    } else if (track.targetType === 'mesh') {
      const mesh = meshMap.get(track.targetId);
      if (!mesh) return;
      if (pos) mesh.position = pos;
      if (rot) mesh.rotation = rot;
      if (scl) mesh.scale = scl;
      const tex = resolveMeshTextureAtTime(mesh, track, t);
      if (tex.dataUrl) {
        mesh.textureCanvasDataUrl = tex.dataUrl;
      }
      meshMap.set(track.targetId, mesh);
    } else if (track.targetType === 'light') {
      const light = lightMap.get(track.targetId);
      if (!light) return;
      if (pos) light.position = pos;
      if (rot) light.rotation = rot;
      if (scl) {
        light.scale = scl;
        light.distance = Math.max(0.5, scl.x * 8);
        if (scl.y > 0) light.intensity = scl.y;
      }
      lightMap.set(track.targetId, light);
    }
  });

  // Ambient auto-play flipbooks tick even without a mesh track in the clip.
  const trackedMeshIds = new Set(
    clip.tracks.filter((tr) => tr.targetType === 'mesh').map((tr) => tr.targetId),
  );
  meshMap.forEach((mesh, meshId) => {
    if (trackedMeshIds.has(meshId)) return;
    if (!mesh.textureAnimation?.autoPlay) return;
    const tex = resolveMeshTextureAtTime(mesh, undefined, t);
    if (tex.dataUrl) mesh.textureCanvasDataUrl = tex.dataUrl;
  });

  return {
    bones: baseBones.map((b) => boneMap.get(b.id) || b),
    meshes: baseMeshes.map((m) => meshMap.get(m.id) || m),
    cameras: baseCameras.map((c) => cameraMap.get(c.id) || c),
    lights: baseLights.map((L) => lightMap.get(L.id) || L),
  };
}

function channelRestKey(keys: AnimKeyframe[]): AnimKeyframe | null {
  if (!keys.length) return null;
  const atZero = keys.find((k) => Math.abs(k.time) < 1e-6);
  if (atZero) return atZero;
  return [...keys].sort((a, b) => a.time - b.time)[0];
}

function shiftChannelToRest(keys: AnimKeyframe[], rest: Vector3D): AnimKeyframe[] {
  const anchor = channelRestKey(keys);
  if (!anchor) return keys;
  const dx = rest.x - anchor.value.x;
  const dy = rest.y - anchor.value.y;
  const dz = rest.z - anchor.value.z;
  if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) < 1e-8) return keys;
  return keys.map((k) => ({
    ...k,
    value: { x: k.value.x + dx, y: k.value.y + dy, z: k.value.z + dz },
  }));
}

export interface AnimSceneRest {
  meshes: CADMesh[];
  bones: CADBone[];
  cameras?: CADCamera[];
  lights?: CADLight[];
  particles?: ParticleEmitter[];
}

function restTransformForTrack(
  track: AnimTrack,
  scene: AnimSceneRest,
): { position: Vector3D; rotation: Vector3D; scale: Vector3D; fov?: number } | null {
  if (track.targetType === 'mesh') {
    const m = scene.meshes.find((x) => x.id === track.targetId);
    return m ? { position: m.position, rotation: m.rotation, scale: m.scale } : null;
  }
  if (track.targetType === 'bone') {
    const b = scene.bones.find((x) => x.id === track.targetId);
    return b ? { position: b.position, rotation: b.rotation, scale: b.scale } : null;
  }
  if (track.targetType === 'camera') {
    const c = scene.cameras?.find((x) => x.id === track.targetId);
    return c
      ? { position: c.position, rotation: c.rotation, scale: { x: c.fov, y: 1, z: 1 }, fov: c.fov }
      : null;
  }
  if (track.targetType === 'light') {
    const L = scene.lights?.find((x) => x.id === track.targetId);
    return L ? { position: L.position, rotation: L.rotation, scale: L.scale } : null;
  }
  if (track.targetType === 'particle') {
    const p = scene.particles?.find((x) => x.id === track.targetId);
    return p
      ? {
          position: p.position,
          rotation: p.rotation,
          scale: p.scale || { x: 1, y: 1, z: 1 },
        }
      : null;
  }
  return null;
}

/**
 * When scene rest transforms change (e.g. Model-mode edits), shift clip keyframes
 * for every tracked object so animation keeps relative motion on the new rest.
 */
export function rebaseClipTracksToScene(
  clip: AnimationClip,
  meshesOrScene: CADMesh[] | AnimSceneRest,
  bones: CADBone[] = [],
): AnimationClip {
  const scene: AnimSceneRest = Array.isArray(meshesOrScene)
    ? { meshes: meshesOrScene, bones }
    : meshesOrScene;
  let changed = false;

  const tracks = clip.tracks.map((track) => {
    const rest = restTransformForTrack(track, scene);
    if (!rest) return track;

    const posKeyframes = shiftChannelToRest(track.posKeyframes, rest.position);
    const rotKeyframes = shiftChannelToRest(track.rotKeyframes, rest.rotation);
    const sclKeyframes = shiftChannelToRest(track.sclKeyframes, rest.scale);
    let scalarKeyframes = track.scalarKeyframes;
    if (track.targetType === 'camera' && typeof rest.fov === 'number' && track.scalarKeyframes?.length) {
      scalarKeyframes = shiftChannelToRest(track.scalarKeyframes, { x: rest.fov, y: 0, z: 0 });
    }
    if (
      posKeyframes === track.posKeyframes &&
      rotKeyframes === track.rotKeyframes &&
      sclKeyframes === track.sclKeyframes &&
      scalarKeyframes === track.scalarKeyframes
    ) {
      return track;
    }
    changed = true;
    return { ...track, posKeyframes, rotKeyframes, sclKeyframes, scalarKeyframes };
  });

  return changed ? { ...clip, tracks } : clip;
}

/** Ensure every scene object has an animation track seeded from its current transform. */
export function ensureClipTracksForScene(clip: AnimationClip, scene: AnimSceneRest): AnimationClip {
  let next = clip;
  const unit = { x: 1, y: 1, z: 1 };

  scene.meshes.forEach((m) => {
    next = ensureTrackForTarget(next, m.id, m.name, 'mesh', {
      position: m.position,
      rotation: m.rotation,
      scale: m.scale,
    });
  });
  scene.bones.forEach((b) => {
    next = ensureTrackForTarget(next, b.id, b.name, 'bone', {
      position: b.position,
      rotation: b.rotation,
      scale: b.scale,
    });
  });
  (scene.cameras || []).forEach((c) => {
    next = ensureTrackForTarget(next, c.id, c.name, 'camera', {
      position: c.position,
      rotation: c.rotation,
      scale: { x: c.fov, y: 1, z: 1 },
    });
  });
  (scene.lights || []).forEach((L) => {
    next = ensureTrackForTarget(next, L.id, L.name, 'light', {
      position: L.position,
      rotation: L.rotation,
      scale: L.scale,
    });
  });
  (scene.particles || []).forEach((p) => {
    next = ensureTrackForTarget(next, p.id, p.name, 'particle', {
      position: p.position,
      rotation: p.rotation,
      scale: p.scale || unit,
    });
  });

  return next;
}

export function ensureTrackForTarget(
  clip: AnimationClip,
  targetId: string,
  targetName: string,
  targetType: AnimTrack['targetType'],
  transform: { position: Vector3D; rotation: Vector3D; scale: Vector3D },
): AnimationClip {
  const existing = clip.tracks.find((t) => t.targetId === targetId && t.targetType === targetType);
  if (existing) return clip;
  const track: AnimTrack = {
    targetId,
    targetName,
    targetType,
    posKeyframes: [{ id: id('kf'), time: 0, value: cloneV(transform.position) }],
    rotKeyframes: [{ id: id('kf'), time: 0, value: cloneV(transform.rotation) }],
    sclKeyframes: [{ id: id('kf'), time: 0, value: cloneV(transform.scale) }],
  };
  return { ...clip, tracks: [...clip.tracks, track] };
}

export function insertKeyframe(
  clip: AnimationClip,
  targetId: string,
  targetType: AnimTrack['targetType'],
  channel: 'pos' | 'rot' | 'scl',
  time: number,
  value: Vector3D,
): AnimationClip {
  return {
    ...clip,
    tracks: clip.tracks.map((track) => {
      if (track.targetId !== targetId || track.targetType !== targetType) return track;
      const key = channel === 'pos' ? 'posKeyframes' : channel === 'rot' ? 'rotKeyframes' : 'sclKeyframes';
      const frames = [...track[key]];
      const existingIdx = frames.findIndex((kf) => Math.abs(kf.time - time) < 1e-4);
      if (existingIdx >= 0) {
        frames[existingIdx] = { ...frames[existingIdx], value: cloneV(value) };
      } else {
        frames.push({ id: id('kf'), time, value: cloneV(value) });
        frames.sort((a, b) => a.time - b.time);
      }
      return { ...track, [key]: frames };
    }),
  };
}

/** Auto-key all channels for a target at the given time from its current transform. */
export function autoKeyTarget(
  clip: AnimationClip,
  targetId: string,
  targetType: AnimTrack['targetType'],
  targetName: string,
  transform: { position: Vector3D; rotation: Vector3D; scale: Vector3D },
  time: number,
): AnimationClip {
  let next = ensureTrackForTarget(clip, targetId, targetName, targetType, transform);
  next = insertKeyframe(next, targetId, targetType, 'pos', time, transform.position);
  next = insertKeyframe(next, targetId, targetType, 'rot', time, transform.rotation);
  next = insertKeyframe(next, targetId, targetType, 'scl', time, transform.scale);
  return next;
}

/** Key a texture frame index (x = integer frame) on a mesh track. */
export function insertTexFrameKeyframe(
  clip: AnimationClip,
  targetId: string,
  time: number,
  frameIndex: number,
): AnimationClip {
  return {
    ...clip,
    tracks: clip.tracks.map((track) => {
      if (track.targetId !== targetId || track.targetType !== 'mesh') return track;
      const frames = [...(track.texFrameKeyframes || [])];
      const existingIdx = frames.findIndex((kf) => Math.abs(kf.time - time) < 1e-4);
      const value = { x: frameIndex, y: 0, z: 0 };
      if (existingIdx >= 0) {
        frames[existingIdx] = { ...frames[existingIdx], value };
      } else {
        frames.push({ id: id('kf'), time, value });
        frames.sort((a, b) => a.time - b.time);
      }
      return { ...track, texFrameKeyframes: frames };
    }),
  };
}

/** Trigger a named texture clip (Talk / Blink / Idle) on a mesh track. */
export function insertTextureClipKey(
  clip: AnimationClip,
  targetId: string,
  time: number,
  clipId: string,
  holdUntil?: number,
): AnimationClip {
  return {
    ...clip,
    tracks: clip.tracks.map((track) => {
      if (track.targetId !== targetId || track.targetType !== 'mesh') return track;
      const keys: TextureClipKey[] = [...(track.textureClipKeys || [])];
      const existingIdx = keys.findIndex((k) => Math.abs(k.time - time) < 1e-4);
      const nextKey: TextureClipKey = {
        id: id('texck'),
        time,
        clipId,
        holdUntil,
      };
      if (existingIdx >= 0) keys[existingIdx] = nextKey;
      else {
        keys.push(nextKey);
        keys.sort((a, b) => a.time - b.time);
      }
      return { ...track, textureClipKeys: keys };
    }),
  };
}
