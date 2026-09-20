import { describe, it, expect, beforeEach } from 'vitest';
import {
  bindMeshHistory,
  resetMeshHistoryForTests,
  useHistoryStore,
  type MeshHistorySnapshot,
} from './useHistoryStore';

describe('mesh history adapter', () => {
  beforeEach(() => {
    resetMeshHistoryForTests();
    useHistoryStore.setState({ currentProvider: 'mesh', version: 0 });
  });

  it('restores the snapshot taken before an edit', () => {
    let value = 1;
    bindMeshHistory({
      takeSnapshot: () => ({
        scenes: [{ n: value }],
        activeSceneId: 's',
        activeMeshId: 'm',
        selectedVertexIds: [],
        selectedEdgeIds: [],
        selectedFaceIds: [],
        selectedMeshIds: [],
        selectedBoneId: '',
      }),
      restoreSnapshot: (snap: MeshHistorySnapshot) => {
        value = (snap.scenes as Array<{ n: number }>)[0].n;
      },
    });

    useHistoryStore.getState().pushUndo();
    value = 2;
    expect(useHistoryStore.getState().canUndo()).toBe(true);

    useHistoryStore.getState().undo();
    expect(value).toBe(1);

    useHistoryStore.getState().redo();
    expect(value).toBe(2);

    bindMeshHistory(null);
  });

  it('does not snapshot when no adapter is bound', () => {
    bindMeshHistory(null);
    useHistoryStore.getState().pushUndo();
    expect(useHistoryStore.getState().meshStackLength()).toBe(0);
  });
});
