import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { CADMesh } from '../types/cad';
import {
  qualityToSegments,
  segmentsToQuality,
  vectorPathsToMesh,
  vectorSnapshotToCADMesh,
  type VectorMeshSnapshot,
} from '../utils/vectorBlockout';
import { useVectorStore } from '../store/useVectorStore';

type PanelTab = 'draw' | 'parts' | 'ref' | 'mesh';
type MeshSubTab = 'detail' | 'caps' | 'advanced';

interface VectorPanelProps {
  /** Replace scene meshes with one object per blockout part. */
  onBuildAll: (meshes: CADMesh[]) => void;
  /** Append the active part as its own object. */
  onAddActive: (mesh: CADMesh) => void;
  /** Optional: after a successful build, jump to MODEL workspace. */
  onBuildAndEdit?: (meshes: CADMesh[]) => void;
  onStatus?: (message: string) => void;
}

export function VectorPanel({ onBuildAll, onAddActive, onBuildAndEdit, onStatus }: VectorPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [tab, setTab] = useState<PanelTab>('draw');
  const [meshSub, setMeshSub] = useState<MeshSubTab>('detail');
  const mode = useVectorStore((s) => s.mode);
  const pathStyle = useVectorStore((s) => s.pathStyle);
  const mirrorWidth = useVectorStore((s) => s.mirrorWidth);
  const pointEditMode = useVectorStore((s) => s.pointEditMode);
  const paths = useVectorStore((s) => s.paths);
  const parts = useVectorStore((s) => s.parts);
  const activePartId = useVectorStore((s) => s.activePartId);
  const selected = useVectorStore((s) => s.selected);
  const selectedIndices = useVectorStore((s) => s.selectedIndices);
  const activePlane = useVectorStore((s) => s.activePlane);
  const snap = useVectorStore((s) => s.snap);
  const snapSize = useVectorStore((s) => s.snapSize);
  const vertical = useVectorStore((s) => s.verticalSegments);
  const radial = useVectorStore((s) => s.radialSegments);
  const thickness = useVectorStore((s) => s.thickness);
  const capStyle = useVectorStore((s) => s.capStyle);
  const roundness = useVectorStore((s) => s.roundness);
  const refImages = useVectorStore((s) => s.refImages);
  const historyCount = useVectorStore((s) => s.history.length);
  const futureCount = useVectorStore((s) => s.future.length);
  const panelPos = useVectorStore((s) => s.panelPos);
  const setPanelPos = useVectorStore((s) => s.setPanelPos);
  const setMode = useVectorStore((s) => s.setMode);
  const setPathStyle = useVectorStore((s) => s.setPathStyle);
  const setMirrorWidth = useVectorStore((s) => s.setMirrorWidth);
  const setPointEditMode = useVectorStore((s) => s.setPointEditMode);
  const seedCompanionCage = useVectorStore((s) => s.seedCompanionCage);
  const setActivePart = useVectorStore((s) => s.setActivePart);
  const renamePart = useVectorStore((s) => s.renamePart);
  const setActivePlane = useVectorStore((s) => s.setActivePlane);
  const setSnap = useVectorStore((s) => s.setSnap);
  const setSnapSize = useVectorStore((s) => s.setSnapSize);
  const setSegments = useVectorStore((s) => s.setSegments);
  const setThickness = useVectorStore((s) => s.setThickness);
  const setCapStyle = useVectorStore((s) => s.setCapStyle);
  const setRoundness = useVectorStore((s) => s.setRoundness);
  const setRefImage = useVectorStore((s) => s.setRefImage);
  const patchRefImage = useVectorStore((s) => s.patchRefImage);
  const deleteSelected = useVectorStore((s) => s.deleteSelected);
  const refFileRef = useRef<HTMLInputElement | null>(null);

  const isDraggingHeader = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });

  const onHeaderPointerDown = (e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).tagName === 'BUTTON') return;
    isDraggingHeader.current = true;
    dragStart.current = { x: e.clientX - panelPos.x, y: e.clientY - panelPos.y };
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const onHeaderPointerMove = (e: ReactPointerEvent) => {
    if (!isDraggingHeader.current) return;
    setPanelPos({
      x: Math.max(10, Math.min(window.innerWidth - 320, e.clientX - dragStart.current.x)),
      y: Math.max(10, Math.min(window.innerHeight - 100, e.clientY - dragStart.current.y)),
    });
  };

  const onHeaderPointerUp = (e: ReactPointerEvent) => {
    if (!isDraggingHeader.current) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    isDraggingHeader.current = false;
  };

  const activePath = paths[activePlane];
  const activePart = parts.find((part) => part.id === activePartId) ?? parts[0];
  const canInsert =
    !!selected &&
    (activePath.closed || selected.index < activePath.anchors.length - 1);
  const polyQuality = segmentsToQuality(vertical, radial);
  const qualityLabel =
    polyQuality <= 20
      ? 'Game Low'
      : polyQuality <= 45
        ? 'Game'
        : polyQuality <= 70
          ? 'Solid'
          : 'Dense';
  const applyMeshQuality = (quality: number) => {
    const next = qualityToSegments(quality);
    setSegments(next.vertical, next.radial);
  };
  const validPartCount = parts.filter(
    (part) => part.paths.front.closed || part.paths.side.closed
  ).length;
  const missingAxis =
    (paths.front.closed ? 0 : 1) + (paths.side.closed ? 0 : 1) === 1;
  const estimatedVertices =
    ((vertical + 1) * radial + (capStyle === 'game' ? 2 * radial + 2 : 2)) *
    Math.max(validPartCount, 1);
  const estimatedFaces =
    (2 * radial * vertical +
      (capStyle === 'game' ? 2 * radial * 2 + 2 * radial : 2 * radial)) *
    Math.max(validPartCount, 1);

  const refPlane = activePlane === 'top' ? 'front' : activePlane;
  const activeRef = refPlane === 'front' || refPlane === 'side' ? refImages[refPlane] : null;
  const frontReady = paths.front.closed;
  const sideReady = paths.side.closed;

  const loadRefFile = (file: File, plane: 'front' | 'side') => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      if (!dataUrl) return;
      const img = new Image();
      img.onload = () => {
        const aspect =
          (img.naturalWidth || img.width || 1) /
          Math.max(1, img.naturalHeight || img.height || 1);
        setRefImage(plane, {
          name: file.name,
          dataUrl,
          opacity: 0.55,
          scale: 4,
          aspect,
          offsetU: 0,
          offsetV: 0,
          locked: false,
        });
        useVectorStore.getState().setRefTool('move', plane);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  if (collapsed) {
    return (
      <div
        className="vector-panel vector-panel-collapsed"
        style={{ left: panelPos.x, top: panelPos.y, bottom: 'auto' }}
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
      >
        <span>Vector Blockout · {activePart.name}</span>
        <button type="button" onClick={() => setCollapsed(false)}>Expand</button>
      </div>
    );
  }

  const meshForPaths = (partPaths: typeof paths): VectorMeshSnapshot | null =>
    vectorPathsToMesh(
      partPaths.front.closed ? partPaths.front : null,
      partPaths.side.closed ? partPaths.side : null,
      vertical,
      radial,
      partPaths.top.closed ? partPaths.top : null,
      { thickness, gameTopology: true, capStyle, taperThickness: true, roundness }
    );

  const partsForBuild = () => {
    const store = useVectorStore.getState();
    return store.parts.map((part) =>
      part.id === store.activePartId ? { ...part, paths: store.paths } : part
    );
  };

  const generateAll = (andEdit = false) => {
    const buildParts = partsForBuild();
    const generated = buildParts
      .map((part) => ({ name: part.name, mesh: meshForPaths(part.paths) }))
      .filter((item): item is { name: string; mesh: VectorMeshSnapshot } => !!item.mesh);
    if (!generated.length) {
      onStatus?.(
        'Close a Front or Side silhouette for height (click point 1). Top is optional and shapes the XZ cross-section.'
      );
      return;
    }
    const meshes = generated.map((item) =>
      vectorSnapshotToCADMesh(item.mesh, item.name, { seedTexture: '#d2b48c' })
    );
    onBuildAll(meshes);
    useVectorStore.getState().markBuilt();
    const totalVerts = meshes.reduce((n, m) => n + m.vertices.length, 0);
    const totalFaces = meshes.reduce((n, m) => n + m.faces.length, 0);
    onStatus?.(
      andEdit
        ? `Built ${meshes.length} object${meshes.length === 1 ? '' : 's'} (${totalVerts} verts) — opening MODEL.`
        : `Built ${meshes.length} object${meshes.length === 1 ? '' : 's'} · ${totalVerts} verts · ${totalFaces} faces. Switch to MODEL to edit.`
    );
    if (andEdit) onBuildAndEdit?.(meshes);
  };

  const addActiveToMesh = () => {
    const store = useVectorStore.getState();
    const generated = meshForPaths(store.paths);
    if (!generated) {
      onStatus?.(`Close a Front or Side silhouette for ${activePart.name} first.`);
      return;
    }
    const partMesh = vectorSnapshotToCADMesh(generated, activePart.name, {
      seedTexture: '#d2b48c',
    });
    onAddActive(partMesh);
    useVectorStore.getState().markBuilt();
    onStatus?.(`${activePart.name} added as its own object (${qualityLabel.toLowerCase()}).`);
  };

  const helpText =
    mode === 'pen'
      ? pathStyle === 'polygon'
        ? 'Click corners · close on point 1. Ctrl-drag box-selects points.'
        : 'Click corners, drag for curves. Ctrl-drag box-selects points.'
      : pointEditMode === 'free'
        ? 'Free Move — drag one point; Mirror is ignored on Front/Side.'
        : pathStyle === 'polygon'
          ? 'Mirror Move — paired points stay even when Mirror is on. Use Free Move for one point.'
          : 'Drag anchors · Ctrl-drag box-select · Shift-click add · Alt-drag handle free.';

  return (
    <div className="vector-panel" style={{ left: panelPos.x, top: panelPos.y, bottom: 'auto' }}>
      <div
        className="vector-panel-title"
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
      >
        <span>Vector Blockout</span>
        <div className="vector-title-actions">
          <span className="vector-badge">{activePart.name}</span>
          <button type="button" onClick={() => setCollapsed(true)}>Collapse</button>
        </div>
      </div>

      <div className="vector-tabs" role="tablist" aria-label="Blockout panel">
        {(
          [
            ['draw', 'Draw'],
            ['parts', 'Parts'],
            ['ref', 'Ref'],
            ['mesh', 'Mesh'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'active' : ''}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="vector-tab-body" role="tabpanel">
        {tab === 'draw' && (
          <>
            <div className="vector-plane-tabs" aria-label="Active silhouette">
              {(['front', 'side', 'top'] as const).map((plane) => (
                <button
                  key={plane}
                  type="button"
                  className={activePlane === plane ? 'active' : ''}
                  onClick={() => setActivePlane(plane)}
                >
                  {plane === 'front' ? 'Front' : plane === 'side' ? 'Side' : 'Top'}
                  <span>
                    {paths[plane].closed
                      ? '✓'
                      : paths[plane].anchors.length
                        ? paths[plane].anchors.length
                        : '—'}
                  </span>
                </button>
              ))}
            </div>

            <div className="vector-mode-row">
              <button type="button" className={mode === 'pen' ? 'active' : ''} onClick={() => setMode('pen')}>
                Draw
              </button>
              <button type="button" className={mode === 'edit' ? 'active' : ''} onClick={() => setMode('edit')}>
                Edit
              </button>
            </div>

            <div className="vector-mode-row vector-style-row">
              <button
                type="button"
                className={pathStyle === 'polygon' ? 'active' : ''}
                onClick={() => setPathStyle('polygon')}
                title="Straight polygon edges"
              >
                Polygon
              </button>
              <button
                type="button"
                className={pathStyle === 'curve' ? 'active' : ''}
                onClick={() => setPathStyle('curve')}
                title="Bézier curves"
              >
                Curves
              </button>
              <button
                type="button"
                className={mirrorWidth && pointEditMode === 'symmetric' ? 'active' : ''}
                onClick={() => {
                  if (pointEditMode !== 'symmetric') {
                    setPointEditMode('symmetric');
                    setMirrorWidth(true);
                  } else {
                    setMirrorWidth(!mirrorWidth);
                  }
                  setMode('edit');
                }}
                title="Mirror Move — paired Front/Side points stay even while dragging"
              >
                Mirror
              </button>
              <button
                type="button"
                className={pointEditMode === 'free' ? 'active' : ''}
                onClick={() => {
                  setPointEditMode('free');
                  setMode('edit');
                }}
                title="Free Move — one point at a time, no mirror"
              >
                Free
              </button>
            </div>

            <div className="vector-help">{helpText}</div>

            {(sideReady && !frontReady) || (frontReady && !sideReady) ? (
              <div className="vector-companion-row">
                {sideReady && !frontReady ? (
                  <button
                    type="button"
                    className="primary"
                    onClick={() => seedCompanionCage('front')}
                    title="Editable Front width cage from Side"
                  >
                    + Front Width Polygon
                  </button>
                ) : null}
                {frontReady && !sideReady ? (
                  <button
                    type="button"
                    className="primary"
                    onClick={() => seedCompanionCage('side')}
                    title="Editable Side depth cage from Front"
                  >
                    + Side Depth Polygon
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className="vector-section-label">Path</div>
            <div className="vector-actions">
              <button
                type="button"
                onClick={() => useVectorStore.getState().toggleClosed(activePlane)}
                disabled={!activePath.closed && activePath.anchors.length < 3}
              >
                {activePath.closed ? 'Open' : 'Close'}
              </button>
              <button
                type="button"
                onClick={() => useVectorStore.getState().insertAfterSelected()}
                disabled={!canInsert}
                title="Insert a point on the selected edge"
              >
                Insert
              </button>
              <button type="button" onClick={deleteSelected} disabled={!selected}>
                Delete{selectedIndices.length > 1 ? ` (${selectedIndices.length})` : ''}
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  if (confirm(`Clear the ${activePlane} path?`)) {
                    useVectorStore.getState().clearPath(activePlane);
                  }
                }}
                disabled={!activePath.anchors.length}
              >
                Clear
              </button>
            </div>

            <div className="vector-history-row">
              <button
                type="button"
                disabled={!historyCount}
                onClick={() => useVectorStore.getState().undo()}
                title="Undo (Ctrl+Z)"
              >
                Undo
              </button>
              <button
                type="button"
                disabled={!futureCount}
                onClick={() => useVectorStore.getState().redo()}
                title="Redo (Ctrl+Y)"
              >
                Redo
              </button>
              <label title="Snap anchors to grid">
                <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} />
                Snap
              </label>
              <select
                value={snapSize}
                onChange={(e) => setSnapSize(Number(e.target.value))}
                disabled={!snap}
                aria-label="Snap spacing"
              >
                <option value={0.05}>0.05</option>
                <option value={0.1}>0.10</option>
                <option value={0.25}>0.25</option>
                <option value={0.5}>0.50</option>
              </select>
            </div>
          </>
        )}

        {tab === 'parts' && (
          <>
            <div className="vector-section-label">Active part</div>
            <div className="vector-part-row">
              <select
                value={activePartId}
                onChange={(e) => setActivePart(e.target.value)}
                aria-label="Vector part"
              >
                {parts.map((part) => (
                  <option key={part.id} value={part.id}>{part.name}</option>
                ))}
              </select>
              <button type="button" onClick={() => useVectorStore.getState().addPart()} title="Add part">
                + Part
              </button>
            </div>
            <input
              className="vector-part-name"
              value={activePart.name}
              onChange={(e) => renamePart(e.target.value)}
              aria-label="Part name"
              placeholder="Head, Torso, Arm…"
            />
            <div className="vector-actions">
              <button type="button" onClick={() => useVectorStore.getState().duplicatePart()}>
                Duplicate
              </button>
              <button
                type="button"
                className="danger"
                disabled={parts.length <= 1}
                onClick={() => {
                  if (confirm(`Delete “${activePart.name}”?`)) {
                    useVectorStore.getState().deletePart();
                  }
                }}
              >
                Delete Part
              </button>
            </div>
            <div className="vector-help">
              Separate parts for limbs/props. Build All combines every part with a closed Front or Side.
            </div>
            <div className="vector-view-status" aria-label="Part silhouette readiness">
              {(['front', 'side', 'top'] as const).map((plane) => (
                <span key={plane} className={paths[plane].closed ? 'done' : ''}>
                  {plane === 'front' ? 'F' : plane === 'side' ? 'S' : 'T'}
                  {paths[plane].closed
                    ? ' ✓'
                    : paths[plane].anchors.length
                      ? ` ${paths[plane].anchors.length}`
                      : ' —'}
                </span>
              ))}
            </div>
          </>
        )}

        {tab === 'ref' && (
          <>
            <div className="vector-section-label">
              Reference · {refPlane === 'side' ? 'Side' : 'Front'}
            </div>
            <div className="vector-help">
              Prefer <strong>+ Ref Image</strong> in the Front/Side viewports for Move / Scale / Lock.
              Panel load works too.
            </div>
            <input
              ref={refFileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                const plane = activePlane === 'side' ? 'side' : 'front';
                if (activePlane === 'top') setActivePlane('front');
                loadRefFile(file, plane);
              }}
            />
            <div className="vector-mode-row">
              <button
                type="button"
                className={refPlane === 'front' ? 'active' : ''}
                onClick={() => setActivePlane('front')}
              >
                Front Ref
              </button>
              <button
                type="button"
                className={refPlane === 'side' ? 'active' : ''}
                onClick={() => setActivePlane('side')}
              >
                Side Ref
              </button>
            </div>
            <div className="vector-actions">
              <button
                type="button"
                className="primary"
                onClick={() => refFileRef.current?.click()}
              >
                Load Image
              </button>
              <button
                type="button"
                disabled={!activeRef}
                onClick={() => {
                  useVectorStore.getState().setRefTool('none', null);
                  setRefImage(refPlane === 'side' ? 'side' : 'front', null);
                }}
              >
                Clear
              </button>
            </div>
            {activeRef ? (
              <>
                <div className="vector-ref-name" title={activeRef.name}>
                  {activeRef.name}
                  {activeRef.locked ? ' · locked' : ''}
                </div>
                <label className="vector-ref-opacity">
                  Opacity
                  <input
                    type="range"
                    min="0.1"
                    max="0.9"
                    step="0.05"
                    value={activeRef.opacity}
                    onChange={(e) =>
                      patchRefImage(refPlane === 'side' ? 'side' : 'front', {
                        opacity: Number(e.target.value),
                      })
                    }
                  />
                  <span>{Math.round(activeRef.opacity * 100)}%</span>
                </label>
              </>
            ) : (
              <div className="vector-thickness-hint">No reference on this view yet.</div>
            )}
          </>
        )}

        {tab === 'mesh' && (
          <>
            <div className="vector-subtabs" role="tablist" aria-label="Mesh settings">
              {(
                [
                  ['detail', 'Detail'],
                  ['caps', 'Tips'],
                  ['advanced', 'Advanced'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={meshSub === id}
                  className={meshSub === id ? 'active' : ''}
                  onClick={() => setMeshSub(id)}
                >
                  {label}
                </button>
              ))}
            </div>

            {meshSub === 'detail' && (
              <div className="vector-poly-quality">
                <div className="vector-quality-heading">
                  <span>Mesh Detail</span>
                  <strong>
                    {qualityLabel} · {vertical}×{radial}
                  </strong>
                </div>
                <div className="vector-quality-scale">
                  <span>Game Low</span>
                  <span>Dense</span>
                </div>
                <input
                  type="range"
                  className="vector-detail-slider"
                  min="0"
                  max="100"
                  step="1"
                  value={polyQuality}
                  aria-label="Vector mesh detail"
                  onInput={(e) => applyMeshQuality(Number((e.target as HTMLInputElement).value))}
                  onChange={(e) => applyMeshQuality(Number(e.target.value))}
                />
                <div className="vector-thickness-hint">
                  Live preview updates as you drag. Game Low = boxy 8-side; Dense adds rings + seams.
                </div>
                <div className="vector-quality-presets">
                  <button
                    type="button"
                    className={polyQuality <= 25 ? 'active' : ''}
                    onClick={() => setSegments(8, 8)}
                    title="Low-poly box: outer + center seams"
                  >
                    Game
                  </button>
                  <button
                    type="button"
                    className={polyQuality > 25 && polyQuality <= 55 ? 'active' : ''}
                    onClick={() => setSegments(10, 12)}
                    title="Mid-poly: center + side seams"
                  >
                    Solid
                  </button>
                  <button
                    type="button"
                    className={polyQuality > 55 ? 'active' : ''}
                    onClick={() => setSegments(14, 16)}
                    title="Denser rings, still game-friendly"
                  >
                    Dense
                  </button>
                </div>

                <div className="vector-thickness">
                  <label>
                    <span>Thickness</span>
                    <strong>{thickness.toFixed(2)}</strong>
                  </label>
                  <input
                    type="range"
                    className="vector-detail-slider"
                    min="0.1"
                    max="2"
                    step="0.01"
                    value={thickness}
                    aria-label="Missing-axis thickness"
                    onInput={(e) => setThickness(Number((e.target as HTMLInputElement).value))}
                    onChange={(e) => setThickness(Number(e.target.value))}
                  />
                  <div className="vector-thickness-hint">
                    {missingAxis
                      ? 'Used when only Front or Side is closed.'
                      : 'Fallback if you clear Front or Side. Both closed → curves win.'}
                  </div>
                  <div className="vector-quality-presets">
                    <button type="button" onClick={() => setThickness(0.3)}>Thin</button>
                    <button type="button" onClick={() => setThickness(0.6)}>Medium</button>
                    <button type="button" onClick={() => setThickness(1.2)}>Thick</button>
                  </div>
                </div>
              </div>
            )}

            {meshSub === 'caps' && (
              <div className="vector-cap-row">
                <div className="vector-quality-heading">
                  <span>Tip Topology</span>
                  <strong>{capStyle === 'game' ? 'Game' : 'Pointed'}</strong>
                </div>
                <div className="vector-quality-presets">
                  <button
                    type="button"
                    className={capStyle === 'game' ? 'active' : ''}
                    onClick={() => setCapStyle('game')}
                    title="Inset quads + tiny tip"
                  >
                    Game Caps
                  </button>
                  <button
                    type="button"
                    className={capStyle === 'pointed' ? 'active' : ''}
                    onClick={() => setCapStyle('pointed')}
                    title="Single pole fan"
                  >
                    Pointed
                  </button>
                </div>
                <div className="vector-thickness-hint">
                  {capStyle === 'game'
                    ? 'Mostly-quad tips — better for UV, bevel, and game cleanup.'
                    : 'Organic pointed tips with a pole fan.'}
                </div>
              </div>
            )}

            {meshSub === 'advanced' && (
              <div className="vector-density">
                <div className="vector-roundness">
                  <div className="vector-quality-heading">
                    <span>Roundness</span>
                    <strong>{roundness < 0.05 ? 'Square' : roundness > 0.85 ? 'Round' : `${Math.round(roundness * 100)}%`}</strong>
                  </div>
                  <div className="vector-quality-scale">
                    <span>Square</span>
                    <span>Round</span>
                  </div>
                  <input
                    type="range"
                    className="vector-detail-slider"
                    min="0"
                    max="100"
                    step="1"
                    value={Math.round(roundness * 100)}
                    aria-label="Cross-section roundness"
                    onInput={(e) =>
                      setRoundness(Number((e.target as HTMLInputElement).value) / 100)
                    }
                    onChange={(e) => setRoundness(Number(e.target.value) / 100)}
                  />
                  <div className="vector-thickness-hint">
                    Default is square box loft. Drag right to soften corners toward a round section.
                  </div>
                  <div className="vector-quality-presets">
                    <button
                      type="button"
                      className={roundness < 0.05 ? 'active' : ''}
                      onClick={() => setRoundness(0)}
                    >
                      Square
                    </button>
                    <button
                      type="button"
                      className={roundness >= 0.05 && roundness < 0.7 ? 'active' : ''}
                      onClick={() => setRoundness(0.35)}
                    >
                      Soft
                    </button>
                    <button
                      type="button"
                      className={roundness >= 0.7 ? 'active' : ''}
                      onClick={() => setRoundness(1)}
                    >
                      Round
                    </button>
                  </div>
                </div>

                <label>
                  Height rings
                  <input
                    type="range"
                    min="3"
                    max="40"
                    value={vertical}
                    onInput={(e) =>
                      setSegments(Number((e.target as HTMLInputElement).value), radial)
                    }
                    onChange={(e) => setSegments(Number(e.target.value), radial)}
                  />
                  <span>{vertical}</span>
                </label>
                <label>
                  Around
                  <input
                    type="range"
                    min="4"
                    max="32"
                    step="4"
                    value={radial}
                    onInput={(e) =>
                      setSegments(vertical, Number((e.target as HTMLInputElement).value))
                    }
                    onChange={(e) => setSegments(vertical, Number(e.target.value))}
                  />
                  <span>{radial}</span>
                </label>
                <div className="vector-thickness-hint">
                  Rings also snap to your polygon landmark heights.
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="vector-panel-footer">
        <div className="vector-poly-estimate">
          <span>
            {vertical}×{radial} · {capStyle}
          </span>
          <span>
            ≈ {estimatedVertices.toLocaleString()}v · {estimatedFaces.toLocaleString()}t
            {validPartCount > 1 ? ` · ${validPartCount} objects` : ''}
          </span>
        </div>
        <div className="vector-footer-actions">
          {onBuildAndEdit ? (
            <button
              type="button"
              className="primary vector-generate"
              onClick={() => generateAll(true)}
              title="Commit mesh and open MODEL"
            >
              Build & Edit in Model
            </button>
          ) : (
            <button type="button" className="primary vector-generate" onClick={() => generateAll(false)}>
              Build All Parts
            </button>
          )}
          <button type="button" onClick={() => generateAll(false)} title="Commit all parts to the scene">
            Build
          </button>
          <button type="button" onClick={addActiveToMesh} title="Add this part as its own object">
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
