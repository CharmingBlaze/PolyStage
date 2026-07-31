import { generateId } from './meshUtils';
import type {
  CutsceneSequence,
  SeqClipSource,
  SeqTrackKind,
  SeqTransitionType,
  SequenceAudioAsset,
  SequenceClip,
  SequenceMarker,
  SequenceTrack,
} from '../types/sequence';
import type { AnimationClip, WeatherPreset } from '../types/cad';

const id = (prefix: string) => `${prefix}_${generateId()}`;

const KIND_LABELS: Record<SeqTrackKind, string> = {
  video: 'Video',
  audio: 'Audio',
  fx: 'FX',
  camera: 'Camera',
  env: 'Environment',
  light: 'Lights',
  overlay: 'Titles',
};

export function createEmptySequence(name = 'Cutscene', duration = 10, fps = 24): CutsceneSequence {
  const mkTrack = (kind: SeqTrackKind, label: string): SequenceTrack => ({
    id: id('strack'),
    name: label,
    kind,
    parentId: null,
    clips: [],
  });
  return {
    id: id('seq'),
    name,
    duration,
    fps,
    tracks: [
      mkTrack('video', 'Video'),
      mkTrack('camera', 'Camera'),
      mkTrack('fx', 'FX'),
      mkTrack('env', 'Environment'),
      mkTrack('light', 'Lights'),
      mkTrack('overlay', 'Titles'),
      mkTrack('audio', 'Music'),
      mkTrack('audio', 'Dialogue'),
    ],
    audioAssets: [],
    markers: [],
  };
}

/** Ensure older sequences get overlay + dialogue lanes and a markers array. */
export function ensureMovieSequenceTracks(seq: CutsceneSequence): CutsceneSequence {
  let changed = false;
  let next = seq;
  if (!next.markers) {
    next = { ...next, markers: [] };
    changed = true;
  }
  const hasOverlay = next.tracks.some((t) => t.kind === 'overlay');
  if (!hasOverlay) {
    next = addSequenceTrack(next, 'overlay', 'Titles');
    changed = true;
  }
  const audioRoots = next.tracks.filter((t) => t.kind === 'audio' && !t.parentId);
  if (audioRoots.length === 1 && audioRoots[0].name === 'Audio') {
    next = {
      ...next,
      tracks: next.tracks.map((t) => (t.id === audioRoots[0].id ? { ...t, name: 'Music' } : t)),
    };
    next = addSequenceTrack(next, 'audio', 'Dialogue');
    changed = true;
  } else if (audioRoots.length === 0) {
    next = addSequenceTrack(next, 'audio', 'Music');
    next = addSequenceTrack(next, 'audio', 'Dialogue');
    changed = true;
  }
  return changed ? next : seq;
}

export function createSequenceClip(
  trackId: string,
  name: string,
  source: SeqClipSource,
  start = 0,
  duration = 2,
  color?: string,
): SequenceClip {
  const isCam = source.type === 'cameraShot';
  const isText = source.type === 'title' || source.type === 'subtitle';
  return {
    id: id('sclip'),
    trackId,
    name,
    start,
    duration,
    inPoint: 0,
    outPoint: duration,
    muted: false,
    volume: 1,
    fadeIn: source.type === 'audio' ? 0.15 : isText ? 0.2 : 0,
    fadeOut: source.type === 'audio' ? 0.25 : isText ? 0.3 : 0,
    transition: isCam ? 'cut' : undefined,
    transitionDuration: isCam ? 0.5 : undefined,
    textStyle: isText
      ? {
          fontSize: source.type === 'title' ? 42 : 22,
          color: '#ffffff',
          align: 'center',
          position: source.type === 'title' ? 'center' : 'bottom',
        }
      : undefined,
    source,
    color,
  };
}

export function sequenceEndTime(seq: CutsceneSequence): number {
  let end = seq.duration;
  seq.tracks.forEach((t) => {
    t.clips.forEach((c) => {
      end = Math.max(end, c.start + c.duration);
    });
  });
  return end;
}

