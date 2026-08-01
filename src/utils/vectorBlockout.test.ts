import { describe, expect, it } from 'vitest';
import {
  analyzeVectorMesh,
  applyVectorSectionEdits,
  buildLoftHeights,
  resolveVectorPartTransform,
  validateVectorPaths,
  vectorPrimitiveToMesh,
  vectorPathsToMesh,
  vectorSilhouetteCenters,
  vectorSnapshotToCADMesh,
  buildCompanionCagePath,
  type BezierPath,
} from './vectorBlockout';

function closedRect(plane: 'front' | 'side' | 'top', halfU: number, y0: number, y1: number): BezierPath {
  const corners = [
    { u: -halfU, v: y0 },
    { u: halfU, v: y0 },
    { u: halfU, v: y1 },
    { u: -halfU, v: y1 },
  ];
  return {
    id: `${plane}_test`,
    plane,
    name: plane,
    closed: true,
    anchors: corners.map((point) => ({
      point,
      handleIn: { ...point },
      handleOut: { ...point },
    })),
  };
}

/** Egg-like side silhouette that tapers at top/bottom tips. */
function closedEggSide(): BezierPath {
  const pts = [
    { u: 0, v: 0 },
    { u: 0.45, v: 0.35 },
    { u: 0.5, v: 1 },
    { u: 0.25, v: 1.7 },
    { u: 0, v: 2 },
    { u: -0.25, v: 1.7 },
    { u: -0.5, v: 1 },
    { u: -0.45, v: 0.35 },
  ];
  return {
    id: 'side_egg',
    plane: 'side',
    name: 'side',
    closed: true,
    anchors: pts.map((point) => ({
      point,
      handleIn: { ...point },
      handleOut: { ...point },
    })),
  };
}

