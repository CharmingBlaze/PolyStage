import React, { useMemo, useRef, useState } from 'react';
import type {
  CutsceneSequence, SeqTrackKind, SeqTransitionType, SequenceClip, SequenceTrack,
} from '../types/sequence';
import {
  SEQ_CLIP_COLORS,
  SEQ_KIND_LABELS,
  SEQ_TRANSITION_LABELS,
  addSequenceMarker,
  addSequenceTrack,
  collectClipEdgeTimes,
  duplicateClip,
  moveClip,
  moveClipToTrack,
  patchSequenceClip,
  patchSequenceMarker,
  patchSequenceTrack,
  removeClip,
  removeSequenceMarker,
  removeSequenceTrack,
  reorderSequenceTracks,
  rippleDeleteClip,
  setSequenceDuration,
  snapSeqTime,
  snapToEdges,
  splitClip,
  trimClip,
} from '../utils/sequence';
import {
  Bookmark, ChevronDown, ChevronRight, ChevronUp, Copy, Lock, Plus, Scissors, Trash2,
  Unlock, Volume2, VolumeX,
} from 'lucide-react';
import { LengthField } from './LengthField';

interface SequenceTimelineProps {
  sequence: CutsceneSequence;
  currentTime: number;
  pxPerSec: number;
  snapToFrames: boolean;
  selectedClipId: string | null;
  onSelectClip: (id: string | null) => void;
  onChangeSequence: (next: CutsceneSequence) => void;
  onScrub: (time: number) => void;
}

const KIND_OPTIONS: SeqTrackKind[] = ['video', 'camera', 'fx', 'env', 'light', 'overlay', 'audio'];
const TRANSITIONS: SeqTransitionType[] = ['cut', 'fade', 'dissolve', 'dipBlack'];

