import { describe, expect, it } from 'vitest';
import type { BezierPath } from '../vectorBlockout';
import { vectorPathsToMesh, vectorSnapshotToCADMesh } from '../vectorBlockout';
import { buildLogicalEdgeGeometry } from './edgeOverlay';

function closedRect(plane: 'front' | 'side', halfU: number): BezierPath {
  const points = [
    { u: -halfU, v: 0 },
    { u: halfU, v: 0 },
    { u: halfU, v: 2 },
    { u: -halfU, v: 2 },
  ];
  return {
    id: `${plane}_rect`,
    plane,
    name: plane,
    closed: true,
    anchors: points.map((point) => ({
      point,
      handleIn: { ...point },
      handleOut: { ...point },
    })),
  };
}

function longitudinalCoordinates(
  geometry: ReturnType<typeof buildLogicalEdgeGeometry>,
  axis: 'x' | 'z'
): number[] {
  const position = geometry.getAttribute('position');
  const axisOffset = axis === 'x' ? 0 : 2;
  const values = new Set<number>();
  for (let index = 0; index < position.count; index += 2) {
    const ay = position.getY(index);
    const by = position.getY(index + 1);
    if (Math.abs(ay - by) < 1e-6) continue;
    const a = position.array[index * 3 + axisOffset] as number;
    const b = position.array[(index + 1) * 3 + axisOffset] as number;
    // Cap inset edges slope into the tip and should remain visible. This helper
    // measures only the body columns that can create the unwanted parallel
    // center lines in an ortho projection.
    if (Math.abs(a - b) > 1e-6) continue;
    values.add(Number(((a + b) / 2).toFixed(5)));
  }
  return [...values].sort((a, b) => a - b);
}

describe('blockout ortho edge overlay', () => {
  it('shows only the silhouette columns and one center seam in Front Ortho', () => {
    const snapshot = vectorPathsToMesh(
      closedRect('front', 0.5),
      closedRect('side', 0.35),
      4,
      12,
      null,
      { gameTopology: true, capStyle: 'game', roundness: 0 },
    );
    expect(snapshot).not.toBeNull();
    const mesh = vectorSnapshotToCADMesh(snapshot!, 'Front Ortho Test');

    const full = buildLogicalEdgeGeometry(mesh);
    const front = buildLogicalEdgeGeometry(mesh, { blockoutOrtho: 'front' });

    expect(front.getAttribute('position').count).toBeLessThan(full.getAttribute('position').count);
    expect(longitudinalCoordinates(front, 'x')).toEqual([-0.5, 0, 0.5]);
  });

  it('keeps the same clean center seam treatment in Side Ortho', () => {
    const snapshot = vectorPathsToMesh(
      closedRect('front', 0.5),
      closedRect('side', 0.35),
      4,
      12,
      null,
      { gameTopology: true, capStyle: 'game', roundness: 0 },
    );
    expect(snapshot).not.toBeNull();
    const mesh = vectorSnapshotToCADMesh(snapshot!, 'Side Ortho Test');
    const side = buildLogicalEdgeGeometry(mesh, { blockoutOrtho: 'side' });

    expect(longitudinalCoordinates(side, 'z')).toEqual([-0.35, 0, 0.35]);
  });
});
