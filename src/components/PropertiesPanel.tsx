import React from 'react';
import {
  Box,
  Palette,
  Sliders,
  Sparkles,
} from 'lucide-react';
import type {
  CADMesh,
  CADCamera,
  CADLight,
  ParticleEmitter,
  EnvironmentSettings,
  SceneSelection,
  ToolState,
  Vector3D,
} from '../types/cad';
import { createDefaultEnvironment } from '../utils/cutsceneEnv';
import { lightDistanceFromScale } from '../utils/sceneHelpers';

interface PropertiesPanelProps {
  mesh: CADMesh;
  setMesh: (updater: CADMesh | ((prev: CADMesh) => CADMesh)) => void;
  toolState: ToolState;
  setToolState: React.Dispatch<React.SetStateAction<ToolState>>;
  selectedVertexIds: string[];
  selectedFaceIds: string[];
  sceneSelection?: SceneSelection | null;
  cameras?: CADCamera[];
  lights?: CADLight[];
  particles?: ParticleEmitter[];
  environment?: EnvironmentSettings;
  setCameras?: React.Dispatch<React.SetStateAction<CADCamera[]>>;
  setLights?: React.Dispatch<React.SetStateAction<CADLight[]>>;
  setParticles?: React.Dispatch<React.SetStateAction<ParticleEmitter[]>>;
  setEnvironment?: (env: EnvironmentSettings | ((prev: EnvironmentSettings) => EnvironmentSettings)) => void;
}

