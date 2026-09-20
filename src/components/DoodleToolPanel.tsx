import React, { useMemo } from 'react';
import { Check, RotateCcw, X } from 'lucide-react';
import { BlenderIcon } from './icons/BlenderIcon';
import { buildDoodleMesh, resolveDoodleTopology, type DoodleSession, type DoodleSettings } from '../utils/doodle3d';

interface DoodleToolPanelProps {
  settings: DoodleSettings;
  session: DoodleSession | null;
  onSettingsChange: (patch: Partial<DoodleSettings>) => void;
  onConfirm: () => void;
  onCancel: () => void;
  onClear: () => void;
}

const selectClass = 'h-7 w-full rounded-[5px] border border-[#3a3f4a] bg-[#16191e] px-2 text-[10.5px] text-[#e2e6ec] outline-none focus:border-[#00b4c4]';

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex h-6 cursor-pointer items-center justify-between rounded-[4px] px-1 hover:bg-[#282c35]">
      <span className="text-[10.5px] text-[#bcc4d0]">{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="accent-[#00b4c4]" />
    </label>
  );
}

function NumberControl({ label, value, min = 0, max, step = 0.05, onChange }: {
  label: string; value: number; min?: number; max?: number; step?: number; onChange: (value: number) => void;
}) {
  return (
    <label className="grid grid-cols-[1fr_74px] items-center gap-2">
      <span className="text-[10.5px] text-[#bcc4d0]">{label}</span>
      <input type="number" value={Number(value.toFixed(3))} min={min} max={max} step={step}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-7 rounded-[5px] border border-[#3a3f4a] bg-[#16191e] px-2 text-right font-mono text-[10px] text-[#e2e6ec] outline-none focus:border-[#00b4c4]" />
    </label>
  );
}

function RangeControl({ label, value, min, max, step, onChange }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void;
}) {
  return (
    <label className="space-y-1">
      <span className="flex items-center justify-between text-[10.5px] text-[#bcc4d0]">
        {label}<b className="font-mono text-[10px] font-normal text-[#e2e6ec]">{value.toFixed(step < 0.1 ? 2 : 1)}</b>
      </span>
      <input type="range" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))}
        className="h-1 w-full cursor-pointer accent-[#00b4c4]" />
    </label>
  );
}