export function setSequenceDuration(seq: CutsceneSequence, duration: number): CutsceneSequence {
  return { ...seq, duration: Math.max(0.5, duration) };
}

export function addSequenceTrack(
  seq: CutsceneSequence,
  kind: SeqTrackKind,
  name?: string,
  parentId: string | null = null,
): CutsceneSequence {
  const kindCount = seq.tracks.filter((t) => t.kind === kind && (parentId ? t.parentId === parentId : !t.parentId)).length;
  const parent = parentId ? seq.tracks.find((t) => t.id === parentId) : null;
  const track: SequenceTrack = {
    id: id('strack'),
    name: name || (parentId
      ? `${parent?.name || KIND_LABELS[kind]} ${kindCount + 1}`
      : kindCount === 0 ? KIND_LABELS[kind] : `${KIND_LABELS[kind]} ${kindCount + 1}`),
    kind: parent?.kind || kind,
    parentId: parentId || null,
    clips: [],
  };
  if (parentId) {
    const parentIdx = seq.tracks.findIndex((t) => t.id === parentId);
    if (parentIdx < 0) return { ...seq, tracks: [...seq.tracks, track] };
    let insertAt = parentIdx + 1;
    while (insertAt < seq.tracks.length && seq.tracks[insertAt].parentId === parentId) insertAt++;
    const tracks = [...seq.tracks];
    tracks.splice(insertAt, 0, track);
    return { ...seq, tracks };
  }
  return { ...seq, tracks: [...seq.tracks, track] };
}

export function removeSequenceTrack(seq: CutsceneSequence, trackId: string): CutsceneSequence {
  const removeIds = new Set<string>([trackId]);
  seq.tracks.forEach((t) => {
    if (t.parentId && removeIds.has(t.parentId)) removeIds.add(t.id);
  });
  return {
    ...seq,
    tracks: seq.tracks.filter((t) => !removeIds.has(t.id) && !(t.parentId && removeIds.has(t.parentId))),
  };
}

export function reorderSequenceTracks(
  seq: CutsceneSequence,
  trackId: string,
  direction: 'up' | 'down',
): CutsceneSequence {
  const roots = seq.tracks.filter((t) => !t.parentId);
  const childrenOf = (pid: string) => seq.tracks.filter((t) => t.parentId === pid);
  const track = seq.tracks.find((t) => t.id === trackId);
  if (!track) return seq;

  if (track.parentId) {
    const siblings = childrenOf(track.parentId);
    const idx = siblings.findIndex((t) => t.id === trackId);
    const swapWith = direction === 'up' ? idx - 1 : idx + 1;
    if (swapWith < 0 || swapWith >= siblings.length) return seq;
    const a = siblings[idx].id;
    const b = siblings[swapWith].id;
    const order = seq.tracks.map((t) => t.id);
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    const next = [...seq.tracks];
    [next[ia], next[ib]] = [next[ib], next[ia]];
    return { ...seq, tracks: next };
  }

  const idx = roots.findIndex((t) => t.id === trackId);
  const swapWith = direction === 'up' ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= roots.length) return seq;

  const blocks: SequenceTrack[][] = roots.map((r) => [r, ...childrenOf(r.id)]);
  const tmp = blocks[idx];
  blocks[idx] = blocks[swapWith];
  blocks[swapWith] = tmp;
  return { ...seq, tracks: blocks.flat() };
}

export function patchSequenceTrack(
  seq: CutsceneSequence,
  trackId: string,
  patch: Partial<Pick<SequenceTrack, 'name' | 'muted' | 'locked' | 'collapsed' | 'solo'>>,
): CutsceneSequence {
  return {
    ...seq,
    tracks: seq.tracks.map((t) => (t.id === trackId ? { ...t, ...patch } : t)),
  };
}

export function patchSequenceClip(
  seq: CutsceneSequence,
  clipId: string,
  patch: Partial<SequenceClip>,
): CutsceneSequence {
  return {
    ...seq,
    tracks: seq.tracks.map((t) => ({
      ...t,
      clips: t.clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c)),
    })),
  };
}

