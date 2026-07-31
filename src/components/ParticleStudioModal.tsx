import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { applyStandardOrbitMouseButtons, bindBlockbenchOrbitModifiers } from '../utils/viewportNav';
import { Download, Sparkles, X, Play, Pause } from 'lucide-react';
import type { ParticleEmitter } from '../types/cad';
import { createParticleEmitter, createParticleFromPreset, exportParticleGameJson, PARTICLE_PRESETS } from '../utils/cutsceneEnv';
import { ParticleSystem } from '../utils/particles';
import { downloadFile } from '../utils/exporters';

interface ParticleStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  emitter?: ParticleEmitter | null;
  onSave: (emitter: ParticleEmitter) => void;
}

export const ParticleStudioModal: React.FC<ParticleStudioModalProps> = ({
  isOpen,
  onClose,
  emitter,
  onSave,
}) => {
  const [draft, setDraft] = useState<ParticleEmitter>(() => emitter || createParticleEmitter('Spark'));
  const [playing, setPlaying] = useState(true);
  const mountRef = useRef<HTMLDivElement>(null);
  const systemRef = useRef<ParticleSystem | null>(null);

  useEffect(() => {
    if (emitter) setDraft(emitter);
    else setDraft(createParticleEmitter('Spark'));
  }, [emitter, isOpen]);

  useEffect(() => {
    if (!isOpen || !mountRef.current) return;
    const width = mountRef.current.clientWidth;
    const height = mountRef.current.clientHeight;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0e1218');
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(2.5, 2, 3.5);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    mountRef.current.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    applyStandardOrbitMouseButtons(controls);
    const unbindNavMods = bindBlockbenchOrbitModifiers(controls, renderer.domElement);
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const grid = new THREE.GridHelper(4, 8, 0x2680eb, 0x2a3140);
    scene.add(grid);

    const system = new ParticleSystem(draft);
    systemRef.current = system;
    scene.add(system.group);

    let raf = 0;
    let last = performance.now();
    let live = true;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      controls.update();
      if (playing && systemRef.current) systemRef.current.update(dt);
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(tick);

    const onResize = () => {
      if (!mountRef.current) return;
      const w = mountRef.current.clientWidth;
      const h = mountRef.current.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    return () => {
      live = false;
      void live;
      unbindNavMods();
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      system.dispose();
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    };
  }, [isOpen]);

  useEffect(() => {
    systemRef.current?.updateEmitter(draft);
  }, [draft]);

  if (!isOpen) return null;

  const patch = (partial: Partial<ParticleEmitter>) => setDraft((d) => ({ ...d, ...partial }));

  return (
    <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 font-sans">
      <div className="w-full max-w-5xl h-[80vh] bg-[#333333] border border-[#4d4d4d] rounded-lg shadow-2xl flex flex-col overflow-hidden">
        <div className="h-10 px-3 border-b border-[#4d4d4d] flex items-center justify-between bg-[#262626]">
          <div className="flex items-center gap-2 text-[#e68619] font-mono text-xs font-bold uppercase">
            <Sparkles className="w-4 h-4" />
            Particle Studio (Game Export)
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="cad-button h-7 px-2 text-[#ed7300] text-[10px] font-bold flex items-center gap-1"
              onClick={() => downloadFile(`${draft.identifier.replace(':', '_')}.particle.json`, exportParticleGameJson(draft), 'application/json')}
            >
              <Download className="w-3.5 h-3.5" /> Export JSON
            </button>
            <button type="button" className="cad-button h-7 px-2 text-[#2d9d78] text-[10px] font-bold" onClick={() => { onSave(draft); onClose(); }}>
              Save to Scene
            </button>
            <button type="button" className="p-1.5 hover:bg-[#404040] rounded" onClick={onClose}>
              <X className="w-4 h-4 text-[#8c8c8c]" />
            </button>
          </div>
        </div>

        <div className="flex-1 flex min-h-0">
          <div className="w-72 border-r border-[#4d4d4d] overflow-y-auto p-3 space-y-3 text-[10px] font-mono custom-scrollbar">
            <div className="space-y-1">
              <span className="text-[#8c8c8c] uppercase">Presets</span>
              <div className="grid grid-cols-2 gap-1">
                {PARTICLE_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    title={preset.hint}
                    className="h-7 rounded border border-[#4d4d4d] hover:border-[#e68619] text-[9px] font-bold"
                    onClick={() => {
                      const next = createParticleFromPreset(preset.id);
                      setDraft({
                        ...next,
                        id: draft.id,
                        position: draft.position,
                        rotation: draft.rotation,
                      });
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
            <label className="block space-y-1">
              <span className="text-[#8c8c8c] uppercase">Name</span>
              <input className="cad-input w-full h-7 px-2" value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
            </label>
            <label className="block space-y-1">
              <span className="text-[#8c8c8c] uppercase">Identifier</span>
              <input className="cad-input w-full h-7 px-2" value={draft.identifier} onChange={(e) => patch({ identifier: e.target.value })} />
            </label>
            <label className="block space-y-1">
              <span className="text-[#8c8c8c] uppercase">Shape</span>
              <select className="cad-input w-full h-7 px-1" value={draft.shape} onChange={(e) => patch({ shape: e.target.value as ParticleEmitter['shape'] })}>
                <option value="point">Point</option>
                <option value="box">Box</option>
                <option value="sphere">Sphere</option>
                <option value="disc">Disc</option>
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-[#8c8c8c] uppercase">Rate ({draft.rate}/s)</span>
              <input type="range" min={1} max={200} value={draft.rate} onChange={(e) => patch({ rate: Number(e.target.value) })} className="w-full accent-[#e68619]" />
            </label>
            <label className="block space-y-1">
              <span className="text-[#8c8c8c] uppercase">Lifetime ({draft.lifetime.toFixed(2)}s)</span>
              <input type="range" min={0.1} max={5} step={0.05} value={draft.lifetime} onChange={(e) => patch({ lifetime: Number(e.target.value) })} className="w-full accent-[#ed7300]" />
            </label>
            <label className="block space-y-1">
              <span className="text-[#8c8c8c] uppercase">Speed ({draft.startSpeed.toFixed(2)})</span>
              <input type="range" min={0} max={8} step={0.1} value={draft.startSpeed} onChange={(e) => patch({ startSpeed: Number(e.target.value) })} className="w-full accent-[#ed7300]" />
            </label>
            <label className="block space-y-1">
              <span className="text-[#8c8c8c] uppercase">Start Size</span>
              <input type="range" min={0.02} max={0.5} step={0.01} value={draft.startSize} onChange={(e) => patch({ startSize: Number(e.target.value) })} className="w-full accent-[#2d9d78]" />
            </label>
            <label className="block space-y-1">
              <span className="text-[#8c8c8c] uppercase">End Size</span>
              <input type="range" min={0} max={0.5} step={0.01} value={draft.endSize} onChange={(e) => patch({ endSize: Number(e.target.value) })} className="w-full accent-[#2d9d78]" />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block space-y-1">
                <span className="text-[#8c8c8c] uppercase">Start Color</span>
                <input type="color" className="w-full h-7 bg-transparent" value={draft.startColor} onChange={(e) => patch({ startColor: e.target.value })} />
              </label>
              <label className="block space-y-1">
                <span className="text-[#8c8c8c] uppercase">End Color</span>
                <input type="color" className="w-full h-7 bg-transparent" value={draft.endColor} onChange={(e) => patch({ endColor: e.target.value })} />
              </label>
            </div>
            <label className="block space-y-1">
              <span className="text-[#8c8c8c] uppercase">Gravity Y ({draft.gravity.y.toFixed(1)})</span>
              <input type="range" min={-10} max={5} step={0.1} value={draft.gravity.y} onChange={(e) => patch({ gravity: { ...draft.gravity, y: Number(e.target.value) } })} className="w-full accent-[#ec5b62]" />
            </label>
            <label className="flex items-center gap-2 text-[#b3b3b3]">
              <input type="checkbox" checked={draft.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
              Enabled
            </label>
          </div>

          <div className="flex-1 relative bg-[#0e1218]">
            <div ref={mountRef} className="absolute inset-0" />
            <button
              type="button"
              className="absolute top-3 left-3 cad-button h-8 px-2 text-white flex items-center gap-1 z-10"
              onClick={() => setPlaying((p) => !p)}
            >
              {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              {playing ? 'Pause' : 'Play'}
            </button>
            <div className="absolute bottom-3 left-3 text-[9px] font-mono text-[#8c8c8c] bg-[#3a3a3a]/80 px-2 py-1 rounded border border-[#4d4d4d]">
              Snowstorm-style preview · exports engine-agnostic .particle.json
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
