import React, { useEffect, useRef, useState } from 'react';
import {
  GripHorizontal, Minus, Maximize2, X, Move, RotateCw, Maximize,
  Camera, Bone, Box, Sparkles, Key, Settings2,
} from 'lucide-react';
import type { Vector3D } from '../types/cad';
import { SmoothSlider } from './SmoothSlider';

export type AnimEditKind = 'mesh' | 'bone' | 'camera' | 'particle' | 'light';
export type AnimGizmoMode = 'translate' | 'rotate' | 'scale';

export type AnimEditTarget = {
  kind: AnimEditKind;
  id: string;
  name: string;
  position: Vector3D;
  rotation: Vector3D;
  scale: Vector3D;
  /** Camera FOV */
  fov?: number;
  /** Particle rate preview */
  rate?: number;
  enabled?: boolean;
};

interface AnimEditPopupProps {
  isOpen: boolean;
  onClose: () => void;
  target: AnimEditTarget | null;
  targets: AnimEditTarget[];
  onSelectTarget: (kind: AnimEditKind, id: string) => void;
  gizmoMode: AnimGizmoMode;
  onGizmoMode: (mode: AnimGizmoMode) => void;
  onChangeTransform: (partial: { position?: Vector3D; rotation?: Vector3D; scale?: Vector3D; fov?: number }) => void;
  onKeyNow: () => void;
  onOpenParticleStudio?: () => void;
}

const deg = (r: number) => Math.round((r * 180) / Math.PI * 10) / 10;
const rad = (d: number) => (d * Math.PI) / 180;