export function moveClipToTrack(
  seq: CutsceneSequence,
  clipId: string,
  targetTrackId: string,
  newStart?: number,
): CutsceneSequence {
  let clip: SequenceClip | undefined;
  for (const t of seq.tracks) {
    const found = t.clips.find((c) => c.id === clipId);
    if (found) {
      clip = found;
      break;
    }
  }
  if (!clip) return seq;
  const target = seq.tracks.find((t) => t.id === targetTrackId);
  if (target && !clipFitsTrack(clip, target)) return seq;
  const moved: SequenceClip = {
    ...clip,
    trackId: targetTrackId,
    start: newStart != null ? Math.max(0, newStart) : clip.start,
  };
  return {
    ...seq,
    tracks: seq.tracks.map((t) => {
      const clips = t.clips.filter((c) => c.id !== clipId);
      if (t.id === targetTrackId) return { ...t, clips: [...clips, moved] };
      return { ...t, clips };
    }),
  };
}

export function clipFitsTrack(clip: SequenceClip, track: SequenceTrack): boolean {
  const map: Record<SeqTrackKind, SeqClipSource['type'][]> = {
    video: ['animClip'],
    camera: ['cameraShot'],
    fx: ['particle'],
    env: ['weather'],
    light: ['lightCue'],
    audio: ['audio'],
    overlay: ['title', 'subtitle'],
  };
  return map[track.kind]?.includes(clip.source.type) ?? false;
}

function trackAudible(seq: CutsceneSequence, track: SequenceTrack): boolean {
  if (track.muted) return false;
  const peers = seq.tracks.filter((t) => t.kind === track.kind);
  const anySolo = peers.some((t) => t.solo);
  if (anySolo && !track.solo) return false;
  return true;
}

export function clipsAtTime(track: SequenceTrack, time: number): SequenceClip[] {
  return track.clips.filter((c) => !c.muted && time >= c.start && time < c.start + c.duration);
}

function tracksOfKind(seq: CutsceneSequence, kind: SeqTrackKind): SequenceTrack[] {
  return seq.tracks.filter((t) => t.kind === kind && trackAudible(seq, t));
}

export function activeAnimClipAtTime(
  seq: CutsceneSequence,
  animClips: AnimationClip[],
  time: number,
): { clip: AnimationClip; localTime: number } | null {
  let best: { clip: AnimationClip; localTime: number } | null = null;
  tracksOfKind(seq, 'video').forEach((video) => {
    const hit = clipsAtTime(video, time).find((c) => c.source.type === 'animClip');
    if (!hit) return;
    const clip = animClips.find((a) => a.id === hit.source.refId);
    if (!clip) return;
    const local = hit.inPoint + (time - hit.start);
    best = { clip, localTime: Math.max(0, Math.min(clip.duration, local)) };
  });
  return best;
}

export function weatherCueAtTime(seq: CutsceneSequence, time: number): WeatherPreset | null {
  let cue: WeatherPreset | null = null;
  tracksOfKind(seq, 'env').forEach((env) => {
    const hit = clipsAtTime(env, time).find((c) => c.source.type === 'weather');
    if (hit) cue = hit.source.refId as WeatherPreset;
  });
  return cue;
}

export function particleIdsAtTime(seq: CutsceneSequence, time: number): Set<string> {
  const ids = new Set<string>();
  tracksOfKind(seq, 'fx').forEach((fx) => {
    clipsAtTime(fx, time).forEach((c) => {
      if (c.source.type === 'particle') ids.add(c.source.refId);
    });
  });
  return ids;
}

export interface CameraShotEval {
  cameraId: string;
  fromCameraId: string | null;
  /** 0 = fully previous / black start · 1 = fully current shot */
  blend: number;
  transition: SeqTransitionType;
  /** Black veil 0–1 for fade / dip transitions */
  blackOpacity: number;
}

function cameraClipAtTime(seq: CutsceneSequence, time: number): SequenceClip | null {
  let hit: SequenceClip | null = null;
  tracksOfKind(seq, 'camera').forEach((cam) => {
    const c = clipsAtTime(cam, time).find((x) => x.source.type === 'cameraShot');
    if (c) hit = c;
  });
  return hit;
}