describe('vectorPathsToMesh', () => {
  it('centers perspective construction planes on asymmetric silhouettes', () => {
    const front = closedRect('front', 0.5, 0, 2);
    const side = closedRect('side', 0.4, 0, 2);
    front.anchors.forEach((anchor) => {
      anchor.point.u += 0.3;
      anchor.handleIn.u += 0.3;
      anchor.handleOut.u += 0.3;
    });
    side.anchors.forEach((anchor) => {
      anchor.point.u -= 0.2;
      anchor.handleIn.u -= 0.2;
      anchor.handleOut.u -= 0.2;
    });

    expect(vectorSilhouetteCenters(front, side)).toEqual({
      x: expect.closeTo(0.3, 6),
      z: expect.closeTo(-0.2, 6),
    });
  });

  it('lofts front + side with game caps (inset quads + tiny tip fans)', () => {
    const front = closedRect('front', 0.5, 0, 2);
    const side = closedRect('side', 0.35, 0, 2);
    const rings = 4;
    const sides = 8;
    const snapshot = vectorPathsToMesh(front, side, rings, sides, null, { capStyle: 'game' });
    expect(snapshot).not.toBeNull();
    // ring verts + 2 inset rings + 2 poles
    expect(snapshot!.vertices.length).toBe((rings + 1) * sides + 2 * sides + 2);
    // wall quads + 2*(inset quads + tip tris)
    expect(snapshot!.faces.length).toBe(rings * sides + 2 * (sides + sides));
    expect(snapshot!.faces.filter((f) => f.length === 4).length).toBe(rings * sides + 2 * sides);
    expect(snapshot!.faces.filter((f) => f.length === 3).length).toBe(2 * sides);

    const mesh = vectorSnapshotToCADMesh(snapshot!, 'Test Blockout', { seedTexture: true });
    expect(mesh.faces.some((f) => f.vertexIds.length === 4)).toBe(true);
    expect(mesh.faces.some((f) => f.vertexIds.length === 3)).toBe(true);
    expect(mesh.textureCanvasDataUrl).toBeTruthy();
    for (const face of mesh.faces) {
      expect(face.uvs.length).toBe(face.vertexIds.length);
      expect(face.materialId).toBe('mat_default');
      expect(face.color).toBe('#d2b48c');
      for (const uv of face.uvs) {
        expect(uv.u).toBeGreaterThanOrEqual(-0.01);
        expect(uv.u).toBeLessThanOrEqual(1.01);
        expect(uv.v).toBeGreaterThanOrEqual(-0.01);
        expect(uv.v).toBeLessThanOrEqual(1.01);
      }
    }

    // Caps append: bottom insets → bottom pole → top insets → top pole.
    const poleBot = snapshot!.vertices[(rings + 1) * sides + sides];
    const poleTop = snapshot!.vertices[snapshot!.vertices.length - 1];
    // Game tips get a tiny push past silhouette ends.
    expect(poleBot.y).toBeLessThan(0.01);
    expect(poleTop.y).toBeGreaterThan(1.99);
  });

  it('pointed caps fan directly to silhouette tips', () => {
    const front = closedRect('front', 0.5, 0, 2);
    const side = closedRect('side', 0.35, 0, 2);
    const rings = 4;
    const sides = 8;
    const snapshot = vectorPathsToMesh(front, side, rings, sides, null, {
      capStyle: 'pointed',
      gameTopology: false,
    });
    expect(snapshot).not.toBeNull();
    expect(snapshot!.vertices.length).toBe((rings + 1) * sides + 2);
    expect(snapshot!.faces.length).toBe(rings * sides + 2 * sides);
    expect(snapshot!.faces.filter((f) => f.length === 3).length).toBe(2 * sides);

    const poleBot = snapshot!.vertices[snapshot!.vertices.length - 2];
    const poleTop = snapshot!.vertices[snapshot!.vertices.length - 1];
    expect(poleBot.y).toBeCloseTo(0, 5);
    expect(poleTop.y).toBeCloseTo(2, 5);
  });

  it('side-only uses thickness for the missing Front axis', () => {
    const side = closedEggSide();
    const thin = vectorPathsToMesh(null, side, 12, 10, null, { thickness: 0.2 });
    const thick = vectorPathsToMesh(null, side, 12, 10, null, { thickness: 1.2 });
    expect(thin).not.toBeNull();
    expect(thick).not.toBeNull();

    const midBandX = (mesh: NonNullable<typeof thin>) => {
      const band = mesh.vertices.filter((v) => Math.abs(v.y - 1) < 0.12);
      return Math.max(...band.map((v) => Math.abs(v.x)));
    };

    expect(midBandX(thin!)).toBeLessThan(0.15);
    expect(midBandX(thick!)).toBeGreaterThan(0.5);
  });

  it('side-only tapers rings with the silhouette (no fat flat lids)', () => {
    const side = closedEggSide();
    const snapshot = vectorPathsToMesh(null, side, 12, 10, null, {
      thickness: 0.4,
      gameTopology: false,
    });
    expect(snapshot).not.toBeNull();

    const body = snapshot!.vertices.length - 2; // pointed poles
    const rowYs = [
      ...new Set(snapshot!.vertices.slice(0, body).map((v) => Number(v.y.toFixed(5)))),
    ].sort((a, b) => a - b);
    const sides = body / rowYs.length;
    expect(Number.isInteger(sides)).toBe(true);

    const bottomRing = snapshot!.vertices.slice(0, sides);
    const topRing = snapshot!.vertices.slice((rowYs.length - 1) * sides, rowYs.length * sides);
    const mid = Math.floor(rowYs.length / 2);
    const midRing = snapshot!.vertices.slice(mid * sides, (mid + 1) * sides);

    const radiusOf = (ring: { x: number; y: number; z: number }[]) => {
      const cx = ring.reduce((s, v) => s + v.x, 0) / ring.length;
      const cz = ring.reduce((s, v) => s + v.z, 0) / ring.length;
      return Math.max(...ring.map((v) => Math.hypot(v.x - cx, v.z - cz)));
    };

    // Tips are much tighter than mid-body — rounded/pointed poles like blockout.
    expect(radiusOf(bottomRing)).toBeLessThan(radiusOf(midRing) * 0.55);
    expect(radiusOf(topRing)).toBeLessThan(radiusOf(midRing) * 0.55);
    // Missing Front axis uses thickness/2 (±0.2 for thickness 0.4).
    expect(Math.max(...midRing.map((v) => Math.abs(v.x)))).toBeLessThan(0.25);
  });

  it('returns null when no silhouette has enough points', () => {
    const front = { ...closedRect('front', 0.5, 0, 2), closed: false, anchors: [] };
    expect(vectorPathsToMesh(front, null, 4, 8, null)).toBeNull();
  });

  it('returns null for top-only (needs Front or Side for height, like blockout)', () => {
    const top = closedRect('top', 0.6, -0.4, 0.4);
    expect(vectorPathsToMesh(null, null, 8, 8, top)).toBeNull();
  });

  it('builds a Front width cage from Side and lofts real X extents', () => {
    const side = closedEggSide();
    const cage = buildCompanionCagePath(side, 'front', 0.4, 5);
    expect(cage.closed).toBe(true);
    expect(cage.anchors.length).toBeGreaterThanOrEqual(6);
    expect(Math.max(...cage.anchors.map((a) => a.point.u))).toBeCloseTo(0.4, 5);
    expect(Math.min(...cage.anchors.map((a) => a.point.u))).toBeCloseTo(-0.4, 5);

    const snapshot = vectorPathsToMesh(cage, side, 8, 8, null, {
      thickness: 0.2,
      capStyle: 'pointed',
      gameTopology: false,
    });
    expect(snapshot).not.toBeNull();
    const mid = snapshot!.vertices.slice(4 * 8, 4 * 8 + 8);
    expect(Math.max(...mid.map((v) => Math.abs(v.x)))).toBeGreaterThan(0.3);
  });

  it('snaps loft rings onto silhouette control heights', () => {
    const front = closedRect('front', 0.5, 0, 2);
    // Extra waist keys on front
    front.anchors.push(
      { point: { u: 0.5, v: 1 }, handleIn: { u: 0.5, v: 1 }, handleOut: { u: 0.5, v: 1 } },
      { point: { u: -0.5, v: 1 }, handleIn: { u: -0.5, v: 1 }, handleOut: { u: -0.5, v: 1 } }
    );
    const side = closedRect('side', 0.35, 0, 2);
    const snapshot = vectorPathsToMesh(front, side, 8, 8, null, {
      capStyle: 'pointed',
      gameTopology: false,
    });
    expect(snapshot).not.toBeNull();
    const body = snapshot!.vertices.length - 2; // pointed poles
    const ringYs = new Set(
      snapshot!.vertices.slice(0, body).map((v) => Number(v.y.toFixed(5)))
    );
    expect([...ringYs].some((y) => Math.abs(y - 1) < 1e-4)).toBe(true);
  });

  it('extends the mesh below zero when either silhouette continues lower', () => {
    const front = closedRect('front', 0.5, -1, 2);
    const side = closedRect('side', 0.35, 0, 2);
    const snapshot = vectorPathsToMesh(front, side, 6, 8, null, {
      capStyle: 'pointed',
      gameTopology: true,
      roundness: 0,
    });
    expect(snapshot).not.toBeNull();
    expect(Math.min(...snapshot!.vertices.map((vertex) => vertex.y))).toBeLessThanOrEqual(-1);

    const belowZero = snapshot!.vertices.filter((vertex) => vertex.y < -0.25);
    expect(belowZero.length).toBeGreaterThan(0);
    expect(Math.max(...belowZero.map((vertex) => Math.abs(vertex.z)))).toBeGreaterThan(0.3);
  });

  it('keeps a loft ring on every silhouette control height', () => {
    const side: BezierPath = {
      id: 'side_char',
      plane: 'side',
      name: 'side',
      closed: true,
      anchors: [
        { u: 0, v: 0 },
        { u: 0.4, v: 0.4 },
        { u: 0.55, v: 1.0 },
        { u: 0.35, v: 1.4 },
        { u: 0.25, v: 1.7 },
        { u: 0, v: 2 },
        { u: -0.25, v: 1.7 },
        { u: -0.35, v: 1.4 },
        { u: -0.55, v: 1.0 },
        { u: -0.4, v: 0.4 },
      ].map((point) => ({
        point,
        handleIn: { ...point },
        handleOut: { ...point },
      })),
    };
    const keyYs = [...new Set(side.anchors.map((a) => a.point.v))];
    const snapshot = vectorPathsToMesh(null, side, 6, 8, null, {
      thickness: 0.5,
      gameTopology: true,
      crossSection: 'box',
      capStyle: 'pointed',
    });
    expect(snapshot).not.toBeNull();
    const body = snapshot!.vertices.length - 2;
    const ringYs = [
      ...new Set(snapshot!.vertices.slice(0, body).map((v) => Number(v.y.toFixed(5)))),
    ];
    for (const key of keyYs) {
      expect(ringYs.some((y) => Math.abs(y - key) < 1e-4)).toBe(true);
    }
  });

  it('keeps dense silhouettes inside the selected height-ring budget', () => {
    const denseKeys = Array.from({ length: 60 }, (_, index) => index / 59);
    const heights = buildLoftHeights(0, 1, 8, denseKeys);
    expect(heights).toHaveLength(9);
    expect(heights[0]).toBe(0);
    expect(heights.at(-1)).toBe(1);

    const side: BezierPath = {
      id: 'dense_side',
      plane: 'side',
      name: 'side',
      closed: true,
      anchors: [
        ...Array.from({ length: 30 }, (_, index) => ({
          u: 0.35 + Math.sin(index * 0.7) * 0.05,
          v: index / 29,
        })),
        ...Array.from({ length: 30 }, (_, index) => ({
          u: -0.35 - Math.sin((29 - index) * 0.7) * 0.05,
          v: (29 - index) / 29,
        })),
      ].map((point) => ({
        point,
        handleIn: { ...point },
        handleOut: { ...point },
      })),
    };
    const mesh = vectorPathsToMesh(null, side, 8, 8, null, {
      gameTopology: true,
      capStyle: 'game',
    });
    expect(mesh).not.toBeNull();
    const audit = analyzeVectorMesh(mesh!);
    expect(audit.vertices).toBe(9 * 8 + 2 * 8 + 2);
    expect(audit.issues).toEqual([]);
  });

  it('box loft keeps a stable mid seam (no zigzag center)', () => {
    const side = closedEggSide();
    const rings = 12;
    const snapshot = vectorPathsToMesh(null, side, rings, 8, null, {
      thickness: 0.5,
      gameTopology: true,
      crossSection: 'box',
      capStyle: 'pointed',
    });
    expect(snapshot).not.toBeNull();
    const body = snapshot!.vertices.length - 2;
    const rowYs = [
      ...new Set(snapshot!.vertices.slice(0, body).map((v) => Number(v.y.toFixed(5)))),
    ].sort((a, b) => a - b);
    const actualSides = body / rowYs.length;
    expect(Number.isInteger(actualSides)).toBe(true);

    const zs: number[] = [];
    for (let row = 0; row < rowYs.length; row++) {
      const rowVerts = snapshot!.vertices.slice(row * actualSides, (row + 1) * actualSides);
      zs.push(rowVerts.reduce((s, v) => s + v.z, 0) / rowVerts.length);
    }
    let maxJump = 0;
    for (let i = 1; i < zs.length; i++) {
      maxJump = Math.max(maxJump, Math.abs(zs[i] - zs[i - 1]));
    }
    // Unsmoothed egg mid can jump ~0.2+ between rings; smoothed spine stays gentle.
    expect(maxJump).toBeLessThan(0.1);
  });

  it('box loft with 16 sides places center + side seams on the front edge', () => {
    const side = closedRect('side', 0.4, 0, 2);
    const sides = 16;
    const snapshot = vectorPathsToMesh(null, side, 6, sides, null, {
      thickness: 1,
      gameTopology: true,
      crossSection: 'box',
      capStyle: 'pointed',
      taperThickness: false,
    });
    expect(snapshot).not.toBeNull();
    const body = snapshot!.vertices.length - 2;
    const rowYs = [
      ...new Set(snapshot!.vertices.slice(0, body).map((v) => Number(v.y.toFixed(5)))),
    ];
    const actualSides = body / rowYs.length;
    const midRing = Math.floor(rowYs.length / 2);
    const xs = [0, 1, 2, 3].map(
      (i) => snapshot!.vertices[midRing * actualSides + i].x
    );
    // Rect side has no interior width features → even Front-edge samples.
    expect(xs[0]).toBeCloseTo(0.5, 5);
    expect(xs[1]).toBeCloseTo(0.25, 5);
    expect(xs[2]).toBeCloseTo(0, 5);
    expect(xs[3]).toBeCloseTo(-0.25, 5);
  });

  it('locks vertical seams to the straight centers of asymmetric silhouettes', () => {
    const asymmetricRect = (
      plane: 'front' | 'side',
      minU: number,
      maxU: number,
    ): BezierPath => ({
      id: `${plane}_asymmetric`,
      plane,
      name: plane,
      closed: true,
      anchors: [
        { u: minU, v: 0 },
        { u: maxU, v: 0 },
        { u: maxU, v: 2 },
        { u: minU, v: 2 },
      ].map((point) => ({
        point,
        handleIn: { ...point },
        handleOut: { ...point },
      })),
    });
    const mesh = vectorPathsToMesh(
      asymmetricRect('front', -0.3, 0.7),
      asymmetricRect('side', -0.2, 0.6),
      6,
      12,
      null,
      {
        gameTopology: true,
        capStyle: 'pointed',
        taperThickness: false,
        roundness: 0.35,
      },
    );
    expect(mesh).not.toBeNull();
    const sides = 12;
    const frontCenter = 0.2;
    const sideCenter = 0.2;
    for (let rowIndex = 0; rowIndex <= 6; rowIndex++) {
      const row = mesh!.vertices.slice(rowIndex * sides, (rowIndex + 1) * sides);
      expect(row.some((vertex) =>
        Math.abs(vertex.x - frontCenter) < 1e-6 && vertex.z > sideCenter
      )).toBe(true);
      expect(row.some((vertex) =>
        Math.abs(vertex.x - frontCenter) < 1e-6 && vertex.z < sideCenter
      )).toBe(true);
      expect(row.some((vertex) =>
        Math.abs(vertex.z - sideCenter) < 1e-6 && vertex.x < frontCenter
      )).toBe(true);
      expect(row.some((vertex) =>
        Math.abs(vertex.z - sideCenter) < 1e-6 && vertex.x > frontCenter
      )).toBe(true);
    }
  });

  it('keeps 12-column Front topology mirrored around its center seam', () => {
    const front: BezierPath = {
      id: 'front_feature_pairs',
      plane: 'front',
      name: 'front',
      closed: true,
      anchors: [
        { u: -1, v: 0 },
        { u: 1, v: 0 },
        { u: 0.4, v: 1 },
        { u: 1, v: 2 },
        { u: -1, v: 2 },
        { u: -0.4, v: 1 },
      ].map((point) => ({
        point,
        handleIn: { ...point },
        handleOut: { ...point },
      })),
    };
    const mesh = vectorPathsToMesh(
      front,
      closedRect('side', 0.5, 0, 2),
      6,
      12,
      null,
      { gameTopology: true, capStyle: 'pointed', roundness: 0 },
    );
    expect(mesh).not.toBeNull();

    const row = mesh!.vertices.slice(3 * 12, 4 * 12);
    const frontZ = Math.max(...row.map((vertex) => vertex.z));
    const frontXs = row
      .filter((vertex) => Math.abs(vertex.z - frontZ) < 1e-6)
      .map((vertex) => vertex.x)
      .sort((a, b) => a - b);
    expect(frontXs).toHaveLength(5);
    for (let index = 0; index < frontXs.length; index++) {
      expect(frontXs[index] + frontXs[frontXs.length - 1 - index]).toBeCloseTo(0, 6);
    }
  });

  it('keeps at least eight radial columns for game symmetry seams', () => {
    const mesh = vectorPathsToMesh(
      closedRect('front', 0.5, 0, 2),
      closedRect('side', 0.4, 0, 2),
      4,
      4,
      null,
      { gameTopology: true, capStyle: 'pointed' },
    );
    expect(mesh).not.toBeNull();
    // Five height rows × eight columns, then two pointed poles.
    expect(mesh!.vertices.length).toBe(5 * 8 + 2);
  });

  it('places vertical width seams under front control points', () => {
    const front: BezierPath = {
      id: 'front_seams',
      plane: 'front',
      name: 'front',
      closed: true,
      anchors: [
        { u: -1, v: 0 },
        { u: -0.5, v: 0.5 },
        { u: -1, v: 1 },
        { u: 1, v: 1 },
        { u: 0.5, v: 0.5 },
        { u: 1, v: 0 },
      ].map((point) => ({
        point,
        handleIn: { ...point },
        handleOut: { ...point },
      })),
    };
    const side = closedRect('side', 0.4, 0, 1);
    const snapshot = vectorPathsToMesh(front, side, 6, 16, null, {
      gameTopology: true,
      crossSection: 'box',
      capStyle: 'pointed',
    });
    expect(snapshot).not.toBeNull();
    const body = snapshot!.vertices.length - 2;
    const rowYs = [
      ...new Set(snapshot!.vertices.slice(0, body).map((v) => Number(v.y.toFixed(5)))),
    ];
    const actualSides = body / rowYs.length;
    const midRing = rowYs.findIndex((y) => Math.abs(y - 0.5) < 1e-4);
    expect(midRing).toBeGreaterThanOrEqual(0);
    const row = snapshot!.vertices.slice(
      midRing * actualSides,
      (midRing + 1) * actualSides
    );
    const maxZ = Math.max(...row.map((v) => v.z));
    const frontEdge = row.filter((v) => Math.abs(v.z - maxZ) < 1e-5);
    // Feature at |u|/maxU = 0.5 → columns near ±0.5 of local half-width.
    const halfW =
      (Math.max(...frontEdge.map((v) => v.x)) - Math.min(...frontEdge.map((v) => v.x))) / 2;
    const cx =
      (Math.max(...frontEdge.map((v) => v.x)) + Math.min(...frontEdge.map((v) => v.x))) / 2;
    expect(
      frontEdge.some((v) => Math.abs(Math.abs(v.x - cx) / halfW - 0.5) < 0.08)
    ).toBe(true);
  });

  it('defaults to a square cross-section and rounds when roundness increases', () => {
    const front = closedRect('front', 0.5, 0, 2);
    const side = closedRect('side', 0.5, 0, 2);
    const square = vectorPathsToMesh(front, side, 4, 8, null, {
      gameTopology: true,
      capStyle: 'pointed',
      roundness: 0,
    });
    const round = vectorPathsToMesh(front, side, 4, 8, null, {
      gameTopology: true,
      capStyle: 'pointed',
      roundness: 1,
    });
    expect(square).not.toBeNull();
    expect(round).not.toBeNull();
    const sides = 8;
    const mid = 2;
    const sq = square!.vertices.slice(mid * sides, (mid + 1) * sides);
    const rd = round!.vertices.slice(mid * sides, (mid + 1) * sides);
    // Square keeps a corner near (±rx, ±rz); full round pulls that point inward on the diagonal.
    const sqCorner = sq.reduce((best, v) =>
      Math.abs(v.x) + Math.abs(v.z) > Math.abs(best.x) + Math.abs(best.z) ? v : best
    );
    const rdAtCornerAngle = rd.reduce((best, v) => {
      const a0 = Math.atan2(sqCorner.z, sqCorner.x);
      const a1 = Math.atan2(v.z, v.x);
      const d0 = Math.abs(Math.atan2(Math.sin(a0 - Math.atan2(best.z, best.x)), Math.cos(a0 - Math.atan2(best.z, best.x))));
      const d1 = Math.abs(Math.atan2(Math.sin(a0 - a1), Math.cos(a0 - a1)));
      return d1 < d0 ? v : best;
    });
    const sqR = Math.hypot(sqCorner.x, sqCorner.z);
    const rdR = Math.hypot(rdAtCornerAngle.x, rdAtCornerAngle.z);
    expect(rdR).toBeLessThan(sqR - 0.05);
  });
});

