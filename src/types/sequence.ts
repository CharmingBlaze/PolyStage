/** Premiere-style multi-track cutscene sequence types — full movie / cutscene timeline. */

export type SeqTrackKind =
  | 'video'
  | 'audio'
  | 'fx'
  | 'camera'
  | 'env'
  | 'light'
  | 'overlay';

export type SeqClipSourceType =
  | 'animClip'
  | 'audio'
  | 'particle'
  | 'weather'
  | 'cameraShot'
  | 'lightCue'
  | 'title'
  | 'subtitle';

/** How a camera (or overlay) clip enters at its start. */
export type SeqTransitionType = 'cut' | 'fade' | 'dissolve' | 'dipBlack';

export interface SeqClipSource {
  type: SeqClipSourceType;
  /**
   * AnimationClip / Particle / Camera / Light / audio asset id,
   * weather preset name, or plain text for title/subtitle.
   */
  refId: string;
}

export interface SequenceClip {
  id: string;
  trackId: string;
  name: string;
  /** Timeline start (seconds). */
  start: number;
  /** Visible duration on timeline (seconds). */
  duration: number;
  /** Source in-point (trim start into media). */
  inPoint: number;
  /** Source out-point (trim end); if null, uses inPoint + duration. */
  outPoint: number | null;
  muted?: boolean;
  /** Linear gain 0–1 (audio / overlay opacity base). */
  volume?: number;
  /** Fade in / out lengths in seconds (clamped to half duration at playback). */
  fadeIn?: number;
  fadeOut?: number;
  /** Camera / overlay entrance transition. */
  transition?: SeqTransitionType;
  /** Transition length in seconds (from clip start). */
  transitionDuration?: number;
  /** Title/subtitle style hints. */
  textStyle?: {
    fontSize?: number;
    color?: string;
    align?: 'left' | 'center' | 'right';
    position?: 'top' | 'center' | 'bottom';
  };
  source: SeqClipSource;
  color?: string;
}

export interface SequenceTrack {
  id: string;
  name: string;
  kind: SeqTrackKind;
  /** Parent track id when this is a sub-track / nested lane. */
  parentId?: string | null;
  locked?: boolean;
  muted?: boolean;
  /** When any track is soloed, non-solo peers of the same kind are silenced. */
  solo?: boolean;
  collapsed?: boolean;
  clips: SequenceClip[];
}

export interface SequenceAudioAsset {
  id: string;
  name: string;
  /** Object URL or data URL for playback. */
  url: string;
  duration: number;
}

/** Editorial marker / chapter cue on the sequence ruler. */
export interface SequenceMarker {
  id: string;
  time: number;
  name: string;
  color?: string;
}

export interface CutsceneSequence {
  id: string;
  name: string;
  duration: number;
  fps: number;
  tracks: SequenceTrack[];
  audioAssets: SequenceAudioAsset[];
  markers?: SequenceMarker[];
}
