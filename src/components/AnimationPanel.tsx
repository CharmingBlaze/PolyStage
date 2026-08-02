import React, { useState, useEffect } from 'react';
import { Play, Pause, Film, Clock, RotateCcw } from 'lucide-react';
import type { CADMesh } from '../types/cad';
import type { AnimationClip, Keyframe } from '../utils/blockbenchCore';
import { sampleAnimationKeyframe } from '../utils/blockbenchCore';

interface AnimationPanelProps {
  meshes: CADMesh[];
  setMeshes: React.Dispatch<React.SetStateAction<CADMesh[]>>;
}

export const AnimationPanel: React.FC<AnimationPanelProps> = ({ meshes, setMeshes }) => {
  const [clips, setClips] = useState<AnimationClip[]>([
    {
      id: 'clip_idle',
      name: 'Idle Loop',
      fps: 12,
      duration: 2.0,
      keyframes: [
        { id: '1', time: 0.0, position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
        { id: '2', time: 1.0, position: { x: 0, y: 0.3, z: 0 }, rotation: { x: 0, y: 0.2, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
        { id: '3', time: 2.0, position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      ],
    },
  ]);

  const [activeClipId, setActiveClipId] = useState<string>(clips[0].id);
  const activeClip = clips.find((c) => c.id === activeClipId) || clips[0];

  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);

  useEffect(() => {
    let intervalId: any;
    if (isPlaying) {
      const stepTime = 1 / activeClip.fps;
      intervalId = setInterval(() => {
        setCurrentTime((prev) => {
          const next = prev + stepTime;
          if (next > activeClip.duration) {
            return 0;
          }
          return next;
        });
      }, 1000 / activeClip.fps);
    }
    return () => clearInterval(intervalId);
  }, [isPlaying, activeClip.fps, activeClip.duration]);

  useEffect(() => {
    if (!isPlaying) return;

    setMeshes((prevMeshes) =>
      prevMeshes.map((m) => {
        if (activeClip.keyframes.length > 0) {
          const sampledPos = sampleAnimationKeyframe(activeClip.keyframes, currentTime);
          return {
            ...m,
            position: sampledPos,
          };
        }
        return m;
      })
    );
  }, [currentTime, isPlaying, activeClipId]);

  const handleCreateClip = () => {
    const newClip: AnimationClip = {
      id: `clip_${Date.now()}`,
      name: `Clip ${clips.length + 1}`,
      fps: 12,
      duration: 2.0,
      keyframes: [
        { id: '1', time: 0.0, position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      ],
    };
    setClips((prev) => [...prev, newClip]);
    setActiveClipId(newClip.id);
  };

  const handleAddKeyframe = () => {
    const activeMesh = meshes[0];
    if (!activeMesh) return;

    const newKf: Keyframe = {
      id: Math.random().toString(36).substring(2, 9),
      time: currentTime,
      position: { ...activeMesh.position },
      rotation: { ...activeMesh.rotation },
      scale: { ...activeMesh.scale },
    };

    setClips((prev) =>
      prev.map((c) => {
        if (c.id === activeClipId) {
          const filtered = c.keyframes.filter((k) => Math.abs(k.time - currentTime) > 0.05);
          return {
            ...c,
            keyframes: [...filtered, newKf].sort((a, b) => a.time - b.time),
          };
        }
        return c;
      })
    );
  };

  return (
    <div className="flex flex-col h-full bg-[#26282d] text-[#eaedf1] font-sans text-xs select-none p-2 space-y-3">
      <div className="flex items-center justify-between">
        <span className="font-bold font-mono text-[#ed7300] text-xs uppercase flex items-center gap-1.5">
          <Film className="w-4 h-4 text-[#ed7300]" />
          KEYFRAME TIMELINE
        </span>
        <button onClick={handleCreateClip} className="px-2 py-0.5 cad-button text-[10px] text-[#ed7300] font-bold">
          + New Clip
        </button>
      </div>

      <div className="cad-card p-2 space-y-2">
        <label className="block text-[10px] font-mono text-[#858a93]">Active Clip</label>
        <select
          value={activeClipId}
          onChange={(e) => {
            setActiveClipId(e.target.value);
            setCurrentTime(0);
          }}
          className="w-full cad-input p-1 font-mono text-xs text-[#ed7300]"
        >
          {clips.map((clip) => (
            <option key={clip.id} value={clip.id} className="bg-[#26282d]">
              {clip.name} ({clip.duration}s)
            </option>
          ))}
        </select>
      </div>

      <div className="cad-card p-2 space-y-2">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className={`px-3 py-1 cad-button flex items-center gap-1 font-mono font-bold ${
              isPlaying ? 'cad-button-active' : 'text-[#ed7300]'
            }`}
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            <span>{isPlaying ? 'PAUSE' : 'PLAY'}</span>
          </button>

          <button onClick={() => setCurrentTime(0)} className="p-1 cad-button" title="Reset Time">
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          <button onClick={handleAddKeyframe} className="px-2 py-1 cad-button text-[10px] text-[#e68619] font-bold">
            + Keyframe
          </button>
        </div>

        <div className="flex items-center gap-2 cad-input p-1.5">
          <Clock className="w-3.5 h-3.5 text-[#ed7300]" />
          <input
            type="range"
            min={0}
            max={activeClip.duration}
            step={0.05}
            value={currentTime}
            onChange={(e) => setCurrentTime(parseFloat(e.target.value))}
            className="flex-1 accent-[#ed7300] cursor-pointer h-2"
          />
          <span className="font-mono text-xs text-[#ed7300] font-bold min-w-[36px]">
            {currentTime.toFixed(2)}s
          </span>
        </div>
      </div>
    </div>
  );
};
