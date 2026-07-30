import React from 'react';
import { X, Keyboard } from 'lucide-react';
import { APP_NAME, APP_TAGLINE } from '../brand';

interface ShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ShortcutsModal: React.FC<ShortcutsModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  const shortcuts = [
    { key: '1', action: 'Object Edit Mode' },
    { key: '2', action: 'Vertex Edit Mode' },
    { key: '3', action: 'Edge Edit Mode' },
    { key: '4', action: 'Face Edit Mode' },
    { key: 'G', action: 'Move / Translate Gizmo' },
    { key: 'R', action: 'Rotate Gizmo' },
    { key: 'S', action: 'Scale Gizmo' },
    { key: 'E', action: 'Extrude Selected Face' },
    { key: 'I', action: 'Inset Selected Face' },
    { key: 'Shift + D', action: 'Duplicate Selected Element' },
    { key: 'Delete / Backspace', action: 'Delete Selected Vertex / Face' },
    { key: 'Ctrl + Z', action: 'Undo last modeling action' },
    { key: 'Ctrl + Y', action: 'Redo modeling action' },
    { key: 'Shift + Click', action: 'Multi-select objects / verts / edges / faces' },
    { key: 'Left Click', action: 'Select' },
    { key: 'Click empty space', action: 'Deselect (current mode)' },
    { key: 'Right Click Drag', action: 'Orbit Viewport Camera' },
    { key: 'Middle Click Drag', action: 'Pan Viewport Camera' },
    { key: 'A', action: 'Select / Deselect All (current mode)' },
    { key: 'Alt + A', action: 'Deselect All' },
    { key: 'Ctrl + Alt + Q', action: 'Toggle Quad / Single Viewport' },
    { key: 'B', action: 'Toggle 3D mesh paint brush' },
    { key: 'E (in paint)', action: 'Toggle pencil / eraser' },
    { key: 'Esc', action: 'Exit 3D paint / CAD draw / place mode' },
  ];

  return (
    <div className="fixed inset-0 bg-black/55 backdrop-blur-sm flex items-center justify-center z-50 p-4 select-none font-sans">
      <div className="modal-shell max-w-md w-full text-xs">
        <div className="modal-header">
          <div className="flex items-center gap-2 font-semibold text-sm">
            <Keyboard className="w-4 h-4 text-[var(--color-accent)]" />
            <span>Keyboard Shortcuts</span>
          </div>
          <button onClick={onClose} className="win-button p-1.5 flex items-center justify-center">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="p-3 max-h-[60vh] overflow-y-auto space-y-1 custom-scrollbar">
          {shortcuts.map((s) => (
            <div key={s.key} className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-[var(--color-elevated)]">
              <span className="text-[var(--color-fg)] font-medium">{s.action}</span>
              <kbd className="px-2 py-0.5 win-inset text-[var(--color-accent)] font-mono text-[10px]">
                {s.key}
              </kbd>
            </div>
          ))}
        </div>

        <div className="px-4 py-2.5 border-t border-[var(--color-border)] text-center text-[var(--color-muted)] text-[10px] font-mono">
          {APP_NAME} · {APP_TAGLINE}
        </div>
      </div>
    </div>
  );
};
