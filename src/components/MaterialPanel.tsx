import React, { useState, useRef, useEffect } from 'react';
import {
  Palette,
  Sparkles,
  RotateCcw,
  Plus,
  Trash2,
  Copy,
  Wand2,
  Check,
  Box,
  CheckCircle2,
  Tv,
  Pencil,
} from 'lucide-react';
import type { CADMesh, ToolState } from '../types/cad';
import type { GradientStop, GradientType } from '../utils/ditheringUtils';
import {
  renderGradientToCanvas,
  applyBayerDitheringToCanvas,
  GAME_SYSTEM_PALETTES,
} from '../utils/ditheringUtils';

export interface MaterialSlot {
  id: string;
  name: string;
  color: string;
  shading: 'pbr' | 'unlit' | 'toon' | 'glass' | 'metallic' | 'emissive';
  roughness: number;
  metalness: number;
  emissive: string;
  emissiveIntensity: number;
  pattern: 'solid' | 'checker' | 'checker4' | 'brick' | 'grid' | 'dots' | 'stripes';
  tileScale: number;
  doubleSided: boolean;
}

const DEFAULT_MATERIALS: MaterialSlot[] = [
  { id: 'mat_default', name: 'White PBR', color: '#e2e8f0', shading: 'pbr', roughness: 0.4, metalness: 0.1, emissive: '#000000', emissiveIntensity: 0, pattern: 'solid', tileScale: 1, doubleSided: true },
  { id: 'mat_crimson', name: 'Ruby Red', color: '#f83800', shading: 'pbr', roughness: 0.25, metalness: 0.4, emissive: '#000000', emissiveIntensity: 0, pattern: 'solid', tileScale: 1, doubleSided: true },
  { id: 'mat_cyber', name: 'Neon Cyan', color: '#00f6ff', shading: 'emissive', roughness: 0.1, metalness: 0.0, emissive: '#00f6ff', emissiveIntensity: 3.0, pattern: 'solid', tileScale: 1, doubleSided: true },
  { id: 'mat_gold', name: 'Gold Metal', color: '#ffd700', shading: 'metallic', roughness: 0.15, metalness: 0.95, emissive: '#000000', emissiveIntensity: 0, pattern: 'solid', tileScale: 1, doubleSided: true },
  { id: 'mat_emerald', name: 'Emerald', color: '#00e436', shading: 'glass', roughness: 0.05, metalness: 0.1, emissive: '#000000', emissiveIntensity: 0, pattern: 'solid', tileScale: 1, doubleSided: true },
  { id: 'mat_checker', name: 'Checker 2D', color: '#29adff', shading: 'unlit', roughness: 0.5, metalness: 0.0, emissive: '#000000', emissiveIntensity: 0, pattern: 'checker', tileScale: 1, doubleSided: true },
  { id: 'mat_obsidian', name: 'Obsidian', color: '#1d2b53', shading: 'pbr', roughness: 0.1, metalness: 0.85, emissive: '#000000', emissiveIntensity: 0, pattern: 'solid', tileScale: 1, doubleSided: true },
  { id: 'mat_toon', name: 'Toon Pink', color: '#ff77a8', shading: 'toon', roughness: 0.8, metalness: 0.0, emissive: '#000000', emissiveIntensity: 0, pattern: 'solid', tileScale: 1, doubleSided: true },
];

interface MaterialPanelProps {
  mesh: CADMesh;
  setMesh: (updater: CADMesh | ((prev: CADMesh) => CADMesh)) => void;
  setMeshes?: React.Dispatch<React.SetStateAction<CADMesh[]>>;
  selectedMeshIds?: string[];
  selectedFaceIds?: string[];
  toolState: ToolState;
  setToolState: React.Dispatch<React.SetStateAction<ToolState>>;
  textureCanvas?: HTMLCanvasElement | null;
  onApplyGradientToTexture?: (gradientCanvas: HTMLCanvasElement) => void;
  onOpenPaintWorkspace?: () => void;
}

