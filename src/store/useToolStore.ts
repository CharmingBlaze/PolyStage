import { create } from 'zustand';
import type { ToolState, EditMode, TransformMode, PrimitiveType, ViewMode, PaintTool, RigMode, MirrorAxis } from '../types/cad';

export interface ToolStoreState extends ToolState {
  setEditMode: (mode: EditMode) => void;
  setTransformMode: (mode: TransformMode) => void;
  setViewMode: (mode: ViewMode) => void;
  setActivePrimitive: (type: PrimitiveType) => void;
  setDrawTool: (tool: PaintTool) => void;
  setGridSnap: (value: number) => void;
  setAngleSnap: (value: number) => void;
  toggleXRay: () => void;
  toggleLiveMirror: () => void;
  setMirrorAxis: (axis: MirrorAxis) => void;
  setRigMode: (mode: RigMode) => void;
  setModalTransform: (mode: ToolState['modalTransform']) => void;
  setModalMeshOp: (op: ToolState['modalMeshOp']) => void;
  setBrushSize: (size: number) => void;
  setActiveColor: (color: string) => void;
  togglePaint3D: () => void;
  reset: () => void;
}

const initialState: ToolState = {
  editMode: 'object',
  transformMode: 'combined',
  isPainting3D: false,
  isCadDrawing: false,
  cadDrawPrimitive: null,
  gridSnap: 0.25,
  angleSnap: 15,
  activePrimitive: 'cube',
  viewMode: 'lit',
  viewportLayout: 'single',
  activeColor: '#00d4e2',
  brushSize: 3,
  drawTool: 'pencil',
  paintOpacity: 1,
  paintSpacing: 0.12,
  paintMirrorU: false,
  uvSnapToPixel: true,
  placeOnClick: false,
  rigMode: 'edit',
  weightPaintMode: 'add',
  modalTransform: null,
  modalMeshOp: null,
  liveMirror: false,
  mirrorAxis: 'x',
  mirrorClip: true,
  mirrorMergeThreshold: 0.001,
  mirrorBones: false,
  xray: false,
};

export const useToolStore = create<ToolStoreState>((set) => ({
  ...initialState,

  setEditMode: (mode) => set({ editMode: mode }),
  setTransformMode: (mode) => set({ transformMode: mode, modalTransform: null }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setActivePrimitive: (type) => set({ activePrimitive: type }),
  setDrawTool: (tool) => set({ drawTool: tool }),
  setGridSnap: (value) => set({ gridSnap: value }),
  setAngleSnap: (value) => set({ angleSnap: value }),
  toggleXRay: () => set((s) => ({ xray: !s.xray })),
  toggleLiveMirror: () => set((s) => ({ liveMirror: !s.liveMirror })),
  setMirrorAxis: (axis) => set({ mirrorAxis: axis }),
  setRigMode: (mode) => set({ rigMode: mode }),
  setModalTransform: (mode) => set({ modalTransform: mode }),
  setModalMeshOp: (op) => set({ modalMeshOp: op }),
  setBrushSize: (size) => set({ brushSize: size }),
  setActiveColor: (color) => set({ activeColor: color }),
  togglePaint3D: () => set((s) => ({ isPainting3D: !s.isPainting3D })),
  reset: () => set(initialState),
}));