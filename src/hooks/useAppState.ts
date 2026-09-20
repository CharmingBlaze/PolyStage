import { useState, useEffect } from 'react';
import { useSceneStore } from '../store/useSceneStore';
import { useHistoryStore } from '../store/useHistoryStore';
import { useVectorStore } from '../store/useVectorStore';

interface AppState {
  scene: ReturnType<typeof useSceneStore>;
  history: ReturnType<typeof useHistoryStore>;
  vector: ReturnType<typeof useVectorStore>;
  isInputFocused: boolean;
  showShortcutsModal: boolean;
  showAssetBrowser: boolean;
  showImportModal: boolean;
  showSpriteSheetModal: boolean;
}

export function useAppState(initialState?: Partial<AppState>) {
  const scene = useSceneStore();
  const history = useHistoryStore();
  const vector = useVectorStore();
  
  const state: AppState = {
    scene,
    history,
    vector,
    isInputFocused: false,
    showShortcutsModal: false,
    showAssetBrowser: false,
    showImportModal: false,
    showSpriteSheetModal: false,
    particleEditorKey: null,
    floatingToolWindowTabs: null,
    showFloatingOutliner: false,
    ...initialState,
  };

  return {
    scene: state.scene,
    history: state.history,
    vector: state.vector,
    isInputFocused: state.isInputFocused,
    showShortcutsModal: state.showShortcutsModal,
    showAssetBrowser: state.showAssetBrowser,
    showImportModal: state.showImportModal,
    showSpriteSheetModal: state.showSpriteSheetModal,
    particleEditorKey: state.particleEditorKey,
    floatingToolWindowTabs: state.floatingToolWindowTabs,
    showFloatingOutliner: state.showFloatingOutliner
  } as const;
}