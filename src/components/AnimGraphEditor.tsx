import React, { useMemo, useRef, useState } from 'react';
import type { AnimKeyframe, AnimTrack, AnimationClip, Vector3D } from '../types/cad';
import { sampleChannel } from '../utils/animation';

type ChannelKind = 'pos' | 'rot' | 'scl';
type Axis = 'x' | 'y' | 'z';

type GraphChannel = {
  kind: ChannelKind;
  axis: Axis;
  label: string;
  color: string;
  keys: AnimKeyframe[];
};

const AXIS_COLORS: Record<Axis, string> = {
  x: '#ec5b62',
  y: '#2d9d78',
  z: '#ed7300',
};

const CHANNEL_KEYS: Record<ChannelKind, 'posKeyframes' | 'rotKeyframes' | 'sclKeyframes'> = {
  pos: 'posKeyframes',
  rot: 'rotKeyframes',
  scl: 'sclKeyframes',
};

interface AnimGraphEditorProps {
  clip: AnimationClip;
  track: AnimTrack | null;
  currentTime: number;
  pxPerSec: number;
  snapToFrames: boolean;
  selectedKeyframeId: string | null;
  onSelectKeyframe: (id: string | null) => void;
  onScrub: (time: number, pause?: boolean) => void;
  onPatchKeyframe: (
    channel: ChannelKind,
    keyframeId: string,
    patch: { time?: number; value?: Vector3D },
  ) => void;
  onInsertKeyframe: (channel: ChannelKind, time: number, value: Vector3D) => void;
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

export const AnimGraphEditor: React.FC<AnimGraphEditorProps> = ({
  clip,
  track,
  currentTime,
  pxPerSec,
  snapToFrames,
  selectedKeyframeId,
  onSelectKeyframe,
  onScrub,
  onPatchKeyframe,
  onInsertKeyframe,
}) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({
    'pos.x': true,
    'pos.y': true,
    'pos.z': true,
    'rot.x': false,
    'rot.y': false,
    'rot.z': false,
    'scl.x': false,
    'scl.y': false,
    'scl.z': false,
  });
  const [valuePan, setValuePan] = useState(0);
  const [valueZoom, setValueZoom] = useState(1);
  const dragRef = useRef<{
    channel: ChannelKind;
    axis: Axis;
    keyframeId: string;
    startValue: Vector3D;
  } | null>(null);
  const pendingPatchRef = useRef<{
    channel: ChannelKind;
    keyframeId: string;
    patch: { time?: number; value?: Vector3D };
  } | null>(null);
  const patchRafRef = useRef(0);

  const duration = clip.duration;
  const fps = clip.fps || 24;
  const width = Math.max(480, Math.ceil(duration * pxPerSec) + 48);
  const height = 200;
  const padL = 44;
  const padR = 12;
  const padT = 12;
  const padB = 20;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const channels: GraphChannel[] = useMemo(() => {
    if (!track) return [];
    const list: GraphChannel[] = [];
    (['pos', 'rot', 'scl'] as ChannelKind[]).forEach((kind) => {
      (['x', 'y', 'z'] as Axis[]).forEach((axis) => {
        const id = `${kind}.${axis}`;
        if (!enabled[id]) return;
        list.push({
          kind,
          axis,
          label: `${kind === 'pos' ? 'P' : kind === 'rot' ? 'R' : 'S'}${axis.toUpperCase()}`,
          color: AXIS_COLORS[axis],
          keys: [...track[CHANNEL_KEYS[kind]]].sort((a, b) => a.time - b.time),
        });
      });
    });
    return list;
  }, [track, enabled]);

