import React from 'react';
import { ArrowDown, ArrowUp, Check, Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import type { CADMesh, MeshModifier, MirrorAxis } from '../types/cad';
import {
  createMirrorModifier,
  createSubdivisionModifier,
  evaluateMeshModifiers,
} from '../utils/mirrorModeling';

interface ModifierStackPanelProps {
  mesh: CADMesh;
  setMesh: (updater: CADMesh | ((prev: CADMesh) => CADMesh)) => void;
}

const AXES: MirrorAxis[] = ['x', 'y', 'z'];

/**
 * Blender-style modifier stack: ordered, toggleable, re-orderable, and each row
 * can be baked ("Apply") on its own.  Evaluation order is top to bottom.
 */
export const ModifierStackPanel: React.FC<ModifierStackPanelProps> = ({ mesh, setMesh }) => {
  const modifiers = mesh.modifiers || [];

  const update = (id: string, patch: Partial<MeshModifier>) =>
    setMesh((prev) => ({
      ...prev,
      modifiers: (prev.modifiers || []).map((m) =>
        m.id === id ? ({ ...m, ...patch } as MeshModifier) : m,
      ),
    }));

  const move = (index: number, delta: number) =>
    setMesh((prev) => {
      const list = [...(prev.modifiers || [])];
      const next = index + delta;
      if (next < 0 || next >= list.length) return prev;
      const a = list[index];
      list[index] = list[next];
      list[next] = a;
      return { ...prev, modifiers: list };
    });

  const remove = (id: string) =>
    setMesh((prev) => ({ ...prev, modifiers: (prev.modifiers || []).filter((m) => m.id !== id) }));

  const add = (mod: MeshModifier) =>
    setMesh((prev) => ({ ...prev, modifiers: [...(prev.modifiers || []), mod] }));

  /** Bake a single modifier into the mesh, then drop it from the stack. */
  const applyOne = (id: string) =>
    setMesh((prev) => {
      const list = prev.modifiers || [];
      const target = list.find((m) => m.id === id);
      if (!target) return prev;
      const baked = evaluateMeshModifiers({ ...prev, modifiers: [target] }, 4);
      return { ...baked, modifiers: list.filter((m) => m.id !== id) };
    });

  return (
    <div className="ts-card p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="ts-section-header px-0">Modifiers</span>
        <span className="font-mono text-[10px] text-[#6e7584]">{modifiers.length}</span>
      </div>

      <div className="grid grid-cols-2 gap-1">
        <button
          type="button"
          onClick={() => add(createMirrorModifier('x', true, 0.001))}
          aria-label="Add mirror modifier"
          className="py-1 bg-[#16191e] border border-[#3a3f4a] text-[#bcc4d0] text-[11.5px] font-medium rounded-[6px] hover:border-[#00b4c4] hover:text-[#e2e6ec] flex items-center justify-center gap-1"
        >
          <Plus className="w-3 h-3" /> Mirror
        </button>
        <button
          type="button"
          onClick={() => add(createSubdivisionModifier(1))}
          aria-label="Add subdivision modifier"
          className="py-1 bg-[#16191e] border border-[#3a3f4a] text-[#bcc4d0] text-[11.5px] font-medium rounded-[6px] hover:border-[#00b4c4] hover:text-[#e2e6ec] flex items-center justify-center gap-1"
        >
          <Plus className="w-3 h-3" /> Subdiv
        </button>
      </div>

      {modifiers.length === 0 ? (
        <p className="text-[11px] text-[#6e7584] leading-snug">
          Add a modifier to keep symmetry or subdivision non-destructive until you bake it.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {modifiers.map((mod, index) => (
            <li
              key={mod.id}
              className={`rounded-[6px] border p-2 space-y-1.5 ${
                mod.enabled
                  ? 'border-[#3a3f4a] bg-[#21242c]'
                  : 'border-[#1a1c22] bg-[#1a1c22] opacity-70'
              }`}
            >
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => update(mod.id, { enabled: !mod.enabled })}
                  aria-label={`${mod.enabled ? 'Disable' : 'Enable'} ${mod.type} modifier`}
                  className="text-[#00b4c4] hover:text-[#e2e6ec] p-0.5"
                >
                  {mod.enabled ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                </button>
                <span className="flex-1 text-[11.5px] font-medium text-[#e2e6ec] capitalize">
                  {mod.type === 'subdivision' ? 'Subdivision' : 'Mirror'}
                </span>
                <button
                  type="button"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  aria-label="Move modifier up"
                  className="p-0.5 text-[#8a9099] hover:text-[#e2e6ec] disabled:opacity-30"
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => move(index, 1)}
                  disabled={index === modifiers.length - 1}
                  aria-label="Move modifier down"
                  className="p-0.5 text-[#8a9099] hover:text-[#e2e6ec] disabled:opacity-30"
                >
                  <ArrowDown className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => remove(mod.id)}
                  aria-label={`Remove ${mod.type} modifier`}
                  className="p-0.5 text-[#8a9099] hover:text-[#ec5b62]"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              {mod.type === 'mirror' ? (
                <div className="flex items-center gap-1">
                  <div className="flex gap-0.5" role="group" aria-label="Mirror axis">
                    {AXES.map((axis) => (
                      <button
                        key={axis}
                        type="button"
                        onClick={() => update(mod.id, { axis })}
                        aria-label={`Mirror on ${axis.toUpperCase()} axis`}
                        className={`w-6 h-5 text-[11px] font-mono rounded-[6px] border ${
                          mod.axis === axis
                            ? 'border-[#00b4c4] text-[#00b4c4] bg-[#00b4c4]/10'
                            : 'border-[#3a3f4a] text-[#8a9099] hover:text-[#e2e6ec]'
                        }`}
                      >
                        {axis.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  <label className="flex items-center gap-1 text-[11px] text-[#8a9099] ml-auto">
                    <input
                      type="checkbox"
                      checked={mod.clip}
                      onChange={(e) => update(mod.id, { clip: e.target.checked })}
                      aria-label="Clip geometry to the mirror plane"
                      className="accent-[#00b4c4]"
                    />
                    Clip
                  </label>
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <label className="text-[11px] text-[#8a9099]">Levels</label>
                  <input
                    type="number"
                    min={1}
                    max={4}
                    value={mod.levels}
                    onChange={(e) =>
                      update(mod.id, {
                        levels: Math.max(1, Math.min(4, Number(e.target.value) || 1)),
                      })
                    }
                    aria-label="Subdivision levels"
                    className="w-12 bg-[#16191e] border border-[#3a3f4a] rounded-[6px] text-[11px] font-mono text-[#bcc4d0] px-1 py-0.5"
                  />
                  <select
                    value={mod.algorithm}
                    onChange={(e) =>
                      update(mod.id, {
                        algorithm: e.target.value === 'simple' ? 'simple' : 'catmullClark',
                      })
                    }
                    aria-label="Subdivision algorithm"
                    className="flex-1 bg-[#16191e] border border-[#3a3f4a] rounded-[6px] text-[11px] text-[#bcc4d0] px-1 py-0.5"
                  >
                    <option value="catmullClark">Catmull-Clark</option>
                    <option value="simple">Simple</option>
                  </select>
                </div>
              )}

              <button
                type="button"
                onClick={() => applyOne(mod.id)}
                aria-label={`Apply ${mod.type} modifier`}
                className="w-full h-6 bg-[#282c35] text-[#00b4c4] border border-[#3a3f4a] hover:bg-[#3a3f4a] rounded-[6px] flex items-center justify-center text-[11px] font-medium gap-1"
              >
                <Check className="w-3 h-3" /> Apply
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};