function previousCameraClip(seq: CutsceneSequence, beforeTime: number): SequenceClip | null {
  let best: SequenceClip | null = null;
  let bestEnd = -1;
  tracksOfKind(seq, 'camera').forEach((cam) => {
    cam.clips.forEach((c) => {
      if (c.muted || c.source.type !== 'cameraShot') return;
      const end = c.start + c.duration;
      if (end <= beforeTime + 1e-4 && end > bestEnd) {
        best = c;
        bestEnd = end;
      }
    });
  });
  return best;
}

export function cameraShotAtTime(seq: CutsceneSequence, time: number): CameraShotEval | null {
  const hit = cameraClipAtTime(seq, time);
  if (!hit) return null;
  const transition: SeqTransitionType = hit.transition || 'cut';
  const td = Math.max(0, Math.min(hit.transitionDuration ?? 0, hit.duration * 0.9));
  const age = time - hit.start;
  const prev = previousCameraClip(seq, hit.start);
  if (transition === 'cut' || td <= 1e-4 || age >= td) {
    return {
      cameraId: hit.source.refId,
      fromCameraId: null,
      blend: 1,
      transition: 'cut',
      blackOpacity: 0,
    };
  }
  const blend = Math.max(0, Math.min(1, age / td));
  if (transition === 'dissolve') {
    return {
      cameraId: hit.source.refId,
      fromCameraId: prev?.source.refId || null,
      blend,
      transition,
      blackOpacity: 0,
    };
  }
  if (transition === 'fade') {
    return {
      cameraId: hit.source.refId,
      fromCameraId: null,
      blend,
      transition,
      blackOpacity: 1 - blend,
    };
  }
  // dipBlack — black peaks at mid-transition; switch camera at halfway
  const blackOpacity = Math.sin(blend * Math.PI);
  const useNew = blend >= 0.5;
  return {
    cameraId: useNew ? hit.source.refId : (prev?.source.refId || hit.source.refId),
    fromCameraId: useNew ? (prev?.source.refId || null) : hit.source.refId,
    blend,
    transition,
    blackOpacity,
  };
}

/** @deprecated Prefer cameraShotAtTime for transitions. */
export function cameraIdAtTime(seq: CutsceneSequence, time: number): string | null {
  return cameraShotAtTime(seq, time)?.cameraId ?? null;
}

export function lightIdsAtTime(seq: CutsceneSequence, time: number): Set<string> | null {
  const lightTracks = tracksOfKind(seq, 'light');
  const hasAnyClips = lightTracks.some((t) => t.clips.length > 0);
  if (!hasAnyClips) return null;
  const ids = new Set<string>();
  lightTracks.forEach((track) => {
    clipsAtTime(track, time).forEach((c) => {
      if (c.source.type === 'lightCue') ids.add(c.source.refId);
    });
  });
  return ids;
}

export interface ActiveAudioClip {
  clip: SequenceClip;
  localTime: number;
  gain: number;
}

/** Envelope gain including fade in/out and clip volume. */
export function clipEnvelopeGain(clip: SequenceClip, time: number): number {
  const base = clip.volume ?? 1;
  const age = time - clip.start;
  const left = clip.start + clip.duration - time;
  const fi = Math.max(0, clip.fadeIn ?? 0);
  const fo = Math.max(0, clip.fadeOut ?? 0);
  let env = 1;
  if (fi > 0 && age < fi) env = Math.min(env, age / fi);
  if (fo > 0 && left < fo) env = Math.min(env, left / fo);
  return Math.max(0, Math.min(1, base * env));
}

export function audioClipsAtTime(seq: CutsceneSequence, time: number): ActiveAudioClip[] {
  const out: ActiveAudioClip[] = [];
  tracksOfKind(seq, 'audio').forEach((track) => {
    clipsAtTime(track, time).forEach((clip) => {
      if (clip.source.type !== 'audio') return;
      out.push({
        clip,
        localTime: clip.inPoint + (time - clip.start),
        gain: clipEnvelopeGain(clip, time),
      });
    });
  });
  return out;
}

