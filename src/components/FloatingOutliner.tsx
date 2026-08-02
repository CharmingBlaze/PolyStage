import React, { useEffect, useRef, useState } from 'react';
import { GripHorizontal, Layers, Maximize2, Minus, X } from 'lucide-react';
import { OutlinerPanel } from './OutlinerPanel';
import type {
  CADMesh,
  SceneGroup,
  CADBone,
  CADCamera,
  CADLight,
  ParticleEmitter,
  EnvironmentSettings,
  SceneSelection,
} from '../types/cad';

export type FloatingOutlinerTab = 'meshes' | 'scene' | 'bones';

interface FloatingOutlinerProps {
  isOpen: boolean;
  onClose: () => void;
  meshes: CADMesh[];
  setMeshes: React.Dispatch<React.SetStateAction<CADMesh[]>>;
  groups: SceneGroup[];
  setGroups: React.Dispatch<React.SetStateAction<SceneGroup[]>>;
  bones: CADBone[];
  setBones: React.Dispatch<React.SetStateAction<CADBone[]>>;
  activeMeshId: string;
  setActiveMeshId: (id: string) => void;
  selectedMeshIds: string[];
  setSelectedMeshIds: React.Dispatch<React.SetStateAction<string[]>>;
  selectedBoneId: string;
  setSelectedBoneId: (id: string) => void;
  onSpawnPrimitive: (type: any) => void;
  onDeleteMesh: (id: string) => void;
  onDuplicateMesh?: (id: string) => void;
  onSeparateMesh?: (id: string) => void;
  cameras: CADCamera[];
  setCameras: React.Dispatch<React.SetStateAction<CADCamera[]>>;
  lights: CADLight[];
  setLights: React.Dispatch<React.SetStateAction<CADLight[]>>;
  particles: ParticleEmitter[];
  setParticles: React.Dispatch<React.SetStateAction<ParticleEmitter[]>>;
  environment: EnvironmentSettings;
  setEnvironment: (env: EnvironmentSettings | ((prev: EnvironmentSettings) => EnvironmentSettings)) => void;
  sceneSelection: SceneSelection | null;
  setSceneSelection: (sel: SceneSelection | null) => void;
  setActiveCameraId: (id: string | null) => void;
  /** Called when a mesh becomes the active edit target. */
  onActivateObject?: (meshId: string) => void;
}

export const FloatingOutliner: React.FC<FloatingOutlinerProps> = ({
  isOpen,
  onClose,
  meshes,
  setMeshes,
  groups,
  setGroups,
  bones,
  setBones,
  activeMeshId,
  setActiveMeshId,
  selectedMeshIds,
  setSelectedMeshIds,
  selectedBoneId,
  setSelectedBoneId,
  onSpawnPrimitive,
  onDeleteMesh,
  onDuplicateMesh,
  onSeparateMesh,
  cameras,
  setCameras,
  lights,
  setLights,
  particles,
  setParticles,
  environment,
  setEnvironment,
  sceneSelection,
  setSceneSelection,
  setActiveCameraId,
  onActivateObject,
}) => {
  const [position, setPosition] = useState({ x: 0, y: 44 });
  const [isMinimized, setIsMinimized] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const placedRef = useRef(false);

  // Dock to the right edge on first open so it doesn't cover the modeling tools.
  useEffect(() => {
    if (!isOpen || placedRef.current) return;
    const width = 300;
    setPosition({
      x: Math.max(60, window.innerWidth - width - 24),
      y: 44,
    });
    placedRef.current = true;
  }, [isOpen]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDragging) return;
      setPosition({
        x: Math.max(8, Math.min(window.innerWidth - 280, e.clientX - dragStartRef.current.x)),
        y: Math.max(8, Math.min(window.innerHeight - 80, e.clientY - dragStartRef.current.y)),
      });
    };
    const onUp = () => setIsDragging(false);
    if (isDragging) {
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    }
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isDragging]);

  if (!isOpen) return null;

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };
  };

  const handleSetActiveMeshId = (id: string) => {
    setActiveMeshId(id);
    setSelectedMeshIds([id]);
    setSceneSelection({ kind: 'mesh', id });
    onActivateObject?.(id);
  };

  const activeName =
    meshes.find((m) => m.id === activeMeshId)?.name ||
    bones.find((b) => b.id === selectedBoneId)?.name ||
    'Scene';

  return (
    <div
      className="sp-outliner fixed z-[120] flex flex-col"
      style={{
        left: position.x,
        top: position.y,
        width: isMinimized ? 260 : 300,
        height: isMinimized ? undefined : Math.min(560, Math.max(360, window.innerHeight - 80)),
      }}
    >
      <div
        onMouseDown={handleMouseDown}
        className="sp-outliner__head cursor-grab active:cursor-grabbing"
      >
        <span className="sp-outliner__accent" aria-hidden />
        <div className="min-w-0 flex-1 flex items-center gap-1.5 px-1">
          <GripHorizontal className="w-3.5 h-3.5 text-[#8b909a] shrink-0" />
          <Layers className="w-3.5 h-3.5 text-[#ed7300] shrink-0" />
          <div className="min-w-0">
            <div className="sp-outliner__title">Outliner</div>
            <div className="sp-outliner__sub truncate">{activeName}</div>
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0 pr-1">
          <button
            type="button"
            className="sp-outliner__icon-btn"
            title={isMinimized ? 'Expand' : 'Minimize'}
            onClick={() => setIsMinimized((v) => !v)}
          >
            {isMinimized ? <Maximize2 className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
          </button>
          <button
            type="button"
            className="sp-outliner__icon-btn is-danger"
            title="Close Outliner"
            onClick={onClose}
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {isMinimized ? (
        <div className="sp-outliner__mini">
          <span>
            {meshes.length} mesh{meshes.length === 1 ? '' : 'es'} · {bones.length} bone
            {bones.length === 1 ? '' : 's'}
          </span>
          <span className="text-[#ed7300] truncate max-w-[140px]">{activeName}</span>
        </div>
      ) : (
        <div className="sp-outliner__body custom-scrollbar">
          <OutlinerPanel
            meshes={meshes}
            setMeshes={setMeshes}
            groups={groups}
            setGroups={setGroups}
            bones={bones}
            setBones={setBones}
            activeMeshId={activeMeshId}
            setActiveMeshId={handleSetActiveMeshId}
            selectedMeshIds={selectedMeshIds}
            setSelectedMeshIds={setSelectedMeshIds}
            selectedBoneId={selectedBoneId}
            setSelectedBoneId={setSelectedBoneId}
            onSpawnPrimitive={onSpawnPrimitive}
            onDeleteMesh={onDeleteMesh}
            onDuplicateMesh={onDuplicateMesh}
            onSeparateMesh={onSeparateMesh}
            cameras={cameras}
            setCameras={setCameras}
            lights={lights}
            setLights={setLights}
            particles={particles}
            setParticles={setParticles}
            environment={environment}
            setEnvironment={setEnvironment}
            sceneSelection={sceneSelection}
            setSceneSelection={setSceneSelection}
            setActiveCameraId={setActiveCameraId}
            showSceneObjects
            floating
          />
        </div>
      )}
    </div>
  );
};