export const AnimEditPopup: React.FC<AnimEditPopupProps> = ({
  isOpen,
  onClose,
  target,
  targets,
  onSelectTarget,
  gizmoMode,
  onGizmoMode,
  onChangeTransform,
  onKeyNow,
  onOpenParticleStudio,
}) => {
  const [position, setPosition] = useState({ x: 72, y: 120 });
  const [minimized, setMinimized] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      setPosition({
        x: Math.max(8, Math.min(window.innerWidth - 240, e.clientX - dragStart.current.x)),
        y: Math.max(8, Math.min(window.innerHeight - 64, e.clientY - dragStart.current.y)),
      });
    };
    const onUp = () => setDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging]);

  if (!isOpen) return null;

  const kindIcon = (kind: AnimEditKind) => {
    if (kind === 'camera') return <Camera className="w-3 h-3 text-[#ed7300]" />;
    if (kind === 'bone') return <Bone className="w-3 h-3 text-[#ed7300]" />;
    if (kind === 'particle') return <Sparkles className="w-3 h-3 text-[#e68619]" />;
    if (kind === 'light') return <Maximize className="w-3 h-3 text-[#f1c40f]" />;
    return <Box className="w-3 h-3 text-[#e68619]" />;
  };

  const patchAxis = (
    field: 'position' | 'rotation' | 'scale',
    axis: keyof Vector3D,
    value: number,
  ) => {
    if (!target) return;
    const next = { ...target[field], [axis]: field === 'rotation' ? rad(value) : value };
    onChangeTransform({ [field]: next });
  };

  return (
    <div
      className="absolute z-40 shadow-2xl rounded-lg border border-[#3b3f46] bg-[#101114]/95 backdrop-blur-md font-mono text-[10px] text-[#c6cad1] select-none"
      style={{ left: position.x, top: position.y, width: minimized ? 220 : 268 }}
    >
      <div
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          setDragging(true);
          dragStart.current = { x: e.clientX - position.x, y: e.clientY - position.y };
        }}
        className="h-8 px-2 flex items-center justify-between border-b border-[#26282d] bg-[#242424] cursor-grab active:cursor-grabbing rounded-t-lg"
      >
        <div className="flex items-center gap-1.5 font-bold text-[#ed7300]">
          <GripHorizontal className="w-3.5 h-3.5 text-[#6f6f6f]" />
          <Settings2 className="w-3 h-3" />
          <span>ANIM EDIT</span>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            className="p-1 hover:bg-[#3b3f46] rounded text-[#a6abb4] hover:text-white"
            title={minimized ? 'Expand' : 'Collapse'}
            onClick={() => setMinimized((v) => !v)}
          >
            {minimized ? <Maximize2 className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
          </button>
          <button
            type="button"
            className="p-1 hover:bg-rose-900/40 hover:text-rose-400 rounded text-[#a6abb4]"
            title="Close"
            onClick={onClose}
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {!minimized && (
        <div className="p-2 space-y-2 max-h-[420px] overflow-y-auto custom-scrollbar">
          <label className="block text-[#858a93] uppercase text-[8px] tracking-wide">
            Target
            <select
              className="cad-input mt-1 h-7 w-full px-1"
              value={target ? `${target.kind}:${target.id}` : ''}
              onChange={(e) => {
                const [kind, id] = e.target.value.split(':');
                if (kind && id) onSelectTarget(kind as AnimEditKind, id);
              }}
            >
              <option value="">— Select —</option>
              {targets.map((t) => (
                <option key={`${t.kind}:${t.id}`} value={`${t.kind}:${t.id}`}>
                  {t.kind.toUpperCase()} · {t.name}
                </option>
              ))}
            </select>
          </label>

          {target && (
            <>
              <div className="flex items-center gap-1.5 text-white font-bold">
                {kindIcon(target.kind)}
                <span className="truncate">{target.name}</span>
              </div>

              <div className="grid grid-cols-3 gap-1">
                {([
                  { id: 'translate' as const, label: 'Move', icon: <Move className="w-3 h-3" /> },
                  { id: 'rotate' as const, label: 'Rotate', icon: <RotateCw className="w-3 h-3" /> },
                  { id: 'scale' as const, label: 'Scale', icon: <Maximize className="w-3 h-3" /> },
                ]).map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    className={`h-7 rounded border flex items-center justify-center gap-1 ${
                      gizmoMode === mode.id
                        ? 'border-[#ed7300] bg-[#ed7300]/20 text-[#ed7300]'
                        : 'border-[#3b3f46] text-[#858a93] hover:text-white'
                    }`}
                    onClick={() => onGizmoMode(mode.id)}
                  >
                    {mode.icon}
                    {mode.label}
                  </button>
                ))}
              </div>

              {(['position', 'rotation', 'scale'] as const).map((field) => (
                <div key={field}>
                  <div className="text-[#858a93] uppercase text-[8px] mb-1">
                    {field}{field === 'rotation' ? ' (°)' : ''}
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    {(['x', 'y', 'z'] as const).map((axis) => (
                      <label key={axis} className="cad-input h-7 flex items-center px-1 gap-1">
                        <span className="uppercase text-[#6f6f6f]">{axis}</span>
                        <input
                          type="number"
                          step={field === 'rotation' ? 1 : 0.05}
                          className="w-full min-w-0 bg-transparent outline-none text-right"
                          value={field === 'rotation' ? deg(target[field][axis]) : Number(target[field][axis].toFixed(3))}
                          onChange={(e) => patchAxis(field, axis, Number(e.target.value))}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ))}

              {target.kind === 'camera' && typeof target.fov === 'number' && (
                <label className="block text-[#858a93]">
                  FOV
                  <SmoothSlider
                    min={20}
                    max={90}
                    step={1}
                    value={target.fov}
                    className="w-full mt-1"
                    onChange={(fov) => onChangeTransform({ fov })}
                    formatValue={(v) => `${Math.round(v)}°`}
                  />
                </label>
              )}

              {target.kind === 'particle' && (
                <div className="space-y-1">
                  <div className="text-[#858a93]">Rate {target.rate ?? 0}/s · {target.enabled === false ? 'OFF' : 'ON'}</div>
                  <button
                    type="button"
                    className="w-full h-7 cad-button text-[#e68619] font-bold"
                    onClick={() => onOpenParticleStudio?.()}
                  >
                    Open Particle Studio
                  </button>
                </div>
              )}

              {target.kind !== 'particle' && (
                <button
                  type="button"
                  className={`w-full h-8 rounded text-white font-bold flex items-center justify-center gap-1 ${
                    target.kind === 'light' ? 'bg-[#f1c40f] text-black' : 'bg-[#ed7300]'
                  }`}
                  onClick={onKeyNow}
                >
                  <Key className="w-3.5 h-3.5" /> {target.kind === 'light' ? 'Key Light Now' : 'Key Transform Now'}
                </button>
              )}
            </>
          )}

          {!target && (
            <div className="text-[#6e6e6e] leading-relaxed py-2">
              Pick a mesh, bone, camera, light, or particle in the viewport (Orbit mode) or from the list above.
            </div>
          )}
        </div>
      )}
    </div>
  );
};
