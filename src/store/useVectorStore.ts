import { create } from 'zustand';
import type {
  BezierAnchor,
  BezierPath,
  VectorCapStyle,
  VectorPlane,
  VectorPoint,
} from '../utils/vectorBlockout';
import {
  DEFAULT_BLOCKOUT_THICKNESS,
  buildCompanionCagePath,
  closestPointOnPath,
  evenRadialSegments,
  findMirroredAnchorIndex,
  sharpAnchor,
} from '../utils/vectorBlockout';

type VectorMode = 'pen' | 'edit';
type VectorPathStyle = 'polygon' | 'curve';
/** How Front/Side polygon points move while editing. */
export type VectorPointEditMode = 'symmetric' | 'free';
type SelectedPoint = { plane: VectorPlane; index: number } | null;
/** Indices on `selected.plane` (or empty). Primary is `selected.index`. */
type SelectedIndices = number[];
export type VectorPart = {
  id: string;
  name: string;
  paths: Record<VectorPlane, BezierPath>;
};
export type VectorRefPlaneId = 'front' | 'side';
export type VectorRefTool = 'none' | 'move' | 'scale';
export type VectorRefImage = {
  name: string;
  dataUrl: string;
  opacity: number;
  /** World-space size of the longer edge. */
  scale: number;
  /** Image width / height (stored at load so transforms don’t need the texture). */
  aspect: number;
  /** In-plane horizontal: Front → X, Side → Z. */
  offsetU: number;
  /** In-plane vertical → Y. */
  offsetV: number;
  /** When true, move/scale tools cannot change this plane. */
  locked: boolean;
};
type VectorSnapshot = {
  paths: Record<VectorPlane, BezierPath>;
  parts: VectorPart[];
  activePartId: string;
  selected: SelectedPoint;
  selectedIndices: SelectedIndices;
  activePlane: VectorPlane;
};

type VectorStore = {
  paths: Record<VectorPlane, BezierPath>;
  parts: VectorPart[];
  activePartId: string;
  mode: VectorMode;
  /** Polygon = sharp corners (game blockout). Curve = Bézier handles. */
  pathStyle: VectorPathStyle;
  /** Keep Front/Side cages symmetric across the center line while dragging. */
  mirrorWidth: boolean;
  /**
   * Front/Side point drag:
   * - symmetric: mirror partner moves when Mirror is on
   * - free: move exactly one point, never mirrors
   */
  pointEditMode: VectorPointEditMode;
  selected: SelectedPoint;
  /** All selected anchor indices on `selected.plane` (includes primary). */
  selectedIndices: SelectedIndices;
  activePlane: VectorPlane;
  snap: boolean;
  snapSize: number;
  verticalSegments: number;
  radialSegments: number;
  /** Full width for the missing Front/Side axis when only one silhouette is closed. */
  thickness: number;
  /** Tip topology: game (quad inset) or pointed (pole). */
  capStyle: VectorCapStyle;
  /**
   * Cross-section roundness: 0 = square (default), 1 = fully round.
   */
  roundness: number;
  /** Ortho underlays for tracing reference art (3D planes in every blockout view). */
  refImages: Partial<Record<VectorRefPlaneId, VectorRefImage | null>>;
  /** Move / scale tool for the active reference plane (viewport chrome). */
  refTool: VectorRefTool;
  refEditPlane: VectorRefPlaneId | null;
  revision: number;
  /** Revision at last Build — used to hide ghost when solid mesh is current. */
  builtRevision: number | null;
  panelPos: { x: number; y: number };
  setPanelPos: (pos: { x: number; y: number }) => void;
  history: VectorSnapshot[];
  future: VectorSnapshot[];
  setMode: (mode: VectorMode) => void;
  setPathStyle: (style: VectorPathStyle) => void;
  setMirrorWidth: (enabled: boolean) => void;
  setPointEditMode: (mode: VectorPointEditMode) => void;
  /** Seed Front width or Side depth polygon from the other closed silhouette. */
  seedCompanionCage: (target: 'front' | 'side') => boolean;
  addPart: () => void;
  duplicatePart: () => void;
  deletePart: () => void;
  renamePart: (name: string) => void;
  setActivePart: (id: string) => void;
  setSelected: (selected: SelectedPoint) => void;
  /** Replace or add (Shift) a marquee / multi point selection on one plane. */
  selectPoints: (
    plane: VectorPlane,
    indices: number[],
    options?: { additive?: boolean; primary?: number }
  ) => void;
  /** Shift-click toggle for a single silhouette point. */
  togglePoint: (plane: VectorPlane, index: number) => void;
  setActivePlane: (plane: VectorPlane) => void;
  setSnap: (enabled: boolean) => void;
  setSnapSize: (size: number) => void;
  setSegments: (vertical: number, radial: number) => void;
  setThickness: (thickness: number) => void;
  setCapStyle: (style: VectorCapStyle) => void;
  setRoundness: (roundness: number) => void;
  setRefImage: (plane: VectorRefPlaneId, image: VectorRefImage | null) => void;
  patchRefImage: (plane: VectorRefPlaneId, patch: Partial<VectorRefImage>) => void;
  setRefTool: (tool: VectorRefTool, plane?: VectorRefPlaneId | null) => void;
  markBuilt: () => void;
  checkpoint: () => void;
  undo: () => void;
  redo: () => void;
  addAnchor: (plane: VectorPlane, point: VectorPoint) => number;
  moveAnchor: (plane: VectorPlane, index: number, point: VectorPoint) => void;
  moveHandle: (
    plane: VectorPlane,
    index: number,
    handle: 'handleIn' | 'handleOut',
    point: VectorPoint,
    mirrored?: boolean
  ) => void;
  closePath: (plane: VectorPlane) => void;
  toggleClosed: (plane: VectorPlane) => void;
  insertAfterSelected: () => void;
  /** Insert a polygon point on the closest edge (mirrors if Mirror is on). */
  insertAtPoint: (plane: VectorPlane, point: VectorPoint) => void;
  deleteSelected: () => void;
  clearPath: (plane: VectorPlane) => void;
  clearAll: () => void;
  loadPaths: (
    paths: Record<'front' | 'side', BezierPath> & Partial<Record<'top', BezierPath>>
  ) => void;
  loadParts: (parts: VectorPart[], activePartId?: string) => void;
};

