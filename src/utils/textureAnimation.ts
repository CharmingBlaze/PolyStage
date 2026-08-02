import type {
  AnimKeyframe,
  AnimTrack,
  CADMesh,
  MeshTextureAnimClip,
  MeshTextureAnimation,
  MeshTextureAnimFrame,
  TextureClipKey,
} from '../types/cad';
import { generateId } from './meshUtils';

const id = (prefix: string) => `${prefix}_${generateId()}`;

export function createPresetTextureClips(frames: MeshTextureAnimFrame[]): MeshTextureAnimClip[] {
  const byTag = (tag: string) => frames.filter((f) => f.tags?.includes(tag)).map((f) => f.id);
  const presets: Array<{ name: string; tag: string }> = [
    { name: 'Idle', tag: 'idle' },
    { name: 'Talk', tag: 'talk' },
    { name: 'Blink', tag: 'blink' },
  ];
  return presets
    .map((p) => {
      const frameIds = byTag(p.tag);
      if (!frameIds.length) return null;
      return {
        id: id('texclip'),
        name: p.name,
        frameIds,
        loop: p.tag !== 'blink',
      } satisfies MeshTextureAnimClip;
    })
    .filter(Boolean) as MeshTextureAnimClip[];
}

export function seedTextureAnimationFromStill(
  width: number,
  height: number,
  dataUrl: string,
): MeshTextureAnimation {
  const frame: MeshTextureAnimFrame = {
    id: id('texframe'),
    name: 'Frame 1',
    durationMs: 100,
    dataUrl,
    tags: ['idle'],
  };
  const idle: MeshTextureAnimClip = {
    id: id('texclip'),
    name: 'Idle',
    frameIds: [frame.id],
    loop: true,
  };
  return {
    width,
    height,
    frames: [frame],
    clips: [idle],
    defaultClipId: idle.id,
  };
}

/** Horizontal spritesheet PNG data URL. */
export function exportTextureSpritesheet(anim: MeshTextureAnimation): string {
  const { width, height, frames } = anim;
  if (!frames.length) {
    const empty = document.createElement('canvas');
    empty.width = width;
    empty.height = height;
    return empty.toDataURL('image/png');
  }
  const sheet = document.createElement('canvas');
  sheet.width = width * frames.length;
  sheet.height = height;
  const ctx = sheet.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  frames.forEach((frame, i) => {
    const img = new Image();
    // Synchronous draw only works if already decoded — callers should prefer async helper.
    img.src = frame.dataUrl;
    try {
      ctx.drawImage(img, i * width, 0, width, height);
    } catch {
      /* ignore incomplete decode */
    }
  });
  return sheet.toDataURL('image/png');
}

export async function exportTextureSpritesheetAsync(anim: MeshTextureAnimation): Promise<string> {
  const { width, height, frames } = anim;
  const sheet = document.createElement('canvas');
  sheet.width = Math.max(1, width * Math.max(1, frames.length));
  sheet.height = Math.max(1, height);
  const ctx = sheet.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  for (let i = 0; i < frames.length; i++) {
    const img = await loadImage(frames[i].dataUrl);
    ctx.drawImage(img, i * width, 0, width, height);
  }
  return sheet.toDataURL('image/png');
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Magic-wand: collect connected same-color pixels. Returns mask of pixel indices. */
export function magicWandSelect(
  image: ImageData,
  sx: number,
  sy: number,
  tol = 0,
): Set<number> {
  const { width: w, height: h, data } = image;
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const out = new Set<number>();
  if (x0 < 0 || y0 < 0 || x0 >= w || y0 >= h) return out;
  const start = (y0 * w + x0) * 4;
  const tr = data[start];
  const tg = data[start + 1];
  const tb = data[start + 2];
  const ta = data[start + 3];
  const match = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    return (
      Math.abs(data[i] - tr) <= tol &&
      Math.abs(data[i + 1] - tg) <= tol &&
      Math.abs(data[i + 2] - tb) <= tol &&
      Math.abs(data[i + 3] - ta) <= tol
    );
  };
  const stack: Array<[number, number]> = [[x0, y0]];
  const seen = new Uint8Array(w * h);
  while (stack.length) {
    const [x, y] = stack.pop()!;
    const idx = y * w + x;
    if (seen[idx]) continue;
    if (!match(x, y)) continue;
    seen[idx] = 1;
    out.add(idx);
    if (x > 0) stack.push([x - 1, y]);
    if (x < w - 1) stack.push([x + 1, y]);
    if (y > 0) stack.push([x, y - 1]);
    if (y < h - 1) stack.push([x, y + 1]);
  }
  return out;
}

/**
 * Ambient auto-play: loop the whole frame strip at `autoPlayFps` (uniform) or
 * per-frame durations. Returns the active frame index at time t (seconds).
 */
