import { create } from 'zustand';
import { useVectorStore } from './useVectorStore';

export type WorkspaceHistoryProvider = 'mesh' | 'vector' | 'paint';

const MAX_HISTORY = 40;

export interface HistoryAdapter {
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

export interface MeshHistorySnapshot {
  scenes: unknown;
  activeSceneId: string;
  activeMeshId: string;
  selectedVertexIds: string[];
  selectedEdgeIds: string[];
  selectedFaceIds: string[];
  selectedMeshIds: string[];
  selectedBoneId: string;
}

export interface MeshHistoryAdapter {
  takeSnapshot: () => MeshHistorySnapshot;
  restoreSnapshot: (snap: MeshHistorySnapshot) => void;
}

const undoStack: MeshHistorySnapshot[] = [];
const redoStack: MeshHistorySnapshot[] = [];

let meshAdapter: MeshHistoryAdapter | null = null;
let paintAdapter: HistoryAdapter | null = null;

function cloneSnapshot(snap: MeshHistorySnapshot): MeshHistorySnapshot {
  if (typeof structuredClone === 'function') return structuredClone(snap);
  return JSON.parse(JSON.stringify(snap)) as MeshHistorySnapshot;
}

export function bindMeshHistory(adapter: MeshHistoryAdapter | null) {
  meshAdapter = adapter;
}

export function bindPaintHistory(adapter: HistoryAdapter | null) {
  paintAdapter = adapter;
}

/** Drop stacks between tests or when loading a project. */
export function resetMeshHistoryForTests() {
  undoStack.length = 0;
  redoStack.length = 0;
}

export const clearMeshHistory = resetMeshHistoryForTests;

export interface HistoryStoreState {
  currentProvider: WorkspaceHistoryProvider;
  /** Incremented on every push/undo/redo to trigger React re-renders */
  version: number;
  setCurrentProvider: (provider: WorkspaceHistoryProvider) => void;
  bumpVersion: () => void;
  pushUndo: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  /** True after a mesh snapshot has been recorded. */
  meshStackLength: () => number;
}

function vectorCanUndo() {
  return useVectorStore.getState().history.length > 0;
}

function vectorCanRedo() {
  return useVectorStore.getState().future.length > 0;
}

export const useHistoryStore = create<HistoryStoreState>((set, get) => ({
  currentProvider: 'mesh',
  version: 0,

  setCurrentProvider: (provider) => set({ currentProvider: provider }),

  bumpVersion: () => set({ version: get().version + 1 }),

  pushUndo: () => {
    if (!meshAdapter) return;
    undoStack.push(cloneSnapshot(meshAdapter.takeSnapshot()));
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack.length = 0;
    set({ version: get().version + 1 });
  },

  undo: () => {
    const { currentProvider } = get();
    if (currentProvider === 'vector') {
      useVectorStore.getState().undo();
      set({ version: get().version + 1 });
      return;
    }
    if (currentProvider === 'paint') {
      paintAdapter?.undo();
      set({ version: get().version + 1 });
      return;
    }
    if (!meshAdapter || undoStack.length === 0) return;
    redoStack.push(cloneSnapshot(meshAdapter.takeSnapshot()));
    meshAdapter.restoreSnapshot(undoStack.pop()!);
    set({ version: get().version + 1 });
  },

  redo: () => {
    const { currentProvider } = get();
    if (currentProvider === 'vector') {
      useVectorStore.getState().redo();
      set({ version: get().version + 1 });
      return;
    }
    if (currentProvider === 'paint') {
      paintAdapter?.redo();
      set({ version: get().version + 1 });
      return;
    }
    if (!meshAdapter || redoStack.length === 0) return;
    undoStack.push(cloneSnapshot(meshAdapter.takeSnapshot()));
    meshAdapter.restoreSnapshot(redoStack.pop()!);
    set({ version: get().version + 1 });
  },

  canUndo: () => {
    const { currentProvider } = get();
    if (currentProvider === 'vector') return vectorCanUndo();
    if (currentProvider === 'paint') return paintAdapter?.canUndo() ?? false;
    return undoStack.length > 0;
  },

  canRedo: () => {
    const { currentProvider } = get();
    if (currentProvider === 'vector') return vectorCanRedo();
    if (currentProvider === 'paint') return paintAdapter?.canRedo() ?? false;
    return redoStack.length > 0;
  },

  meshStackLength: () => undoStack.length,
}));