export interface ActiveOverlay {
  clip: SequenceClip;
  text: string;
  opacity: number;
}

export function overlayClipsAtTime(seq: CutsceneSequence, time: number): ActiveOverlay[] {
  const out: ActiveOverlay[] = [];
  tracksOfKind(seq, 'overlay').forEach((track) => {
    clipsAtTime(track, time).forEach((clip) => {
      if (clip.source.type !== 'title' && clip.source.type !== 'subtitle') return;
      out.push({
        clip,
        text: clip.source.refId || clip.name,
        opacity: clipEnvelopeGain(clip, time),
      });
    });
  });
  return out;
}

export function moveClip(seq: CutsceneSequence, clipId: string, newStart: number): CutsceneSequence {
  return {
    ...seq,
    tracks: seq.tracks.map((t) => ({
      ...t,
      clips: t.clips.map((c) => (c.id === clipId ? { ...c, start: Math.max(0, newStart) } : c)),
    })),
  };
}

export function trimClip(
  seq: CutsceneSequence,
  clipId: string,
  edge: 'start' | 'end',
  time: number,
): CutsceneSequence {
  return {
    ...seq,
    tracks: seq.tracks.map((t) => ({
      ...t,
      clips: t.clips.map((c) => {
        if (c.id !== clipId) return c;
        if (edge === 'start') {
          const end = c.start + c.duration;
          const start = Math.max(0, Math.min(time, end - 1 / 60));
          const delta = start - c.start;
          return {
            ...c,
            start,
            duration: end - start,
            inPoint: Math.max(0, c.inPoint + delta),
          };
        }
        const end = Math.max(c.start + 1 / 60, time);
        return {
          ...c,
          duration: end - c.start,
          outPoint: c.inPoint + (end - c.start),
        };
      }),
    })),
  };
}

export function splitClip(seq: CutsceneSequence, clipId: string, time: number): CutsceneSequence {
  return {
    ...seq,
    tracks: seq.tracks.map((t) => {
      const idx = t.clips.findIndex((c) => c.id === clipId);
      if (idx < 0) return t;
      const c = t.clips[idx];
      if (time <= c.start + 1e-3 || time >= c.start + c.duration - 1e-3) return t;
      const leftDur = time - c.start;
      const rightDur = c.duration - leftDur;
      const left: SequenceClip = { ...c, duration: leftDur, outPoint: c.inPoint + leftDur };
      const right: SequenceClip = {
        ...c,
        id: id('sclip'),
        start: time,
        duration: rightDur,
        inPoint: c.inPoint + leftDur,
        outPoint: c.outPoint,
        transition: undefined,
        transitionDuration: undefined,
      };
      const clips = [...t.clips];
      clips.splice(idx, 1, left, right);
      return { ...t, clips };
    }),
  };
}

export function removeClip(seq: CutsceneSequence, clipId: string): CutsceneSequence {
  return {
    ...seq,
    tracks: seq.tracks.map((t) => ({
      ...t,
      clips: t.clips.filter((c) => c.id !== clipId),
    })),
  };
}

/** Delete clip and pull later clips on the same track left (ripple). */
export function rippleDeleteClip(seq: CutsceneSequence, clipId: string): CutsceneSequence {
  let removed: SequenceClip | undefined;
  let trackId = '';
  for (const t of seq.tracks) {
    const c = t.clips.find((x) => x.id === clipId);
    if (c) {
      removed = c;
      trackId = t.id;
      break;
    }
  }
  if (!removed) return seq;
  const end = removed.start + removed.duration;
  return {
    ...seq,
    tracks: seq.tracks.map((t) => {
      if (t.id !== trackId) return t;
      return {
        ...t,
        clips: t.clips
          .filter((c) => c.id !== clipId)
          .map((c) => (c.start >= end - 1e-6
            ? { ...c, start: Math.max(0, c.start - removed!.duration) }
            : c)),
      };
    }),
  };
}

