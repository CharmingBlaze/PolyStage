import { Sparkles, Sun, Eye, Layers, Film, CloudRain, Box, Camera, RotateCcw } from 'lucide-react';
import type { RenderSettings, CADMesh, WeatherPreset } from '../types/cad';
import { exportToOBJ, downloadFile } from '../utils/exporters';
import { weatherPresetToEnv, createDefaultEnvironment } from '../utils/cutsceneEnv';
import { SHADOW_QUALITY, type ShadowMapAlgorithm, type ShadowQualityLevel } from '../utils/shadowQuality';

interface RenderExportPanelProps {
  renderSettings: RenderSettings;
  setRenderSettings: React.Dispatch<React.SetStateAction<RenderSettings>>;
  mesh: CADMesh;
  setMesh: (updater: CADMesh | ((prev: CADMesh) => CADMesh)) => void;
  onOpenSpriteSheetModal: () => void;
  onExportGLB?: () => void;
  onOpenParticleStudio?: () => void;
}

export const RenderExportPanel: React.FC<RenderExportPanelProps> = ({
  renderSettings,
  setRenderSettings,
  mesh,
  onOpenSpriteSheetModal,
  onExportGLB,
  onOpenParticleStudio,
}) => {
  const handleExportOBJ = () => {
    const { obj, mtl } = exportToOBJ(mesh);
    downloadFile(`${mesh.name.toLowerCase().replace(/\s+/g, '_')}.obj`, obj, 'text/plain');
    downloadFile(`${mesh.name.toLowerCase().replace(/\s+/g, '_')}.mtl`, mtl, 'text/plain');
  };

  const applyWeather = (weather: WeatherPreset) => {
    const env = weatherPresetToEnv(weather, createDefaultEnvironment());
    setRenderSettings((s) => ({
      ...s,
      weather,
      fogDensity: env.fogDensity,
      fogColor: env.fogColor,
      sunElevation: env.sunElevation,
      sunAzimuth: env.sunAzimuth,
      bgColor: env.skyTopColor,
      lightIntensity: weather === 'storm' ? 0.7 : weather === 'overcast' ? 0.9 : s.lightIntensity,
      ambientIntensity: weather === 'fog' ? 1.1 : s.ambientIntensity,
    }));
  };

  return (
    <div className="flex flex-col h-full bg-[#1c1f26] text-[#e0e0e0] font-sans text-xs select-none">
      <div className="h-8 bg-[#16191e] border-b border-[#3a3f4a] px-3 flex items-center justify-between font-mono text-[10px] text-[#00b4c4] font-bold">
        <span className="flex items-center gap-1.5 uppercase">
          <Sparkles className="w-3.5 h-3.5 text-[#00b4c4]" />
          MODERN AAA GAME RENDER STUDIO
        </span>
        <span className="text-[#7e838c]">HIGH-DEF PBR ENGINE</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4 custom-scrollbar">
        <div className="cad-card p-2.5 space-y-3 border border-[#3a3f4a] bg-[#16191e]">
          <span className="text-[9px] font-mono font-bold text-[#00b4c4] uppercase tracking-wider block flex items-center gap-1">
            <Sun className="w-3 h-3 text-[#00b4c4]" />
            HIGH-DEF LIGHTING & SOFT SHADOWS
          </span>

          <div className="space-y-2 font-mono text-[10px]">
            <div className="flex justify-between items-center text-[#7e838c]">
              <span>Directional Key Light:</span>
              <span className="text-[#00b4c4] font-bold">{renderSettings.lightIntensity}x</span>
            </div>
            <input
              type="range"
              min="0.2"
              max="3.0"
              step="0.1"
              value={renderSettings.lightIntensity}
              onChange={(e) => setRenderSettings((s) => ({ ...s, lightIntensity: parseFloat(e.target.value) }))}
              className="w-full accent-[#00b4c4] cursor-pointer"
            />

            <div className="flex justify-between items-center text-[#7e838c]">
              <span>Ambient Fill:</span>
              <span className="text-[#00b4c4] font-bold">{renderSettings.ambientIntensity}x</span>
            </div>
            <input
              type="range"
              min="0.1"
              max="2.0"
              step="0.1"
              value={renderSettings.ambientIntensity}
              onChange={(e) => setRenderSettings((s) => ({ ...s, ambientIntensity: parseFloat(e.target.value) }))}
              className="w-full accent-[#00b4c4] cursor-pointer"
            />

            <div className="flex justify-between items-center text-[#7e838c]">
              <span>Background</span>
              <input
                type="color"
                value={renderSettings.bgColor || '#16191e'}
                onChange={(e) => setRenderSettings((s) => ({ ...s, bgColor: e.target.value }))}
                className="h-6 w-10 bg-transparent"
              />
            </div>
          </div>
        </div>

        {/* ── THREE.JS SHADOW SYSTEM CONTROLS ───────────────────── */}
        <div className="cad-card p-2.5 space-y-3 border border-[#3a3f4a] bg-[#16191e]">
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-mono font-bold text-[#00b4c4] uppercase tracking-wider flex items-center gap-1">
              <Box className="w-3 h-3 text-[#00b4c4]" />
              SHADOW SYSTEM (THREE.JS)
            </span>
            <span className="text-[9px] font-mono text-[#7e838c]">
              {renderSettings.shadowMapType ?? 'pcf-soft'}
            </span>
          </div>

          {/* Algorithm Toggle (PCFSoft vs PCF vs Basic vs VSM vs Off) */}
          <div className="space-y-1.5 font-mono text-[10px]">
            <span className="text-[#7e838c] text-[9px]">Shadow Map Algorithm:</span>
            <div className="grid grid-cols-3 gap-1">
              {(
                [
                  { id: 'pcf-soft', label: 'PCF Soft', note: 'Recommended' },
                  { id: 'pcf', label: 'PCF Std', note: 'Default' },
                  { id: 'basic', label: 'Basic', note: 'High Perf' },
                  { id: 'vsm', label: 'VSM', note: 'Variance' },
                  { id: 'off', label: 'Disabled', note: 'No Shadows' },
                ] as const
              ).map((mode) => {
                const active = (renderSettings.shadowMapType ?? 'pcf-soft') === mode.id;
                return (
                  <button
                    key={mode.id}
                    type="button"
                    title={`${mode.label} (${mode.note})`}
                    onClick={() =>
                      setRenderSettings((s) => ({
                        ...s,
                        shadowMapType: mode.id as ShadowMapAlgorithm,
                      }))
                    }
                    className={`h-8 px-1 rounded border text-[9px] font-bold flex flex-col items-center justify-center transition-colors ${
                      active
                        ? 'border-[#00b4c4] bg-[#00b4c4]/20 text-white'
                        : 'border-[#3a3f4a] text-[#8e949f] hover:border-[#00b4c4]/60'
                    }`}
                  >
                    <span>{mode.label}</span>
                    <span className="text-[7.5px] opacity-75 font-normal">{mode.note}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Resolution Preset */}
          {renderSettings.shadowMapType !== 'off' && (
            <div className="space-y-1.5 font-mono text-[10px]">
              <div className="flex justify-between items-center text-[#7e838c]">
                <span className="text-[9px]">Map Resolution:</span>
                <span className="text-[#00b4c4] font-bold">
                  {SHADOW_QUALITY[renderSettings.shadowQuality ?? 'standard'].mapSize}px
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1">
                {(
                  [
                    { id: 'draft', label: '1024 (Draft)' },
                    { id: 'standard', label: '2048 (Std)' },
                    { id: 'high', label: '4096 (Cinematic)' },
                  ] as const
                ).map((res) => {
                  const active = (renderSettings.shadowQuality ?? 'standard') === res.id;
                  return (
                    <button
                      key={res.id}
                      type="button"
                      onClick={() =>
                        setRenderSettings((s) => ({
                          ...s,
                          shadowQuality: res.id as ShadowQualityLevel,
                        }))
                      }
                      className={`h-7 rounded border text-[9px] font-bold transition-colors ${
                        active
                          ? 'border-[#00b4c4] bg-[#00b4c4]/20 text-white'
                          : 'border-[#3a3f4a] text-[#8e949f] hover:border-[#00b4c4]/60'
                      }`}
                    >
                      {res.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Dynamic Scene Auto-Fit & Shadow Camera Frustum Helper */}
          {renderSettings.shadowMapType !== 'off' && (
            <div className="space-y-2 pt-1 border-t border-[#262b33] font-mono text-[10px]">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setRenderSettings((s) => ({
                      ...s,
                      shadowAutoFit: s.shadowAutoFit === false ? true : false,
                    }))
                  }
                  className={`flex-1 h-7 rounded border text-[8.5px] font-bold flex items-center justify-center gap-1 transition-colors ${
                    renderSettings.shadowAutoFit !== false
                      ? 'border-[#00b4c4] bg-[#00b4c4]/20 text-white'
                      : 'border-[#3a3f4a] text-[#8e949f]'
                  }`}
                  title="Dynamically size shadow frustum camera bounds to scene bounding box"
                >
                  <Box className="w-2.5 h-2.5" />
                  Auto-Fit Bounds
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setRenderSettings((s) => ({
                      ...s,
                      showShadowHelper: !s.showShadowHelper,
                    }))
                  }
                  className={`flex-1 h-7 rounded border text-[8.5px] font-bold flex items-center justify-center gap-1 transition-colors ${
                    renderSettings.showShadowHelper
                      ? 'border-[#ed7300] bg-[#ed7300]/20 text-[#ed7300]'
                      : 'border-[#3a3f4a] text-[#8e949f]'
                  }`}
                  title="Visualize Three.js CameraHelper wireframe box around shadows"
                >
                  <Camera className="w-2.5 h-2.5" />
                  Frustum Box
                </button>
              </div>

              {/* Bias Controls for Shadow Acne Prevention */}
              <div className="space-y-2 pt-1">
                <div className="flex justify-between items-center text-[#7e838c]">
                  <span>Shadow Bias (Acne Fix):</span>
                  <span className="text-[#00b4c4] font-bold">
                    {(renderSettings.shadowBias ?? -0.0001).toFixed(5)}
                  </span>
                </div>
                <input
                  type="range"
                  min="-0.001"
                  max="0.0001"
                  step="0.00005"
                  value={renderSettings.shadowBias ?? -0.0001}
                  onChange={(e) =>
                    setRenderSettings((s) => ({
                      ...s,
                      shadowBias: parseFloat(e.target.value),
                    }))
                  }
                  className="w-full accent-[#00b4c4] cursor-pointer"
                />

                <div className="flex justify-between items-center text-[#7e838c]">
                  <span>Normal Bias:</span>
                  <span className="text-[#00b4c4] font-bold">
                    {(renderSettings.shadowNormalBias ?? 0.02).toFixed(3)}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="0.08"
                  step="0.002"
                  value={renderSettings.shadowNormalBias ?? 0.02}
                  onChange={(e) =>
                    setRenderSettings((s) => ({
                      ...s,
                      shadowNormalBias: parseFloat(e.target.value),
                    }))
                  }
                  className="w-full accent-[#00b4c4] cursor-pointer"
                />

                <button
                  type="button"
                  onClick={() =>
                    setRenderSettings((s) => ({
                      ...s,
                      shadowBias: -0.0001,
                      shadowNormalBias: 0.02,
                    }))
                  }
                  className="w-full h-6 rounded border border-[#3a3f4a] text-[#8e949f] hover:text-white hover:border-[#00b4c4] text-[8.5px] font-bold flex items-center justify-center gap-1 transition-colors"
                >
                  <RotateCcw className="w-2.5 h-2.5" />
                  Reset Recommended Biases
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="cad-card p-2.5 space-y-2 border border-[#3a3f4a] bg-[#16191e]">
          <span className="text-[9px] font-mono font-bold text-[#2d9d78] uppercase tracking-wider flex items-center gap-1">
            <CloudRain className="w-3 h-3" /> Weather & Atmosphere
          </span>
          <div className="grid grid-cols-3 gap-1">
            {(['clear', 'fog', 'rain', 'snow', 'storm', 'overcast'] as WeatherPreset[]).map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => applyWeather(w)}
                className={`h-7 rounded border capitalize text-[9px] font-bold ${
                  renderSettings.weather === w
                    ? 'border-[#2d9d78] bg-[#2d9d78]/25 text-white'
                    : 'border-[#3a3f4a] text-[#a6abb4] hover:border-[#2d9d78]'
                }`}
              >
                {w}
              </button>
            ))}
          </div>
          <div className="flex justify-between items-center text-[#7e838c] font-mono text-[10px]">
            <span>Fog density</span>
            <span>{(renderSettings.fogDensity || 0).toFixed(3)}</span>
          </div>
          <input
            type="range"
            min="0"
            max="0.12"
            step="0.002"
            value={renderSettings.fogDensity || 0}
            onChange={(e) => setRenderSettings((s) => ({ ...s, fogDensity: parseFloat(e.target.value) }))}
            className="w-full accent-[#2d9d78]"
          />
        </div>

        <div className="cad-card p-2.5 space-y-3 border border-[#3a3f4a] bg-[#16191e]">
          <span className="text-[9px] font-mono font-bold text-[#2d9d78] uppercase tracking-wider block flex items-center gap-1">
            <Eye className="w-3 h-3 text-[#2d9d78]" />
            POST FX
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setRenderSettings((s) => ({ ...s, bloom: !s.bloom }))}
              className={`flex-1 h-7 rounded border text-[9px] font-bold ${renderSettings.bloom ? 'border-[#00b4c4] bg-[#00b4c4]/20' : 'border-[#3a3f4a]'}`}
            >
              Bloom
            </button>
            <button
              type="button"
              onClick={() => setRenderSettings((s) => ({ ...s, ssao: !s.ssao }))}
              className={`flex-1 h-7 rounded border text-[9px] font-bold ${renderSettings.ssao ? 'border-[#00b4c4] bg-[#00b4c4]/20' : 'border-[#3a3f4a]'}`}
            >
              SSAO
            </button>
          </div>
        </div>

        <div className="cad-card p-2.5 space-y-3 border border-[#3a3f4a] bg-[#16191e]">
          <span className="text-[9px] font-mono font-bold text-[#00b4c4] uppercase tracking-wider block flex items-center gap-1">
            <Film className="w-3 h-3 text-[#00b4c4]" />
            GAME TURNTABLE CAMERA SPIN
          </span>
          <button
            onClick={() => setRenderSettings((s) => ({ ...s, isTurntablePlaying: !s.isTurntablePlaying }))}
            className={`px-3 py-1.5 rounded font-mono text-[10px] font-bold w-full transition ${
              renderSettings.isTurntablePlaying ? 'bg-[#00b4c4] text-white' : 'bg-[#00b4c4] text-white'
            }`}
          >
            {renderSettings.isTurntablePlaying ? 'PAUSE SPIN' : 'PLAY 360° SPIN'}
          </button>
        </div>

        <div className="cad-card p-2.5 space-y-2 border border-[#3a3f4a] bg-[#16191e]">
          <span className="text-[9px] font-mono font-bold text-[#00b4c4] uppercase tracking-wider block flex items-center gap-1">
            <Layers className="w-3 h-3 text-[#00b4c4]" />
            MODERN ASSET EXPORT
          </span>

          <button
            onClick={onOpenSpriteSheetModal}
            className="w-full py-2 bg-[#00b4c4] text-white font-bold rounded text-xs flex items-center justify-center gap-1.5"
          >
            <Film className="w-3.5 h-3.5" />
            <span>EXPORT RENDER SEQUENCE</span>
          </button>

          <button
            onClick={() => onExportGLB?.()}
            className="w-full py-2 bg-[#2d9d78] text-white font-bold rounded text-xs flex items-center justify-center gap-1.5"
          >
            <Layers className="w-3.5 h-3.5" />
            <span>EXPORT GLB (RIG + CLIPS)</span>
          </button>

          <button
            onClick={() => onOpenParticleStudio?.()}
            className="w-full py-2 bg-[#00b4c4] text-white font-bold rounded text-xs flex items-center justify-center gap-1.5"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>PARTICLE STUDIO</span>
          </button>

          <button
            onClick={handleExportOBJ}
            className="w-full py-2 cad-button font-bold text-[#00b4c4] text-xs flex items-center justify-center gap-1.5"
          >
            <Sparkles className="w-3.5 h-3.5 text-[#00b4c4]" />
            <span>EXPORT HIGH-DEF OBJ</span>
          </button>
        </div>
      </div>
    </div>
  );
};