const makePath = (plane: VectorPlane): BezierPath => ({
  id: `${plane}_silhouette`,
  plane,
  name:
    plane === 'front'
      ? 'Front Silhouette'
      : plane === 'side'
        ? 'Side Silhouette'
        : 'Top Silhouette',
  anchors: [],
  closed: false,
});

const clonePoint = (point: VectorPoint): VectorPoint => ({ ...point });
const cloneAnchor = (anchor: BezierAnchor): BezierAnchor => ({
  point: clonePoint(anchor.point),
  handleIn: clonePoint(anchor.handleIn),
  handleOut: clonePoint(anchor.handleOut),
});
const clonePath = (path: BezierPath): BezierPath => ({
  ...path,
  anchors: path.anchors.map(cloneAnchor),
});
const clonePaths = (
  paths: Record<'front' | 'side', BezierPath> & Partial<Record<'top', BezierPath>>
): Record<VectorPlane, BezierPath> => ({
  front: clonePath(paths.front),
  side: clonePath(paths.side),
  top: paths.top ? clonePath(paths.top) : makePath('top'),
});
const cloneParts = (parts: VectorPart[]): VectorPart[] =>
  parts.map((part) => ({ ...part, paths: clonePaths(part.paths) }));
let partSerial = 1;
const makePart = (name = 'Part 1'): VectorPart => {
  const id = `vector_part_${Date.now()}_${partSerial++}`;
  return {
    id,
    name,
    paths: {
      front: makePath('front'),
      side: makePath('side'),
      top: makePath('top'),
    },
  };
};
const midpoint = (a: VectorPoint, b: VectorPoint): VectorPoint => ({
  u: (a.u + b.u) / 2,
  v: (a.v + b.v) / 2,
});