describe('Blockout parametric parts', () => {
  it('preserves the drawn world position when centering the Model-mode pivot', () => {
    const snapshot = vectorPrimitiveToMesh({
      type: 'box',
      width: 2,
      height: 2,
      depth: 2,
      sides: 8,
    });
    snapshot.vertices = snapshot.vertices.map((vertex) => ({
      ...vertex,
      x: vertex.x + 4,
      y: vertex.y + 7,
      z: vertex.z - 3,
    }));
    const cad = vectorSnapshotToCADMesh(snapshot, 'Offset Blockout', {
      transform: {
        position: { x: 2, y: 5, z: 1 },
        rotationY: 0,
        scale: { x: 1, y: 1, z: 1 },
      },
    });
    const restored = cad.vertices.map((vertex) => ({
      x: vertex.x + cad.position.x,
      y: vertex.y + cad.position.y,
      z: vertex.z + cad.position.z,
    }));
    expect(Math.min(...restored.map((vertex) => vertex.x)))
      .toBeCloseTo(Math.min(...snapshot.vertices.map((vertex) => vertex.x)) + 2, 6);
    expect(Math.min(...restored.map((vertex) => vertex.y)))
      .toBeCloseTo(Math.min(...snapshot.vertices.map((vertex) => vertex.y)) + 5, 6);
    expect(Math.min(...restored.map((vertex) => vertex.z)))
      .toBeCloseTo(Math.min(...snapshot.vertices.map((vertex) => vertex.z)) + 1, 6);
  });

  it('builds editable box, cylinder, wedge, and capsule primitives', () => {
    for (const type of ['box', 'cylinder', 'wedge', 'capsule'] as const) {
      const mesh = vectorPrimitiveToMesh({ type, width: 1, height: 2, depth: 1, sides: 12 });
      expect(mesh.vertices.length).toBeGreaterThanOrEqual(8);
      expect(mesh.faces.length).toBeGreaterThanOrEqual(5);
      expect(mesh.edges.length).toBeGreaterThan(0);
    }
  });

  it('applies localized cross-section width and offset edits', () => {
    const base = vectorPrimitiveToMesh({ type: 'box', width: 1, height: 2, depth: 1, sides: 8 });
    const edited = applyVectorSectionEdits(base, [{
      id: 'mid',
      t: 0.5,
      width: 2,
      depth: 1,
      offsetX: 0.25,
      offsetZ: 0,
      twist: 0,
      falloff: 1,
    }]);
    expect(Math.max(...edited.vertices.map((v) => v.x)))
      .toBeGreaterThan(Math.max(...base.vertices.map((v) => v.x)));
  });

  it('resolves parented assembly transforms', () => {
    const parent = {
      id: 'parent',
      transform: {
        position: { x: 2, y: 1, z: 0 },
        rotationY: 0,
        scale: { x: 2, y: 2, z: 2 },
      },
    };
    const child = {
      id: 'child',
      parentId: 'parent',
      transform: {
        position: { x: 1, y: 0, z: 0 },
        rotationY: 15,
        scale: { x: 1, y: 1, z: 1 },
      },
    };
    const resolved = resolveVectorPartTransform(child, [parent, child]);
    expect(resolved.position).toEqual({ x: 4, y: 1, z: 0 });
    expect(resolved.scale).toEqual({ x: 2, y: 2, z: 2 });
  });

  it('reports open and self-intersecting silhouettes', () => {
    const front = closedRect('front', 1, 0, 1);
    front.anchors = [
      { u: -1, v: 0 }, { u: 1, v: 1 }, { u: -1, v: 1 }, { u: 1, v: 0 },
    ].map((point) => ({ point, handleIn: { ...point }, handleOut: { ...point } }));
    const side = closedRect('side', 0.5, 0, 1);
    side.closed = false;
    const top = closedRect('top', 0.5, 0, 1);
    top.closed = false;
    top.anchors = [];
    const issues = validateVectorPaths({ front, side, top });
    expect(issues.some((issue) => issue.severity === 'error')).toBe(true);
    expect(issues.some((issue) => issue.message.includes('open'))).toBe(true);
  });

  it('warns about near-duplicate points and mismatched view heights', () => {
    const front = closedRect('front', 0.5, 0, 2);
    front.anchors.splice(1, 0, {
      point: { u: 0.50001, v: 0.00001 },
      handleIn: { u: 0.50001, v: 0.00001 },
      handleOut: { u: 0.50001, v: 0.00001 },
    });
    const side = closedRect('side', 0.4, 1.8, 3.8);
    const top = { ...closedRect('top', 0.5, 0, 1), anchors: [], closed: false };
    const issues = validateVectorPaths({ front, side, top });
    expect(issues.some((issue) => issue.message.includes('near-duplicate'))).toBe(true);
    expect(issues.some((issue) => issue.message.includes('extended'))).toBe(true);
  });

  it('audits generated game lofts as closed and manifold', () => {
    const mesh = vectorPathsToMesh(
      closedRect('front', 0.6, 0, 2),
      closedRect('side', 0.4, 0, 2),
      10,
      12,
      null,
      { gameTopology: true, capStyle: 'game', roundness: 0.35 }
    );
    expect(mesh).not.toBeNull();
    const audit = analyzeVectorMesh(mesh!);
    expect(audit.boundaryEdges).toBe(0);
    expect(audit.nonManifoldEdges).toBe(0);
    expect(audit.degenerateFaces).toBe(0);
    expect(audit.issues).toEqual([]);
  });
});
