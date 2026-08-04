import { create } from 'zustand';
import { useVectorStore } from './useVectorStore';

export type WorkspaceHistoryProvider = 'mesh' | 'vector' | 'paint';

export interface HistoryRecord {
  id: string;
  provider: WorkspaceHistoryProvider;
  label: string;
  timestamp: number;
}

export interface HistoryStoreState {
  currentProvider: WorkspaceHistoryProvider;
  setCurrentProvider: (provider: WorkspaceHistoryProvider) => void;
  undo: () => void;
  redo: () => void;
  registerMeshUndo: (undoFn: () => void, _redoFn: () => void) => void;
}

const meshUndoStack: (() => void)[] = [];
const meshRedoStack: (() => void)[] = [];

export const useHistoryStore = create<HistoryStoreState>((set, get) => ({
  currentProvider: 'mesh',

  setCurrentProvider: (provider) => set({ currentProvider: provider }),

  registerMeshUndo: (undoFn, _redoFn) => {
    meshUndoStack.push(undoFn);
    meshRedoStack.length = 0; // Clear redo stack on new action
  },

  undo: () => {
    const { currentProvider } = get();
    if (currentProvider === 'vector') {
      useVectorStore.getState().undo();
    } else if (currentProvider === 'mesh' && meshUndoStack.length > 0) {
      const undoAction = meshUndoStack.pop();
      if (undoAction) undoAction();
    }
  },

  redo: () => {
    const { currentProvider } = get();
    if (currentProvider === 'vector') {
      useVectorStore.getState().redo();
    } else if (currentProvider === 'mesh' && meshRedoStack.length > 0) {
      const redoAction = meshRedoStack.pop();
      if (redoAction) redoAction();
    }
  },
}));
