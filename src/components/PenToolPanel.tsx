import React from 'react';
import { Check, CornerDownLeft, Eraser, Ruler, Trash2 } from 'lucide-react';
import { BlenderIcon } from './icons/BlenderIcon';
import {
  PEN_TYPE_OPTIONS,
  PROJECT_TO_OPTIONS,
  WALL_MODE_OPTIONS,
  penTypeCreatesFaces,
  type PenSession,
  type PenToolSettings,
} from '../utils/penTool';
import type { Vec3 } from '../utils/primitiveDraw';

interface PenToolPanelProps {
  settings: PenToolSettings;
  onSettingsChange: (patch: Partial<PenToolSettings>) => void;
  session: PenSession | null;
  /** Current Point number (1-based) shown by the numeric fields. */
  currentOrder: number;
  onCurrentOrderChange: (order: number) => void;
  onPointMove: (order: number, position: Vec3) => void;
  onFinish: () => void;
  onCommit: () => void;
  onDrop: () => void;
  onUndo: () => void;
}

const numberInput =
  'w-full min-w-0 bg-transparent text-right font-mono text-[11px] text-[#e2e6ec] outline-none';

function Toggle({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      title={hint}
      className={`flex items-center justify-between h-6 px-1 rounded-[6px] ${
        disabled ? 'opacity-40' : 'cursor-pointer hover:bg-[#282c35]'
      }`}
    >
      <span className="text-[11px] text-[#bcc4d0] truncate">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label}
        className="accent-[#00b4c4] shrink-0"
      />
    </label>
  );
}

/**
 * Modo's Pen tool Properties panel.
 *
 * Mirrors the documented options one-for-one: Pen Type, Current Point,
 * Position X/Y/Z, Make Quads, Wall Mode, Offset, Inset, Segments,
 * Show Angles / Handles / Numbers, Select New, Make UVs and Project To.
 */
