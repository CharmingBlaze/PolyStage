import { create } from 'zustand';
import { useVectorStore } from './useVectorStore';
import { useSceneStore } from './useSceneStore';
import type { CADMesh, CADBone } from '../types/cad';

export type WorkspaceHistoryProvider = 'mesh' | 'vector' | 'paint';

const MAX_HISTORY = 50;

interface Snapshot {
  meshes: CADMesh[];
  bones: CADBone[];
}

const undoStack: Snapshot[] = [];
const redoStack: Snapshot[] = [];

function takeSnapshot(): Snapshot {
  const { meshes, bones } = useSceneStore.getState();
  return { meshes, bones };
}

function restoreSnapshot(snap: Snapshot): void {
  useSceneStore.setState({ meshes: snap.meshes, bones: snap.bones });
}

export interface HistoryStoreState {
  currentProvider: WorkspaceHistoryProvider;
  /** Incremented on every push/undo/redo to trigger React re-renders */
  version: number;
  setCurrentProvider: (provider: WorkspaceHistoryProvider) => void;
  pushUndo: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

export const useHistoryStore = create<HistoryStoreState>((set, get) => ({
  currentProvider: 'mesh',
  version: 0,

  setCurrentProvider: (provider) => set({ currentProvider: provider }),

  pushUndo: () => {
    undoStack.push(takeSnapshot());
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack.length = 0;
    set({ version: get().version + 1 });
  },

  undo: () => {
    const { currentProvider } = get();
    if (currentProvider === 'vector') {
      useVectorStore.getState().undo();
      return;
    }
    if (undoStack.length === 0) return;
    redoStack.push(takeSnapshot());
    restoreSnapshot(undoStack.pop()!);
    set({ version: get().version + 1 });
  },

  redo: () => {
    const { currentProvider } = get();
    if (currentProvider === 'vector') {
      useVectorStore.getState().redo();
      return;
    }
    if (redoStack.length === 0) return;
    undoStack.push(takeSnapshot());
    restoreSnapshot(redoStack.pop()!);
    set({ version: get().version + 1 });
  },

  canUndo: () => undoStack.length > 0,
  canRedo: () => redoStack.length > 0,
}));