export const useVectorStore = create<VectorStore>((set, get) => {
  const firstPart = makePart();
  const syncActivePaths = (
    paths: Record<VectorPlane, BezierPath>
  ): Pick<VectorStore, 'paths' | 'parts'> => {
    const state = get();
    return {
      paths,
      parts: state.parts.map((part) =>
        part.id === state.activePartId ? { ...part, paths: clonePaths(paths) } : part
      ),
    };
  };
  const snapshot = (): VectorSnapshot => {
    const state = get();
    return {
      paths: clonePaths(state.paths),
      parts: cloneParts(state.parts),
      activePartId: state.activePartId,
      selected: state.selected ? { ...state.selected } : null,
      selectedIndices: [...state.selectedIndices],
      activePlane: state.activePlane,
    };
  };
  const checkpoint = () =>
    set((state) => ({
      history: [...state.history.slice(-79), snapshot()],
      future: [],
    }));
  const snapped = (point: VectorPoint) => {
    const state = get();
    if (!state.snap) return point;
    const size = Math.max(0.01, state.snapSize);
    return {
      u: Math.round(point.u / size) * size,
      v: Math.round(point.v / size) * size,
    };
  };
  /** Build selection fields for one plane. Empty indices clears selection. */
  const selectionOf = (
    plane: VectorPlane,
    indices: number[],
    primary?: number
  ): Pick<VectorStore, 'selected' | 'selectedIndices' | 'activePlane'> => {
    const unique = [...new Set(indices)]
      .filter((i) => Number.isFinite(i) && i >= 0)
      .sort((a, b) => a - b);
    if (!unique.length) {
      return { selected: null, selectedIndices: [], activePlane: plane };
    }
    const index =
      primary != null && unique.includes(primary)
        ? primary
        : unique[unique.length - 1];
    return {
      selected: { plane, index },
      selectedIndices: unique,
      activePlane: plane,
    };
  };
  const clearSelection = (): Pick<VectorStore, 'selected' | 'selectedIndices'> => ({
    selected: null,
    selectedIndices: [],
  });

  return {
    paths: clonePaths(firstPart.paths),
    parts: [firstPart],
    activePartId: firstPart.id,
    mode: 'pen',
    pathStyle: 'polygon',
    mirrorWidth: true,
    pointEditMode: 'symmetric',
    selected: null,
    selectedIndices: [],
    activePlane: 'front',
    snap: true,
    snapSize: 0.1,
    verticalSegments: 10,
    radialSegments: 12,
    thickness: DEFAULT_BLOCKOUT_THICKNESS,
    capStyle: 'game',
    roundness: 0,
    refImages: {},
    refTool: 'none',
    refEditPlane: null,
    revision: 0,
    builtRevision: null,
    panelPos: { x: 14, y: 120 },
    setPanelPos: (panelPos) => set({ panelPos }),
    history: [],
    future: [],

    setMode: (mode) => set({ mode }),
    setPathStyle: (pathStyle) => set({ pathStyle }),
    setMirrorWidth: (mirrorWidth) => set({ mirrorWidth }),
    setPointEditMode: (pointEditMode) =>
      set((state) => ({
        pointEditMode,
        mode: 'edit',
        // Free move is always a single-point tool.
        ...(pointEditMode === 'free' && state.selected
          ? {
              selectedIndices: [state.selected.index],
            }
          : {}),
      })),
    seedCompanionCage: (target) => {
      const state = get();
      const sourcePlane = target === 'front' ? 'side' : 'front';
      const source = state.paths[sourcePlane];
      if (!source.closed || source.anchors.length < 3) return false;
      checkpoint();
      const cage = buildCompanionCagePath(
        source,
        target,
        Math.max(0.08, state.thickness / 2),
        Math.max(4, Math.round(state.verticalSegments / 2))
      );
      if (cage.anchors.length < 4) return false;
      set({
        ...syncActivePaths({
          ...get().paths,
          [target]: cage,
        }),
        activePlane: target,
        ...selectionOf(target, [0]),
        mode: 'edit',
        pathStyle: 'polygon',
        revision: get().revision + 1,
      });
      return true;
    },
    markBuilt: () => set({ builtRevision: get().revision }),
    addPart: () => {
      checkpoint();
      const part = makePart(`Part ${get().parts.length + 1}`);
      set({
        parts: [...get().parts, part],
        activePartId: part.id,
        paths: clonePaths(part.paths),
        ...clearSelection(),
        activePlane: 'front',
        mode: 'pen',
        revision: get().revision + 1,
      });
    },
    duplicatePart: () => {
      const state = get();
      const source = state.parts.find((part) => part.id === state.activePartId);
      if (!source) return;
      checkpoint();
      const part = makePart(`${source.name} Copy`);
      part.paths = clonePaths(source.paths);
      set({
        parts: [...get().parts, part],
        activePartId: part.id,
        paths: clonePaths(part.paths),
        ...clearSelection(),
        revision: get().revision + 1,
      });
    },
    deletePart: () => {
      const state = get();
      if (state.parts.length <= 1) return;
      checkpoint();
      const index = state.parts.findIndex((part) => part.id === state.activePartId);
      const parts = state.parts.filter((part) => part.id !== state.activePartId);
      const next = parts[Math.min(Math.max(index, 0), parts.length - 1)];
      set({
        parts,
        activePartId: next.id,
        paths: clonePaths(next.paths),
        ...clearSelection(),
        activePlane: 'front',
        revision: get().revision + 1,
      });
    },
    renamePart: (name) => {
      const clean = name.trim();
      if (!clean) return;
      set({
        parts: get().parts.map((part) =>
          part.id === get().activePartId ? { ...part, name: clean } : part
        ),
      });
    },
    setActivePart: (activePartId) => {
      const part = get().parts.find((item) => item.id === activePartId);
      if (!part || part.id === get().activePartId) return;
      set({
        activePartId,
        paths: clonePaths(part.paths),
        ...clearSelection(),
        activePlane: 'front',
        mode: part.paths.front.closed || part.paths.side.closed ? 'edit' : 'pen',
        revision: get().revision + 1,
      });
    },
    setSelected: (selected) =>
      set(
        selected
          ? selectionOf(selected.plane, [selected.index], selected.index)
          : clearSelection()
      ),
    selectPoints: (plane, indices, options) => {
      const additive = options?.additive === true;
      const next =
        additive && get().selected?.plane === plane
          ? [...get().selectedIndices, ...indices]
          : indices;
      const sel = selectionOf(plane, next, options?.primary);
      set(next.length ? { ...sel, mode: 'edit' } : sel);
    },
    togglePoint: (plane, index) => {
      const state = get();
      if (state.selected?.plane === plane) {
        const has = state.selectedIndices.includes(index);
        const next = has
          ? state.selectedIndices.filter((i) => i !== index)
          : [...state.selectedIndices, index];
        set(selectionOf(plane, next, has ? undefined : index));
        return;
      }
      set(selectionOf(plane, [index], index));
    },
    setActivePlane: (activePlane) => set({ activePlane, ...clearSelection() }),
    setSnap: (snap) => set({ snap }),
    setSnapSize: (snapSize) => set({ snapSize: Math.max(0.01, snapSize) }),
    setSegments: (verticalSegments, radialSegments) =>
      set({
        verticalSegments: Math.max(3, Math.round(verticalSegments)),
        radialSegments: evenRadialSegments(radialSegments, 4),
        revision: get().revision + 1,
      }),
    setThickness: (thickness) =>
      set({
        thickness: Math.max(0.05, Math.min(4, Number(thickness) || DEFAULT_BLOCKOUT_THICKNESS)),
        revision: get().revision + 1,
      }),
    setCapStyle: (capStyle) => set({ capStyle, revision: get().revision + 1 }),
    setRoundness: (roundness) =>
      set({
        roundness: Math.max(0, Math.min(1, Number(roundness) || 0)),
        revision: get().revision + 1,
      }),
    setRefImage: (plane, image) =>
      set({
        refImages: { ...get().refImages, [plane]: image },
        refEditPlane: image ? plane : get().refEditPlane === plane ? null : get().refEditPlane,
        refTool: image ? get().refTool : get().refEditPlane === plane ? 'none' : get().refTool,
      }),
    patchRefImage: (plane, patch) => {
      const current = get().refImages[plane];
      if (!current) return;
      const next: Partial<VectorRefImage> = { ...patch };
      if (current.locked) {
        delete next.offsetU;
        delete next.offsetV;
        delete next.scale;
      }
      if (Object.keys(next).length === 0) return;
      set({
        refImages: { ...get().refImages, [plane]: { ...current, ...next } },
      });
    },
    setRefTool: (tool, plane) => {
      if (tool === 'none') {
        set({
          refTool: 'none',
          refEditPlane: plane === null ? null : get().refEditPlane,
        });
        return;
      }
      set({
        refTool: tool,
        refEditPlane: plane ?? get().refEditPlane,
      });
    },
    checkpoint,

    undo: () => {
      const state = get();
      const previous = state.history.at(-1);
      if (!previous) return;
      set({
        paths: clonePaths(previous.paths),
        parts: cloneParts(previous.parts),
        activePartId: previous.activePartId,
        selected: previous.selected ? { ...previous.selected } : null,
        selectedIndices: [...(previous.selectedIndices || [])],
        activePlane: previous.activePlane,
        history: state.history.slice(0, -1),
        future: [snapshot(), ...state.future].slice(0, 80),
        revision: state.revision + 1,
      });
    },

    redo: () => {
      const state = get();
      const next = state.future[0];
      if (!next) return;
      set({
        paths: clonePaths(next.paths),
        parts: cloneParts(next.parts),
        activePartId: next.activePartId,
        selected: next.selected ? { ...next.selected } : null,
        selectedIndices: [...(next.selectedIndices || [])],
        activePlane: next.activePlane,
        history: [...state.history.slice(-79), snapshot()],
        future: state.future.slice(1),
        revision: state.revision + 1,
      });
    },

    addAnchor: (plane, rawPoint) => {
      const path = get().paths[plane];
      if (path.closed) return -1;
      checkpoint();
      const point = snapped(rawPoint);
      const anchor: BezierAnchor = {
        point: { ...point },
        handleIn: { ...point },
        handleOut: { ...point },
      };
      const index = path.anchors.length;
      set({
        ...syncActivePaths({
          ...get().paths,
          [plane]: { ...path, anchors: [...path.anchors, anchor] },
        }),
        ...selectionOf(plane, [index], index),
        revision: get().revision + 1,
      });
      return index;
    },

    moveAnchor: (plane, index, rawPoint) => {
      const point = snapped(rawPoint);
      const path = get().paths[plane];
      const prev = path.anchors[index];
      if (!prev) return;
      const du = point.u - prev.point.u;
      const dv = point.v - prev.point.v;
      // Snap often makes consecutive moves identical — skip clone/notify work.
      if (du === 0 && dv === 0) return;

      const polygon = get().pathStyle === 'polygon';
      const state = get();
      const freeMove = state.pointEditMode === 'free';
      const groupMove =
        !freeMove &&
        state.selected?.plane === plane &&
        state.selectedIndices.includes(index) &&
        state.selectedIndices.length > 1;

      if (groupMove) {
        const toMove = new Set(state.selectedIndices);
        const anchors = path.anchors.map((anchor, i) => {
          if (!toMove.has(i)) return anchor;
          const nextPoint = { u: anchor.point.u + du, v: anchor.point.v + dv };
          return polygon
            ? sharpAnchor(nextPoint)
            : {
                point: nextPoint,
                handleIn: { u: anchor.handleIn.u + du, v: anchor.handleIn.v + dv },
                handleOut: { u: anchor.handleOut.u + du, v: anchor.handleOut.v + dv },
              };
        });
        set({
          ...syncActivePaths({ ...get().paths, [plane]: { ...path, anchors } }),
          revision: get().revision + 1,
        });
        return;
      }

      const mirror =
        !freeMove &&
        state.mirrorWidth &&
        polygon &&
        (plane === 'front' || plane === 'side');
      const mirrorIndex = mirror ? findMirroredAnchorIndex(path.anchors, index) : -1;

      const anchors = path.anchors.map((anchor, i) => {
        if (i === index) {
          return polygon
            ? sharpAnchor(point)
            : {
                point: { ...point },
                handleIn: { u: anchor.handleIn.u + du, v: anchor.handleIn.v + dv },
                handleOut: { u: anchor.handleOut.u + du, v: anchor.handleOut.v + dv },
              };
        }
        if (i === mirrorIndex) {
          const mirrored = { u: -point.u, v: point.v };
          return polygon
            ? sharpAnchor(mirrored)
            : {
                point: mirrored,
                handleIn: {
                  u: anchor.handleIn.u - (anchor.point.u + point.u),
                  v: anchor.handleIn.v + (point.v - anchor.point.v),
                },
                handleOut: {
                  u: anchor.handleOut.u - (anchor.point.u + point.u),
                  v: anchor.handleOut.v + (point.v - anchor.point.v),
                },
              };
        }
        return anchor;
      });
      set({
        ...syncActivePaths({ ...get().paths, [plane]: { ...path, anchors } }),
        revision: get().revision + 1,
      });
    },

    moveHandle: (plane, index, handle, point, mirrored = true) => {
      const path = get().paths[plane];
      const prev = path.anchors[index];
      if (!prev) return;
      const nextHandle = { u: point.u, v: point.v };
      const cur = prev[handle];
      if (cur.u === nextHandle.u && cur.v === nextHandle.v) return;
      const anchors = path.anchors.map((anchor, i) => {
        if (i !== index) return anchor;
        const other = handle === 'handleIn' ? 'handleOut' : 'handleIn';
        const next = { ...anchor, [handle]: nextHandle };
        if (mirrored) {
          next[other] = {
            u: anchor.point.u * 2 - point.u,
            v: anchor.point.v * 2 - point.v,
          };
        }
        return next;
      });
      set({
        ...syncActivePaths({ ...get().paths, [plane]: { ...path, anchors } }),
        revision: get().revision + 1,
      });
    },

    closePath: (plane) => {
      const path = get().paths[plane];
      if (path.closed || path.anchors.length < 3) return;
      checkpoint();
      set({
        ...syncActivePaths({ ...get().paths, [plane]: { ...path, closed: true } }),
        ...clearSelection(),
        activePlane: plane,
        mode: 'edit',
        revision: get().revision + 1,
      });
    },

    toggleClosed: (plane) => {
      const path = get().paths[plane];
      if (!path.closed && path.anchors.length < 3) return;
      checkpoint();
      set({
        ...syncActivePaths({ ...get().paths, [plane]: { ...path, closed: !path.closed } }),
        ...clearSelection(),
        activePlane: plane,
        mode: path.closed ? 'pen' : 'edit',
        revision: get().revision + 1,
      });
    },

    insertAfterSelected: () => {
      const selected = get().selected;
      if (!selected) return;
      const path = get().paths[selected.plane];
      const nextIndex = selected.index + 1;
      if (nextIndex >= path.anchors.length && !path.closed) return;
      checkpoint();
      const actualNext = nextIndex % path.anchors.length;
      const current = cloneAnchor(path.anchors[selected.index]);
      const next = cloneAnchor(path.anchors[actualNext]);
      if (get().pathStyle === 'polygon') {
        const point = midpoint(current.point, next.point);
        const anchors = path.anchors.map(cloneAnchor);
        anchors.splice(nextIndex, 0, sharpAnchor(point));
        set({
          ...syncActivePaths({
            ...get().paths,
            [selected.plane]: { ...path, anchors },
          }),
          ...selectionOf(selected.plane, [nextIndex], nextIndex),
          revision: get().revision + 1,
        });
        return;
      }
      // De Casteljau split at 50% preserves the original Bézier segment exactly.
      const a = midpoint(current.point, current.handleOut);
      const b = midpoint(current.handleOut, next.handleIn);
      const c = midpoint(next.handleIn, next.point);
      const d = midpoint(a, b);
      const e = midpoint(b, c);
      const point = midpoint(d, e);
      current.handleOut = a;
      next.handleIn = c;
      const inserted: BezierAnchor = { point, handleIn: d, handleOut: e };
      const anchors = path.anchors.map(cloneAnchor);
      anchors[selected.index] = current;
      anchors[actualNext] = next;
      anchors.splice(nextIndex, 0, inserted);
      set({
        ...syncActivePaths({
          ...get().paths,
          [selected.plane]: { ...path, anchors },
        }),
        ...selectionOf(selected.plane, [nextIndex], nextIndex),
        revision: get().revision + 1,
      });
    },

    insertAtPoint: (plane, rawPoint) => {
      const path = get().paths[plane];
      if (path.anchors.length < 2) return;
      const hit = closestPointOnPath(path, snapped(rawPoint));
      if (!hit) return;
      // Ignore clicks that are basically on an existing vertex.
      const nearExisting = path.anchors.some(
        (a) => Math.hypot(a.point.u - hit.point.u, a.point.v - hit.point.v) < 0.04
      );
      if (nearExisting) return;
      checkpoint();
      const insertOne = (anchors: BezierAnchor[], afterIndex: number, point: VectorPoint) => {
        const next = anchors.map(cloneAnchor);
        next.splice(afterIndex + 1, 0, sharpAnchor(point));
        return next;
      };
      let anchors = insertOne(path.anchors, hit.index, hit.point);
      let selectedIndex = hit.index + 1;

      if (
        get().pointEditMode !== 'free' &&
        get().mirrorWidth &&
        get().pathStyle === 'polygon' &&
        (plane === 'front' || plane === 'side')
      ) {
        const mirrored = { u: -hit.point.u, v: hit.point.v };
        const mirrorHit = closestPointOnPath({ ...path, anchors }, mirrored);
        if (
          mirrorHit &&
          Math.hypot(mirrored.u - mirrorHit.point.u, mirrored.v - mirrorHit.point.v) < 0.25
        ) {
          const nearMirror = anchors.some(
            (a) => Math.hypot(a.point.u - mirrored.u, a.point.v - mirrored.v) < 0.04
          );
          if (!nearMirror) {
            // Recompute closest segment on the updated path.
            const again = closestPointOnPath({ ...path, anchors }, mirrored);
            if (again) {
              const beforeLen = anchors.length;
              anchors = insertOne(anchors, again.index, {
                u: mirrored.u,
                v: again.point.v,
              });
              // Keep selection on the originally clicked insert if indices shifted.
              if (again.index < selectedIndex) selectedIndex += 1;
              if (anchors.length === beforeLen) {
                /* no-op */
              }
            }
          }
        }
      }

      set({
        ...syncActivePaths({ ...get().paths, [plane]: { ...path, anchors } }),
        ...selectionOf(plane, [selectedIndex], selectedIndex),
        mode: 'edit',
        revision: get().revision + 1,
      });
    },

    deleteSelected: () => {
      const selected = get().selected;
      const indices = get().selectedIndices;
      if (!selected || !indices.length) return;
      checkpoint();
      const path = get().paths[selected.plane];
      const remove = new Set(indices);
      const anchors = path.anchors.filter((_, i) => !remove.has(i));
      set({
        ...syncActivePaths({
          ...get().paths,
          [selected.plane]: {
            ...path,
            anchors,
            closed: path.closed && anchors.length >= 3,
          },
        }),
        ...clearSelection(),
        activePlane: selected.plane,
        revision: get().revision + 1,
      });
    },

    clearPath: (plane) => {
      if (!get().paths[plane].anchors.length) return;
      checkpoint();
      const clearSel = get().selected?.plane === plane;
      set({
        ...syncActivePaths({ ...get().paths, [plane]: makePath(plane) }),
        ...(clearSel ? clearSelection() : {}),
        activePlane: plane,
        mode: 'pen',
        revision: get().revision + 1,
      });
    },

    clearAll: () => {
      if (
        get().parts.length === 1 &&
        !get().paths.front.anchors.length &&
        !get().paths.side.anchors.length &&
        !get().paths.top.anchors.length
      ) return;
      checkpoint();
      const part = makePart('Part 1');
      set({
        paths: clonePaths(part.paths),
        parts: [part],
        activePartId: part.id,
        ...clearSelection(),
        activePlane: 'front',
        mode: 'pen',
        revision: get().revision + 1,
      });
    },

    loadPaths: (paths) => {
      const loadedPaths: Record<VectorPlane, BezierPath> = {
          front: { ...clonePath(paths.front), plane: 'front' as const },
          side: { ...clonePath(paths.side), plane: 'side' as const },
          top: paths.top
            ? { ...clonePath(paths.top), plane: 'top' as const }
            : makePath('top'),
      };
      const part = makePart('Part 1');
      part.paths = clonePaths(loadedPaths);
      set({
        paths: loadedPaths,
        parts: [part],
        activePartId: part.id,
        ...clearSelection(),
        activePlane: 'front',
        mode: 'edit',
        history: [],
        future: [],
        revision: get().revision + 1,
      });
    },
    loadParts: (parts, requestedActivePartId) => {
      if (!parts.length) return;
      const loaded = cloneParts(parts);
      const active =
        loaded.find((part) => part.id === requestedActivePartId) ?? loaded[0];
      set({
        parts: loaded,
        activePartId: active.id,
        paths: clonePaths(active.paths),
        ...clearSelection(),
        activePlane: 'front',
        mode: 'edit',
        history: [],
        future: [],
        revision: get().revision + 1,
      });
    },
  };
});
