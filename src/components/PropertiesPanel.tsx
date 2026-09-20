import React from 'react';
import {
  Palette,
  Sliders,
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
import {
  originToBottom,
  originToGeometry,
  originToSelection,
  originToWorldZero,
  setMeshOriginWorld,
} from '../utils/meshOrigin';
import { ModifierStackPanel } from './ModifierStackPanel';

interface PropertiesPanelProps {
  mesh: CADMesh;
  setMesh: (updater: CADMesh | ((prev: CADMesh) => CADMesh)) => void;
  toolState: ToolState;
  setToolState: React.Dispatch<React.SetStateAction<ToolState>>;
  selectedVertexIds: string[];
  selectedFaceIds: string[];
  selectedEdgeIds?: string[];
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
  selectedVertexIds = [],
  selectedFaceIds = [],
  selectedEdgeIds = [],
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

  const handleOriginChange = (axis: keyof Vector3D, val: number) => {
    setMesh(setMeshOriginWorld(mesh, { ...mesh.position, [axis]: val }));
  };

  const selectionVertIds = (): string[] => {
    if (selectedVertexIds.length) return selectedVertexIds;
    const ids = new Set<string>();
    if (selectedFaceIds.length) {
      for (const f of mesh.faces) {
        if (selectedFaceIds.includes(f.id)) f.vertexIds.forEach((id) => ids.add(id));
      }
    }
    if (selectedEdgeIds.length) {
      for (const e of mesh.edges) {
        if (selectedEdgeIds.includes(e.id)) {
          ids.add(e.v1Id);
          ids.add(e.v2Id);
        }
      }
    }
    return [...ids];
  };

  const handleOriginToGeometry = () => setMesh(originToGeometry(mesh));
  const handleOriginToSelection = () => setMesh(originToSelection(mesh, selectionVertIds()));
  const handleOriginToWorld = () => setMesh(originToWorldZero(mesh));
  const handleOriginToBottom = () => setMesh(originToBottom(mesh));

  const adobeSwatches = [
    '#00b4c4', '#00d4e2', '#ff0055', '#f59e0b', '#10b981', '#8b5cf6',
    '#ec4899', '#6366f1', '#3b82f6', '#06b6d4', '#14b8a6', '#22c55e',
    '#eab308', '#f97316', '#ef4444', '#64748b', '#e2e6ec', '#16191e',
  ];

  const applyMaterialPreset = (preset: 'gold' | 'chrome' | 'ruby' | 'emerald' | 'neon' | 'plastic') => {
    let color = '#00d4e2';
    if (preset === 'gold') color = '#f59e0b';
    else if (preset === 'chrome') color = '#e2e8f0';
    else if (preset === 'ruby') color = '#ef4444';
    else if (preset === 'emerald') color = '#10b981';
    else if (preset === 'neon') color = '#ff0055';
    else if (preset === 'plastic') color = '#3b82f6';
    setToolState((s) => ({ ...s, activeColor: color }));
  };

  return (
    <div className="flex flex-col h-full bg-[#1c1f26] text-[#bcc4d0] font-sans text-xs select-none">
      <div className="panel-header justify-between">
        <span className="flex items-center gap-1.5">
          <Sliders className="w-3.5 h-3.5 text-[#00b4c4]" />
          Properties
        </span>
        <span className="text-[#6e7584] truncate max-w-[40%] normal-case tracking-normal font-medium">{displayName}</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4 custom-scrollbar">
        {sceneTarget && (
          <div className="ts-section-header px-0">
            Editing {sceneTarget.kind} · gizmo or G / R / S
          </div>
        )}

        <div className="ts-card p-3 space-y-3">
          <span className="ts-section-header px-0">
            Transform
          </span>

          <div className="space-y-2 font-mono text-[11px]">
            {!sceneTarget && (
              <div>
                <span className="text-[var(--ts-text-muted)] block mb-1 text-[11.5px]">Origin <span className="font-sans font-normal opacity-80">pivot · mesh stays</span></span>
                <div className="grid grid-cols-3 gap-1">
                  {(['x', 'y', 'z'] as (keyof Vector3D)[]).map((axis) => (
                    <div key={axis} className="flex items-center bg-[var(--ts-app)] px-2 py-0.5 rounded-[6px] border border-[var(--ts-border-hi)]">
                      <span className="text-[var(--ts-axis-x)] font-medium mr-1" style={{ color: axis === 'x' ? 'var(--ts-axis-x)' : axis === 'y' ? 'var(--ts-axis-y)' : 'var(--ts-axis-z)' }}>{axis}</span>
                      <input
                        type="number"
                        step="0.1"
                        value={Math.round(position[axis] * 100) / 100}
                        onChange={(e) => handleOriginChange(axis, parseFloat(e.target.value) || 0)}
                        className="bg-transparent text-[var(--ts-text-hi)] outline-none w-full text-[11px] font-mono"
                        aria-label={`Origin ${axis}`}
                      />
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-1 mt-1.5">
                  <button type="button" onClick={handleOriginToGeometry} className="h-6 bg-[var(--ts-elevated)] text-[var(--ts-text)] border border-[var(--ts-border-hi)] hover:bg-[var(--ts-hover)] rounded-[6px] text-[10.5px]" title="Origin to geometry center">Center</button>
                  <button type="button" onClick={handleOriginToSelection} className="h-6 bg-[var(--ts-elevated)] text-[var(--ts-text)] border border-[var(--ts-border-hi)] hover:bg-[var(--ts-hover)] rounded-[6px] text-[10.5px]" title="Origin to selection">Selection</button>
                  <button type="button" onClick={handleOriginToWorld} className="h-6 bg-[var(--ts-elevated)] text-[var(--ts-text)] border border-[var(--ts-border-hi)] hover:bg-[var(--ts-hover)] rounded-[6px] text-[10.5px]" title="Origin to world 0,0,0">World 0</button>
                  <button type="button" onClick={handleOriginToBottom} className="h-6 bg-[var(--ts-elevated)] text-[var(--ts-text)] border border-[var(--ts-border-hi)] hover:bg-[var(--ts-hover)] rounded-[6px] text-[10.5px]" title="Origin to bottom center">Bottom</button>
                </div>
              </div>
            )}

            <div>
              <span className="text-[var(--ts-text-muted)] block mb-1 text-[11.5px]">Location <span className="font-sans font-normal opacity-80">moves object</span></span>
              <div className="grid grid-cols-3 gap-1">
                {(['x', 'y', 'z'] as (keyof Vector3D)[]).map((axis) => (
                  <div key={axis} className="flex items-center bg-[#16191e] px-2 py-0.5 rounded-[6px] border border-[#3a3f4a]">
                    <span className="text-[#e0556a] font-medium mr-1">{axis}</span>
                    <input
                      type="number"
                      step="0.1"
                      value={Math.round(position[axis] * 100) / 100}
                      onChange={(e) => handlePositionChange(axis, parseFloat(e.target.value) || 0)}
                      className="bg-transparent text-[#e2e6ec] outline-none w-full text-[11px] font-mono"
                      aria-label={`Position ${axis}`}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div>
              <span className="text-[#6e7584] block mb-1 text-[11.5px]">Rotation (deg)</span>
              <div className="grid grid-cols-3 gap-1">
                {(['x', 'y', 'z'] as (keyof Vector3D)[]).map((axis) => (
                  <div key={axis} className="flex items-center bg-[#16191e] px-2 py-0.5 rounded-[6px] border border-[#3a3f4a]">
                    <span className="text-[#e6b422] font-medium mr-1">{axis}</span>
                    <input
                      type="number"
                      step="5"
                      value={Math.round(((rotation[axis] * 180) / Math.PI) * 10) / 10}
                      onChange={(e) => handleRotationChange(axis, parseFloat(e.target.value) || 0)}
                      className="bg-transparent text-[#e2e6ec] outline-none w-full text-[11px] font-mono"
                      aria-label={`Rotation ${axis}`}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div>
              <span className="text-[#6e7584] block mb-1 text-[11.5px]">Scale</span>
              <div className="grid grid-cols-3 gap-1">
                {(['x', 'y', 'z'] as (keyof Vector3D)[]).map((axis) => (
                  <div key={axis} className="flex items-center bg-[#16191e] px-2 py-0.5 rounded-[6px] border border-[#3a3f4a]">
                    <span className="text-[#34a87a] font-medium mr-1">{axis}</span>
                    <input
                      type="number"
                      step="0.1"
                      value={Math.round(scale[axis] * 100) / 100}
                      onChange={(e) => handleScaleChange(axis, parseFloat(e.target.value) || 1)}
                      className="bg-transparent text-[#e2e6ec] outline-none w-full text-[11px] font-mono"
                      aria-label={`Scale ${axis}`}
                    />
                  </div>
                ))}
              </div>
            </div>

            {!sceneTarget && (
              <button
                type="button"
                onClick={() => setToolState((s) => ({ ...s, transformMode: 'pivot', isPainting3D: false }))}
                className={`w-full mt-2 h-7 border rounded-[6px] flex items-center justify-center text-[11.5px] font-medium gap-1.5 transition ${
                  toolState.transformMode === 'pivot'
                    ? 'bg-[rgba(0,180,196,0.12)] text-[var(--ts-accent-hi)] border-[var(--ts-accent)] shadow-sm'
                    : 'bg-[var(--ts-elevated)] text-[var(--ts-text)] border-[var(--ts-border-hi)] hover:bg-[var(--ts-hover)]'
                }`}
                title="Move origin without moving the mesh (.)"
                aria-label="Pivot origin tool"
              >
                Move origin
              </button>
            )}
          </div>
        </div>

        {!sceneTarget && (
          <>
          <div className="ts-card p-3 space-y-3">
            <span className="ts-section-header px-0">
              Material presets
            </span>

            <div className="grid grid-cols-3 gap-1">
              {([
                ['gold', 'Gold'],
                ['chrome', 'Chrome'],
                ['ruby', 'Ruby'],
                ['emerald', 'Emerald'],
                ['neon', 'Neon'],
                ['plastic', 'Plastic'],
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => applyMaterialPreset(id)}
                  className="py-1 bg-[#16191e] border border-[#3a3f4a] text-[#bcc4d0] text-[11.5px] font-medium rounded-[6px] hover:border-[#00b4c4] hover:text-[#e2e6ec]"
                  aria-label={`${label} material preset`}
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
                  aria-label={`Color swatch ${swatch}`}
                  onClick={() => setToolState((s) => ({ ...s, activeColor: swatch }))}
                  className={`w-5 h-5 rounded-[6px] border ${
                    toolState.activeColor === swatch ? 'border-[#00b4c4] ring-1 ring-[#00b4c4] scale-110' : 'border-[#3a3f4a]'
                  }`}
                  style={{ backgroundColor: swatch }}
                />
              ))}
              <span className="flex items-center gap-1 text-[#6e7584] ml-1 font-mono text-[11px]">
                <Palette className="w-3 h-3" />
                {toolState.activeColor}
              </span>
            </div>
          </div>
          <ModifierStackPanel mesh={mesh} setMesh={setMesh} />
          </>
        )}
      </div>
    </div>
  );
};
