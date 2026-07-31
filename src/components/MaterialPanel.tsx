import React, { useState, useRef, useEffect } from 'react';
import {
  Sparkles,
  RotateCcw,
  Plus,
  Copy,
  Wand2,
  Check,
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
      color: activePalette.palette[0] || '#ff9a3c',
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
    const matId = activeMaterial?.id;

    const patchFaces = (faces: typeof mesh.faces, faceScoped: boolean) => {
      if (!colorHex && !matId) return faces;
      if (faceScoped && selectedFaceIds.length > 0) {
        return faces.map((f) =>
          selectedFaceIds.includes(f.id)
            ? {
                ...f,
                ...(colorHex ? { color: colorHex } : {}),
                ...(matId ? { materialId: matId } : {}),
              }
            : f
        );
      }
      return faces.map((f) => ({
        ...f,
        ...(colorHex ? { color: colorHex } : {}),
        ...(matId ? { materialId: matId } : {}),
      }));
    };

    if (setMeshes) {
      setMeshes((prev) =>
        prev.map((m) => {
          if (!ids.has(m.id)) return m;
          const faceScoped = toolState.editMode === 'face' && m.id === mesh.id;
          return {
            ...m,
            textureCanvasDataUrl: dataUrl,
            ...(doubleSided != null ? { doubleSided } : {}),
            faces: patchFaces(m.faces, faceScoped),
            revision: (m.revision || 0) + 1,
          };
        })
      );
      setToolState((s) => ({ ...s, viewMode: 'textured' }));
    } else if (ids.has(mesh.id)) {
      setMesh((prev) => ({
        ...prev,
        textureCanvasDataUrl: dataUrl,
        ...(doubleSided != null ? { doubleSided } : {}),
        faces: patchFaces(prev.faces, toolState.editMode === 'face'),
        revision: (prev.revision || 0) + 1,
      }));
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
      ctx.fillStyle = '#3a3a3a';
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
      ctx.fillStyle = '#3a3a3a';
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
    <div className="sp-mat flex flex-col h-full select-none">
      <header className="sp-mat__head">
        <span className="sp-mat__accent" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="sp-mat__title">Properties</div>
          <div className="sp-mat__sub truncate">{activeMaterial.name}</div>
        </div>
        <button
          type="button"
          onClick={handleEditMaterialInPixelPaint}
          className="sp-mat__ghost-btn"
          title="Bake and open in Pixel Paint"
        >
          <Pencil className="w-3 h-3" />
          Paint
        </button>
      </header>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {/* Material stack */}
        <section className="sp-mat__section">
          <div className="sp-mat__section-head">
            <span>Materials</span>
            <div className="flex items-center gap-0.5">
              <button type="button" className="sp-mat__icon-btn" title="Duplicate" onClick={handleDuplicateActiveMaterial}>
                <Copy className="w-3 h-3" />
              </button>
              <button type="button" className="sp-mat__icon-btn is-accent" title="New material" onClick={handleCreateNewMaterial}>
                <Plus className="w-3 h-3" />
              </button>
            </div>
          </div>
          <div className="sp-mat__stack">
            {materialSlots.map((mat) => {
              const isSelected = mat.id === activeMaterial.id;
              return (
                <button
                  key={mat.id}
                  type="button"
                  onClick={() => setActiveMaterialId(mat.id)}
                  className={`sp-mat__slot ${isSelected ? 'is-active' : ''}`}
                >
                  <span className="sp-mat__slot-swatch" style={{ backgroundColor: mat.color }} />
                  <span className="sp-mat__slot-name truncate">{mat.name}</span>
                  <span className="sp-mat__slot-meta">{mat.shading}</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Channels / parameters */}
        <section className="sp-mat__section">
          <div className="sp-mat__section-head">
            <span>Channels</span>
          </div>
          <div className="sp-mat__rows">
            <label className="sp-mat__row">
              <span className="sp-mat__row-label">Name</span>
              <input
                type="text"
                className="sp-mat__input"
                value={activeMaterial.name}
                onChange={(e) => handleUpdateActiveMaterial('name', e.target.value)}
              />
            </label>

            <label className="sp-mat__row">
              <span className="sp-mat__row-label">Base Color</span>
              <div className="sp-mat__row-value">
                <input
                  type="color"
                  value={activeMaterial.color}
                  onChange={(e) => handleUpdateActiveMaterial('color', e.target.value)}
                  className="sp-mat__color"
                />
                <span className="sp-mat__hex">{activeMaterial.color.toUpperCase()}</span>
              </div>
            </label>

            <label className="sp-mat__row">
              <span className="sp-mat__row-label">Shading</span>
              <select
                className="sp-mat__select"
                value={activeMaterial.shading}
                onChange={(e) => handleUpdateActiveMaterial('shading', e.target.value)}
              >
                <option value="pbr">PBR Lit</option>
                <option value="unlit">Unlit</option>
                <option value="toon">Toon</option>
                <option value="metallic">Metallic</option>
                <option value="glass">Glass</option>
                <option value="emissive">Emissive</option>
              </select>
            </label>

            <label className="sp-mat__row is-slider">
              <div className="sp-mat__row-top">
                <span className="sp-mat__row-label">Roughness</span>
                <b>{activeMaterial.roughness.toFixed(2)}</b>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={activeMaterial.roughness}
                onChange={(e) => handleUpdateActiveMaterial('roughness', +e.target.value)}
              />
            </label>

            <label className="sp-mat__row is-slider">
              <div className="sp-mat__row-top">
                <span className="sp-mat__row-label">Metallic</span>
                <b>{activeMaterial.metalness.toFixed(2)}</b>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={activeMaterial.metalness}
                onChange={(e) => handleUpdateActiveMaterial('metalness', +e.target.value)}
              />
            </label>

            <label className="sp-mat__row">
              <span className="sp-mat__row-label">Pattern</span>
              <select
                className="sp-mat__select"
                value={activeMaterial.pattern}
                onChange={(e) => handleUpdateActiveMaterial('pattern', e.target.value)}
              >
                <option value="solid">Solid</option>
                <option value="checker">Checker</option>
                <option value="grid">Grid</option>
                <option value="dots">Dots</option>
                <option value="stripes">Stripes</option>
              </select>
            </label>

            <label className="sp-mat__row">
              <span className="sp-mat__row-label">Tile</span>
              <select
                className="sp-mat__select is-narrow"
                value={activeMaterial.tileScale}
                onChange={(e) => handleUpdateActiveMaterial('tileScale', +e.target.value)}
              >
                <option value={1}>1×</option>
                <option value={2}>2×</option>
                <option value={4}>4×</option>
                <option value={8}>8×</option>
              </select>
            </label>
          </div>

          <div className="sp-mat__actions">
            <button type="button" className="sp-mat__primary" onClick={handleApplyMaterialToMesh}>
              <Check className="w-3.5 h-3.5" />
              Apply to Mesh
            </button>
            <button type="button" className="sp-mat__secondary" onClick={handleEditMaterialInPixelPaint}>
              <Pencil className="w-3 h-3" />
              Edit Texture
            </button>
          </div>
        </section>

        {/* Palette */}
        <section className="sp-mat__section">
          <div className="sp-mat__section-head">
            <span>Color Palette</span>
            <select
              value={activePaletteId}
              onChange={(e) => setActivePaletteId(e.target.value)}
              className="sp-mat__select is-compact"
            >
              {GAME_SYSTEM_PALETTES.map((sys) => (
                <option key={sys.id} value={sys.id}>{sys.name}</option>
              ))}
            </select>
          </div>
          <div className="sp-mat__palette">
            {activePalette.palette.map((colorHex, idx) => {
              const isCurrent = activeMaterial.color.toLowerCase() === colorHex.toLowerCase();
              return (
                <button
                  key={`${colorHex}-${idx}`}
                  type="button"
                  onClick={() => handleSelectSwatchColor(colorHex)}
                  className={`sp-mat__swatch ${isCurrent ? 'is-active' : ''}`}
                  style={{ backgroundColor: colorHex }}
                  title={colorHex}
                />
              );
            })}
          </div>
        </section>

        {/* Gradient */}
        <section className="sp-mat__section">
          <div className="sp-mat__section-head">
            <span>Gradient</span>
          </div>
          <div className="sp-mat__ramp-wrap">
            <canvas ref={previewCanvasRef} width={300} height={28} className="sp-mat__ramp" />
            {stops.map((stop) => {
              const isSelected = stop.id === selectedStop?.id;
              return (
                <button
                  key={stop.id}
                  type="button"
                  onClick={() => setSelectedStopId(stop.id)}
                  className={`sp-mat__stop ${isSelected ? 'is-active' : ''}`}
                  style={{ left: `${stop.position}%`, backgroundColor: stop.color }}
                  title={`${stop.position}%`}
                />
              );
            })}
          </div>

          <div className="sp-mat__rows">
            <label className="sp-mat__row">
              <span className="sp-mat__row-label">Type</span>
              <select
                className="sp-mat__select"
                value={gradientType}
                onChange={(e) => setGradientType(e.target.value as GradientType)}
              >
                <option value="linear">Linear</option>
                <option value="radial">Radial</option>
                <option value="reflected">Reflected</option>
              </select>
            </label>
            <label className="sp-mat__row is-slider">
              <div className="sp-mat__row-top">
                <span className="sp-mat__row-label">Angle</span>
                <b>{gradientAngle}°</b>
              </div>
              <input
                type="range"
                min="0"
                max="360"
                step="1"
                value={gradientAngle}
                onChange={(e) => setGradientAngle(+e.target.value)}
              />
            </label>
            <label className="sp-mat__row">
              <span className="sp-mat__row-label">Stop</span>
              <div className="sp-mat__row-value gap-1">
                <input
                  type="number"
                  min="0"
                  max="100"
                  className="sp-mat__input is-tiny"
                  value={selectedStop?.position ?? 0}
                  onChange={(e) => handleUpdateSelectedStop('position', Math.max(0, Math.min(100, +e.target.value)))}
                />
                <span className="text-[#999]">%</span>
                <input
                  type="color"
                  value={selectedStop?.color || '#ffffff'}
                  onChange={(e) => handleUpdateSelectedStop('color', e.target.value)}
                  className="sp-mat__color"
                />
              </div>
            </label>
          </div>

          <div className="sp-mat__toolbar">
            <button type="button" className="sp-mat__ghost-btn" onClick={handleAddStop}><Plus className="w-3 h-3" />Insert</button>
            <button type="button" className="sp-mat__ghost-btn" onClick={handleDuplicateStop}>Copy</button>
            <button type="button" className="sp-mat__ghost-btn" onClick={handleDeleteStop} disabled={stops.length <= 2}>Delete</button>
            <button type="button" className="sp-mat__ghost-btn" onClick={handleReverseGradient}><RotateCcw className="w-3 h-3" />Reverse</button>
          </div>

          <div className="sp-mat__actions">
            <button type="button" className="sp-mat__primary" onClick={handleApplyGradientToMesh}>
              <Sparkles className="w-3.5 h-3.5" />
              Apply Gradient
            </button>
          </div>
        </section>

        {/* Dither */}
        <section className="sp-mat__section">
          <div className="sp-mat__section-head">
            <span>Dither / Quantize</span>
          </div>
          <div className="sp-mat__rows">
            <label className="sp-mat__row is-slider">
              <div className="sp-mat__row-top">
                <span className="sp-mat__row-label">Spread</span>
                <b>{ditherSpread}</b>
              </div>
              <input
                type="range"
                min="0"
                max="64"
                step="1"
                value={ditherSpread}
                onChange={(e) => setDitherSpread(+e.target.value)}
              />
            </label>
          </div>
          <div className="sp-mat__actions">
            <button type="button" className="sp-mat__secondary is-wide" onClick={handleApplyDithering}>
              <Wand2 className="w-3 h-3" />
              Apply Dithering
            </button>
          </div>
        </section>
      </div>
    </div>
  );
};
