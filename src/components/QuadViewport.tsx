import React, { useState } from 'react';
import { Viewport3D } from './Viewport3D';
import type {
  CADMesh,
  CADCamera,
  CADLight,
  ParticleEmitter,
  EnvironmentSettings,
  SceneSelection,
  ToolState,
  RenderSettings,
} from '../types/cad';
import type { KnifeHit } from '../utils/meshCutTools';

type PaneId = 'top' | 'front' | 'side' | 'perspective';

interface QuadViewportProps {
  meshes: CADMesh[];
  activeMeshId: string;
  setActiveMeshId: (id: string) => void;
  setMesh: (updater: CADMesh | ((prev: CADMesh) => CADMesh)) => void;
  toolState: ToolState;
  setToolState: React.Dispatch<React.SetStateAction<ToolState>>;
  renderSettings: RenderSettings;
  textureCanvas: HTMLCanvasElement | null;
  textureReadyTick?: number;
  selectedVertexIds: string[];
  setSelectedVertexIds: React.Dispatch<React.SetStateAction<string[]>>;
  selectedEdgeIds?: string[];
  setSelectedEdgeIds?: React.Dispatch<React.SetStateAction<string[]>>;
  selectedFaceIds: string[];
  setSelectedFaceIds: React.Dispatch<React.SetStateAction<string[]>>;
  selectedMeshIds?: string[];
  setSelectedMeshIds?: React.Dispatch<React.SetStateAction<string[]>>;
  onDirect3DPaintPixel?: (uvU: number, uvV: number, isFinal?: boolean, faceId?: string | null) => void;
  onDirect3DPaintStrokeEnd?: () => void;
  onSpawnDrawnPrimitive?: (newMesh: CADMesh) => void;
  onOpenUVModal?: () => void;
  onModalMeshPreview?: (amount: number) => void;
  onModalMeshConfirm?: () => void;
  onModalMeshCancel?: () => void;
  onModalLoopCutConfirm?: (loopEdgeIds: string[], factors: number[]) => void;
  onModalKnifeConfirm?: (hits: KnifeHit[]) => void;
  onBeginHistory?: () => void;
  cameras?: CADCamera[];
  lights?: CADLight[];
  particles?: ParticleEmitter[];
  environment?: EnvironmentSettings;
  setCameras?: React.Dispatch<React.SetStateAction<CADCamera[]>>;
  setLights?: React.Dispatch<React.SetStateAction<CADLight[]>>;
  setParticles?: React.Dispatch<React.SetStateAction<ParticleEmitter[]>>;
  setEnvironment?: (env: EnvironmentSettings | ((prev: EnvironmentSettings) => EnvironmentSettings)) => void;
  sceneSelection?: SceneSelection | null;
  setSceneSelection?: (sel: SceneSelection | null) => void;
}

export const QuadViewport: React.FC<QuadViewportProps> = ({
  meshes,
  activeMeshId,
  setActiveMeshId,
  setMesh,
  toolState,
  setToolState,
  renderSettings,
  textureCanvas,
  textureReadyTick,
  selectedVertexIds,
  setSelectedVertexIds,
  selectedEdgeIds,
  setSelectedEdgeIds,
  selectedFaceIds,
  setSelectedFaceIds,
  selectedMeshIds,
  setSelectedMeshIds,
  onDirect3DPaintPixel,
  onSpawnDrawnPrimitive,
  onOpenUVModal,
  onModalMeshPreview,
  onModalMeshConfirm,
  onModalMeshCancel,
  onModalLoopCutConfirm,
  onModalKnifeConfirm,
  onBeginHistory,
  cameras,
  lights,
  particles,
  environment,
  setCameras,
  setLights,
  setParticles,
  setEnvironment,
  sceneSelection,
  setSceneSelection,
}) => {
  const [splitRatioX, setSplitRatioX] = useState<number>(50);
  const [splitRatioY, setSplitRatioY] = useState<number>(50);
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const maximizedPane: PaneId | null = null;

  const handlePointerDownSplitter = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsResizing(true);
  };

  const handlePointerMoveSplitter = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isResizing) return;
    const rect = e.currentTarget.parentElement?.getBoundingClientRect();
    if (!rect) return;

    const pctX = Math.max(20, Math.min(80, ((e.clientX - rect.left) / rect.width) * 100));
    const pctY = Math.max(20, Math.min(80, ((e.clientY - rect.top) / rect.height) * 100));

    setSplitRatioX(pctX);
    setSplitRatioY(pctY);
  };

  const handlePointerUpSplitter = (e: React.PointerEvent<HTMLDivElement>) => {
    setIsResizing(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const shared = {
    meshes,
    activeMeshId,
    setActiveMeshId,
    setMesh,
    toolState,
    setToolState,
    renderSettings,
    textureCanvas,
    textureRevision: textureReadyTick,
    selectedVertexIds,
    setSelectedVertexIds,
    selectedEdgeIds,
    setSelectedEdgeIds,
    selectedFaceIds,
    setSelectedFaceIds,
    selectedMeshIds,
    setSelectedMeshIds,
    onDirect3DPaintPixel,
    onSpawnDrawnPrimitive,
    onOpenUVModal,
    isQuadSubViewport: true as const,
    onModalMeshPreview,
    onModalMeshConfirm,
    onModalMeshCancel,
    onModalLoopCutConfirm,
    onModalKnifeConfirm,
    onBeginHistory,
    cameras,
    lights,
    particles,
    environment,
    setCameras,
    setLights,
    setParticles,
    setEnvironment,
    sceneSelection,
    setSceneSelection,
  };

  return (
    <div
      className="relative w-full h-full grid gap-px bg-[#0a0a0a]"
      style={{
        gridTemplateColumns: maximizedPane ? '1fr' : `${splitRatioX}% 1fr`,
        gridTemplateRows: maximizedPane ? '1fr' : `${splitRatioY}% 1fr`,
      }}
      onPointerMove={handlePointerMoveSplitter}
      onPointerUp={handlePointerUpSplitter}
    >
      <div className="relative min-h-0 min-w-0 overflow-hidden border border-[#222]">
        <Viewport3D {...shared} cameraType="top" />
      </div>
      <div className="relative min-h-0 min-w-0 overflow-hidden border border-[#222]">
        <Viewport3D {...shared} cameraType="front" />
      </div>
      <div className="relative min-h-0 min-w-0 overflow-hidden border border-[#222]">
        <Viewport3D {...shared} cameraType="side" />
      </div>
      <div className="relative min-h-0 min-w-0 overflow-hidden border border-[#222]">
        <Viewport3D {...shared} cameraType="perspective" />
      </div>

      <div
        className="absolute inset-0 pointer-events-none"
        style={{ zIndex: 5 }}
      >
        <div
          className="absolute top-0 bottom-0 w-1 -ml-0.5 pointer-events-auto cursor-col-resize bg-transparent hover:bg-[#ed7300]/40"
          style={{ left: `${splitRatioX}%` }}
          onPointerDown={handlePointerDownSplitter}
        />
        <div
          className="absolute left-0 right-0 h-1 -mt-0.5 pointer-events-auto cursor-row-resize bg-transparent hover:bg-[#ed7300]/40"
          style={{ top: `${splitRatioY}%` }}
          onPointerDown={handlePointerDownSplitter}
        />
      </div>
    </div>
  );
};