export const SequenceTimeline: React.FC<SequenceTimelineProps> = ({
  sequence,
  currentTime,
  pxPerSec,
  snapToFrames,
  selectedClipId,
  onSelectClip,
  onChangeSequence,
  onScrub,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const labelScrollRef = useRef<HTMLDivElement>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [showInspector, setShowInspector] = useState(true);

  const fps = sequence.fps || 24;
  const viewDuration = Math.max(sequence.duration, ...sequence.tracks.flatMap((t) => t.clips.map((c) => c.start + c.duration)), 1);
  const width = Math.max(640, Math.ceil(viewDuration * pxPerSec) + 120);
  const markers = sequence.markers || [];

  const snap = (t: number, excludeClipId?: string) => {
    let v = snapSeqTime(t, fps, snapToFrames);
    const threshold = Math.max(0.08, 8 / pxPerSec);
    v = snapToEdges(v, collectClipEdgeTimes(sequence, excludeClipId), threshold);
    return v;
  };

  const visibleTracks = useMemo(() => {
    const collapsedParents = new Set(
      sequence.tracks.filter((t) => !t.parentId && t.collapsed).map((t) => t.id),
    );
    return sequence.tracks.filter((t) => !t.parentId || !collapsedParents.has(t.parentId));
  }, [sequence.tracks]);

  const timeFromClientX = (clientX: number, lane: HTMLElement, excludeClipId?: string) => {
    const rect = lane.getBoundingClientRect();
    return snap((clientX - rect.left + (scrollRef.current?.scrollLeft || 0)) / pxPerSec, excludeClipId);
  };

  const startScrub = (e: React.PointerEvent<HTMLElement>) => {
    e.preventDefault();
    const lane = e.currentTarget;
    onScrub(timeFromClientX(e.clientX, lane));
    const onMove = (ev: PointerEvent) => onScrub(timeFromClientX(ev.clientX, lane));
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const startMoveClip = (e: React.PointerEvent, clip: SequenceClip, track: SequenceTrack) => {
    if (track.locked) return;
    e.preventDefault();
    e.stopPropagation();
    onSelectClip(clip.id);
    setSelectedTrackId(track.id);
    const startX = e.clientX;
    const startY = e.clientY;
    const origin = clip.start;
    const laneEls = Array.from(
      (scrollRef.current?.querySelectorAll('[data-seq-track]') || []) as NodeListOf<HTMLElement>,
    );

    const onMove = (ev: PointerEvent) => {
      const dt = (ev.clientX - startX) / pxPerSec;
      let next = moveClip(sequence, clip.id, snap(origin + dt, clip.id));

      if (Math.abs(ev.clientY - startY) > 10) {
        const hit = laneEls.find((el) => {
          const r = el.getBoundingClientRect();
          return ev.clientY >= r.top && ev.clientY <= r.bottom;
        });
        const targetId = hit?.dataset.seqTrack;
        if (targetId && targetId !== clip.trackId) {
          const target = sequence.tracks.find((t) => t.id === targetId);
          if (target && !target.locked) {
            next = moveClipToTrack(sequence, clip.id, targetId, snap(origin + dt, clip.id));
          }
        }
      }
      onChangeSequence(next);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const startTrim = (e: React.PointerEvent, clip: SequenceClip, edge: 'start' | 'end', track: SequenceTrack) => {
    if (track.locked) return;
    e.preventDefault();
    e.stopPropagation();
    onSelectClip(clip.id);
    const onMove = (ev: PointerEvent) => {
      const parent = (e.currentTarget as HTMLElement).parentElement?.parentElement;
      if (!parent) return;
      const t = timeFromClientX(ev.clientX, parent, clip.id);
      let next = trimClip(sequence, clip.id, edge, t);
      const end = Math.max(
        next.duration,
        ...next.tracks.flatMap((tr) => tr.clips.map((c) => c.start + c.duration)),
      );
      if (end > next.duration) next = setSequenceDuration(next, end);
      onChangeSequence(next);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const startResizeDuration = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const origin = sequence.duration;
    const onMove = (ev: PointerEvent) => {
      const dt = (ev.clientX - startX) / pxPerSec;
      onChangeSequence(setSequenceDuration(sequence, snap(Math.max(0.5, origin + dt))));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const selected = useMemo(() => {
    for (const t of sequence.tracks) {
      const c = t.clips.find((x) => x.id === selectedClipId);
      if (c) return c;
    }
    return null;
  }, [sequence, selectedClipId]);

  const setClipDuration = (clipId: string, duration: number) => {
    const dur = Math.max(0.1, duration);
    onChangeSequence(patchSequenceClip(sequence, clipId, {
      duration: dur,
      outPoint: (sequence.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId)?.inPoint || 0) + dur,
    }));
  };

  const renderTrack = (track: SequenceTrack) => {
    const isSub = Boolean(track.parentId);
    return (
      <div
        key={track.id}
        data-seq-track={track.id}
        className={`h-9 relative border-b border-[#1a1f2a] ${track.muted ? 'bg-[#0a0c10] opacity-60' : 'bg-[#0c1018]'} ${selectedTrackId === track.id ? 'ring-1 ring-inset ring-[#ed7300]/30' : ''}`}
        onClick={() => setSelectedTrackId(track.id)}
      >
        {track.clips.map((clip) => {
          const color = clip.color || SEQ_CLIP_COLORS[clip.source.type] || '#ed7300';
          const selectedCls = selectedClipId === clip.id ? 'ring-1 ring-white z-20' : 'z-10';
          const hasXfade = clip.transition && clip.transition !== 'cut' && (clip.transitionDuration || 0) > 0;
          return (
            <div
              key={clip.id}
              style={{
                left: clip.start * pxPerSec,
                width: Math.max(8, clip.duration * pxPerSec),
                background: color,
              }}
              className={`absolute top-1 bottom-1 rounded-sm text-[8px] font-mono text-white/95 px-1 flex items-center overflow-hidden ${track.locked ? 'cursor-not-allowed' : 'cursor-grab'} ${selectedCls} ${clip.muted ? 'opacity-40' : ''}`}
              onPointerDown={(e) => startMoveClip(e, clip, track)}
              title={`${clip.name} · ${clip.duration.toFixed(2)}s${hasXfade ? ` · ${clip.transition}` : ''}`}
            >
              {hasXfade && (
                <div
                  className="absolute left-0 top-0 bottom-0 bg-black/35 pointer-events-none"
                  style={{ width: Math.min(clip.duration, clip.transitionDuration || 0) * pxPerSec }}
                />
              )}
              <div
                className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize bg-black/30 hover:bg-white/50"
                onPointerDown={(e) => startTrim(e, clip, 'start', track)}
              />
              <span className="truncate pointer-events-none pl-1 relative z-10">{clip.name}</span>
              <div
                className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize bg-black/30 hover:bg-white/50"
                onPointerDown={(e) => startTrim(e, clip, 'end', track)}
              />
            </div>
          );
        })}
        <div
          className="absolute inset-0 cursor-ew-resize"
          onPointerDown={startScrub}
          style={{ zIndex: 0 }}
        />
        {isSub && <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-[#ed7300]/35 pointer-events-none" />}
      </div>
    );
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[#080a0f]">
      <div className="h-8 shrink-0 px-2 border-b border-[#101114] flex items-center gap-1.5 text-[9px] font-mono overflow-x-auto">
        <span className="text-[#6a9fd8] font-bold truncate max-w-[100px]">{sequence.name}</span>

        <LengthField
          value={sequence.duration}
          snapStep={snapToFrames ? 1 / fps : 0.1}
          onChange={(next) => onChangeSequence(setSequenceDuration(sequence, next))}
          title="Sequence length — drag to change · click number to type"
        />
        <span className="text-[#464b53]">{fps}fps</span>

        <div className="relative">
          <button
            type="button"
            className="h-6 px-1.5 rounded border border-[#101114] text-[#b0b0b0] hover:text-white flex items-center gap-1"
            onClick={() => setAddMenuOpen((v) => !v)}
          >
            <Plus className="w-3 h-3" /> Track
          </button>
          {addMenuOpen && (
            <div className="absolute left-0 top-full mt-1 z-50 min-w-[140px] py-1 rounded border border-[#3b3f46] bg-[#202226] shadow-xl">
              {KIND_OPTIONS.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className="w-full text-left px-3 py-1.5 hover:bg-[#3b3f46] text-[10px]"
                  onClick={() => {
                    onChangeSequence(addSequenceTrack(sequence, kind));
                    setAddMenuOpen(false);
                  }}
                >
                  {SEQ_KIND_LABELS[kind]}
                </button>
              ))}
            </div>
          )}
        </div>

        {selectedTrackId && (
          <button
            type="button"
            className="h-6 px-1.5 rounded border border-[#ed7300]/40 text-[#6a9fd8] flex items-center gap-1"
            title="Add sub-track under selected"
            onClick={() => {
              const parent = sequence.tracks.find((t) => t.id === selectedTrackId);
              if (!parent) return;
              const rootId = parent.parentId || parent.id;
              const root = sequence.tracks.find((t) => t.id === rootId);
              if (!root) return;
              onChangeSequence(addSequenceTrack(sequence, root.kind, undefined, rootId));
            }}
          >
            <Plus className="w-3 h-3" /> Sub
          </button>
        )}

        <button
          type="button"
          className="h-6 px-1.5 rounded border border-[#e68619]/50 text-[#e68619] flex items-center gap-1"
          title="Add marker at playhead"
          onClick={() => onChangeSequence(addSequenceMarker(sequence, currentTime))}
        >
          <Bookmark className="w-3 h-3" /> Marker
        </button>

        <button
          type="button"
          className={`h-6 px-1.5 rounded border text-[9px] ${showInspector ? 'border-[#ed7300] bg-[#ed7300]/15 text-white' : 'border-[#101114] text-[#7e838c]'}`}
          onClick={() => setShowInspector((v) => !v)}
        >
          Inspector
        </button>

        {selected && (
          <>
            <div className="w-px h-4 bg-[#202226]" />
            <label className="flex items-center gap-1 text-[#7e838c]" title="Selected clip length">
              Clip
              <input
                type="number"
                min={0.1}
                step={0.1}
                className="w-14 h-5 px-1 rounded bg-[#2e3136] border border-[#101114] text-right text-[10px] outline-none focus:border-[#ed7300]"
                value={Number(selected.duration.toFixed(2))}
                onChange={(e) => setClipDuration(selected.id, Number(e.target.value))}
              />
              s
            </label>
            <button
              type="button"
              className="h-6 px-1.5 rounded border border-[#101114] text-[#b0b0b0] hover:text-white flex items-center gap-1"
              title="Split at playhead"
              onClick={() => onChangeSequence(splitClip(sequence, selected.id, currentTime))}
            >
              <Scissors className="w-3 h-3" /> Split
            </button>
            <button
              type="button"
              className="h-6 px-1.5 rounded border border-[#101114] text-[#b0b0b0] hover:text-white flex items-center gap-1"
              title="Duplicate after clip"
              onClick={() => onChangeSequence(duplicateClip(sequence, selected.id))}
            >
              <Copy className="w-3 h-3" /> Dup
            </button>
            <button
              type="button"
              className="h-6 px-1.5 rounded border border-[#101114] text-[#b0b0b0] hover:text-white flex items-center gap-1"
              onClick={() => onChangeSequence(patchSequenceClip(sequence, selected.id, { muted: !selected.muted }))}
            >
              {selected.muted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />} Mute
            </button>
            <button
              type="button"
              className="h-6 px-1.5 rounded border border-[#ec5b62]/40 text-[#ec5b62] flex items-center gap-1"
              title="Ripple delete (close gap)"
              onClick={() => {
                onChangeSequence(rippleDeleteClip(sequence, selected.id));
                onSelectClip(null);
              }}
            >
              Ripple
            </button>
            <button
              type="button"
              className="h-6 px-1.5 rounded bg-[#ec5b62]/80 text-white flex items-center gap-1"
              onClick={() => {
                onChangeSequence(removeClip(sequence, selected.id));
                onSelectClip(null);
              }}
            >
              <Trash2 className="w-3 h-3" /> Delete
            </button>
          </>
        )}
        <span className="ml-auto text-[#464b53] truncate hidden xl:inline">Markers · transitions · snap to edges · ripple · titles / audio fades</span>
      </div>

      <div className="flex-1 min-h-0 flex">
        <div className="w-40 shrink-0 border-r border-[#101114] bg-[#2e3136] flex flex-col">
          <div className="h-7 border-b border-[#101114] text-[8px] uppercase tracking-wider text-[#51565f] flex items-center justify-between px-2 shrink-0">
            <span>Tracks</span>
            <span className="text-[#383c42] normal-case">{visibleTracks.length}</span>
          </div>
          <div
            ref={labelScrollRef}
            className="flex-1 overflow-y-auto custom-scrollbar"
            onScroll={(e) => {
              if (scrollRef.current) scrollRef.current.scrollTop = e.currentTarget.scrollTop;
            }}
          >
            {visibleTracks.map((t) => {
              const isSub = Boolean(t.parentId);
              const kids = sequence.tracks.filter((c) => c.parentId === t.id);
              const rowSelected = selectedTrackId === t.id;
              return (
                <div
                  key={t.id}
                  className={`h-9 px-1 border-b border-[#101114] flex items-center gap-0.5 group ${rowSelected ? 'bg-[#ed7300]/12' : 'hover:bg-[#101114]'}`}
                  style={{ paddingLeft: isSub ? 10 : 4 }}
                  onClick={() => setSelectedTrackId(t.id)}
                >
                  {!isSub && kids.length > 0 ? (
                    <button
                      type="button"
                      className="w-4 h-4 flex items-center justify-center text-[#51565f]"
                      onClick={(e) => {
                        e.stopPropagation();
                        onChangeSequence(patchSequenceTrack(sequence, t.id, { collapsed: !t.collapsed }));
                      }}
                    >
                      {t.collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </button>
                  ) : (
                    <span className="w-4" />
                  )}

                  {editingNameId === t.id ? (
                    <input
                      autoFocus
                      className="flex-1 min-w-0 h-5 px-1 rounded bg-[#0a0a0a] border border-[#ed7300] text-[10px] outline-none"
                      defaultValue={t.name}
                      onBlur={(e) => {
                        onChangeSequence(patchSequenceTrack(sequence, t.id, { name: e.target.value || t.name }));
                        setEditingNameId(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        if (e.key === 'Escape') setEditingNameId(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <button
                      type="button"
                      className={`flex-1 min-w-0 text-left truncate text-[10px] ${t.muted ? 'text-[#51565f] line-through' : 'text-[#c0c0c0]'}`}
                      title="Double-click to rename"
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setEditingNameId(t.id);
                      }}
                    >
                      {t.name}
                    </button>
                  )}

                  <div className="flex items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                    <button
                      type="button"
                      className={`px-0.5 text-[8px] font-bold ${t.solo ? 'text-[#e68619]' : 'text-[#464b53] hover:text-[#e68619]'}`}
                      title="Solo"
                      onClick={(e) => {
                        e.stopPropagation();
                        onChangeSequence(patchSequenceTrack(sequence, t.id, { solo: !t.solo }));
                      }}
                    >
                      S
                    </button>
                    <button
                      type="button"
                      className="p-0.5 text-[#464b53] hover:text-white"
                      title="Move up"
                      onClick={(e) => {
                        e.stopPropagation();
                        onChangeSequence(reorderSequenceTracks(sequence, t.id, 'up'));
                      }}
                    >
                      <ChevronUp className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      className="p-0.5 text-[#464b53] hover:text-white"
                      title="Move down"
                      onClick={(e) => {
                        e.stopPropagation();
                        onChangeSequence(reorderSequenceTracks(sequence, t.id, 'down'));
                      }}
                    >
                      <ChevronDown className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      className={`p-0.5 ${t.muted ? 'text-[#ec5b62]' : 'text-[#464b53] hover:text-white'}`}
                      title="Mute track"
                      onClick={(e) => {
                        e.stopPropagation();
                        onChangeSequence(patchSequenceTrack(sequence, t.id, { muted: !t.muted }));
                      }}
                    >
                      {t.muted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
                    </button>
                    <button
                      type="button"
                      className={`p-0.5 ${t.locked ? 'text-[#e68619]' : 'text-[#464b53] hover:text-white'}`}
                      title="Lock track"
                      onClick={(e) => {
                        e.stopPropagation();
                        onChangeSequence(patchSequenceTrack(sequence, t.id, { locked: !t.locked }));
                      }}
                    >
                      {t.locked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                    </button>
                    <button
                      type="button"
                      className="p-0.5 text-[#464b53] hover:text-[#ec5b62]"
                      title="Delete track"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (sequence.tracks.filter((x) => !x.parentId).length <= 1 && !t.parentId) return;
                        onChangeSequence(removeSequenceTrack(sequence, t.id));
                        if (selectedTrackId === t.id) setSelectedTrackId(null);
                      }}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div
          ref={scrollRef}
          className="flex-1 min-w-0 overflow-auto custom-scrollbar"
          onScroll={(e) => {
            if (labelScrollRef.current) labelScrollRef.current.scrollTop = e.currentTarget.scrollTop;
          }}
        >
          <div style={{ width }} className="min-h-full relative">
            <div
              className="h-7 sticky top-0 z-20 bg-[#212327] border-b border-[#101114] relative cursor-ew-resize"
              onPointerDown={startScrub}
            >
              {Array.from({ length: Math.floor(viewDuration) + 1 }).map((_, i) => (
                <div key={i} style={{ left: i * pxPerSec }} className="absolute top-0 bottom-0 flex flex-col items-center pointer-events-none">
                  <div className={`w-px h-3 ${i === Math.round(sequence.duration) ? 'bg-[#e68619]' : 'bg-[#ed7300]'}`} />
                  <span className="text-[8px] text-[#6a9fd8]">{i}s</span>
                </div>
              ))}

              {markers.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  style={{ left: m.time * pxPerSec, borderColor: m.color || '#e68619' }}
                  className="absolute top-0 bottom-0 w-0 z-30 -translate-x-1/2 border-l border-dashed"
                  title={`${m.name} @ ${m.time.toFixed(2)}s — click jump · dbl-click rename · Alt+click delete`}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    if (e.altKey) {
                      onChangeSequence(removeSequenceMarker(sequence, m.id));
                      return;
                    }
                    onScrub(m.time);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    const name = window.prompt('Marker name', m.name);
                    if (name != null) onChangeSequence(patchSequenceMarker(sequence, m.id, { name }));
                  }}
                >
                  <span
                    className="absolute top-0 left-1/2 -translate-x-1/2 text-[7px] px-0.5 rounded whitespace-nowrap"
                    style={{ background: m.color || '#e68619', color: '#111' }}
                  >
                    {m.name}
                  </span>
                </button>
              ))}

              <div
                style={{ left: sequence.duration * pxPerSec }}
                className="absolute top-0 bottom-0 w-1 bg-[#e68619] z-40 cursor-ew-resize"
                title="Drag to change sequence length"
                onPointerDown={startResizeDuration}
              >
                <div className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-3 h-3 rounded-sm bg-[#e68619] rotate-45" />
              </div>

              <div
                style={{ left: currentTime * pxPerSec }}
                className="absolute top-0 bottom-0 w-0.5 bg-[#ec5b62] z-30 pointer-events-none"
              >
                <div className="w-2.5 h-2.5 bg-[#ec5b62] -translate-x-1/2 rotate-45 -top-0.5 absolute rounded-sm" />
              </div>
            </div>

            <div className="relative">
              <div
                style={{ left: currentTime * pxPerSec }}
                className="absolute top-0 bottom-0 w-px bg-[#ec5b62]/60 z-30 pointer-events-none"
              />
              <div
                style={{ left: sequence.duration * pxPerSec }}
                className="absolute top-0 bottom-0 w-px bg-[#e68619]/40 z-20 pointer-events-none"
              />
              {visibleTracks.map(renderTrack)}
            </div>
          </div>
        </div>

        {showInspector && (
          <div className="w-52 shrink-0 border-l border-[#101114] bg-[#0e1218] flex flex-col text-[9px] font-mono overflow-y-auto custom-scrollbar">
            <div className="h-7 px-2 border-b border-[#101114] flex items-center text-[8px] uppercase tracking-wider text-[#51565f]">
              Clip inspector
            </div>
            {!selected ? (
              <div className="p-2 text-[#464b53] leading-relaxed">
                Select a clip for transition, fades, volume, and title text. Add markers for shots / chapters.
              </div>
            ) : (
              <div className="p-2 space-y-2">
                <label className="block space-y-0.5">
                  <span className="text-[#51565f]">Name</span>
                  <input
                    className="w-full h-6 px-1 rounded bg-[#2e3136] border border-[#101114] text-[#ddd] outline-none focus:border-[#ed7300]"
                    value={selected.name}
                    onChange={(e) => onChangeSequence(patchSequenceClip(sequence, selected.id, { name: e.target.value }))}
                  />
                </label>
                <div className="text-[#464b53]">{selected.source.type}</div>

                {(selected.source.type === 'title' || selected.source.type === 'subtitle') && (
                  <label className="block space-y-0.5">
                    <span className="text-[#51565f]">Text</span>
                    <textarea
                      className="w-full h-16 px-1 py-0.5 rounded bg-[#2e3136] border border-[#101114] text-[#ddd] outline-none focus:border-[#ed7300] resize-none"
                      value={selected.source.refId}
                      onChange={(e) => onChangeSequence(patchSequenceClip(sequence, selected.id, {
                        source: { ...selected.source, refId: e.target.value },
                        name: e.target.value.slice(0, 24) || selected.name,
                      }))}
                    />
                  </label>
                )}

                {selected.source.type === 'cameraShot' && (
                  <>
                    <label className="block space-y-0.5">
                      <span className="text-[#51565f]">Transition</span>
                      <select
                        className="w-full h-6 px-1 rounded bg-[#2e3136] border border-[#101114] text-[#ddd]"
                        value={selected.transition || 'cut'}
                        onChange={(e) => onChangeSequence(patchSequenceClip(sequence, selected.id, {
                          transition: e.target.value as SeqTransitionType,
                          transitionDuration: selected.transitionDuration ?? 0.5,
                        }))}
                      >
                        {TRANSITIONS.map((tr) => (
                          <option key={tr} value={tr}>{SEQ_TRANSITION_LABELS[tr]}</option>
                        ))}
                      </select>
                    </label>
                    {(selected.transition || 'cut') !== 'cut' && (
                      <label className="block space-y-0.5">
                        <span className="text-[#51565f]">Transition length (s)</span>
                        <input
                          type="number"
                          min={0.05}
                          step={0.05}
                          className="w-full h-6 px-1 rounded bg-[#2e3136] border border-[#101114] text-right text-[#ddd]"
                          value={Number((selected.transitionDuration ?? 0.5).toFixed(2))}
                          onChange={(e) => onChangeSequence(patchSequenceClip(sequence, selected.id, {
                            transitionDuration: Math.max(0.05, Number(e.target.value) || 0.5),
                          }))}
                        />
                      </label>
                    )}
                  </>
                )}

                {(selected.source.type === 'audio' || selected.source.type === 'title' || selected.source.type === 'subtitle') && (
                  <>
                    <label className="block space-y-0.5">
                      <span className="text-[#51565f]">Volume / opacity</span>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        className="w-full"
                        value={selected.volume ?? 1}
                        onChange={(e) => onChangeSequence(patchSequenceClip(sequence, selected.id, {
                          volume: Number(e.target.value),
                        }))}
                      />
                    </label>
                    <div className="grid grid-cols-2 gap-1">
                      <label className="space-y-0.5">
                        <span className="text-[#51565f]">Fade in</span>
                        <input
                          type="number"
                          min={0}
                          step={0.05}
                          className="w-full h-6 px-1 rounded bg-[#2e3136] border border-[#101114] text-right text-[#ddd]"
                          value={Number((selected.fadeIn ?? 0).toFixed(2))}
                          onChange={(e) => onChangeSequence(patchSequenceClip(sequence, selected.id, {
                            fadeIn: Math.max(0, Number(e.target.value) || 0),
                          }))}
                        />
                      </label>
                      <label className="space-y-0.5">
                        <span className="text-[#51565f]">Fade out</span>
                        <input
                          type="number"
                          min={0}
                          step={0.05}
                          className="w-full h-6 px-1 rounded bg-[#2e3136] border border-[#101114] text-right text-[#ddd]"
                          value={Number((selected.fadeOut ?? 0).toFixed(2))}
                          onChange={(e) => onChangeSequence(patchSequenceClip(sequence, selected.id, {
                            fadeOut: Math.max(0, Number(e.target.value) || 0),
                          }))}
                        />
                      </label>
                    </div>
                  </>
                )}

                <div className="pt-1 text-[#464b53] leading-relaxed">
                  {selected.start.toFixed(2)}s → {(selected.start + selected.duration).toFixed(2)}s
                </div>
              </div>
            )}

            {markers.length > 0 && (
              <div className="border-t border-[#101114] mt-auto">
                <div className="h-7 px-2 border-b border-[#101114] flex items-center text-[8px] uppercase tracking-wider text-[#51565f]">
                  Markers · {markers.length}
                </div>
                <div className="max-h-32 overflow-y-auto">
                  {markers.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className="w-full flex items-center gap-1 px-2 py-1 text-left hover:bg-[#101114] text-[#c0c0c0]"
                      onClick={() => onScrub(m.time)}
                    >
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: m.color || '#e68619' }} />
                      <span className="truncate flex-1">{m.name}</span>
                      <span className="text-[#464b53]">{m.time.toFixed(1)}s</span>
                      <span
                        className="text-[#ec5b62] px-0.5"
                        onClick={(e) => {
                          e.stopPropagation();
                          onChangeSequence(removeSequenceMarker(sequence, m.id));
                        }}
                      >
                        ×
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