export function duplicateClip(seq: CutsceneSequence, clipId: string): CutsceneSequence {
  for (const t of seq.tracks) {
    const c = t.clips.find((x) => x.id === clipId);
    if (!c) continue;
    const copy: SequenceClip = {
      ...c,
      id: id('sclip'),
      start: c.start + c.duration,
      name: `${c.name} copy`,
    };
    return addClipToTrack(seq, t.id, copy);
  }
  return seq;
}

export function addClipToTrack(
  seq: CutsceneSequence,
  trackId: string,
  clip: SequenceClip,
): CutsceneSequence {
  const next = {
    ...seq,
    tracks: seq.tracks.map((t) => (t.id === trackId ? { ...t, clips: [...t.clips, { ...clip, trackId }] } : t)),
  };
  const end = sequenceEndTime(next);
  if (end > next.duration) return { ...next, duration: end };
  return next;
}

export function addAudioAsset(
  seq: CutsceneSequence,
  asset: Omit<SequenceAudioAsset, 'id'> & { id?: string },
): CutsceneSequence {
  const next: SequenceAudioAsset = {
    id: asset.id || id('audio'),
    name: asset.name,
    url: asset.url,
    duration: asset.duration,
  };
  return { ...seq, audioAssets: [...seq.audioAssets, next] };
}

export function addSequenceMarker(
  seq: CutsceneSequence,
  time: number,
  name?: string,
  color = '#e68619',
): CutsceneSequence {
  const marker: SequenceMarker = {
    id: id('smark'),
    time: Math.max(0, time),
    name: name || `M${(seq.markers?.length || 0) + 1}`,
    color,
  };
  return { ...seq, markers: [...(seq.markers || []), marker].sort((a, b) => a.time - b.time) };
}

export function removeSequenceMarker(seq: CutsceneSequence, markerId: string): CutsceneSequence {
  return { ...seq, markers: (seq.markers || []).filter((m) => m.id !== markerId) };
}

export function patchSequenceMarker(
  seq: CutsceneSequence,
  markerId: string,
  patch: Partial<Pick<SequenceMarker, 'time' | 'name' | 'color'>>,
): CutsceneSequence {
  return {
    ...seq,
    markers: (seq.markers || []).map((m) => (m.id === markerId ? { ...m, ...patch } : m))
      .sort((a, b) => a.time - b.time),
  };
}

export function collectClipEdgeTimes(seq: CutsceneSequence, excludeClipId?: string): number[] {
  const times = [0, seq.duration];
  seq.tracks.forEach((t) => {
    t.clips.forEach((c) => {
      if (c.id === excludeClipId) return;
      times.push(c.start, c.start + c.duration);
    });
  });
  (seq.markers || []).forEach((m) => times.push(m.time));
  return times;
}

export function snapToEdges(t: number, edges: number[], thresholdSec: number): number {
  let best = t;
  let bestDist = thresholdSec;
  for (const e of edges) {
    const d = Math.abs(e - t);
    if (d < bestDist) {
      bestDist = d;
      best = e;
    }
  }
  return best;
}

export function snapSeqTime(t: number, fps: number, snap: boolean): number {
  if (!snap) return Math.max(0, Math.round(t * 1000) / 1000);
  return Math.max(0, Math.round(t * fps) / fps);
}

export const SEQ_CLIP_COLORS: Record<string, string> = {
  animClip: '#ed7300',
  audio: '#2d9d78',
  particle: '#e68619',
  weather: '#6a9fd8',
  cameraShot: '#9b59b6',
  lightCue: '#f1c40f',
  title: '#ec5b62',
  subtitle: '#c45c9a',
};

export const SEQ_KIND_LABELS: Record<SeqTrackKind, string> = { ...KIND_LABELS };

export const SEQ_TRANSITION_LABELS: Record<SeqTransitionType, string> = {
  cut: 'Cut',
  fade: 'Fade from black',
  dissolve: 'Dissolve',
  dipBlack: 'Dip to black',
};