  const valueRange = useMemo(() => {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    channels.forEach((ch) => {
      ch.keys.forEach((k) => {
        const v = k.value[ch.axis];
        if (Number.isFinite(v)) {
          min = Math.min(min, v);
          max = Math.max(max, v);
        }
      });
    });
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      min = -1;
      max = 1;
    }
    if (Math.abs(max - min) < 1e-4) {
      min -= 1;
      max += 1;
    }
    const pad = (max - min) * 0.15;
    const mid = (min + max) / 2;
    const span = ((max - min) / 2 + pad) / Math.max(0.15, valueZoom);
    return { min: mid - span + valuePan, max: mid + span + valuePan };
  }, [channels, valuePan, valueZoom]);

  const snapT = (t: number) => {
    const clamped = clamp(t, 0, duration);
    if (!snapToFrames) return Math.round(clamped * 1000) / 1000;
    return clamp(Math.round(clamped * fps) / fps, 0, duration);
  };

  const timeToX = (t: number) => padL + (t / Math.max(1e-6, duration)) * plotW;
  const valueToY = (v: number) => {
    const { min, max } = valueRange;
    const u = (v - min) / Math.max(1e-6, max - min);
    return padT + (1 - u) * plotH;
  };
  const xToTime = (x: number) => snapT(((x - padL) / Math.max(1e-6, plotW)) * duration);
  const yToValue = (y: number) => {
    const { min, max } = valueRange;
    const u = 1 - (y - padT) / Math.max(1e-6, plotH);
    return min + u * (max - min);
  };

  const flushPatch = () => {
    patchRafRef.current = 0;
    const pending = pendingPatchRef.current;
    if (!pending) return;
    pendingPatchRef.current = null;
    onPatchKeyframe(pending.channel, pending.keyframeId, pending.patch);
  };

  const queuePatch = (
    channel: ChannelKind,
    keyframeId: string,
    patch: { time?: number; value?: Vector3D },
  ) => {
    pendingPatchRef.current = { channel, keyframeId, patch };
    if (patch.time != null) onScrub(patch.time, true);
    if (!patchRafRef.current) {
      patchRafRef.current = requestAnimationFrame(flushPatch);
    }
  };

  const curvePath = (ch: GraphChannel) => {
    if (ch.keys.length === 0) return '';
    const samples: string[] = [];
    const steps = Math.max(24, Math.ceil(duration * fps));
    for (let i = 0; i <= steps; i += 1) {
      const t = (i / steps) * duration;
      const sampled = sampleChannel(ch.keys, t, clip.interpolation || 'smooth');
      if (!sampled) continue;
      const x = timeToX(t);
      const y = valueToY(sampled[ch.axis]);
      samples.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`);
    }
    return samples.join(' ');
  };

  const startPointDrag = (
    e: React.PointerEvent,
    ch: GraphChannel,
    kf: AnimKeyframe,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    onSelectKeyframe(kf.id);
    onScrub(kf.time, true);
    dragRef.current = {
      channel: ch.kind,
      axis: ch.axis,
      keyframeId: kf.id,
      startValue: { ...kf.value },
    };
    const svg = svgRef.current;
    if (!svg) return;
    svg.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || !svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const sx = (width / Math.max(1, rect.width));
      const sy = (height / Math.max(1, rect.height));
      const x = (ev.clientX - rect.left) * sx;
      const y = (ev.clientY - rect.top) * sy;
      const time = xToTime(x);
      const axisVal = yToValue(y);
      const value = {
        ...drag.startValue,
        // keep other axes from latest key if possible
        [drag.axis]: Math.round(axisVal * 1000) / 1000,
      };
      // Prefer live track values for untouched axes
      const live = track?.[CHANNEL_KEYS[drag.channel]].find((k) => k.id === drag.keyframeId);
      if (live) {
        value.x = drag.axis === 'x' ? value.x : live.value.x;
        value.y = drag.axis === 'y' ? value.y : live.value.y;
        value.z = drag.axis === 'z' ? value.z : live.value.z;
        value[drag.axis] = Math.round(axisVal * 1000) / 1000;
      }
      queuePatch(drag.channel, drag.keyframeId, { time, value });
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      dragRef.current = null;
      if (patchRafRef.current) {
        cancelAnimationFrame(patchRafRef.current);
        flushPatch();
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const onBackgroundPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    // RMB / MMB pan the graph
    if (e.button === 1 || e.button === 2) {
      e.preventDefault();
      const startY = e.clientY;
      const startPan = valuePan;
      const onMove = (ev: PointerEvent) => {
        const dy = (ev.clientY - startY) / plotH;
        const span = valueRange.max - valueRange.min;
        setValuePan(startPan + dy * span);
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      return;
    }
    if (e.button !== 0) return;
    if ((e.target as Element).closest('[data-graph-point]')) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const sx = width / Math.max(1, rect.width);
    const x = (e.clientX - rect.left) * sx;
    const t = xToTime(x);
    onScrub(t, true);

    // Shift+drag still pans (legacy)
    if (e.shiftKey) {
      const startY = e.clientY;
      const startPan = valuePan;
      const onMove = (ev: PointerEvent) => {
        const dy = (ev.clientY - startY) / plotH;
        const span = valueRange.max - valueRange.min;
        setValuePan(startPan + dy * span);
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      return;
    }

    // Drag scrub on empty graph
    const onMove = (ev: PointerEvent) => {
      const r = svg.getBoundingClientRect();
      const xx = (ev.clientX - r.left) * (width / Math.max(1, r.width));
      onScrub(xToTime(xx), true);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const onDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!track) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const sx = width / Math.max(1, rect.width);
    const sy = height / Math.max(1, rect.height);
    const x = (e.clientX - rect.left) * sx;
    const y = (e.clientY - rect.top) * sy;
    const t = xToTime(x);
    const v = yToValue(y);
    // Insert into first enabled channel, default pos.y
    const ch = channels[0] || null;
    if (!ch) return;
    const existing = sampleChannel(ch.keys, t, clip.interpolation || 'smooth') || { x: 0, y: 0, z: 0 };
    const value = { ...existing, [ch.axis]: Math.round(v * 1000) / 1000 };
    onInsertKeyframe(ch.kind, t, value);
    onScrub(t, true);
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setValueZoom((z) => clamp(z * (e.deltaY > 0 ? 0.9 : 1.1), 0.25, 8));
  };

  const gridYs = useMemo(() => {
    const lines: number[] = [];
    const span = valueRange.max - valueRange.min;
    const step = span > 20 ? 5 : span > 8 ? 2 : span > 3 ? 1 : span > 1 ? 0.5 : 0.25;
    const start = Math.ceil(valueRange.min / step) * step;
    for (let v = start; v <= valueRange.max + 1e-6; v += step) lines.push(v);
    return lines;
  }, [valueRange]);

  const toggle = (id: string) => setEnabled((prev) => ({ ...prev, [id]: !prev[id] }));

  return (
    <div ref={wrapRef} className="flex-1 min-h-0 flex flex-col bg-[#080a0f]" onWheel={onWheel}>
      <div className="h-8 shrink-0 px-2 border-b border-[#101114] flex items-center gap-1.5 overflow-x-auto custom-scrollbar">
        <span className="text-[9px] font-mono text-[#6a9fd8] shrink-0 truncate max-w-[120px]">
          {track ? track.targetName : 'Select a track'}
        </span>
        <div className="w-px h-4 bg-[#202226] shrink-0" />
        {([
          ['pos', 'Pos'],
          ['rot', 'Rot'],
          ['scl', 'Scl'],
        ] as const).map(([kind, label]) => (
          <div key={kind} className="flex items-center gap-0.5 shrink-0">
            <span className="text-[8px] text-[#51565f] uppercase mr-0.5">{label}</span>
            {(['x', 'y', 'z'] as Axis[]).map((axis) => {
              const id = `${kind}.${axis}`;
              const on = enabled[id];
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggle(id)}
                  className="h-5 min-w-[22px] px-1 rounded text-[9px] font-bold border"
                  style={{
                    color: on ? AXIS_COLORS[axis] : '#464b53',
                    borderColor: on ? AXIS_COLORS[axis] : '#202226',
                    background: on ? `${AXIS_COLORS[axis]}22` : 'transparent',
                  }}
                  title={`${label} ${axis.toUpperCase()}`}
                >
                  {axis.toUpperCase()}
                </button>
              );
            })}
          </div>
        ))}
        <div className="ml-auto flex items-center gap-1 shrink-0 text-[8px] font-mono text-[#464b53]">
          <button type="button" className="h-5 px-1.5 rounded border border-[#101114] hover:text-white" onClick={() => setValueZoom((z) => clamp(z * 1.2, 0.25, 8))}>+</button>
          <button type="button" className="h-5 px-1.5 rounded border border-[#101114] hover:text-white" onClick={() => setValueZoom((z) => clamp(z / 1.2, 0.25, 8))}>-</button>
          <button type="button" className="h-5 px-1.5 rounded border border-[#101114] hover:text-white" onClick={() => { setValueZoom(1); setValuePan(0); }}>Fit</button>
          <span>Drag points · RMB/MMB pan · Wheel zoom</span>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto custom-scrollbar">
        <div style={{ width }} className="relative min-h-full">
          <svg
            ref={svgRef}
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            className="block cursor-crosshair"
            onPointerDown={onBackgroundPointerDown}
            onDoubleClick={onDoubleClick}
            onContextMenu={(e) => e.preventDefault()}
          >
            <rect x={0} y={0} width={width} height={height} fill="#080a0f" />
            <rect x={padL} y={padT} width={plotW} height={plotH} fill="#0c1018" stroke="#1a2030" />

            {gridYs.map((v) => {
              const y = valueToY(v);
              return (
                <g key={`g-${v}`}>
                  <line x1={padL} y1={y} x2={padL + plotW} y2={y} stroke="#151a24" strokeWidth={1} />
                  <text x={padL - 4} y={y + 3} textAnchor="end" fill="#464b53" fontSize="8" fontFamily="ui-monospace, monospace">
                    {Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(2)}
                  </text>
                </g>
              );
            })}

            {/* Time grid */}
            {Array.from({ length: Math.floor(duration) + 1 }).map((_, i) => {
              const x = timeToX(i);
              return <line key={`t-${i}`} x1={x} y1={padT} x2={x} y2={padT + plotH} stroke="#151a24" strokeWidth={1} />;
            })}

            {/* Zero line */}
            {valueRange.min < 0 && valueRange.max > 0 && (
              <line
                x1={padL}
                y1={valueToY(0)}
                x2={padL + plotW}
                y2={valueToY(0)}
                stroke="#2a3140"
                strokeDasharray="4 3"
              />
            )}

            {/* Curves */}
            {channels.map((ch) => (
              <path
                key={`curve-${ch.kind}-${ch.axis}`}
                d={curvePath(ch)}
                fill="none"
                stroke={ch.color}
                strokeWidth={1.75}
                opacity={0.9}
                pointerEvents="none"
              />
            ))}

            {/* Playhead */}
            <line
              x1={timeToX(currentTime)}
              y1={padT}
              x2={timeToX(currentTime)}
              y2={padT + plotH}
              stroke="#ec5b62"
              strokeWidth={1.5}
              pointerEvents="none"
            />

            {/* Points */}
            {channels.map((ch) =>
              ch.keys.map((kf) => {
                const cx = timeToX(kf.time);
                const cy = valueToY(kf.value[ch.axis]);
                const selected = selectedKeyframeId === kf.id;
                return (
                  <g
                    key={`${ch.kind}-${ch.axis}-${kf.id}`}
                    data-graph-point
                    transform={`translate(${cx} ${cy})`}
                    onPointerDown={(e) => startPointDrag(e, ch, kf)}
                    style={{ cursor: 'grab' }}
                  >
                    <circle
                      r={selected ? 6 : 4.5}
                      fill={ch.color}
                      stroke={selected ? '#fff' : '#0e1016'}
                      strokeWidth={selected ? 2 : 1.25}
                    />
                    {selected && (
                      <title>{`${ch.label}  t=${kf.time.toFixed(3)}  v=${kf.value[ch.axis].toFixed(3)}`}</title>
                    )}
                  </g>
                );
              }),
            )}
          </svg>

          {!track && (
            <div className="absolute inset-0 flex items-center justify-center text-[10px] font-mono text-[#464b53] pointer-events-none">
              Select a timeline track to edit curves
            </div>
          )}
          {track && channels.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-[10px] font-mono text-[#464b53] pointer-events-none">
              Enable Pos/Rot/Scl channels above
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