export const DoodleToolPanel: React.FC<DoodleToolPanelProps> = ({ settings, session, onSettingsChange, onConfirm, onCancel, onClear }) => {
  const pointCount = session?.points.length ?? 0;
  const closedMode = settings.mode !== 'open';
  const canConfirm = closedMode ? Boolean(session?.closed && pointCount >= 3) : pointCount >= 2;
  const topology = resolveDoodleTopology(settings);
  const previewMesh = useMemo(() => session ? buildDoodleMesh(session).mesh : null, [session]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#1c1f26] text-[#bcc4d0] select-none">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-[#1a1c22] bg-[#16191e] px-3">
        <div className="flex items-center gap-2">
          <BlenderIcon name="blockout" size={15} className="text-[#00b4c4]" />
          <span className="text-[12px] font-semibold tracking-wide text-[#e2e6ec]">3D DOODLE</span>
        </div>
        <span className="font-mono text-[10px] text-[#87909f]">{pointCount} pts {session?.closed ? '/ closed' : session?.drawing ? '/ drawing' : '/ ready'}</span>
      </div>

      <div className="custom-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto p-2.5">
        <section className="space-y-2 rounded-[6px] border border-[#303540] bg-[#21242c] p-2.5">
          <div className="grid grid-cols-3 gap-1 rounded-[5px] border border-[#303540] bg-[#16191e] p-1">
            {(['sharp', 'soft', 'open'] as const).map((mode) => (
              <button key={mode} type="button" onClick={() => onSettingsChange({
                mode,
                plane: mode === 'open' ? 'free3d' : settings.plane === 'free3d' ? 'xz' : settings.plane,
              })}
                className={`h-7 rounded-[4px] text-[10px] font-semibold ${settings.mode === mode ? 'bg-[#00b4c4] text-[#071316]' : 'text-[#87909f] hover:bg-[#282c35] hover:text-[#e2e6ec]'}`}>
                {mode === 'sharp' ? 'Sharp Edge' : mode === 'soft' ? 'Soft Edge' : 'Open'}
              </button>
            ))}
          </div>
          <p className="text-[10px] leading-snug text-[#87909f]">
            {settings.mode === 'sharp' ? 'Clean polygon extrusion for hard-surface and low-poly work.' : settings.mode === 'soft' ? 'Rounded editable volume with controlled smoothing.' : 'Create a path, strip, ribbon, tube, or mesh stroke.'}
          </p>
        </section>

        {session?.warning && <div role="alert" className="rounded-[6px] border border-[#c68a2d]/50 bg-[#c68a2d]/10 px-2.5 py-2 text-[10px] text-[#f0bd63]">{session.warning}</div>}

        <section className="space-y-2 rounded-[6px] border border-[#303540] bg-[#21242c] p-2.5">
          <span className="text-[9.5px] font-semibold uppercase tracking-wider text-[#6e7584]">Drawing</span>
          <select value={settings.plane} onChange={(event) => onSettingsChange({ plane: event.target.value as DoodleSettings['plane'] })} className={selectClass} aria-label="Drawing plane">
            {settings.mode === 'open' && <option value="free3d">Free 3D space</option>}
            <option value="xz">XZ ground plane</option><option value="xy">XY front plane</option><option value="yz">YZ side plane</option>
            <option value="workplane">Active workplane</option><option value="camera">Current camera view</option><option value="surface">Draw on surface</option>
          </select>
          {settings.plane === 'free3d' && (
            <>
              <select value={settings.spatialDepthMode} onChange={(event) => onSettingsChange({ spatialDepthMode: event.target.value as DoodleSettings['spatialDepthMode'] })} className={selectClass} aria-label="Free 3D depth reconstruction">
                <option value="auto">Auto camera depth</option>
                <option value="surfaceAware">Surface-aware depth</option>
                <option value="pressure">Stylus pressure depth</option>
              </select>
              <NumberControl label="Depth bias" value={settings.spatialDepthBias} min={-20} step={0.1} onChange={(spatialDepthBias) => onSettingsChange({ spatialDepthBias })} />
              {settings.spatialDepthMode === 'pressure' && <NumberControl label="Pressure depth" value={settings.pressureDepth} min={0} step={0.1} onChange={(pressureDepth) => onSettingsChange({ pressureDepth })} />}
              <p className="text-[9.5px] leading-snug text-[#6e7584]">Draws on an adaptive camera-depth shell. Hold Ctrl and drag vertically, or use the wheel, to move through depth. Release, orbit, and continue from the last point.</p>
            </>
          )}
          {settings.mode === 'open' && (
            <select value={settings.openOutput} onChange={(event) => onSettingsChange({ openOutput: event.target.value as DoodleSettings['openOutput'] })} className={selectClass} aria-label="Open doodle output">
              <option value="edgeChain">Edge chain</option><option value="tube">Tube</option><option value="ribbon">Ribbon</option>
              <option value="beveledCurve">Beveled curve</option><option value="surfaceStrip">Surface strip</option>
              <option value="extrusionPath">Extrusion path</option><option value="meshStroke">Mesh stroke</option>
            </select>
          )}
          <div className="grid grid-cols-2 gap-x-2">
            <Toggle label="Grid snap" checked={settings.gridSnap} onChange={(gridSnap) => onSettingsChange({ gridSnap })} />
            <Toggle label="Surface snap" checked={settings.surfaceSnap} onChange={(surfaceSnap) => onSettingsChange({ surfaceSnap })} />
            <Toggle label="Vertex snap" checked={settings.vertexSnap} onChange={(vertexSnap) => onSettingsChange({ vertexSnap })} />
            <Toggle label="Edge snap" checked={settings.edgeSnap} onChange={(edgeSnap) => onSettingsChange({ edgeSnap })} />
          </div>
          <Toggle label="Auto-weld nearby points" checked={settings.autoWeld} onChange={(autoWeld) => onSettingsChange({ autoWeld })} />
        </section>

        <section className="space-y-2.5 rounded-[6px] border border-[#303540] bg-[#21242c] p-2.5">
          <span className="text-[9.5px] font-semibold uppercase tracking-wider text-[#6e7584]">Geometry</span>
          <div className="grid grid-cols-3 gap-1 rounded-[5px] border border-[#303540] bg-[#16191e] p-1">
            {(['low', 'mid', 'custom'] as const).map((preset) => (
              <button key={preset} type="button" onClick={() => onSettingsChange({
                topologyPreset: preset,
                resolution: preset === 'low' ? 6 : preset === 'mid' ? 10 : settings.resolution,
              })}
                className={`h-7 rounded-[4px] text-[10px] font-semibold ${settings.topologyPreset === preset ? 'bg-[#00b4c4] text-[#071316]' : 'text-[#87909f] hover:bg-[#282c35] hover:text-[#e2e6ec]'}`}>
                {preset === 'low' ? 'Low Poly' : preset === 'mid' ? 'Mid Poly' : 'Custom'}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between text-[9.5px] text-[#6e7584]">
            <span>{topology.label}{settings.mode === 'open' ? ` / ${topology.profileSegments}-side profile` : ' / corner preserving'}</span>
            {previewMesh && <span className="font-mono text-[#87909f]">{previewMesh.vertices.length}v / {previewMesh.faces.length}f</span>}
          </div>
          {closedMode && <NumberControl label="Depth" value={settings.depth} min={-100} step={0.1} onChange={(depth) => onSettingsChange({ depth })} />}
          {settings.mode === 'open' && <NumberControl label="Width" value={settings.width} min={0.001} step={0.02} onChange={(width) => onSettingsChange({ width })} />}
          {settings.mode === 'open' && !['edgeChain', 'extrusionPath', 'ribbon', 'surfaceStrip'].includes(settings.openOutput) &&
            <NumberControl label="Thickness" value={settings.thickness} min={0.001} step={0.02} onChange={(thickness) => onSettingsChange({ thickness })} />}
          {(settings.mode === 'soft' || settings.openOutput === 'beveledCurve') && <NumberControl label="Bevel" value={settings.bevel} min={0} step={0.01} onChange={(bevel) => onSettingsChange({ bevel })} />}
          {settings.mode === 'soft' && <RangeControl label="Roundness" value={settings.roundness} min={0} max={1} step={0.01} onChange={(roundness) => onSettingsChange({ roundness })} />}
          {(settings.mode === 'soft' || settings.mode === 'open') && <RangeControl label="Smoothing" value={settings.smoothing} min={0} max={1} step={0.01} onChange={(smoothing) => onSettingsChange({ smoothing })} />}
          {(settings.mode === 'soft' || settings.mode === 'open') && settings.topologyPreset === 'custom' && <NumberControl label="Profile sides" value={settings.resolution} min={3} max={24} step={1} onChange={(resolution) => onSettingsChange({ resolution: Math.round(resolution) })} />}
          {settings.topologyPreset === 'custom' && <NumberControl label="Simplify" value={settings.simplifyTolerance} min={0} step={0.005} onChange={(simplifyTolerance) => onSettingsChange({ simplifyTolerance })} />}
          {settings.mode === 'open' && !['edgeChain', 'extrusionPath'].includes(settings.openOutput) && (
            <>
              <select value={settings.profile} onChange={(event) => onSettingsChange({ profile: event.target.value as DoodleSettings['profile'] })} className={selectClass} aria-label="Profile shape">
                <option value="round">Round profile</option><option value="square">Square profile</option><option value="diamond">Diamond profile</option><option value="flat">Flat profile</option>
              </select>
              <select value={settings.capStyle} onChange={(event) => onSettingsChange({ capStyle: event.target.value as DoodleSettings['capStyle'] })} className={selectClass} aria-label="Cap style">
                <option value="flat">Flat caps</option><option value="round">Round caps</option><option value="none">Open ends</option>
              </select>
              <Toggle label="Cap ends" checked={settings.capEnds} onChange={(capEnds) => onSettingsChange({ capEnds })} />
            </>
          )}
          {closedMode && (
            <select value={settings.fillMode} onChange={(event) => onSettingsChange({ fillMode: event.target.value as DoodleSettings['fillMode'] })} className={selectClass} aria-label="Fill mode">
              <option value="ngon">Intentional n-gon caps</option><option value="triangles">Triangulated caps</option>
            </select>
          )}
        </section>

        <section className="space-y-1 rounded-[6px] border border-[#303540] bg-[#21242c] p-2.5">
          <Toggle label="Generate UVs" checked={settings.generateUvs} onChange={(generateUvs) => onSettingsChange({ generateUvs })} />
          <Toggle label="Mirror result" checked={settings.symmetry} onChange={(symmetry) => onSettingsChange({ symmetry })} />
          {settings.symmetry && <select value={settings.mirrorAxis} onChange={(event) => onSettingsChange({ mirrorAxis: event.target.value as DoodleSettings['mirrorAxis'] })} className={selectClass} aria-label="Mirror axis"><option value="x">Mirror X</option><option value="y">Mirror Y</option><option value="z">Mirror Z</option></select>}
          <RangeControl label="Preview opacity" value={settings.previewOpacity} min={0.08} max={0.8} step={0.01} onChange={(previewOpacity) => onSettingsChange({ previewOpacity })} />
        </section>

        <section className="space-y-1.5 pb-1">
          <button type="button" disabled={!canConfirm} onClick={onConfirm}
            className="flex h-8 w-full items-center justify-center gap-1.5 rounded-[6px] bg-[#00b4c4] text-[11px] font-semibold text-[#071316] hover:bg-[#00d4e2] disabled:cursor-not-allowed disabled:opacity-35">
            <Check className="h-3.5 w-3.5" /> Confirm Doodle
          </button>
          <div className="grid grid-cols-2 gap-1.5">
            <button type="button" onClick={onClear} className="flex h-7 items-center justify-center gap-1.5 rounded-[6px] border border-[#3a3f4a] bg-[#282c35] text-[10.5px] text-[#e2e6ec] hover:bg-[#343a45]"><RotateCcw className="h-3 w-3" /> Clear</button>
            <button type="button" onClick={onCancel} className="flex h-7 items-center justify-center gap-1.5 rounded-[6px] border border-[#3a3f4a] bg-[#282c35] text-[10.5px] text-[#e0556a] hover:border-[#e0556a]/50 hover:bg-[#e0556a]/10"><X className="h-3 w-3" /> Cancel</button>
          </div>
          <p className="text-[9.5px] leading-snug text-[#6e7584]">Drag in the viewport to draw. Release to preview. Enter confirms. Esc cancels.</p>
        </section>
      </div>
    </div>
  );
};
