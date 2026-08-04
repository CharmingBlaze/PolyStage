import React from 'react';
import { Camera, Play, Pause } from 'lucide-react';

export interface CutsceneViewportToolbarProps {
  cameraView: boolean;
  setCameraView: (val: boolean | ((prev: boolean) => boolean)) => void;
  gizmoMode: 'translate' | 'rotate' | 'scale';
  setGizmoMode: (mode: 'translate' | 'rotate' | 'scale') => void;
  isPlaying: boolean;
  togglePlayback: () => void;
  playheadFrame: number;
  totalFrames: number;
  fps: number;
}

export const CutsceneViewportToolbar: React.FC<CutsceneViewportToolbarProps> = ({
  cameraView,
  setCameraView,
  gizmoMode,
  setGizmoMode,
  isPlaying,
  togglePlayback,
  playheadFrame,
  totalFrames,
  fps,
}) => {
  return (
    <div className="h-8 px-3 bg-[#1e2024] border-b border-[#2e3136] flex items-center justify-between text-[11px] font-mono text-[#8c919b]">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setCameraView((v) => !v)}
          className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold ${
            cameraView ? 'bg-[#ed7300] text-white' : 'bg-[#282b30] text-[#9ca3af] hover:bg-[#34383f]'
          }`}
        >
          <Camera size={12} />
          {cameraView ? 'Active Camera' : 'Free Camera'}
        </button>

        <div className="h-3 w-px bg-[#3b3f46]" />

        <div className="flex items-center gap-0.5 bg-[#282b30] p-0.5 rounded">
          <button
            type="button"
            onClick={() => setGizmoMode('translate')}
            className={`px-2 py-0.5 text-[9px] font-bold rounded ${
              gizmoMode === 'translate' ? 'bg-[#ed7300] text-white' : 'text-[#8c919b] hover:text-white'
            }`}
          >
            Move (G)
          </button>
          <button
            type="button"
            onClick={() => setGizmoMode('rotate')}
            className={`px-2 py-0.5 text-[9px] font-bold rounded ${
              gizmoMode === 'rotate' ? 'bg-[#ed7300] text-white' : 'text-[#8c919b] hover:text-white'
            }`}
          >
            Rotate (R)
          </button>
          <button
            type="button"
            onClick={() => setGizmoMode('scale')}
            className={`px-2 py-0.5 text-[9px] font-bold rounded ${
              gizmoMode === 'scale' ? 'bg-[#ed7300] text-white' : 'text-[#8c919b] hover:text-white'
            }`}
          >
            Scale (S)
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={togglePlayback}
          className="flex items-center gap-1 px-2.5 py-0.5 bg-[#ed7300] hover:bg-[#ff8412] text-white font-bold rounded text-[10px]"
        >
          {isPlaying ? <Pause size={12} /> : <Play size={12} />}
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        <span className="text-[10px] text-[#717680]">
          Frame <span className="text-white font-bold">{playheadFrame}</span> / {totalFrames} ({fps} fps)
        </span>
      </div>
    </div>
  );
};