export const MeshSketchPanel: React.FC<PenToolPanelProps> = ({
  settings,
  onSettingsChange,
  session,
  currentOrder,
  onCurrentOrderChange,
  onPointMove,
  onFinish,
  onCommit,
  onDrop,
  onUndo,
}) => {
  const polygons = settings.type === 'polygons';
  const wallActive = settings.wallMode !== 'off';
  const current = session?.points[Math.max(1, currentOrder) - 1] ?? null;
  const pointCount = session?.points.length ?? 0;
  const commitsFaces = penTypeCreatesFaces(settings.type);
  const activePatch = session
    ? session.patches.length + (session.activeIds.length ? 1 : 0)
    : 0;

  const setAxis = (axis: keyof Vec3, value: number) => {
    if (!current || !Number.isFinite(value)) return;
    onPointMove(currentOrder, { ...current.position, [axis]: value });
  };

  return (
    <div className="h-full flex flex-col bg-[#1c1f26] text-[#bcc4d0] text-[11.5px] select-none overflow-hidden">
      <div className="h-10 shrink-0 px-3 bg-[#16191e] border-b border-[#1a1c22] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BlenderIcon name="pen" size={15} className="text-[#00b4c4]" />
          <span className="font-semibold text-[12px] text-[#e2e6ec] tracking-wide">MESH SKETCH</span>
        </div>
        <span className="font-mono text-[10px] text-[#87909f]">
          {session?.state ?? 'Idle'} / {pointCount}v / {activePatch}f
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-2.5 space-y-2.5">
        <section className="bg-[#21242c] border border-[#303540] rounded-[6px] p-2.5 space-y-2">
          <div className="grid grid-cols-3 gap-1 bg-[#16191e] p-1 rounded-[6px] border border-[#303540]">
            {(['surface', 'plane', 'free3d'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => onSettingsChange({ drawMode: mode })}
                className={`h-7 rounded-[4px] text-[10px] font-semibold transition-colors ${settings.drawMode === mode ? 'bg-[#00b4c4] text-[#071316]' : 'text-[#87909f] hover:text-[#e2e6ec] hover:bg-[#282c35]'}`}
              >
                {mode === 'free3d' ? 'Free 3D' : mode[0].toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>
          <p className="text-[10.5px] leading-snug text-[#87909f]">
            {settings.drawMode === 'surface'
              ? 'Retopology mode. New vertices conform to the mesh under the pointer.'
              : settings.drawMode === 'plane'
                ? `Constrained to the ${settings.activePlane.toUpperCase()} construction plane.`
                : 'Each segment starts on a view-facing plane through the current vertex. Orbit or switch view to change depth.'}
          </p>
          {settings.drawMode === 'plane' && (
            <div className="grid grid-cols-3 gap-1">
              {(['xy', 'xz', 'yz'] as const).map((plane) => (
                <button key={plane} type="button" onClick={() => onSettingsChange({ activePlane: plane })}
                  className={`h-6 rounded-[4px] border text-[10px] font-mono ${settings.activePlane === plane ? 'border-[#00b4c4] bg-[#00b4c4]/10 text-[#5eead4]' : 'border-[#3a3f4a] text-[#87909f] hover:text-[#e2e6ec]'}`}>
                  {plane.toUpperCase()}
                </button>
              ))}
            </div>
          )}
          <div className="grid grid-cols-3 gap-1">
            {(['quad', 'ngon', 'triangulate'] as const).map((mode) => (
              <button key={mode} type="button" onClick={() => onSettingsChange({ faceMode: mode, makeQuads: mode === 'quad' })}
                className={`h-6 rounded-[4px] text-[9.5px] ${settings.faceMode === mode ? 'bg-[#343a45] text-[#f4f7fa]' : 'text-[#87909f] hover:bg-[#282c35]'}`}>
                {mode === 'ngon' ? 'N-gon' : mode[0].toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10.5px] text-[#bcc4d0]">Weld radius</span>
            <input type="number" min={0} step={0.01} value={settings.snapDistance}
              onChange={(e) => onSettingsChange({ snapDistance: Math.max(0, Number(e.target.value) || 0) })}
              className="ml-auto w-20 h-6 px-2 rounded-[4px] bg-[#16191e] border border-[#3a3f4a] text-right font-mono text-[10px] text-[#e2e6ec] outline-none focus:border-[#00b4c4]" />
          </div>
          <Toggle label="Auto-weld" hint="Reuse a nearby existing vertex instead of creating a duplicate." checked={settings.autoWeld} onChange={(autoWeld) => onSettingsChange({ autoWeld })} />
          <Toggle label="Live face preview" hint="Preview a valid closed face before confirming it." checked={settings.autoFace} onChange={(autoFace) => onSettingsChange({ autoFace })} />
          <Toggle
            label="Select face on commit"
            hint="Switch to Face mode and select the newest face. Leave off to return to Vertex mode and keep building."
            checked={settings.selectFaceOnCommit}
            onChange={(selectFaceOnCommit) => onSettingsChange({ selectFaceOnCommit })}
          />
        </section>

        {session?.warning && (
          <div role="status" className="rounded-[6px] border border-[#c68a2d]/50 bg-[#c68a2d]/10 px-2.5 py-2 text-[10.5px] leading-snug text-[#f0bd63]">
            {session.warning}
          </div>
        )}

        <details className="group bg-[#1d2027] border border-[#303540] rounded-[6px]">
          <summary className="h-8 px-2.5 flex items-center cursor-pointer text-[10px] font-semibold text-[#87909f] uppercase tracking-wider hover:text-[#e2e6ec] list-none">
            Advanced topology options
            <span className="ml-auto text-[#5eead4] group-open:rotate-90 transition-transform">›</span>
          </summary>
          <div className="px-2 pb-2 space-y-2">
        {/* Pen Type */}
        <section className="bg-[#21242c] border border-[#1a1c22] rounded-[6px] p-2.5 space-y-2">
          <span className="text-[10px] font-semibold text-[#6e7584] uppercase tracking-wider">Pen Type</span>
          <select
            value={settings.type}
            onChange={(e) => onSettingsChange({ type: e.target.value as PenToolSettings['type'] })}
            aria-label="Pen Type"
            className="w-full h-7 px-2 rounded-[6px] bg-[#16191e] border border-[#3a3f4a] focus:border-[#00b4c4] text-[11px] font-mono text-[#e2e6ec] outline-none cursor-pointer"
          >
            {PEN_TYPE_OPTIONS.map((option) => (
              <option key={option.id} value={option.id} title={option.hint}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="text-[10.5px] leading-snug text-[#6e7584]">
            {PEN_TYPE_OPTIONS.find((option) => option.id === settings.type)?.hint}
          </p>
          {!commitsFaces && (
            <p className="text-[10.5px] leading-snug text-[#e6b422]">
              Construction only: vertices are committed, connecting segments stay on the viewport
              overlay. Switch to Polygons to write faces.
            </p>
          )}
        </section>

        {/* Current Point + Position X/Y/Z */}
        <section className="bg-[#21242c] border border-[#1a1c22] rounded-[6px] p-2.5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-[#6e7584] uppercase tracking-wider">
              Current Point
            </span>
            <div className="h-7 w-20 rounded-[6px] bg-[#16191e] border border-[#3a3f4a] focus-within:border-[#00b4c4] flex items-center px-2">
              <input
                type="number"
                min={1}
                max={Math.max(1, pointCount)}
                value={currentOrder}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  if (Number.isFinite(next)) onCurrentOrderChange(Math.max(1, Math.round(next)));
                }}
                aria-label="Current Point"
                className={numberInput}
              />
            </div>
          </div>

          {(['x', 'y', 'z'] as const).map((axis) => (
            <div key={axis} className="flex items-center gap-2">
              <span
                className="w-3 text-[10px] font-mono font-bold"
                style={{ color: axis === 'x' ? '#e0556a' : axis === 'y' ? '#34a87a' : '#4a90d9' }}
              >
                {axis.toUpperCase()}
              </span>
              <div className="flex-1 h-7 rounded-[6px] bg-[#16191e] border border-[#3a3f4a] focus-within:border-[#00b4c4] flex items-center px-2">
                <input
                  type="number"
                  step={0.05}
                  disabled={!current}
                  value={current ? Number(current.position[axis].toFixed(4)) : 0}
                  onChange={(e) => setAxis(axis, Number(e.target.value))}
                  aria-label={`Position ${axis.toUpperCase()}`}
                  className={numberInput}
                />
              </div>
            </div>
          ))}
          {current && (
            <button
              type="button"
              onClick={() => onPointMove(currentOrder, { x: 0, y: 0, z: 0 })}
              className="w-full h-6 rounded-[6px] bg-[#282c35] hover:bg-[#2f3340] border border-[#3a3f4a] text-[11px] text-[#bcc4d0]"
            >
              Zero position
            </button>
          )}
        </section>

        {/* Make Quads */}
        <section className="bg-[#21242c] border border-[#1a1c22] rounded-[6px] p-2 space-y-1">
          <Toggle
            label="Make Quads"
            hint="Polygons only: each click after the first two vertices completes a quad. Hold Ctrl for a single triangle."
            checked={settings.makeQuads}
            disabled={!polygons}
            onChange={(next) => onSettingsChange({ makeQuads: next })}
          />
        </section>

        {/* Wall Mode */}
        <section className="bg-[#21242c] border border-[#1a1c22] rounded-[6px] p-2.5 space-y-2">
          <span className="text-[10px] font-semibold text-[#6e7584] uppercase tracking-wider flex items-center gap-1.5">
            <Ruler className="w-3 h-3" /> Wall Mode
          </span>
          <div className="grid grid-cols-4 gap-1 bg-[#16191e] p-1 rounded-[6px] border border-[#1a1c22]">
            {WALL_MODE_OPTIONS.map((mode) => (
              <button
                key={mode.id}
                type="button"
                title={mode.hint}
                onClick={() => onSettingsChange({ wallMode: mode.id })}
                className={`h-6 rounded-[4px] text-[10.5px] font-medium transition-all ${
                  settings.wallMode === mode.id
                    ? 'bg-[#00b4c4] text-[#0a1114] font-semibold'
                    : 'text-[#6e7584] hover:text-[#e2e6ec] hover:bg-[#282c35]'
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>

          {([
            ['Offset', 'offset', 0.05, !wallActive, 0],
            ['Inset', 'inset', 0.01, !wallActive, 0],
            ['Segments', 'segments', 1, !wallActive || settings.inset <= 0, 1],
          ] as const).map(([label, key, step, disabled, min]) => (
            <div key={key} className="flex items-center justify-between">
              <span className={`text-[11px] ${disabled ? 'text-[#6e7584]' : 'text-[#bcc4d0]'}`}>{label}</span>
              <div className="h-7 w-20 rounded-[6px] bg-[#16191e] border border-[#3a3f4a] focus-within:border-[#00b4c4] flex items-center px-2">
                <input
                  type="number"
                  min={min}
                  step={step}
                  disabled={disabled}
                  value={settings[key]}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    if (!Number.isFinite(next)) return;
                    onSettingsChange({
                      [key]: key === 'segments' ? Math.max(1, Math.round(next)) : Math.max(0, next),
                    });
                  }}
                  aria-label={label}
                  className={numberInput}
                />
              </div>
            </div>
          ))}

          <p className="text-[10.5px] leading-snug text-[#6e7584]">
            {settings.wallMode === 'both'
              ? 'Both draws walls each side of the edge line; the Offset is doubled.'
              : 'Wall Mode draws the floor plan strips. Inset bevels each corner; Segments 1 flattens it.'}
          </p>
        </section>

        {/* Show + Select New */}
        <section className="bg-[#21242c] border border-[#1a1c22] rounded-[6px] p-2 space-y-0.5">
          <Toggle
            label="Show Angles"
            hint="Draw the corner angles between opposing edges, in degrees."
            checked={settings.showAngles}
            onChange={(next) => onSettingsChange({ showAngles: next })}
          />
          <Toggle
            label="Show Handles"
            hint="Show per-axis handles to adjust the previously created vertex."
            checked={settings.showHandles}
            onChange={(next) => onSettingsChange({ showHandles: next })}
          />
          <Toggle
            label="Show Numbers"
            hint="Show the vertex point order values in the viewport."
            checked={settings.showNumbers}
            onChange={(next) => onSettingsChange({ showNumbers: next })}
          />
          <Toggle
            label="Select New"
            hint="Select the most recently created polygon while the tool is still active."
            checked={settings.selectNew}
            onChange={(next) => onSettingsChange({ selectNew: next })}
          />
        </section>

        {/* UVs */}
        <section className="bg-[#21242c] border border-[#1a1c22] rounded-[6px] p-2.5 space-y-2">
          <Toggle
            label="Make UVs"
            hint="Automatically create UVs for the new geometry, projected by Project To."
            checked={settings.makeUvs}
            onChange={(next) => onSettingsChange({ makeUvs: next })}
          />
          <select
            value={settings.projectTo}
            disabled={!settings.makeUvs}
            onChange={(e) => onSettingsChange({ projectTo: e.target.value as PenToolSettings['projectTo'] })}
            aria-label="Project To"
            className="w-full h-7 px-2 rounded-[6px] bg-[#16191e] border border-[#3a3f4a] focus:border-[#00b4c4] text-[11px] font-mono text-[#e2e6ec] outline-none cursor-pointer disabled:opacity-40"
          >
            {PROJECT_TO_OPTIONS.map((option) => (
              <option key={option.id} value={option.id} title={option.hint}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="text-[10.5px] leading-snug text-[#6e7584]">
            {PROJECT_TO_OPTIONS.find((option) => option.id === settings.projectTo)?.hint}
          </p>
        </section>
          </div>
        </details>

        {/* Actions */}
        <section className="space-y-1.5">
          <button
            type="button"
            onClick={onFinish}
            className="w-full h-7 rounded-[6px] bg-[#00b4c4] hover:bg-[#00d4e2] text-[#0a1114] text-[11px] font-semibold flex items-center justify-center gap-1.5"
          >
            <Check className="w-3.5 h-3.5" /> Create Face
          </button>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={onUndo}
              className="h-7 rounded-[6px] bg-[#282c35] hover:bg-[#2f3340] border border-[#3a3f4a] text-[11px] text-[#e2e6ec] flex items-center justify-center gap-1.5"
            >
              <Eraser className="w-3.5 h-3.5 text-[#00b4c4]" /> Undo Point
            </button>
            <button
              type="button"
              onClick={onDrop}
              className="h-7 rounded-[6px] bg-[#282c35] hover:bg-[#e0556a]/20 border border-[#3a3f4a] hover:border-[#e0556a]/50 text-[11px] text-[#e0556a] flex items-center justify-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" /> Cancel
            </button>
          </div>
          <button type="button" onClick={onCommit}
            className="w-full h-7 rounded-[6px] bg-[#343a45] hover:bg-[#3e4552] border border-[#4a5260] text-[11px] font-semibold text-[#f4f7fa]">
            Commit Mesh Sketch (Enter)
          </button>
          <p className="text-[10.5px] leading-snug text-[#6e7584] flex items-start gap-1.5">
            <CornerDownLeft className="w-3 h-3 mt-0.5 shrink-0" />
            Click to place · drag a vertex to move it · drop it on another to weld · Shift+click starts
            a new polygon · Ctrl+click makes a triangle · highlight a vertex then click to insert
            after it.
          </p>
        </section>
      </div>
    </div>
  );
};

/** Backward-compatible export for saved layouts and downstream imports. */
export const PenToolPanel = MeshSketchPanel;