export const PropertiesPanel: React.FC<PropertiesPanelProps> = ({
  mesh,
  setMesh,
  toolState,
  setToolState,
  sceneSelection = null,
  cameras = [],
  lights = [],
  particles = [],
  environment,
  setCameras,
  setLights,
  setParticles,
  setEnvironment,
}) => {
  const sceneTarget = (() => {
    if (!sceneSelection || sceneSelection.kind === 'mesh') return null;
    if (sceneSelection.kind === 'camera') {
      const cam = cameras.find((c) => c.id === sceneSelection.id);
      return cam
        ? { kind: 'camera' as const, name: cam.name, position: cam.position, rotation: cam.rotation, scale: { x: 1, y: 1, z: 1 }, id: cam.id }
        : null;
    }
    if (sceneSelection.kind === 'light') {
      const L = lights.find((c) => c.id === sceneSelection.id);
      return L
        ? { kind: 'light' as const, name: L.name, position: L.position, rotation: L.rotation, scale: L.scale, id: L.id }
        : null;
    }
    if (sceneSelection.kind === 'particle') {
      const p = particles.find((c) => c.id === sceneSelection.id);
      return p
        ? {
            kind: 'particle' as const,
            name: p.name,
            position: p.position,
            rotation: p.rotation,
            scale: p.scale || { x: 1, y: 1, z: 1 },
            id: p.id,
          }
        : null;
    }
    const env = environment || createDefaultEnvironment();
    return {
      kind: 'weather' as const,
      name: `Weather (${env.weather})`,
      position: env.position || { x: 0, y: 2, z: 0 },
      rotation: env.rotation || { x: 0, y: 0, z: 0 },
      scale: env.scale || { x: 1, y: 1, z: 1 },
      id: 'environment',
    };
  })();

  const displayName = sceneTarget?.name || mesh.name;
  const position = sceneTarget?.position || mesh.position;
  const rotation = sceneTarget?.rotation || mesh.rotation;
  const scale = sceneTarget?.scale || mesh.scale;

  const patchTransform = (partial: { position?: Vector3D; rotation?: Vector3D; scale?: Vector3D }) => {
    if (!sceneTarget) {
      setMesh({
        ...mesh,
        position: partial.position || mesh.position,
        rotation: partial.rotation || mesh.rotation,
        scale: partial.scale || mesh.scale,
      });
      return;
    }
    if (sceneTarget.kind === 'camera' && setCameras) {
      setCameras((prev) =>
        prev.map((c) =>
          c.id === sceneTarget.id
            ? {
                ...c,
                position: partial.position || c.position,
                rotation: partial.rotation || c.rotation,
                lookAt: partial.position || partial.rotation ? null : c.lookAt,
              }
            : c,
        ),
      );
      return;
    }
    if (sceneTarget.kind === 'light' && setLights) {
      setLights((prev) =>
        prev.map((L) => {
          if (L.id !== sceneTarget.id) return L;
          const nextScale = partial.scale || L.scale;
          return {
            ...L,
            position: partial.position || L.position,
            rotation: partial.rotation || L.rotation,
            scale: nextScale,
            distance: partial.scale ? lightDistanceFromScale(nextScale, L.type) || L.distance : L.distance,
          };
        }),
      );
      return;
    }
    if (sceneTarget.kind === 'particle' && setParticles) {
      setParticles((prev) =>
        prev.map((p) =>
          p.id === sceneTarget.id
            ? {
                ...p,
                position: partial.position || p.position,
                rotation: partial.rotation || p.rotation,
                scale: partial.scale || p.scale,
              }
            : p,
        ),
      );
      return;
    }
    if (sceneTarget.kind === 'weather' && setEnvironment) {
      setEnvironment((prev) => ({
        ...prev,
        position: partial.position || prev.position,
        rotation: partial.rotation || prev.rotation,
        scale: partial.scale || prev.scale,
      }));
    }
  };

  const handlePositionChange = (axis: keyof Vector3D, val: number) => {
    patchTransform({ position: { ...position, [axis]: val } });
  };

  const handleRotationChange = (axis: keyof Vector3D, val: number) => {
    patchTransform({ rotation: { ...rotation, [axis]: (val * Math.PI) / 180 } });
  };

  const handleScaleChange = (axis: keyof Vector3D, val: number) => {
    patchTransform({ scale: { ...scale, [axis]: Math.max(0.01, val) } });
  };

  const adobeSwatches = [
    '#ed7300', '#ff9a3c', '#ff0055', '#f59e0b', '#10b981', '#8b5cf6',
    '#ec4899', '#6366f1', '#3b82f6', '#06b6d4', '#14b8a6', '#22c55e',
    '#eab308', '#f97316', '#ef4444', '#64748b', '#ffffff', '#000000',
  ];

  const applyMaterialPreset = (preset: 'gold' | 'chrome' | 'ruby' | 'emerald' | 'neon' | 'plastic') => {
    let color = '#ff9a3c';
    if (preset === 'gold') color = '#f59e0b';
    else if (preset === 'chrome') color = '#e2e8f0';
    else if (preset === 'ruby') color = '#ef4444';
    else if (preset === 'emerald') color = '#10b981';
    else if (preset === 'neon') color = '#ff0055';
    else if (preset === 'plastic') color = '#3b82f6';
    setToolState((s) => ({ ...s, activeColor: color }));
  };

  return (
    <div className="flex flex-col h-full bg-[#333333] text-[#cccccc] font-sans text-xs select-none">
      <div className="panel-header justify-between">
        <span className="flex items-center gap-1.5">
          <Sliders className="w-3.5 h-3.5 text-[#ed7300]" />
          Properties
        </span>
        <span className="text-[#999999] truncate max-w-[40%] normal-case tracking-normal font-medium">{displayName}</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4 custom-scrollbar">
        {sceneTarget && (
          <div className="text-[9px] font-mono text-[#e68619] uppercase tracking-wider">
            Editing {sceneTarget.kind} · use gizmo or G/R/S
          </div>
        )}

        <div className="cad-card p-2.5 space-y-3 border border-[#4d4d4d] bg-[#262626]">
          <span className="text-[9px] font-mono font-bold text-[#ff9a3c] uppercase tracking-wider block flex items-center gap-1">
            <Box className="w-3 h-3 text-[#ff9a3c]" />
            TRANSFORM NUMERICS
          </span>

          <div className="space-y-2 font-mono text-[10px]">
            <div>
              <span className="text-[#888888] block mb-1">POSITION (X, Y, Z):</span>
              <div className="grid grid-cols-3 gap-1">
                {(['x', 'y', 'z'] as (keyof Vector3D)[]).map((axis) => (
                  <div key={axis} className="flex items-center bg-[#262626] px-2 py-0.5 rounded border border-[#4d4d4d]">
                    <span className="text-rose-400 font-bold uppercase mr-1">{axis}:</span>
                    <input
                      type="number"
                      step="0.1"
                      value={Math.round(position[axis] * 100) / 100}
                      onChange={(e) => handlePositionChange(axis, parseFloat(e.target.value) || 0)}
                      className="bg-transparent text-white outline-none w-full text-[10px]"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div>
              <span className="text-[#888888] block mb-1">ROTATION (DEG):</span>
              <div className="grid grid-cols-3 gap-1">
                {(['x', 'y', 'z'] as (keyof Vector3D)[]).map((axis) => (
                  <div key={axis} className="flex items-center bg-[#262626] px-2 py-0.5 rounded border border-[#4d4d4d]">
                    <span className="text-amber-400 font-bold uppercase mr-1">{axis}:</span>
                    <input
                      type="number"
                      step="5"
                      value={Math.round(((rotation[axis] * 180) / Math.PI) * 10) / 10}
                      onChange={(e) => handleRotationChange(axis, parseFloat(e.target.value) || 0)}
                      className="bg-transparent text-white outline-none w-full text-[10px]"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div>
              <span className="text-[#888888] block mb-1">SCALE (X, Y, Z):</span>
              <div className="grid grid-cols-3 gap-1">
                {(['x', 'y', 'z'] as (keyof Vector3D)[]).map((axis) => (
                  <div key={axis} className="flex items-center bg-[#262626] px-2 py-0.5 rounded border border-[#4d4d4d]">
                    <span className="text-emerald-400 font-bold uppercase mr-1">{axis}:</span>
                    <input
                      type="number"
                      step="0.1"
                      value={Math.round(scale[axis] * 100) / 100}
                      onChange={(e) => handleScaleChange(axis, parseFloat(e.target.value) || 1)}
                      className="bg-transparent text-white outline-none w-full text-[10px]"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {!sceneTarget && (
          <div className="cad-card p-2.5 space-y-3 border border-[#4d4d4d] bg-[#262626]">
            <span className="text-[9px] font-mono font-bold text-amber-400 uppercase tracking-wider block flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-amber-400" />
              PBR MATERIAL PRESETS
            </span>

            <div className="grid grid-cols-3 gap-1">
              {([
                ['gold', 'GOLD', 'amber'],
                ['chrome', 'CHROME', 'slate'],
                ['ruby', 'RUBY', 'rose'],
                ['emerald', 'EMERALD', 'emerald'],
                ['neon', 'NEON', 'fuchsia'],
                ['plastic', 'PLASTIC', 'blue'],
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => applyMaterialPreset(id)}
                  className="py-1 bg-[#404040] border border-[#444] text-[#ddd] font-mono text-[9px] font-bold rounded hover:border-[#ed7300] transition"
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap gap-1 pt-1">
              {adobeSwatches.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  title={swatch}
                  onClick={() => setToolState((s) => ({ ...s, activeColor: swatch }))}
                  className={`w-5 h-5 rounded border ${
                    toolState.activeColor === swatch ? 'border-white scale-110' : 'border-[#444]'
                  }`}
                  style={{ backgroundColor: swatch }}
                />
              ))}
              <span className="flex items-center gap-1 text-[#888888] ml-1">
                <Palette className="w-3 h-3" />
                {toolState.activeColor}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
