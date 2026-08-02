import React from 'react';
import { X, Keyboard } from 'lucide-react';
import { APP_NAME, APP_TAGLINE } from '../brand';

interface ShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type ShortcutRow = { key: string; action: string };
type ShortcutSection = { title: string; rows: ShortcutRow[] };

export const ShortcutsModal: React.FC<ShortcutsModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  const sections: ShortcutSection[] = [
    {
      title: 'Viewport',
      rows: [
        { key: 'LMB Drag', action: 'Orbit camera' },
        { key: 'RMB Drag', action: 'Pan camera' },
        { key: 'MMB / Wheel', action: 'Dolly / zoom' },
        { key: 'Ctrl + Alt + Q', action: 'Toggle quad / single viewport' },
        { key: 'Alt + Z', action: 'Toggle X-Ray' },
      ],
    },
    {
      title: 'Modeling',
      rows: [
        { key: '1 / 2 / 3 / 4', action: 'Object / Vertex / Edge / Face mode (keeps selection)' },
        { key: 'Tab', action: 'Toggle Object mode ↔ last sub-object mode' },
        { key: 'G / R / S', action: 'Move / Rotate / Scale' },
        { key: 'E / I', action: 'Extrude / Inset face' },
        { key: 'Shift + D', action: 'Duplicate selection' },
        { key: 'P', action: 'Separate selection into new object' },
        { key: 'Delete', action: 'Delete selection' },
        { key: 'Ctrl + Z / Y', action: 'Undo / Redo' },
      ],
    },
    {
      title: 'Selection (Vertex / Edge / Face)',
      rows: [
        { key: 'Click', action: 'Replace selection' },
        { key: 'Shift + Click', action: 'Add to selection' },
        { key: 'Ctrl / Alt + Click', action: 'Remove from selection' },
        { key: 'Drag', action: 'Box select' },
        { key: 'A / Alt + A', action: 'Select all / Deselect all' },
        { key: 'Ctrl + I', action: 'Invert selection' },
        { key: 'L', action: 'Select linked (whole connected island)' },
        { key: 'Ctrl + = / Ctrl + -', action: 'Grow / shrink selection' },
      ],
    },
    {
      title: 'Blockout',
      rows: [
        { key: 'LMB', action: 'Add silhouette points (Draw)' },
        { key: 'Double-click / first point', action: 'Close path' },
        { key: 'Ctrl + Drag', action: 'Box-select points' },
        { key: 'Shift + Click', action: 'Add to point selection' },
        { key: 'Alt + Click edge', action: 'Insert polygon point' },
        { key: 'Delete', action: 'Delete selected points' },
        { key: 'Ctrl + Z / Y', action: 'Path undo / redo' },
      ],
    },
    {
      title: 'UV',
      rows: [
        { key: 'G / R / S', action: 'Move / Rotate / Scale UVs' },
        { key: 'B', action: 'Box select' },
        { key: 'F / Home', action: 'Frame selection / Frame all' },
        { key: 'A / Alt + A', action: 'Select all / Clear' },
        { key: 'Esc', action: 'Cancel transform / box' },
      ],
    },
    {
      title: 'Rigging',
      rows: [
        { key: '5', action: 'Enter Easy Rig / Bone mode' },
        { key: 'EDIT / POSE / PAINT', action: 'Build skeleton · Pose · Weight paint' },
        { key: 'G / R / S', action: 'Move / Rotate / Scale selected bone' },
        { key: 'Shift (weight paint)', action: 'Temporary subtract brush' },
        { key: 'Alt (weight paint)', action: 'Temporary smooth brush' },
        { key: 'Delete', action: 'Delete bone branch' },
        { key: 'Ctrl + C / V', action: 'Copy / paste bones' },
      ],
    },
    {
      title: 'Pixel Paint',
      rows: [
        { key: 'B / E / G / I', action: 'Pencil / Eraser / Fill / Eyedropper' },
        { key: 'L / U / C', action: 'Line / Rect / Ellipse' },
        { key: 'V / W / M', action: 'Select / Wand / Move' },
        { key: '[ / ]', action: 'Brush size down / up' },
        { key: 'Space / RMB / MMB', action: 'Pan canvas' },
        { key: 'Ctrl + Z / Y', action: 'Undo / Redo' },
        { key: '± / Wheel', action: 'Zoom (Ctrl fine · Shift coarse)' },
      ],
    },
    {
      title: '3D Paint',
      rows: [
        { key: 'B', action: 'Toggle 3D paint brush' },
        { key: 'E', action: 'Toggle pencil / eraser' },
        { key: 'I', action: 'Eyedropper' },
        { key: 'LMB on mesh', action: 'Stamp texture (UV)' },
        { key: 'Empty LMB drag', action: 'Orbit while painting armed' },
      ],
    },
    {
      title: 'Animation',
      rows: [
        { key: 'Space', action: 'Play / Pause' },
        { key: '← / →', action: 'Step frame' },
        { key: 'Home / End', action: 'Jump to start / end' },
        { key: 'G / R / S', action: 'Move / Rotate / Scale (modal)' },
        { key: 'K', action: 'Insert keyframe' },
        { key: 'Shift + F', action: 'Enlarge / focus playback' },
        { key: 'Shift + T', action: 'Maximize timeline' },
      ],
    },
  ];

  return (
    <div className="fixed inset-0 bg-black/55 backdrop-blur-sm flex items-center justify-center z-50 p-4 select-none font-sans">
      <div className="modal-shell max-w-lg w-full text-xs">
        <div className="modal-header">
          <div className="flex items-center gap-2 font-semibold text-sm">
            <Keyboard className="w-4 h-4 text-[var(--color-accent)]" />
            <span>Keyboard Shortcuts</span>
          </div>
          <button type="button" onClick={onClose} className="win-button p-1.5 flex items-center justify-center">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="p-3 max-h-[70vh] overflow-y-auto space-y-3 custom-scrollbar">
          {sections.map((section) => (
            <div key={section.title}>
              <div className="px-2 pb-1 text-[9px] font-bold uppercase tracking-wider text-[var(--color-accent)]">
                {section.title}
              </div>
              <div className="space-y-0.5">
                {section.rows.map((s) => (
                  <div key={`${section.title}-${s.key}`} className="flex items-center justify-between gap-3 py-1.5 px-2 rounded-lg hover:bg-[var(--color-elevated)]">
                    <span className="text-[var(--color-fg)] font-medium">{s.action}</span>
                    <kbd className="shrink-0 px-2 py-0.5 win-inset text-[var(--color-accent)] font-mono text-[10px]">
                      {s.key}
                    </kbd>
                  </div>
                ))}
              </div>
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