export function sampleAutoPlayFrameIndex(anim: MeshTextureAnimation, time: number): number {
  const count = anim.frames.length;
  if (count <= 1) return 0;
  const t = Math.max(0, time);
  if (anim.autoPlayFps && anim.autoPlayFps > 0) {
    return Math.floor(t * anim.autoPlayFps) % count;
  }
  const durations = anim.frames.map((f) => Math.max(1, f.durationMs || 100));
  const total = durations.reduce((a, b) => a + b, 0);
  let tMs = (t * 1000) % total;
  for (let i = 0; i < count; i++) {
    tMs -= durations[i];
    if (tMs < 0) return i;
  }
  return count - 1;
}

export function sampleTextureFrameIndex(keys: AnimKeyframe[] | undefined, time: number): number | null {
  if (!keys?.length) return null;
  const sorted = [...keys].sort((a, b) => a.time - b.time);
  let active = sorted[0];
  for (const k of sorted) {
    if (k.time <= time) active = k;
    else break;
  }
  return Math.max(0, Math.round(active.value.x));
}

export function activeTextureClipKey(
  keys: TextureClipKey[] | undefined,
  time: number,
): TextureClipKey | null {
  if (!keys?.length) return null;
  const sorted = [...keys].sort((a, b) => a.time - b.time);
  let best: TextureClipKey | null = null;
  for (const k of sorted) {
    if (k.time > time) break;
    const end = k.holdUntil ?? Number.POSITIVE_INFINITY;
    if (time >= k.time && time <= end) best = k;
  }
  return best;
}

/**
 * Resolve which texture dataUrl to show at time t.
 * Priority: texFrameKeys > named texture clip > autoPlay strip > still > defaultClip > first frame.
 */
export function resolveMeshTextureAtTime(
  mesh: CADMesh,
  track: AnimTrack | undefined,
  time: number,
): { dataUrl: string | null; frameIndex: number; clipId: string | null } {
  const anim = mesh.textureAnimation;
  const still = mesh.textureCanvasDataUrl || null;
  if (!anim?.frames.length) {
    return { dataUrl: still, frameIndex: 0, clipId: null };
  }

  const frameById = new Map(anim.frames.map((f) => [f.id, f]));

  // 1) Explicit frame index keys
  const keyed = sampleTextureFrameIndex(track?.texFrameKeyframes, time);
  if (keyed != null) {
    const idx = Math.min(anim.frames.length - 1, Math.max(0, keyed));
    return { dataUrl: anim.frames[idx].dataUrl, frameIndex: idx, clipId: null };
  }

  // 2) Named clip trigger
  const clipKey = activeTextureClipKey(track?.textureClipKeys, time);
  if (clipKey) {
    const clip = anim.clips?.find((c) => c.id === clipKey.clipId);
    if (clip?.frameIds.length) {
      const local = Math.max(0, time - clipKey.time);
      const durations = clip.frameIds.map((fid) => frameById.get(fid)?.durationMs || 100);
      const total = durations.reduce((a, b) => a + b, 0) || 100;
      let tMs = clip.loop ? (local * 1000) % total : Math.min(local * 1000, total - 1);
      let acc = 0;
      for (let i = 0; i < clip.frameIds.length; i++) {
        acc += durations[i];
        if (tMs < acc) {
          const frame = frameById.get(clip.frameIds[i]);
          const frameIndex = anim.frames.findIndex((f) => f.id === clip.frameIds[i]);
          return {
            dataUrl: frame?.dataUrl || still,
            frameIndex: Math.max(0, frameIndex),
            clipId: clip.id,
          };
        }
      }
    }
  }

  // 3) Ambient auto-play loop (opt-in; no keyframes needed)
  if (anim.autoPlay && anim.frames.length > 1) {
    const idx = sampleAutoPlayFrameIndex(anim, time);
    return { dataUrl: anim.frames[idx].dataUrl || still, frameIndex: idx, clipId: null };
  }

  // 4) Current still (live paint / last composited frame)
  if (still) {
    return { dataUrl: still, frameIndex: 0, clipId: null };
  }

  // 5) Default clip
  if (anim.defaultClipId) {
    const clip = anim.clips?.find((c) => c.id === anim.defaultClipId);
    if (clip?.frameIds[0]) {
      const frame = frameById.get(clip.frameIds[0]);
      const frameIndex = anim.frames.findIndex((f) => f.id === clip.frameIds[0]);
      return { dataUrl: frame?.dataUrl || null, frameIndex: Math.max(0, frameIndex), clipId: clip.id };
    }
  }

  return { dataUrl: anim.frames[0].dataUrl || null, frameIndex: 0, clipId: null };
}
