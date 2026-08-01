import { beforeEach, describe, expect, it } from 'vitest';
import { useVectorStore } from './useVectorStore';
import type { VectorPlane, VectorPoint } from '../utils/vectorBlockout';

const drawAndClose = (plane: VectorPlane, points: VectorPoint[]) => {
  const store = useVectorStore.getState();
  store.setSnap(false);
  points.forEach((point) => useVectorStore.getState().addAnchor(plane, point));
  useVectorStore.getState().closePath(plane);
};

describe('Blockout automatic width/depth editing', () => {
  beforeEach(() => {
    useVectorStore.getState().clearAll();
    useVectorStore.getState().setMirrorWidth(false);
    useVectorStore.getState().setPointEditMode('free');
  });

  it('creates an editable Front width cage when Side is closed first', () => {
    drawAndClose('side', [
      { u: -0.4, v: 0 },
      { u: 0.4, v: 0 },
      { u: 0.55, v: 1 },
      { u: 0.2, v: 2 },
      { u: -0.2, v: 2 },
      { u: -0.55, v: 1 },
    ]);

    const state = useVectorStore.getState();
    expect(state.paths.side.closed).toBe(true);
    expect(state.paths.front.closed).toBe(true);
    expect(state.paths.front.anchors.length).toBeGreaterThanOrEqual(6);
    expect(state.mode).toBe('edit');
    expect(state.pointEditMode).toBe('symmetric');
    expect(state.mirrorWidth).toBe(true);
  });

  it('creates an editable Side depth cage when Front is closed first', () => {
    drawAndClose('front', [
      { u: -0.7, v: 0 },
      { u: 0.7, v: 0 },
      { u: 0.5, v: 1.5 },
      { u: 0, v: 2.2 },
      { u: -0.5, v: 1.5 },
    ]);

    const state = useVectorStore.getState();
    expect(state.paths.front.closed).toBe(true);
    expect(state.paths.side.closed).toBe(true);
    expect(state.paths.side.anchors.length).toBeGreaterThanOrEqual(6);
    expect(state.paths.side.anchors.every((anchor) =>
      Math.abs(Math.abs(anchor.point.u) - state.thickness / 2) < 1e-6
    )).toBe(true);
  });

  it('does not overwrite an opposite view the user already started drawing', () => {
    useVectorStore.getState().setSnap(false);
    useVectorStore.getState().addAnchor('front', { u: 0.3, v: 0.5 });
    drawAndClose('side', [
      { u: -0.4, v: 0 },
      { u: 0.4, v: 0 },
      { u: 0.4, v: 2 },
      { u: -0.4, v: 2 },
    ]);

    const front = useVectorStore.getState().paths.front;
    expect(front.closed).toBe(false);
    expect(front.anchors).toHaveLength(1);
    expect(front.anchors[0].point).toEqual({ u: 0.3, v: 0.5 });
  });
});
