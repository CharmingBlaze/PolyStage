import React, { useEffect, useRef, useState } from 'react';
import { CloudRain, GripHorizontal, Minus, Maximize2, X } from 'lucide-react';
import type { EnvironmentSettings, WeatherPreset } from '../types/cad';
import { weatherPresetToEnv } from '../utils/cutsceneEnv';
import { SmoothSlider } from './SmoothSlider';

interface EnvironmentSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  environment: EnvironmentSettings;
  setEnvironment: React.Dispatch<React.SetStateAction<EnvironmentSettings>>;
}

export const EnvironmentSettingsModal: React.FC<EnvironmentSettingsModalProps> = ({
  isOpen,
  onClose,
  environment,
  setEnvironment,
}) => {
  const [minimized, setMinimized] = useState(false);
  const [position, setPosition] = useState({ x: 72, y: 96 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      setPosition({ x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y });
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

  const patch = (partial: Partial<EnvironmentSettings>) => {
    setEnvironment((prev) => ({ ...prev, ...partial }));
  };

  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <label className="flex items-center gap-2 text-[9px] text-[#8a8a8a]">
      <span className="w-16 shrink-0 uppercase tracking-wide">{label}</span>
      {children}
    </label>
  );

  return (
    <div
      className="absolute z-40 shadow-2xl rounded-lg border border-[#4d4d4d] bg-[#1a1a1a]/95 backdrop-blur-md font-mono text-[10px] text-[#cccccc] select-none"
      style={{ left: position.x, top: position.y, width: minimized ? 220 : 280 }}
    >
      <div
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          setDragging(true);
          dragStart.current = { x: e.clientX - position.x, y: e.clientY - position.y };
        }}
        className="h-7 px-2 flex items-center justify-between border-b border-[#333] bg-[#242424] cursor-grab active:cursor-grabbing rounded-t-lg"
      >
        <div className="flex items-center gap-1.5 font-bold text-[#6a9fd8]">
          <GripHorizontal className="w-3 h-3 text-[#666]" />
          <CloudRain className="w-3 h-3" />
          <span>ENVIRONMENT</span>
        </div>
        <div className="flex items-center gap-0.5">
          <button type="button" className="p-1 rounded hover:bg-[#4d4d4d] text-[#aaa]" onClick={() => setMinimized((v) => !v)}>
            {minimized ? <Maximize2 className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
          </button>
          <button type="button" className="p-1 rounded hover:bg-rose-900/40 text-[#aaa] hover:text-rose-400" onClick={onClose}>
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {!minimized && (
        <div className="p-2.5 space-y-2.5 max-h-[70vh] overflow-y-auto custom-scrollbar">
          <div className="grid grid-cols-3 gap-0.5">
            {(['clear', 'fog', 'rain', 'snow', 'storm', 'overcast'] as WeatherPreset[]).map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setEnvironment((prev) => weatherPresetToEnv(w, prev))}
                className={`h-6 rounded text-[9px] capitalize border ${
                  environment.weather === w
                    ? 'border-[#ed7300] bg-[#ed7300]/20 text-[#8ec5ff]'
                    : 'border-[#1a1a1a] text-[#888] hover:text-white'
                }`}
              >
                {w}
              </button>
            ))}
          </div>

          <div className="space-y-1.5">
            <div className="text-[8px] uppercase tracking-wider text-[#666]">Fog</div>
            <Row label="Density">
              <SmoothSlider min={0} max={0.12} step={0.001} value={environment.fogDensity}
                onChange={(fogDensity) => patch({ fogDensity })} />
            </Row>
            <Row label="Color">
              <input type="color" value={environment.fogColor} className="h-6 w-10 bg-transparent border-0"
                onChange={(e) => patch({ fogColor: e.target.value })} />
            </Row>
          </div>

          <div className="space-y-1.5">
            <div className="text-[8px] uppercase tracking-wider text-[#666]">Sun</div>
            <Row label="Elevation">
              <SmoothSlider min={-10} max={90} step={1} value={environment.sunElevation} accent="#e68619"
                onChange={(sunElevation) => patch({ sunElevation })} />
            </Row>
            <Row label="Azimuth">
              <SmoothSlider min={0} max={360} step={1} value={environment.sunAzimuth} accent="#e68619"
                onChange={(sunAzimuth) => patch({ sunAzimuth })} />
            </Row>
            <Row label="Color">
              <input type="color" value={environment.sunColor} className="h-6 w-10 bg-transparent border-0"
                onChange={(e) => patch({ sunColor: e.target.value })} />
            </Row>
          </div>

          <div className="space-y-1.5">
            <div className="text-[8px] uppercase tracking-wider text-[#666]">Sky / Ambient</div>
            <Row label="Top">
              <input type="color" value={environment.skyTopColor} className="h-6 w-10 bg-transparent border-0"
                onChange={(e) => patch({ skyTopColor: e.target.value })} />
            </Row>
            <Row label="Horizon">
              <input type="color" value={environment.skyHorizonColor} className="h-6 w-10 bg-transparent border-0"
                onChange={(e) => patch({ skyHorizonColor: e.target.value })} />
            </Row>
            <Row label="Ambient">
              <input type="color" value={environment.ambientColor} className="h-6 w-10 bg-transparent border-0"
                onChange={(e) => patch({ ambientColor: e.target.value })} />
            </Row>
            <div className="grid grid-cols-2 gap-1">
              <button
                type="button"
                className={`h-6 rounded text-[9px] border ${
                  environment.backgroundMode !== 'solid'
                    ? 'border-[#ed7300] bg-[#ed7300]/20 text-[#8ec5ff]'
                    : 'border-[#1a1a1a] text-[#888] hover:text-white'
                }`}
                onClick={() => patch({ backgroundMode: 'sky' })}
              >
                Sky BG
              </button>
              <button
                type="button"
                className={`h-6 rounded text-[9px] border ${
                  environment.backgroundMode === 'solid'
                    ? 'border-[#ed7300] bg-[#ed7300]/20 text-[#8ec5ff]'
                    : 'border-[#1a1a1a] text-[#888] hover:text-white'
                }`}
                onClick={() => patch({ backgroundMode: 'solid', backgroundColor: environment.backgroundColor || '#000000' })}
              >
                Solid BG
              </button>
            </div>
            {environment.backgroundMode === 'solid' && (
              <Row label="BG Color">
                <input type="color" value={environment.backgroundColor || '#000000'} className="h-6 w-10 bg-transparent border-0"
                  onChange={(e) => patch({ backgroundMode: 'solid', backgroundColor: e.target.value })} />
              </Row>
            )}
            <Row label="Wind">
              <SmoothSlider min={0} max={4} step={0.05} value={environment.windStrength} accent="#6a9fd8"
                onChange={(windStrength) => patch({ windStrength })} />
            </Row>
          </div>
        </div>
      )}
    </div>
  );
};