export const MaterialPanel: React.FC<MaterialPanelProps> = ({
  mesh,
  setMesh,
  setMeshes,
  selectedMeshIds = [],
  selectedFaceIds = [],
  toolState,
  setToolState,
  onApplyGradientToTexture,
  onOpenPaintWorkspace,
}) => {
  // Material Slots Library
  const [materialSlots, setMaterialSlots] = useState<MaterialSlot[]>(DEFAULT_MATERIALS);
  const [activeMaterialId, setActiveMaterialId] = useState<string>('mat_default');

  const activeMaterial =
    materialSlots.find((m) => m.id === activeMaterialId) || materialSlots[0];

  // Palette System (Default: 64-Color Pro Spectrum)
  const [activePaletteId, setActivePaletteId] = useState<string>('pro64');
  const activePalette =
    GAME_SYSTEM_PALETTES.find((p) => p.id === activePaletteId) || GAME_SYSTEM_PALETTES[0];

  // Active Gradient Stops
  const [stops, setStops] = useState<GradientStop[]>([
    { id: 'stop_1', color: '#8b3a3a', position: 0, opacity: 100, midpoint: 50 },
    { id: 'stop_2', color: '#3a1e1e', position: 100, opacity: 100, midpoint: 50 },
  ]);

  const [selectedStopId, setSelectedStopId] = useState<string>('stop_1');
  const [gradientType, setGradientType] = useState<GradientType>('linear');
  const [gradientAngle, setGradientAngle] = useState<number>(90);
  const [ditherSpread, setDitherSpread] = useState<number>(32);

  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const selectedStop = stops.find((s) => s.id === selectedStopId) || stops[0];

  // Update gradient preview canvas whenever stops change
  useEffect(() => {
    if (previewCanvasRef.current) {
      renderGradientToCanvas(previewCanvasRef.current, stops, gradientType, gradientAngle);
    }
  }, [stops, gradientType, gradientAngle]);

  // Update active material property
  const handleUpdateActiveMaterial = (field: keyof MaterialSlot, value: any) => {
    setMaterialSlots((prev) =>
      prev.map((m) => (m.id === activeMaterial.id ? { ...m, [field]: value } : m))
    );
  };

  const handleCreateNewMaterial = () => {
    const newId = `mat_${Date.now()}`;
    const newMat: MaterialSlot = {
      id: newId,
      name: `Mat ${materialSlots.length + 1}`,
      color: activePalette.palette[0] || '#02a0e8',
      shading: 'pbr',
      roughness: 0.4,
      metalness: 0.2,
      emissive: '#000000',
      emissiveIntensity: 0,
      pattern: 'solid',
      tileScale: 1,
      doubleSided: true,
    };
    setMaterialSlots((prev) => [...prev, newMat]);
    setActiveMaterialId(newId);
  };

  const handleDuplicateActiveMaterial = () => {
    const newId = `mat_${Date.now()}`;
    const dupMat: MaterialSlot = {
      ...activeMaterial,
      id: newId,
      name: `${activeMaterial.name} Copy`,
    };
    setMaterialSlots((prev) => [...prev, dupMat]);
    setActiveMaterialId(newId);
  };

  const targetMeshIds = (): string[] => {
    if (selectedMeshIds.length > 0) return selectedMeshIds;
    return mesh?.id ? [mesh.id] : [];
  };

  const applyTextureDataUrlToTargets = (
    dataUrl: string,
    colorHex?: string,
    doubleSided?: boolean,
  ) => {
    const ids = new Set(targetMeshIds());
    if (ids.size === 0) return;

    if (setMeshes) {
      setMeshes((prev) =>
        prev.map((m) => {
          if (!ids.has(m.id)) return m;
          let updatedFaces = m.faces;
          if (colorHex) {
            if (toolState.editMode === 'face' && selectedFaceIds.length > 0 && m.id === mesh.id) {
              updatedFaces = m.faces.map((f) =>
                selectedFaceIds.includes(f.id) ? { ...f, color: colorHex } : f
              );
            } else {
              updatedFaces = m.faces.map((f) => ({ ...f, color: colorHex }));
            }
          }
          return {
            ...m,
            textureCanvasDataUrl: dataUrl,
            ...(doubleSided != null ? { doubleSided } : {}),
            faces: updatedFaces,
            revision: (m.revision || 0) + 1,
          };
        })
      );
      setToolState((s) => ({ ...s, viewMode: 'textured' }));
    } else if (ids.has(mesh.id)) {
      setMesh((prev) => {
        let updatedFaces = prev.faces;
        if (colorHex) {
          if (toolState.editMode === 'face' && selectedFaceIds.length > 0) {
            updatedFaces = prev.faces.map((f) =>
              selectedFaceIds.includes(f.id) ? { ...f, color: colorHex } : f
            );
          } else {
            updatedFaces = prev.faces.map((f) => ({ ...f, color: colorHex }));
          }
        }
        return {
          ...prev,
          textureCanvasDataUrl: dataUrl,
          ...(doubleSided != null ? { doubleSided } : {}),
          faces: updatedFaces,
          revision: (prev.revision || 0) + 1,
        };
      });
      setToolState((s) => ({ ...s, viewMode: 'textured' }));
    }
  };

  // Click Swatch to set Active Material Color or Active Stop Color + Automatic Instant Apply
  const handleSelectSwatchColor = (colorHex: string) => {
    handleUpdateActiveMaterial('color', colorHex);
    if (selectedStop) {
      handleUpdateSelectedStop('color', colorHex);
    }

    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = colorHex;
      ctx.fillRect(0, 0, 256, 256);
    }
    applyTextureDataUrlToTargets(canvas.toDataURL('image/png'), colorHex);
  };

  // Generate & apply procedural material texture to active mesh
  const handleApplyMaterialToMesh = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = activeMaterial.color;
    ctx.fillRect(0, 0, 256, 256);

    const scale = activeMaterial.tileScale || 1;
    const tileSize = Math.max(8, Math.floor(32 / scale));

    if (activeMaterial.pattern === 'checker' || activeMaterial.pattern === 'checker4') {
      ctx.fillStyle = '#121212';
      for (let y = 0; y < 256; y += tileSize) {
        for (let x = 0; x < 256; x += tileSize) {
          if (((x / tileSize) + (y / tileSize)) % 2 === 0) {
            ctx.fillRect(x, y, tileSize, tileSize);
          }
        }
      }
    } else if (activeMaterial.pattern === 'grid') {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(1, 4 / scale);
      for (let i = 0; i <= 256; i += tileSize) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, 256);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(256, i);
        ctx.stroke();
      }
    } else if (activeMaterial.pattern === 'dots') {
      ctx.fillStyle = '#ffffff';
      const radius = Math.max(2, 6 / scale);
      for (let y = tileSize / 2; y < 256; y += tileSize) {
        for (let x = tileSize / 2; x < 256; x += tileSize) {
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (activeMaterial.pattern === 'stripes') {
      ctx.fillStyle = '#121212';
      for (let x = 0; x < 256; x += tileSize * 2) {
        ctx.fillRect(x, 0, tileSize, 256);
      }
    }

    if (onApplyGradientToTexture) {
      onApplyGradientToTexture(canvas);
    }

    applyTextureDataUrlToTargets(
      canvas.toDataURL('image/png'),
      activeMaterial.color,
      activeMaterial.doubleSided,
    );
  };

  const handleEditMaterialInPixelPaint = () => {
    handleApplyMaterialToMesh();
    if (onOpenPaintWorkspace) {
      onOpenPaintWorkspace();
    }
  };

  const handleEditGradientInPixelPaint = (dithered = false) => {
    if (dithered) {
      handleApplyDithering();
    } else {
      handleApplyGradientToMesh();
    }
    if (onOpenPaintWorkspace) {
      onOpenPaintWorkspace();
    }
  };

  // Gradient Stop Handlers
  const handleUpdateSelectedStop = (field: keyof GradientStop, value: any) => {
    if (!selectedStop) return;
    setStops((prev) =>
      prev.map((s) => (s.id === selectedStop.id ? { ...s, [field]: value } : s))
    );
  };

  const handleAddStop = () => {
    const newId = `stop_${Date.now()}`;
    const newStop: GradientStop = {
      id: newId,
      color: activePalette.palette[0] || '#e68619',
      position: 50,
      opacity: 100,
      midpoint: 50,
    };
    setStops((prev) => [...prev, newStop].sort((a, b) => a.position - b.position));
    setSelectedStopId(newId);
  };

  const handleDuplicateStop = () => {
    if (!selectedStop) return;
    const newId = `stop_${Date.now()}`;
    const dupStop: GradientStop = {
      ...selectedStop,
      id: newId,
      position: Math.min(100, selectedStop.position + 10),
    };
    setStops((prev) => [...prev, dupStop].sort((a, b) => a.position - b.position));
    setSelectedStopId(newId);
  };

  const handleDeleteStop = () => {
    if (stops.length <= 2) return;
    setStops((prev) => prev.filter((s) => s.id !== selectedStopId));
    const remaining = stops.filter((s) => s.id !== selectedStopId);
    if (remaining.length > 0) setSelectedStopId(remaining[0].id);
  };

  const handleReverseGradient = () => {
    setStops((prev) =>
      prev.map((s) => ({ ...s, position: 100 - s.position })).sort((a, b) => a.position - b.position)
    );
  };

  const applyGradientPreset = (presetName: string) => {
    if (presetName === 'sunset') {
      setStops([
        { id: 's1', color: '#ff4e50', position: 0, opacity: 100 },
        { id: 's2', color: '#f9d423', position: 100, opacity: 100 },
      ]);
    } else if (presetName === 'cyberpunk') {
      setStops([
        { id: 's1', color: '#00f6ff', position: 0, opacity: 100 },
        { id: 's2', color: '#ff007b', position: 100, opacity: 100 },
      ]);
    } else if (presetName === 'picocad') {
      setStops([
        { id: 's1', color: '#83769c', position: 0, opacity: 100 },
        { id: 's2', color: '#ff004d', position: 50, opacity: 100 },
        { id: 's3', color: '#ffec27', position: 100, opacity: 100 },
      ]);
    } else if (presetName === 'gold') {
      setStops([
        { id: 's1', color: '#bf953f', position: 0, opacity: 100 },
        { id: 's2', color: '#fcf6ba', position: 50, opacity: 100 },
        { id: 's3', color: '#b38728', position: 100, opacity: 100 },
      ]);
    } else if (presetName === 'monochrome') {
      setStops([
        { id: 's1', color: '#1a1a1a', position: 0, opacity: 100 },
        { id: 's2', color: '#ffffff', position: 100, opacity: 100 },
      ]);
    }
  };

  const handleApplyGradientToMesh = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    renderGradientToCanvas(canvas, stops, gradientType, gradientAngle);

    if (onApplyGradientToTexture) {
      onApplyGradientToTexture(canvas);
    }

    const dataUrl = canvas.toDataURL('image/png');
    setMesh((prev) => ({
      ...prev,
      textureCanvasDataUrl: dataUrl,
      revision: (prev.revision || 0) + 1,
    }));
  };

  const handleApplyDithering = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    renderGradientToCanvas(canvas, stops, gradientType, gradientAngle);

    applyBayerDitheringToCanvas(canvas, activePalette.palette, ditherSpread);

    if (onApplyGradientToTexture) {
      onApplyGradientToTexture(canvas);
    }

    const dataUrl = canvas.toDataURL('image/png');
    setMesh((prev) => ({
      ...prev,
      textureCanvasDataUrl: dataUrl,
      revision: (prev.revision || 0) + 1,
    }));
  };

  return (
    <div className="flex flex-col h-full bg-[#161616] text-[#e0e0e0] font-sans text-xs select-none">
      {/* Top Header */}
      <div className="h-8 bg-[#121212] border-b border-[#2d2d2d] px-3 flex items-center justify-between font-mono text-[10px] text-[#1473e6] font-bold">
        <span className="flex items-center gap-1.5 uppercase tracking-wide">
          <Palette className="w-3.5 h-3.5 text-[#1473e6]" />
          MATERIAL STUDIO
        </span>
        <button
          type="button"
          onClick={handleEditMaterialInPixelPaint}
          className="flex items-center gap-1 px-2 py-0.5 bg-[#1473e6] hover:bg-[#1264cb] text-white font-sans text-[9px] font-bold rounded transition shadow-sm"
          title="Bake material texture and open directly in Pixel Paint mode for editing"
        >
          <Pencil className="w-3 h-3" />
          Edit in Pixel Paint
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2.5 custom-scrollbar">
        {/* 1. COMPACT COLOR SWATCH SYSTEM (64 PRO SPECTRUM + GAME SYSTEMS) */}
        <div className="cad-card p-2 space-y-1.5 border border-[#333333] bg-[#1e1e1e] rounded shadow-sm">
          <div className="flex items-center justify-between font-mono text-[10px]">
            <span className="font-bold text-[#e68619] uppercase flex items-center gap-1">
              <Tv className="w-3 h-3 text-[#e68619]" />
              COLOR PALETTE ({activePalette.palette.length})
            </span>
            <select
              value={activePaletteId}
              onChange={(e) => setActivePaletteId(e.target.value)}
              className="bg-[#121212] text-[#e68619] px-1.5 py-0.5 rounded border border-[#383838] outline-none font-bold text-[9px] cursor-pointer"
            >
              {GAME_SYSTEM_PALETTES.map((sys) => (
                <option key={sys.id} value={sys.id}>
                  {sys.name}
                </option>
              ))}
            </select>
          </div>

          {/* Compact 16-Column Micro Swatch Grid */}
          <div className="grid grid-cols-16 gap-1 p-1 bg-[#121212] rounded border border-[#2d2d2d]">
            {activePalette.palette.map((colorHex, idx) => {
              const isCurrentColor = activeMaterial.color.toLowerCase() === colorHex.toLowerCase();
              return (
                <button
                  key={`${colorHex}-${idx}`}
                  onClick={() => handleSelectSwatchColor(colorHex)}
                  className={`w-full aspect-square rounded-sm border transition relative hover:scale-125 cursor-pointer ${
                    isCurrentColor
                      ? 'border-white ring-1 ring-[#e68619] z-10'
                      : 'border-black/60 hover:border-white'
                  }`}
                  style={{ backgroundColor: colorHex }}
                  title={`Color: ${colorHex} (Click to apply)`}
                />
              );
            })}
          </div>
        </div>

        {/* 2. COMPACT MATERIAL SLOTS & CREATOR */}
        <div className="cad-card p-2 space-y-2 border border-[#333333] bg-[#1e1e1e] rounded shadow-sm">
          <div className="flex items-center justify-between font-mono text-[10px]">
            <span className="font-bold text-[#1473e6] uppercase flex items-center gap-1">
              <Box className="w-3.5 h-3.5 text-[#1473e6]" />
              MATERIAL PRESETS
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={handleDuplicateActiveMaterial}
                className="px-1.5 py-0.5 bg-[#2d2d2d] hover:bg-[#383838] text-[#e0e0e0] rounded text-[8.5px] font-bold"
                title="Duplicate active material"
              >
                Dup
              </button>
              <button
                onClick={handleCreateNewMaterial}
                className="px-1.5 py-0.5 bg-[#1473e6] hover:bg-[#2680eb] text-white rounded text-[8.5px] font-bold flex items-center gap-0.5"
              >
                <Plus className="w-3 h-3" />
                <span>+ Mat</span>
              </button>
            </div>
          </div>

          {/* Compact Material Pills Row */}
          <div className="flex items-center gap-1 overflow-x-auto pb-1 custom-scrollbar">
            {materialSlots.map((mat) => {
              const isSelected = mat.id === activeMaterial.id;
              return (
                <button
                  key={mat.id}
                  onClick={() => setActiveMaterialId(mat.id)}
                  className={`px-2 py-1 rounded flex items-center gap-1 font-mono text-[9px] whitespace-nowrap border shrink-0 transition ${
                    isSelected
                      ? 'bg-[#1473e6]/20 border-[#1473e6] text-white font-bold'
                      : 'bg-[#161616] border-[#303030] text-[#8c8c8c] hover:text-white'
                  }`}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full border border-black/50 shrink-0"
                    style={{ backgroundColor: mat.color }}
                  />
                  <span>{mat.name}</span>
                </button>
              );
            })}
          </div>

          {/* Material Properties Setup */}
          <div className="p-2 bg-[#141414] rounded border border-[#2a2a2a] space-y-2 text-[10px] font-mono">
            <label className="flex items-center justify-between text-[#b3b3b3]">
              <span>Name:</span>
              <input
                type="text"
                value={activeMaterial.name}
                onChange={(e) => handleUpdateActiveMaterial('name', e.target.value)}
                className="bg-[#1c1c1c] text-white px-2 py-0.5 rounded border border-[#333333] outline-none font-bold text-[10px] w-32"
              />
            </label>

            {/* Shading & Base Color */}
            <div className="grid grid-cols-2 gap-2">
              <label className="flex items-center justify-between text-[#b3b3b3]">
                <span>Shading:</span>
                <select
                  value={activeMaterial.shading}
                  onChange={(e) => handleUpdateActiveMaterial('shading', e.target.value)}
                  className="bg-[#1c1c1c] text-[#1473e6] px-1 py-0.5 rounded border border-[#333333] outline-none font-bold cursor-pointer w-22"
                >
                  <option value="pbr">PBR Lit</option>
                  <option value="unlit">Unlit Flat</option>
                  <option value="toon">Toon Shade</option>
                  <option value="metallic">Metallic</option>
                  <option value="glass">Glass Gem</option>
                  <option value="emissive">Neon Glow</option>
                </select>
              </label>

              <label className="flex items-center justify-between text-[#b3b3b3]">
                <span>Color:</span>
                <div className="flex items-center gap-1">
                  <input
                    type="color"
                    value={activeMaterial.color}
                    onChange={(e) => handleUpdateActiveMaterial('color', e.target.value)}
                    className="w-5 h-4 rounded bg-transparent border-0 cursor-pointer"
                  />
                  <span className="text-white text-[8.5px] uppercase">{activeMaterial.color}</span>
                </div>
              </label>
            </div>

            {/* Pattern & Scale */}
            <div className="grid grid-cols-2 gap-2">
              <label className="flex items-center justify-between text-[#b3b3b3]">
                <span>Pattern:</span>
                <select
                  value={activeMaterial.pattern}
                  onChange={(e) => handleUpdateActiveMaterial('pattern', e.target.value)}
                  className="bg-[#1c1c1c] text-[#e68619] px-1 py-0.5 rounded border border-[#333333] outline-none font-bold cursor-pointer w-22"
                >
                  <option value="solid">Solid</option>
                  <option value="checker">Checker</option>
                  <option value="grid">Wire Grid</option>
                  <option value="dots">Dots</option>
                  <option value="stripes">Stripes</option>
                </select>
              </label>

              <label className="flex items-center justify-between text-[#b3b3b3]">
                <span>Tile:</span>
                <select
                  value={activeMaterial.tileScale}
                  onChange={(e) => handleUpdateActiveMaterial('tileScale', +e.target.value)}
                  className="bg-[#1c1c1c] text-white px-1 py-0.5 rounded border border-[#333333] outline-none cursor-pointer w-14"
                >
                  <option value={1}>1x</option>
                  <option value={2}>2x</option>
                  <option value={4}>4x</option>
                  <option value={8}>8x</option>
                </select>
              </label>
            </div>

            {/* Surface Finish: Roughness & Metalness */}
            <div className="grid grid-cols-2 gap-2">
              <label className="flex items-center justify-between text-[#b3b3b3]">
                <span>Rough:</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={activeMaterial.roughness}
                  onChange={(e) => handleUpdateActiveMaterial('roughness', +e.target.value)}
                  className="w-16 accent-[#1473e6]"
                />
              </label>

              <label className="flex items-center justify-between text-[#b3b3b3]">
                <span>Metal:</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={activeMaterial.metalness}
                  onChange={(e) => handleUpdateActiveMaterial('metalness', +e.target.value)}
                  className="w-16 accent-[#1473e6]"
                />
              </label>
            </div>

            {/* Apply & Edit Buttons */}
            <div className="grid grid-cols-2 gap-1 mt-1">
              <button
                onClick={handleApplyMaterialToMesh}
                className="py-1.5 bg-[#1473e6] hover:bg-[#2680eb] text-white font-mono text-[9px] font-bold rounded shadow transition flex items-center justify-center gap-1"
              >
                <Check className="w-3.5 h-3.5" />
                <span>APPLY MATERIAL</span>
              </button>
              <button
                onClick={handleEditMaterialInPixelPaint}
                className="py-1.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-mono text-[9px] font-bold rounded shadow transition flex items-center justify-center gap-1"
                title="Bake material texture and open in Pixel Paint mode"
              >
                <Pencil className="w-3.5 h-3.5" />
                <span>EDIT IN PIXEL PAINT</span>
              </button>
            </div>
          </div>
        </div>

        {/* 3. PHOTOSHOP/LIGHTWAVE STYLE GRADIENT RAMP EDITOR */}
        <div className="cad-card p-2 space-y-2 border border-[#333333] bg-[#1e1e1e] rounded shadow-sm">
          <span className="text-[9.5px] font-mono font-bold text-white uppercase block">
            GRADIENT RAMP EDITOR
          </span>

          {/* Canvas Preview Strip */}
          <div className="relative w-full h-9 rounded border border-[#121212] shadow-inner overflow-hidden bg-[#111111]">
            <canvas ref={previewCanvasRef} width={300} height={36} className="w-full h-full block" />
            <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-white/70 shadow-sm pointer-events-none transform -translate-y-1/2" />

            {stops.map((stop) => {
              const isSelected = stop.id === selectedStop?.id;
              return (
                <div
                  key={stop.id}
                  onClick={() => setSelectedStopId(stop.id)}
                  style={{ left: `${stop.position}%` }}
                  className={`absolute top-1/2 transform -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full border-2 cursor-pointer transition shadow-md ${
                    isSelected
                      ? 'border-white ring-2 ring-[#1473e6] scale-125 z-20'
                      : 'border-white/80 hover:scale-110 z-10'
                  }`}
                >
                  <div
                    className="w-full h-full rounded-full"
                    style={{ backgroundColor: stop.color }}
                  />
                </div>
              );
            })}
          </div>

          {/* Gradient Controls Table */}
          <div className="space-y-1.5 text-[9.5px] font-mono pt-1 border-t border-[#2d2d2d]">
            <div className="grid grid-cols-2 gap-2">
              <label className="flex items-center justify-between text-[#b3b3b3]">
                <span>Type:</span>
                <select
                  value={gradientType}
                  onChange={(e) => setGradientType(e.target.value as GradientType)}
                  className="bg-[#141414] text-white px-1.5 py-0.5 rounded border border-[#333333] outline-none cursor-pointer w-22"
                >
                  <option value="linear">Linear</option>
                  <option value="radial">Radial</option>
                  <option value="reflected">Reflected</option>
                </select>
              </label>

              <label className="flex items-center justify-between text-[#b3b3b3]">
                <span>Angle:</span>
                <div className="flex items-center gap-1">
                  <input
                    type="range"
                    min="0"
                    max="360"
                    step="15"
                    value={gradientAngle}
                    onChange={(e) => setGradientAngle(+e.target.value)}
                    className="w-12 accent-[#1473e6]"
                  />
                  <span className="text-white w-6 text-right">{gradientAngle}°</span>
                </div>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="flex items-center justify-between text-[#b3b3b3]">
                <span>Position:</span>
                <div className="flex items-center gap-0.5">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={selectedStop?.position ?? 0}
                    onChange={(e) => handleUpdateSelectedStop('position', Math.max(0, Math.min(100, +e.target.value)))}
                    className="bg-[#141414] text-[#1473e6] px-1 py-0.5 rounded border border-[#333333] outline-none text-right w-12 font-bold"
                  />
                  <span>%</span>
                </div>
              </label>

              <label className="flex items-center justify-between text-[#b3b3b3]">
                <span>Color:</span>
                <div className="flex items-center gap-1">
                  <input
                    type="color"
                    value={selectedStop?.color || '#ffffff'}
                    onChange={(e) => handleUpdateSelectedStop('color', e.target.value)}
                    className="w-6 h-4 rounded bg-transparent border-0 cursor-pointer"
                  />
                  <span className="text-white text-[8.5px] uppercase">{selectedStop?.color}</span>
                </div>
              </label>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-1">
                <button
                  onClick={handleAddStop}
                  className="px-2 py-0.5 bg-[#2d2d2d] hover:bg-[#1473e6] text-white rounded text-[8.5px] font-bold transition flex items-center gap-0.5"
                >
                  <Plus className="w-3 h-3" />
                  <span>Insert</span>
                </button>
                <button
                  onClick={handleDuplicateStop}
                  className="px-2 py-0.5 bg-[#2d2d2d] hover:bg-[#383838] text-[#e0e0e0] rounded text-[8.5px] transition"
                >
                  Copy
                </button>
                <button
                  onClick={handleDeleteStop}
                  disabled={stops.length <= 2}
                  className={`px-2 py-0.5 rounded text-[8.5px] transition ${
                    stops.length <= 2
                      ? 'bg-[#1c1c1c] text-[#555555] cursor-not-allowed'
                      : 'bg-[#2d2d2d] hover:bg-[#ec5b62] text-white'
                  }`}
                >
                  Delete
                </button>
              </div>

              <button
                onClick={handleReverseGradient}
                className="px-2 py-0.5 bg-[#2d2d2d] hover:bg-[#383838] text-white rounded text-[8.5px] transition flex items-center gap-0.5"
              >
                <RotateCcw className="w-3 h-3 text-[#2680eb]" />
                <span>Reverse</span>
              </button>
            </div>
          </div>

          <button
            onClick={handleApplyGradientToMesh}
            className="w-full py-1.5 bg-[#1473e6] hover:bg-[#2680eb] text-white font-mono text-[9.5px] font-bold rounded shadow transition flex items-center justify-center gap-1"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>APPLY GRADIENT TO MESH</span>
          </button>
        </div>

        {/* 4. BAYER DITHERING SECTION */}
        <div className="cad-card p-2 space-y-1.5 border border-[#333333] bg-[#1e1e1e] rounded shadow-sm">
          <span className="text-[9.5px] font-mono font-bold text-[#e68619] uppercase block">
            BAYER DITHERING & PALETTE QUANTIZER
          </span>

          <div className="grid grid-cols-2 gap-2 text-[9.5px] font-mono">
            <label className="flex items-center justify-between text-[#b3b3b3]">
              <span>Palette:</span>
              <select
                value={activePaletteId}
                onChange={(e) => setActivePaletteId(e.target.value)}
                className="bg-[#141414] text-[#e68619] px-1.5 py-0.5 rounded border border-[#333333] outline-none cursor-pointer w-22 font-bold"
              >
                {GAME_SYSTEM_PALETTES.map((sys) => (
                  <option key={sys.id} value={sys.id}>
                    {sys.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center justify-between text-[#b3b3b3]">
              <span>Dither:</span>
              <input
                type="range"
                min="0"
                max="64"
                step="4"
                value={ditherSpread}
                onChange={(e) => setDitherSpread(+e.target.value)}
                className="w-16 accent-[#e68619]"
              />
            </label>
          </div>

          <button
            onClick={handleApplyDithering}
            className="w-full py-1 bg-[#e68619] hover:bg-[#f59e0b] text-white font-mono text-[9.5px] font-bold rounded shadow transition flex items-center justify-center gap-1"
          >
            <Wand2 className="w-3 h-3" />
            <span>APPLY DITHERING & PALETTE</span>
          </button>
        </div>
      </div>
    </div>
  );
};
