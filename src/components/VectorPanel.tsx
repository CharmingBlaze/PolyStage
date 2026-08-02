import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { CADMesh } from '../types/cad';
import {
  analyzeVectorMesh,
  applyVectorSectionEdits,
  qualityToSegments,
  resolveVectorPartTransform,
  segmentsToQuality,
  validateVectorPaths,
  VECTOR_DENSITY_PRESETS,
  vectorPrimitiveToMesh,
  vectorPathsToMesh,
  vectorSnapshotToCADMesh,
  type VectorMeshSnapshot,
  type VectorPrimitiveType,
} from '../utils/vectorBlockout';
import { useVectorStore } from '../store/useVectorStore';

type PanelTab = 'draw' | 'parts' | 'ref' | 'mesh';
type MeshSubTab = 'detail' | 'caps' | 'advanced';

interface VectorPanelProps {
  /** Create or update one linked scene mesh per blockout part. */
  onBuildAll: (meshes: CADMesh[]) => void;
  /** Append the active part as its own object. */
  onAddActive: (mesh: CADMesh) => void;
  /** Optional: after a successful build, jump to MODEL workspace. */
  onBuildAndEdit?: (meshes: CADMesh[]) => void;
  onStatus?: (message: string) => void;
}

export function VectorPanel({ onBuildAll, onAddActive, onBuildAndEdit, onStatus }: VectorPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [docked, setDocked] = useState(true);
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
  const addPrimitivePart = useVectorStore((s) => s.addPrimitivePart);
  const mirrorPart = useVectorStore((s) => s.mirrorPart);
  const setActivePart = useVectorStore((s) => s.setActivePart);
  const renamePart = useVectorStore((s) => s.renamePart);
  const patchActivePart = useVectorStore((s) => s.patchActivePart);
  const addSection = useVectorStore((s) => s.addSection);
  const patchSection = useVectorStore((s) => s.patchSection);
  const deleteSection = useVectorStore((s) => s.deleteSection);
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
    if (docked) return;
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
  const activeTransform = activePart.transform ?? {
    position: { x: 0, y: 0, z: 0 },
    rotationY: 0,
    scale: { x: 1, y: 1, z: 1 },
  };
  const activeSections = activePart.sections || [];
  const canInsert =
    !!selected &&
    (activePath.closed || selected.index < activePath.anchors.length - 1);
  const polyQuality = segmentsToQuality(vertical, radial);
  const qualityLabel =
    polyQuality <= 18
      ? 'Low'
      : polyQuality <= 40
        ? 'Game'
        : polyQuality <= 65
          ? 'Solid'
          : 'Dense';
  const applyMeshQuality = (quality: number) => {
    const next = qualityToSegments(quality);
    setSegments(next.vertical, next.radial);
  };
  const validPartCount = parts.filter(
    (part) => part.kind === 'primitive' || part.paths.front.closed || part.paths.side.closed
  ).length;
  const missingAxis =
    (paths.front.closed ? 0 : 1) + (paths.side.closed ? 0 : 1) === 1;
  // Game caps: inset ring + diameter strip (no poles/tris). Pointed: pole fans.
  const tipVerts = capStyle === 'game' ? 2 * radial : 2;
  const tipFaces =
    capStyle === 'game'
      ? 2 * (radial + Math.max(0, radial / 2 - 1))
      : 2 * radial;
  const estimatedVertices =
    ((vertical + 1) * radial + tipVerts) * Math.max(validPartCount, 1);
  const estimatedFaces =
    (radial * vertical + tipFaces) * Math.max(validPartCount, 1);

  const refPlane = activePlane === 'top' ? 'front' : activePlane;
  const activeRef = refPlane === 'front' || refPlane === 'side' ? refImages[refPlane] : null;
  const frontReady = paths.front.closed;
  const sideReady = paths.side.closed;
  const validationIssues =
    activePart.kind === 'primitive' ? [] : validateVectorPaths(paths);
  const selectedAnchor = selected ? paths[selected.plane]?.anchors[selected.index] : null;

  const patchTransform = (
    section: 'position' | 'scale' | 'rotationY',
    axis: 'x' | 'y' | 'z' | null,
    value: number,
  ) => {
    if (section === 'rotationY') {
      patchActivePart({ transform: { ...activeTransform, rotationY: value } });
      return;
    }
    patchActivePart({
      transform: {
        ...activeTransform,
        [section]: {
          ...activeTransform[section],
          [axis!]: value,
        },
      },
    });
  };

  const addPrimitive = (type: VectorPrimitiveType) => {
    addPrimitivePart(type);
    setTab('parts');
  };

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
        className={`vector-panel vector-panel-collapsed ${docked ? 'vector-panel-docked' : 'vector-panel-floating'}`}
        style={docked ? undefined : { left: panelPos.x, top: panelPos.y, bottom: 'auto' }}
        onPointerDown={docked ? undefined : onHeaderPointerDown}
        onPointerMove={docked ? undefined : onHeaderPointerMove}
        onPointerUp={docked ? undefined : onHeaderPointerUp}
      >
        <span>Vector Blockout · {activePart.name}</span>
        <div className="vector-title-actions">
          <button type="button" onClick={() => setDocked((value) => !value)}>
            {docked ? 'Float' : 'Dock Bottom'}
          </button>
          <button type="button" onClick={() => setCollapsed(false)}>Expand</button>
        </div>
      </div>
    );
  }

  const meshForPart = (part: typeof activePart): VectorMeshSnapshot | null => {
    const base = part.kind === 'primitive' && part.primitive
      ? vectorPrimitiveToMesh(part.primitive)
      : vectorPathsToMesh(
          part.paths.front.closed ? part.paths.front : null,
          part.paths.side.closed ? part.paths.side : null,
          vertical,
          radial,
          part.paths.top.closed ? part.paths.top : null,
          { thickness, gameTopology: true, capStyle, taperThickness: true, roundness }
        );
    if (!base) return null;
    return applyVectorSectionEdits(base, part.sections || []);
  };

  const partsForBuild = () => {
    const store = useVectorStore.getState();
    return store.parts.map((part) =>
      part.id === store.activePartId ? { ...part, paths: store.paths } : part
    );
  };

  const activePreviewMesh = activePart.hidden
    ? null
    : meshForPart({ ...activePart, paths });
  const activeMeshAudit = activePreviewMesh ? analyzeVectorMesh(activePreviewMesh) : null;
  const activeValidationIssues = [
    ...validationIssues,
    ...(activeMeshAudit?.issues || []),
  ];
  const previewMeshes = partsForBuild()
    .filter((part) => !part.hidden)
    .map((part) => meshForPart(part))
    .filter((mesh): mesh is VectorMeshSnapshot => !!mesh);
  const previewStats = previewMeshes.reduce(
    (totals, mesh) => {
      const audit = analyzeVectorMesh(mesh);
      totals.vertices += audit.vertices;
      totals.triangles += audit.triangles;
      return totals;
    },
    { vertices: 0, triangles: 0 }
  );

  const generateAll = (andEdit = false) => {
    const buildParts = partsForBuild();
    const blocking = buildParts
      .filter(
        (part) =>
          !part.hidden &&
          part.kind !== 'primitive' &&
          Object.values(part.paths).some((path) => path.anchors.length > 0)
      )
      .flatMap((part) =>
        validateVectorPaths(part.paths)
          .filter((issue) => issue.severity === 'error')
          .map((issue) => `${part.name}: ${issue.message}`)
      );
    if (blocking.length) {
      onStatus?.(`Cannot update Blockout — ${blocking[0]}`);
      return;
    }
    const generated = buildParts
      .filter((part) => !part.hidden)
      .map((part) => ({ part, mesh: meshForPart(part) }))
      .filter((item): item is { part: typeof activePart; mesh: VectorMeshSnapshot } => !!item.mesh);
    if (!generated.length) {
      onStatus?.(
        'Close a Front or Side silhouette for height (click point 1). Top is optional and shapes the XZ cross-section.'
      );
      return;
    }
    const topologyBlocking = generated.flatMap(({ part, mesh }) =>
      analyzeVectorMesh(mesh).issues
        .filter((issue) => issue.severity === 'error')
        .map((issue) => `${part.name}: ${issue.message}`)
    );
    if (topologyBlocking.length) {
      onStatus?.(`Cannot update Blockout — ${topologyBlocking[0]}`);
      return;
    }
    const revision = useVectorStore.getState().revision;
    const meshes = generated.map((item) => {
      const transform = resolveVectorPartTransform(item.part, buildParts);
      const cad = vectorSnapshotToCADMesh(item.mesh, item.part.name, {
        seedTexture: '#d2b48c',
        transform,
      });
      const authored = {
        position: { ...cad.position },
        rotation: { ...cad.rotation },
        scale: { ...cad.scale },
      };
      return {
        ...cad,
        blockoutPartId: item.part.id,
        blockoutRevision: revision,
        blockoutTransform: authored,
      };
    });
    onBuildAll(meshes);
    useVectorStore.getState().markBuilt();
    const totalVerts = meshes.reduce((n, m) => n + m.vertices.length, 0);
    const totalFaces = meshes.reduce((n, m) => n + m.faces.length, 0);
    onStatus?.(
      andEdit
        ? `Built ${meshes.length} game mesh${meshes.length === 1 ? '' : 'es'} (${totalVerts} verts · ${totalFaces} quads) — opening MODEL.`
        : `Built ${meshes.length} · ${qualityLabel} ${vertical}×${radial} · ${totalVerts} verts · ${totalFaces} faces (all-quad tips).`
    );
    if (andEdit) onBuildAndEdit?.(meshes);
  };

  const addActiveToMesh = () => {
    const store = useVectorStore.getState();
    const current = store.parts.find((part) => part.id === store.activePartId);
    const generated = current ? meshForPart({ ...current, paths: store.paths }) : null;
    if (!generated) {
      onStatus?.(`Close a Front or Side silhouette for ${activePart.name} first.`);
      return;
    }
    const transform = resolveVectorPartTransform(activePart, store.parts);
    const cad = vectorSnapshotToCADMesh(generated, activePart.name, {
      seedTexture: '#d2b48c',
      transform,
    });
    const authored = {
      position: { ...cad.position },
      rotation: { ...cad.rotation },
      scale: { ...cad.scale },
    };
    const partMesh = {
      ...cad,
      blockoutPartId: activePart.id,
      blockoutRevision: store.revision,
      blockoutTransform: authored,
    };
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

  if (docked) {
    const openFloatingTab = (nextTab: PanelTab) => {
      setTab(nextTab);
      setCollapsed(false);
      setDocked(false);
    };
    const hasBlockingIssue = activeValidationIssues.some((issue) => issue.severity === 'error');

    return (
      <div className="vector-panel vector-panel-dockbar" aria-label="Vector Blockout dock">
        <div className="vector-dock-brand">
          <span>Blockout</span>
          <button type="button" onClick={() => setDocked(false)} title="Open the full floating panel">
            Panel
          </button>
        </div>

        <div className="vector-dock-group" aria-label="Active silhouette">
          {(['front', 'side', 'top'] as const).map((plane) => {
            const ready = paths[plane].closed;
            const started = paths[plane].anchors.length > 0;
            return (
              <button
                key={plane}
                type="button"
                className={`${activePlane === plane ? 'active' : ''}${ready ? ' is-ready' : started ? ' is-drawing' : ''}`}
                onClick={() => setActivePlane(plane)}
                title={
                  ready
                    ? `${plane} closed — ready`
                    : started
                      ? `${plane} open — keep drawing or close`
                      : `Draw ${plane} silhouette`
                }
              >
                {plane === 'front' ? 'F' : plane === 'side' ? 'S' : 'T'}
                {ready ? '✓' : ''}
              </button>
            );
          })}
        </div>

        <div className="vector-dock-group">
          <button type="button" className={mode === 'pen' ? 'active' : ''} onClick={() => setMode('pen')}>
            Draw
          </button>
          <button type="button" className={mode === 'edit' ? 'active' : ''} onClick={() => setMode('edit')}>
            Edit
          </button>
        </div>

        <div className="vector-dock-group">
          <button
            type="button"
            className={pathStyle === 'polygon' ? 'active' : ''}
            onClick={() => setPathStyle('polygon')}
          >
            Poly
          </button>
          <button
            type="button"
            className={pathStyle === 'curve' ? 'active' : ''}
            onClick={() => setPathStyle('curve')}
          >
            Curve
          </button>
        </div>

        <div className="vector-dock-group">
          <button
            type="button"
            className={pointEditMode === 'symmetric' ? 'active' : ''}
            onClick={() => setPointEditMode('symmetric')}
            title="Mirror Move — paired points stay even when Mirror Width is on"
          >
            Mirror
          </button>
          <button
            type="button"
            className={pointEditMode === 'free' ? 'active' : ''}
            onClick={() => setPointEditMode('free')}
            title="Free Move — drag one point at a time"
          >
            Free
          </button>
        </div>

        <div className="vector-dock-group vector-dock-history">
          <button type="button" disabled={!historyCount} onClick={() => useVectorStore.getState().undo()}>
            Undo
          </button>
          <button type="button" disabled={!futureCount} onClick={() => useVectorStore.getState().redo()}>
            Redo
          </button>
        </div>

        <label className="vector-dock-snap">
          <input type="checkbox" checked={snap} onChange={(event) => setSnap(event.target.checked)} />
          Snap
          <select value={snapSize} onChange={(event) => setSnapSize(Number(event.target.value))}>
            {[0.05, 0.1, 0.25, 0.5, 1].map((value) => (
              <option key={value} value={value}>{value.toFixed(2)}</option>
            ))}
          </select>
        </label>

        <div className="vector-dock-group vector-dock-open" aria-label="Open full panel tab">
          {(['parts', 'ref', 'mesh'] as const).map((nextTab) => (
            <button key={nextTab} type="button" onClick={() => openFloatingTab(nextTab)}>
              {nextTab[0].toUpperCase() + nextTab.slice(1)}
            </button>
          ))}
        </div>

        <span
          className={`vector-dock-status ${hasBlockingIssue ? 'error' : 'ok'}`}
          title={
            hasBlockingIssue
              ? activeValidationIssues[0]?.message
              : `${qualityLabel} topology · ${vertical}×${radial} · ~${estimatedFaces} faces`
          }
        >
          {hasBlockingIssue ? '!' : '✓'}
        </span>

        <span className="vector-dock-poly" title="Estimated game mesh size">
          {vertical}×{radial}
        </span>

        <button
          type="button"
          className="primary vector-dock-build"
          onClick={() => generateAll(!!onBuildAndEdit)}
        >
          {onBuildAndEdit ? 'Update & Edit' : 'Update'}
        </button>

        <button type="button" className="vector-dock-collapse" onClick={() => setCollapsed(true)}>
          Hide
        </button>
      </div>
    );
  }

  return (
    <div
      className="vector-panel vector-panel-floating"
      style={{ left: panelPos.x, top: panelPos.y, bottom: 'auto' }}
    >
      <div
        className="vector-panel-title"
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
      >
        <span>Vector Blockout</span>
        <div className="vector-title-actions">
          <span className="vector-badge">{activePart.name}</span>
          <button type="button" onClick={() => setDocked((value) => !value)}>
            {docked ? 'Float' : 'Dock Bottom'}
          </button>
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

            {selected && selectedAnchor ? (
              <>
                <div className="vector-section-label">Selected point · numeric</div>
                <div className="vector-numeric-grid">
                  <label>
                    U
                    <input
                      type="number"
                      step={snap ? snapSize : 0.01}
                      value={Number(selectedAnchor.point.u.toFixed(3))}
                      onChange={(e) =>
                        useVectorStore.getState().moveAnchor(selected.plane, selected.index, {
                          u: Number(e.target.value),
                          v: selectedAnchor.point.v,
                        })
                      }
                    />
                  </label>
                  <label>
                    V
                    <input
                      type="number"
                      step={snap ? snapSize : 0.01}
                      value={Number(selectedAnchor.point.v.toFixed(3))}
                      onChange={(e) =>
                        useVectorStore.getState().moveAnchor(selected.plane, selected.index, {
                          u: selectedAnchor.point.u,
                          v: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                </div>
              </>
            ) : null}
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
              <button type="button" onClick={mirrorPart} title="Create a linked-style copy mirrored across X">
                Mirror X
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
            <div className="vector-section-label">Quick primitives</div>
            <div className="vector-quality-presets">
              {(['box', 'cylinder', 'wedge', 'capsule'] as VectorPrimitiveType[]).map((type) => (
                <button type="button" key={type} onClick={() => addPrimitive(type)}>
                  {type[0].toUpperCase() + type.slice(1)}
                </button>
              ))}
            </div>

            <div className="vector-section-label">Assembly</div>
            <div className="vector-part-row">
              <select
                value={activePart.parentId || ''}
                onChange={(e) => patchActivePart({ parentId: e.target.value || null })}
                aria-label="Parent blockout part"
              >
                <option value="">No parent</option>
                {parts.filter((part) => part.id !== activePart.id).map((part) => (
                  <option key={part.id} value={part.id}>{part.name}</option>
                ))}
              </select>
              <button
                type="button"
                className={activePart.hidden ? 'active' : ''}
                onClick={() => patchActivePart({ hidden: !activePart.hidden })}
              >
                {activePart.hidden ? 'Show' : 'Hide'}
              </button>
            </div>
            <div className="vector-numeric-grid vector-numeric-grid-3">
              {(['x', 'y', 'z'] as const).map((axis) => (
                <label key={`position-${axis}`}>
                  {axis.toUpperCase()}
                  <input
                    type="number"
                    step={snap ? snapSize : 0.05}
                    value={Number(activeTransform.position[axis].toFixed(3))}
                    onChange={(e) => patchTransform('position', axis, Number(e.target.value))}
                  />
                </label>
              ))}
              <label>
                Y°
                <input
                  type="number"
                  step="5"
                  value={Number(activeTransform.rotationY.toFixed(2))}
                  onChange={(e) => patchTransform('rotationY', null, Number(e.target.value))}
                />
              </label>
              {(['x', 'y', 'z'] as const).map((axis) => (
                <label key={`scale-${axis}`}>
                  S{axis.toUpperCase()}
                  <input
                    type="number"
                    min="0.01"
                    step="0.05"
                    value={Number(activeTransform.scale[axis].toFixed(3))}
                    onChange={(e) => patchTransform('scale', axis, Math.max(0.01, Number(e.target.value)))}
                  />
                </label>
              ))}
            </div>

            {activePart.kind === 'primitive' && activePart.primitive ? (
              <>
                <div className="vector-section-label">Primitive dimensions</div>
                <div className="vector-numeric-grid vector-numeric-grid-3">
                  {(['width', 'height', 'depth'] as const).map((key) => (
                    <label key={key}>
                      {key[0].toUpperCase()}
                      <input
                        type="number"
                        min="0.02"
                        step="0.1"
                        value={activePart.primitive![key]}
                        onChange={(e) =>
                          patchActivePart({
                            primitive: {
                              ...activePart.primitive!,
                              [key]: Math.max(0.02, Number(e.target.value)),
                            },
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
              </>
            ) : null}
            <div className="vector-help">
              Parent, position, mirror, hide, and combine silhouette or primitive parts. Hidden parts are skipped when building.
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
                <div className="vector-section-label">Reference calibration</div>
                <div className="vector-numeric-grid">
                  <label>
                    Length
                    <input
                      type="number"
                      min="0.01"
                      step="0.1"
                      value={activeRef.calibrationLength ?? Number(activeRef.scale.toFixed(2))}
                      onChange={(e) => {
                        const length = Math.max(0.01, Number(e.target.value));
                        patchRefImage(refPlane, {
                          calibrationLength: length,
                          scale: length,
                        });
                      }}
                    />
                  </label>
                  <label>
                    Unit
                    <input
                      type="text"
                      value={activeRef.calibrationUnit || 'm'}
                      onChange={(e) => patchRefImage(refPlane, { calibrationUnit: e.target.value })}
                    />
                  </label>
                </div>
                <div className="vector-thickness-hint">
                  The entered length sets the image’s longest edge in world units.
                </div>
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
                  <span>Low</span>
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
                  All-quad game loft · {estimatedFaces} faces · {estimatedVertices} verts (est.)
                </div>
                <div className="vector-quality-presets">
                  {(Object.keys(VECTOR_DENSITY_PRESETS) as Array<keyof typeof VECTOR_DENSITY_PRESETS>).map((key) => {
                    const preset = VECTOR_DENSITY_PRESETS[key];
                    const active =
                      vertical === preset.vertical && radial === preset.radial;
                    return (
                      <button
                        key={key}
                        type="button"
                        className={active ? 'active' : ''}
                        onClick={() => setSegments(preset.vertical, preset.radial)}
                        title={preset.hint}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
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
                    ? 'All-quad tips (inset loop + diameter strip) — clean for UV, bevel, and game export.'
                    : 'Organic pointed tips with a pole fan (uses triangles).'}
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

                <div className="vector-section-editor">
                  <div className="vector-quality-heading">
                    <span>3D Cross-sections</span>
                    <button type="button" onClick={addSection}>+ Section</button>
                  </div>
                  <div className="vector-thickness-hint">
                    Localized ring controls update the 3D preview live.
                  </div>
                  {activeSections.map((section, index) => (
                    <div className="vector-section-card" key={section.id}>
                      <div className="vector-section-card-title">
                        <strong>Section {index + 1}</strong>
                        <button type="button" className="danger" onClick={() => deleteSection(section.id)}>×</button>
                      </div>
                      <label>
                        Height
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.01"
                          value={section.t}
                          onChange={(e) => patchSection(section.id, { t: Number(e.target.value) })}
                        />
                        <span>{Math.round(section.t * 100)}%</span>
                      </label>
                      <div className="vector-numeric-grid vector-numeric-grid-3">
                        {([
                          ['width', 'W'],
                          ['depth', 'D'],
                          ['offsetX', 'X'],
                          ['offsetZ', 'Z'],
                          ['twist', '°'],
                          ['falloff', 'Fall'],
                        ] as const).map(([key, label]) => (
                          <label key={key}>
                            {label}
                            <input
                              type="number"
                              step={key === 'twist' ? 5 : 0.05}
                              min={key === 'width' || key === 'depth' ? 0.02 : key === 'falloff' ? 0.02 : undefined}
                              value={Number(section[key].toFixed(3))}
                              onChange={(e) => patchSection(section.id, { [key]: Number(e.target.value) })}
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                  {!activeSections.length ? (
                    <div className="vector-thickness-hint">Add a section to taper, bulge, offset, or twist the mesh at a chosen height.</div>
                  ) : null}
                </div>

                <label>
                  Height rings
                  <input
                    type="range"
                    min="3"
                    max="24"
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
                    min="8"
                    max="24"
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
                  Important landmarks stay within budget. Vertical seams stay centered on the Front and Side silhouettes.
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="vector-panel-footer">
        <div className={`vector-validation ${activeValidationIssues.some((issue) => issue.severity === 'error') ? 'has-error' : ''}`}>
          {activeValidationIssues.length ? (
            activeValidationIssues.slice(0, 3).map((issue, index) => (
              <span key={`${issue.message}-${index}`} className={issue.severity}>
                {issue.severity === 'error' ? '!' : '△'} {issue.message}
              </span>
            ))
          ) : (
            <span className="ok">✓ Active part is build-ready</span>
          )}
        </div>
        <div className="vector-poly-estimate">
          <span>
            {vertical}×{radial} · {capStyle}
          </span>
          <span>
            {previewStats.vertices
              ? `${previewStats.vertices.toLocaleString()}v · ${previewStats.triangles.toLocaleString()}t`
              : `≈ ${estimatedVertices.toLocaleString()}v · ${estimatedFaces.toLocaleString()}t`}
            {validPartCount > 1 ? ` · ${validPartCount} objects` : ''}
          </span>
        </div>
        <div className="vector-footer-actions">
          {onBuildAndEdit ? (
            <button
              type="button"
              className="primary vector-generate"
              onClick={() => generateAll(true)}
              title="Create or update linked meshes and open MODEL"
            >
              Update & Edit in Model
            </button>
          ) : (
            <button type="button" className="primary vector-generate" onClick={() => generateAll(false)}>
              Update All Parts
            </button>
          )}
          <button type="button" onClick={() => generateAll(false)} title="Create or update linked scene meshes">
            Update
          </button>
          <button type="button" onClick={addActiveToMesh} title="Add this part as its own object">
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
