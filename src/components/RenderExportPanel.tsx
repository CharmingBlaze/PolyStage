import React from 'react';
import { Sparkles, Sun, Eye, Layers, Film, CloudRain } from 'lucide-react';
import type { RenderSettings, CADMesh, WeatherPreset } from '../types/cad';
import { exportToOBJ, downloadFile } from '../utils/exporters';
import { weatherPresetToEnv, createDefaultEnvironment } from '../utils/cutsceneEnv';

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
    <div className="flex flex-col h-full bg-[#1c1c1c] text-[#e0e0e0] font-sans text-xs select-none">
      <div className="h-8 bg-[#141414] border-b border-[#323232] px-3 flex items-center justify-between font-mono text-[10px] text-[#1473e6] font-bold">
        <span className="flex items-center gap-1.5 uppercase">
          <Sparkles className="w-3.5 h-3.5 text-[#1473e6]" />
          MODERN AAA GAME RENDER STUDIO
        </span>
        <span className="text-[#888888]">HIGH-DEF PBR ENGINE</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4 custom-scrollbar">
        <div className="cad-card p-2.5 space-y-3 border border-[#383838] bg-[#262626]">
          <span className="text-[9px] font-mono font-bold text-[#1473e6] uppercase tracking-wider block flex items-center gap-1">
            <Sun className="w-3 h-3 text-[#1473e6]" />
            HIGH-DEF LIGHTING & SOFT SHADOWS
          </span>

          <div className="space-y-2 font-mono text-[10px]">
            <div className="flex justify-between items-center text-[#888888]">
              <span>Directional Key Light:</span>
              <span className="text-[#1473e6] font-bold">{renderSettings.lightIntensity}x</span>
            </div>
            <input
              type="range"
              min="0.2"
              max="3.0"
              step="0.1"
              value={renderSettings.lightIntensity}
              onChange={(e) => setRenderSettings((s) => ({ ...s, lightIntensity: parseFloat(e.target.value) }))}
              className="w-full accent-[#1473e6] cursor-pointer"
            />

            <div className="flex justify-between items-center text-[#888888]">
              <span>Ambient Fill:</span>
              <span className="text-[#e68619] font-bold">{renderSettings.ambientIntensity}x</span>
            </div>
            <input
              type="range"
              min="0.1"
              max="2.0"
              step="0.1"
              value={renderSettings.ambientIntensity}
              onChange={(e) => setRenderSettings((s) => ({ ...s, ambientIntensity: parseFloat(e.target.value) }))}
              className="w-full accent-[#e68619] cursor-pointer"
            />

            <div className="flex justify-between items-center text-[#888888]">
              <span>Background</span>
              <input
                type="color"
                value={renderSettings.bgColor || '#161616'}
                onChange={(e) => setRenderSettings((s) => ({ ...s, bgColor: e.target.value }))}
                className="h-6 w-10 bg-transparent"
              />
            </div>
          </div>
        </div>

        <div className="cad-card p-2.5 space-y-2 border border-[#383838] bg-[#262626]">
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
                    : 'border-[#323232] text-[#b3b3b3] hover:border-[#2d9d78]'
                }`}
              >
                {w}
              </button>
            ))}
          </div>
          <div className="flex justify-between items-center text-[#888888] font-mono text-[10px]">
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

        <div className="cad-card p-2.5 space-y-3 border border-[#383838] bg-[#262626]">
          <span className="text-[9px] font-mono font-bold text-[#2d9d78] uppercase tracking-wider block flex items-center gap-1">
            <Eye className="w-3 h-3 text-[#2d9d78]" />
            POST FX
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setRenderSettings((s) => ({ ...s, bloom: !s.bloom }))}
              className={`flex-1 h-7 rounded border text-[9px] font-bold ${renderSettings.bloom ? 'border-[#1473e6] bg-[#1473e6]/20' : 'border-[#323232]'}`}
            >
              Bloom
            </button>
            <button
              type="button"
              onClick={() => setRenderSettings((s) => ({ ...s, ssao: !s.ssao }))}
              className={`flex-1 h-7 rounded border text-[9px] font-bold ${renderSettings.ssao ? 'border-[#e68619] bg-[#e68619]/20' : 'border-[#323232]'}`}
            >
              SSAO
            </button>
          </div>
        </div>

        <div className="cad-card p-2.5 space-y-3 border border-[#383838] bg-[#262626]">
          <span className="text-[9px] font-mono font-bold text-[#2680eb] uppercase tracking-wider block flex items-center gap-1">
            <Film className="w-3 h-3 text-[#2680eb]" />
            GAME TURNTABLE CAMERA SPIN
          </span>
          <button
            onClick={() => setRenderSettings((s) => ({ ...s, isTurntablePlaying: !s.isTurntablePlaying }))}
            className={`px-3 py-1.5 rounded font-mono text-[10px] font-bold w-full transition ${
              renderSettings.isTurntablePlaying ? 'bg-[#e68619] text-white' : 'bg-[#1473e6] text-white'
            }`}
          >
            {renderSettings.isTurntablePlaying ? 'PAUSE SPIN' : 'PLAY 360° SPIN'}
          </button>
        </div>

        <div className="cad-card p-2.5 space-y-2 border border-[#383838] bg-[#262626]">
          <span className="text-[9px] font-mono font-bold text-[#2680eb] uppercase tracking-wider block flex items-center gap-1">
            <Layers className="w-3 h-3 text-[#2680eb]" />
            MODERN ASSET EXPORT
          </span>

          <button
            onClick={onOpenSpriteSheetModal}
            className="w-full py-2 bg-[#1473e6] text-white font-bold rounded text-xs flex items-center justify-center gap-1.5"
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
            className="w-full py-2 bg-[#e68619] text-white font-bold rounded text-xs flex items-center justify-center gap-1.5"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>PARTICLE STUDIO</span>
          </button>

          <button
            onClick={handleExportOBJ}
            className="w-full py-2 cad-button font-bold text-[#1473e6] text-xs flex items-center justify-center gap-1.5"
          >
            <Sparkles className="w-3.5 h-3.5 text-[#1473e6]" />
            <span>EXPORT HIGH-DEF OBJ</span>
          </button>
        </div>
      </div>
    </div>
  );
};
