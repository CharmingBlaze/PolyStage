import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Copy, Plus } from 'lucide-react';
import type { MaterialAsset } from '../types/cad';

interface MaterialShelfProps {
  materials: MaterialAsset[];
  activeMaterialId: string;
  workspace: string;
  targetLabel: string;
  onSelect: (id: string) => void;
  onApply: (materialId: string) => void;
  onCreate: () => void;
  onDuplicate: () => void;
  onOpenEditor: () => void;
}

export const MaterialShelf: React.FC<MaterialShelfProps> = ({
  materials,
  activeMaterialId,
  workspace,
  targetLabel,
  onSelect,
  onApply,
  onCreate,
  onDuplicate,
  onOpenEditor,
}) => {
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const active = materials.find((material) => material.id === activeMaterialId) || materials[0];

  useEffect(() => {
    if (!isPickerOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setIsPickerOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsPickerOpen(false);
    };
    window.addEventListener('pointerdown', closeOutside);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [isPickerOpen]);

  if (!active) return null;

  const sourceLabel = (material: MaterialAsset) =>
    material.source === 'uv' ? 'UV' : material.source === 'painted' ? 'Paint' : material.shading;

  return (
    <div className="sp-material-shelf" role="toolbar" aria-label="Shared material library">
      <div className="sp-material-shelf__context">
        <span className="sp-material-shelf__workspace">{workspace === 'modeling' ? 'Model' : workspace}</span>
        <span className="sp-material-shelf__target" title={targetLabel}>{targetLabel}</span>
      </div>

      <div className={`sp-material-shelf__picker ${isPickerOpen ? 'is-open' : ''}`} ref={pickerRef}>
        <button
          type="button"
          className="sp-material-shelf__picker-trigger"
          aria-label="Active material"
          aria-haspopup="listbox"
          aria-expanded={isPickerOpen}
          onClick={() => setIsPickerOpen((open) => !open)}
        >
          <span className="sp-material-shelf__preview" style={{ backgroundColor: active.color }} aria-hidden />
          <span className="sp-material-shelf__picker-name">{active.name}</span>
          <span className="sp-material-shelf__picker-source">{sourceLabel(active)}</span>
          <ChevronDown size={12} className="sp-material-shelf__picker-chevron" aria-hidden />
        </button>
        {isPickerOpen && (
          <div className="sp-material-shelf__menu" role="listbox" aria-label="Materials">
            {materials.map((material) => (
              <button
                key={material.id}
                type="button"
                role="option"
                aria-selected={material.id === active.id}
                className={`sp-material-shelf__menu-item ${material.id === active.id ? 'is-selected' : ''}`}
                onClick={() => {
                  onSelect(material.id);
                  setIsPickerOpen(false);
                }}
              >
                <span className="sp-material-shelf__menu-swatch" style={{ backgroundColor: material.color }} aria-hidden />
                <span className="sp-material-shelf__menu-copy">
                  <span className="sp-material-shelf__menu-name">{material.name}</span>
                  <span className="sp-material-shelf__menu-meta">{sourceLabel(material)}</span>
                </span>
                {material.id === active.id && <Check size={12} className="sp-material-shelf__menu-check" aria-hidden />}
              </button>
            ))}
          </div>
        )}
      </div>

      <button type="button" className="sp-material-shelf__apply" onClick={() => onApply(active.id)} title={`Assign ${active.name} to ${targetLabel}`}>
        <Check size={13} />
        Assign
      </button>
      <div className="sp-material-shelf__tools" aria-label="Material actions">
        <button type="button" onClick={onCreate} title="New material" aria-label="New material"><Plus size={13} /></button>
        <button type="button" onClick={onDuplicate} title="Duplicate active material" aria-label="Duplicate active material"><Copy size={12} /></button>
        <button type="button" className="is-wide" onClick={onOpenEditor} title="Open the full material editor">
          Edit <ChevronRight size={12} />
        </button>
      </div>
    </div>
  );
};
