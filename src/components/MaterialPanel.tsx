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
import type { CADMesh, MaterialAsset, ToolState } from '../types/cad';
import type { GradientStop, GradientType } from '../utils/ditheringUtils';
import {
  renderGradientToCanvas,
  applyBayerDitheringToCanvas,
  GAME_SYSTEM_PALETTES,
} from '../utils/ditheringUtils';
import { createMaterial, materialTextureDataUrl } from '../utils/materials';

const GRADIENT_PRESETS: { id: string; name: string; stops: GradientStop[] }[] = [
  {
    id: 'sunset',
    name: 'Sunset',
    stops: [
      { id: 's1', color: '#ff4e50', position: 0, opacity: 100 },
      { id: 's2', color: '#f9d423', position: 100, opacity: 100 },
    ],
  },
  {
    id: 'cyberpunk',
    name: 'Cyberpunk',
    stops: [
      { id: 's1', color: '#00f6ff', position: 0, opacity: 100 },
      { id: 's2', color: '#ff007b', position: 100, opacity: 100 },
    ],
  },
  {
    id: 'retro',
    name: 'Retro 16',
    stops: [
      { id: 's1', color: '#83769c', position: 0, opacity: 100 },
      { id: 's2', color: '#ff004d', position: 50, opacity: 100 },
      { id: 's3', color: '#ffec27', position: 100, opacity: 100 },
    ],
  },
  {
    id: 'gold',
    name: 'Gold',
    stops: [
      { id: 's1', color: '#bf953f', position: 0, opacity: 100 },
      { id: 's2', color: '#fcf6ba', position: 50, opacity: 100 },
      { id: 's3', color: '#b38728', position: 100, opacity: 100 },
    ],
  },
  {
    id: 'monochrome',
    name: 'Mono',
    stops: [
      { id: 's1', color: '#1a1c22', position: 0, opacity: 100 },
      { id: 's2', color: '#e2e6ec', position: 100, opacity: 100 },
    ],
  },
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
  materials: MaterialAsset[];
  setMaterials: React.Dispatch<React.SetStateAction<MaterialAsset[]>>;
  activeMaterialId: string;
  setActiveMaterialId: (id: string) => void;
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
  materials: materialSlots,
  setMaterials: setMaterialSlots,
  activeMaterialId,
  setActiveMaterialId,
}) => {
  const activeMaterial =
    materialSlots.find((m) => m.id === activeMaterialId) || materialSlots[0]!;

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
  const handleUpdateActiveMaterial = (field: keyof MaterialAsset, value: MaterialAsset[keyof MaterialAsset]) => {
    setMaterialSlots((prev) =>
      prev.map((m) => (m.id === activeMaterial.id ? { ...m, [field]: value } : m))
    );
  };

  const handleCreateNewMaterial = () => {
    const newMat = createMaterial(`Material ${materialSlots.length + 1}`);
    newMat.color = activePalette.palette[0] || '#00d4e2';
    setMaterialSlots((prev) => [...prev, newMat]);
    setActiveMaterialId(newMat.id);
  };

  const handleDuplicateActiveMaterial = () => {
    const newId = `mat_${Date.now()}`;
    const dupMat: MaterialAsset = {
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
    dataUrl: string | undefined,
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
            materialId: matId,
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
        materialId: matId,
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
    if (!activeMaterial) return;
    if (activeMaterial.source === 'color' && activeMaterial.pattern === 'solid') {
      applyTextureDataUrlToTargets(undefined, activeMaterial.color, activeMaterial.doubleSided);
      return;
    }
    if (activeMaterial.source === 'painted' && activeMaterial.textureDataUrl) {
      applyTextureDataUrlToTargets(activeMaterial.textureDataUrl, activeMaterial.color, activeMaterial.doubleSided);
      return;
    }
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
      ctx.fillStyle = '#282c35';
      for (let y = 0; y < 256; y += tileSize) {
        for (let x = 0; x < 256; x += tileSize) {
          if (((x / tileSize) + (y / tileSize)) % 2 === 0) {
            ctx.fillRect(x, y, tileSize, tileSize);
          }
        }
      }
    } else if (activeMaterial.pattern === 'grid') {
      ctx.strokeStyle = '#e2e6ec';
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
      ctx.fillStyle = '#e2e6ec';
      const radius = Math.max(2, 6 / scale);
      for (let y = tileSize / 2; y < 256; y += tileSize) {
        for (let x = tileSize / 2; x < 256; x += tileSize) {
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (activeMaterial.pattern === 'stripes') {
      ctx.fillStyle = '#282c35';
      for (let x = 0; x < 256; x += tileSize * 2) {
        ctx.fillRect(x, 0, tileSize, 256);
      }
    }

    if (onApplyGradientToTexture) {
      onApplyGradientToTexture(canvas);
    }

    applyTextureDataUrlToTargets(
      activeMaterial.source === 'uv' ? materialTextureDataUrl(activeMaterial) : canvas.toDataURL('image/png'),
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
      color: activePalette.palette[0] || '#00b4c4',
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

  const applyGradientPreset = (presetId: string) => {
    const preset = GRADIENT_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setStops(preset.stops.map((s) => ({ ...s })));
    setSelectedStopId(preset.stops[0].id);
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
    setMaterialSlots((prev) => prev.map((material) => material.id === activeMaterial.id
      ? { ...material, source: 'painted', textureDataUrl: dataUrl }
      : material));
    setMesh((prev) => ({
      ...prev,
      materialId: activeMaterial.id,
      textureCanvasDataUrl: dataUrl,
      faces: prev.faces.map((face) => ({ ...face, materialId: activeMaterial.id })),
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
    setMaterialSlots((prev) => prev.map((material) => material.id === activeMaterial.id
      ? { ...material, source: 'painted', textureDataUrl: dataUrl }
      : material));
    setMesh((prev) => ({
      ...prev,
      materialId: activeMaterial.id,
      textureCanvasDataUrl: dataUrl,
      faces: prev.faces.map((face) => ({ ...face, materialId: activeMaterial.id })),
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
          aria-label="Bake and open in Pixel Paint"
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
              <button type="button" className="sp-mat__icon-btn" title="Duplicate" aria-label="Duplicate material" onClick={handleDuplicateActiveMaterial}>
                <Copy className="w-3 h-3" />
              </button>
              <button type="button" className="sp-mat__icon-btn is-accent" title="New material" aria-label="New material" onClick={handleCreateNewMaterial}>
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
              <span className="sp-mat__row-label">Source</span>
              <select
                className="sp-mat__select"
                value={activeMaterial.source}
                onChange={(e) => handleUpdateActiveMaterial('source', e.target.value as MaterialAsset['source'])}
              >
                <option value="color">Color only</option>
                <option value="uv">UV checker</option>
                <option value="painted">Painted texture</option>
              </select>
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
              Assign Material
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
                <span className="text-[#6e7584]">%</span>
                <input
                  type="color"
                  value={selectedStop?.color || '#e2e6ec'}
                  onChange={(e) => handleUpdateSelectedStop('color', e.target.value)}
                  className="sp-mat__color"
                  aria-label="Gradient stop color"
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

          <div className="sp-mat__presets">
            {GRADIENT_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="sp-mat__preset"
                title={`Load ${preset.name} gradient`}
                onClick={() => applyGradientPreset(preset.id)}
              >
                <span
                  className="sp-mat__preset-swatch"
                  style={{
                    background: `linear-gradient(90deg, ${preset.stops
                      .map((s) => `${s.color} ${s.position}%`)
                      .join(', ')})`,
                  }}
                />
                <span className="sp-mat__preset-name">{preset.name}</span>
              </button>
            ))}
          </div>

          <div className="sp-mat__actions">
            <button type="button" className="sp-mat__primary" onClick={handleApplyGradientToMesh}>
              <Sparkles className="w-3.5 h-3.5" />
              Apply Gradient
            </button>
            {onOpenPaintWorkspace && (
              <button
                type="button"
                className="sp-mat__secondary"
                title="Apply the gradient, then jump to Pixel Paint to refine it"
                onClick={() => handleEditGradientInPixelPaint(false)}
              >
                <Pencil className="w-3 h-3" />
                Edit in Paint
              </button>
            )}
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
