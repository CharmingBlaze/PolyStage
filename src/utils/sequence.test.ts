import { describe, expect, it } from 'vitest';
import {
  addClipToTrack,
  cameraShotAtTime,
  clipEnvelopeGain,
  createEmptySequence,
  createSequenceClip,
  moveClip,
  splitClip,
  trimClip,
  activeAnimClipAtTime,
  sequenceEndTime,
} from './sequence';
import { createEmptyClip } from './animation';

describe('sequence timeline', () => {
  it('creates default movie tracks', () => {
    const seq = createEmptySequence('Test', 8, 24);
    expect(seq.tracks.map((t) => t.kind)).toEqual([
      'video', 'camera', 'fx', 'env', 'light', 'overlay', 'audio', 'audio',
    ]);
    expect(seq.markers).toEqual([]);
  });

  it('moves and trims clips', () => {
    let seq = createEmptySequence('T', 10, 24);
    const video = seq.tracks.find((t) => t.kind === 'video')!;
    const clip = createSequenceClip(video.id, 'Idle', { type: 'animClip', refId: 'c1' }, 0, 4);
    seq = addClipToTrack(seq, video.id, clip);
    seq = moveClip(seq, clip.id, 2);
    expect(seq.tracks.find((t) => t.kind === 'video')!.clips[0].start).toBe(2);
    seq = trimClip(seq, clip.id, 'end', 5);
    expect(seq.tracks.find((t) => t.kind === 'video')!.clips[0].duration).toBe(3);
  });

  it('splits clips and resolves anim at time', () => {
    const anim = createEmptyClip('Idle', 4, 24);
    let seq = createEmptySequence('T', 10, 24);
    const video = seq.tracks.find((t) => t.kind === 'video')!;
    const clip = createSequenceClip(video.id, 'Idle', { type: 'animClip', refId: anim.id }, 0, 4);
    seq = addClipToTrack(seq, video.id, clip);
    seq = splitClip(seq, clip.id, 2);
    expect(seq.tracks.find((t) => t.kind === 'video')!.clips.length).toBe(2);
    const hit = activeAnimClipAtTime(seq, [anim], 1.5);
    expect(hit?.clip.id).toBe(anim.id);
    expect(hit?.localTime).toBeCloseTo(1.5);
    expect(sequenceEndTime(seq)).toBeGreaterThanOrEqual(4);
  });

  it('resolves camera dissolve blend and audio envelope', () => {
    let seq = createEmptySequence('T', 10, 24);
    const cam = seq.tracks.find((t) => t.kind === 'camera')!;
    const a = createSequenceClip(cam.id, 'A', { type: 'cameraShot', refId: 'camA' }, 0, 2);
    a.transition = 'cut';
    const b = createSequenceClip(cam.id, 'B', { type: 'cameraShot', refId: 'camB' }, 2, 3);
    b.transition = 'dissolve';
    b.transitionDuration = 1;
    seq = addClipToTrack(seq, cam.id, a);
    seq = addClipToTrack(seq, cam.id, b);
    const mid = cameraShotAtTime(seq, 2.5);
    expect(mid?.cameraId).toBe('camB');
    expect(mid?.fromCameraId).toBe('camA');
    expect(mid?.blend).toBeCloseTo(0.5);
    const audio = createSequenceClip(
      seq.tracks.find((t) => t.kind === 'audio')!.id,
      'Sfx',
      { type: 'audio', refId: 'a1' },
      0,
      2,
    );
    audio.fadeIn = 0.5;
    audio.volume = 1;
    expect(clipEnvelopeGain(audio, 0.25)).toBeCloseTo(0.5);
  });
});
