import React from 'react';
import { X, Sparkles, Box, Cylinder, Triangle, Layers } from 'lucide-react';
import type { PrimitiveType } from '../types/cad';

interface PresetsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectPreset: (type: PrimitiveType) => void;
}

export const PresetsModal: React.FC<PresetsModalProps> = ({ isOpen, onClose, onSelectPreset }) => {
  if (!isOpen) return null;

  const presets: { id: PrimitiveType; title: string; desc: string; icon: any; category: string }[] = [
    { id: 'cube', title: 'Low-Poly Cube', desc: 'Standard 6-sided quad box unit.', icon: Box, category: 'Basic' },
    { id: 'chest', title: 'Default Box', desc: 'Starter box mesh for modeling.', icon: Box, category: 'Primitive' },
    { id: 'tree', title: 'Low-Poly Pine Tree', desc: 'Trunk cylinder + layered cone foliage.', icon: Triangle, category: 'Environment' },
    { id: 'car', title: 'Retro Cyber Car', desc: 'Sci-Fi low poly vehicle chassis.', icon: Layers, category: 'Vehicle' },
    { id: 'cylinder', title: 'Pillar / Barrel', desc: '8-segment retro cylinder.', icon: Cylinder, category: 'Basic' },
    { id: 'pyramid', title: 'Great Pyramid', desc: '4-side quad base pyramid.', icon: Triangle, category: 'Basic' },
  ];

  return (
    <div className="fixed inset-0 bg-black/55 backdrop-blur-sm flex items-center justify-center z-50 p-4 select-none font-sans">
      <div className="modal-shell max-w-xl w-full text-xs">
        <div className="modal-header">
          <div className="flex items-center gap-2 font-semibold text-sm">
            <Sparkles className="w-4 h-4 text-[var(--color-warning)]" />
            <span>Preset Library</span>
          </div>
          <button onClick={onClose} className="win-button p-1.5 flex items-center justify-center">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="p-3 grid grid-cols-2 gap-2.5 max-h-[60vh] overflow-y-auto custom-scrollbar">
          {presets.map((p) => {
            const Icon = p.icon;
            return (
              <button
                key={p.id}
                onClick={() => {
                  onSelectPreset(p.id);
                  onClose();
                }}
                className="win-raised p-3 text-left hover:border-[rgba(94,177,239,0.4)] hover:bg-[var(--color-elevated)] cursor-pointer transition flex flex-col justify-between space-y-2"
              >
                <div className="flex items-start justify-between">
                  <div className="w-8 h-8 rounded-lg bg-[var(--color-accent-soft)] border border-[rgba(94,177,239,0.3)] flex items-center justify-center text-[var(--color-accent)]">
                    <Icon className="w-4 h-4" />
                  </div>
                  <span className="text-[9px] font-mono text-[var(--color-muted)] win-inset px-1.5 py-0.5">
                    {p.category}
                  </span>
                </div>
                <div>
                  <h4 className="font-semibold text-[var(--color-fg)] text-xs">{p.title}</h4>
                  <p className="text-[var(--color-muted)] text-[10px] mt-0.5 leading-relaxed">{p.desc}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
