import { describe, expect, it } from 'vitest';
import {
  vectorPathsToMesh,
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
    const body = square!.vertices.length - 2;
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
