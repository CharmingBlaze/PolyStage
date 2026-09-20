import { describe, expect, it } from 'vitest';
import { createBoxMesh, createPrimitiveMesh } from './topology/primitives';
import { localPointToWorld } from './meshOrigin';
import { constructionPlaneForView, vec } from './primitiveDraw';
import {
  DEFAULT_PEN_SETTINGS,
  PEN_TYPE_OPTIONS,
  PROJECT_TO_OPTIONS,
  WALL_MODE_OPTIONS,
  createPenSession,
  penAddPoint,
  penAngleLabels,
  penBandTriangles,
  penBindMeshVertex,
  penCommitActive,
  penConnectExisting,
  penMovePoint,
  penNearestScreenHit,
  penOverlaySegments,
  penPointOrder,
  penPolylineParams,
  penSessionToMesh,
  penSetPointByOrder,
  penUndoLastPoint,
  penUVFor,
  penWallProfile,
  penWeldPoints,
  penTypeCreatesFaces,
  resolvePenWorkPlane,
  type PenSession,
  type PenToolSettings,
} from './penTool';

/** Top view work plane, matching constructionPlaneForView('top'): u = +X, v = +Z, n = +Y. */
const topPlane = {
  origin: vec(0, 0, 0),
  u: vec(1, 0, 0),
  v: vec(0, 0, 1),
  n: vec(0, 1, 0),
};

const settings = (overrides: Partial<PenToolSettings> = {}): PenToolSettings => ({
  ...DEFAULT_PEN_SETTINGS,
  ...overrides,
});

const session = (overrides: Partial<PenToolSettings> = {}): PenSession =>
  createPenSession(settings(overrides), topPlane);

const click = (s: PenSession, x: number, z: number, options = {}) =>
  penAddPoint(s, vec(x, 0, z), options);

describe('Pen options', () => {
  it('exposes every documented Pen Type', () => {
    expect(PEN_TYPE_OPTIONS.map((o) => o.id)).toEqual([
      'polygons',
      'lines',
      'vertices',
      'splinePatches',
      'subdivision',
      'polyline',
      'catmullClark',
      'bSpline',
    ]);
  });

  it('exposes Wall Mode Off / Inner / Outer / Both', () => {
    expect(WALL_MODE_OPTIONS.map((o) => o.id)).toEqual(['off', 'inner', 'outer', 'both']);
  });

  it('exposes Project To Action Axis / Backdrop Item / U-V Direction', () => {
    expect(PROJECT_TO_OPTIONS.map((o) => o.id)).toEqual(['actionAxis', 'backdrop', 'uvDirection']);
  });

  it('knows which types produce faces', () => {
    expect(penTypeCreatesFaces('polygons')).toBe(true);
    expect(penTypeCreatesFaces('splinePatches')).toBe(true);
    expect(penTypeCreatesFaces('subdivision')).toBe(true);
    expect(penTypeCreatesFaces('vertices')).toBe(false);
    expect(penTypeCreatesFaces('bSpline')).toBe(false);
  });

  it('defaults match Modo (Polygons, wall off, Show Numbers on, Make UVs on)', () => {
    const d = DEFAULT_PEN_SETTINGS;
    expect(d.drawMode).toBe('free3d');
    expect(d.selectFaceOnCommit).toBe(false);
    expect(d.type).toBe('polygons');
    expect(d.makeQuads).toBe(false);
    expect(d.wallMode).toBe('off');
    expect(d.showNumbers).toBe(true);
    expect(d.makeUvs).toBe(true);
    expect(d.projectTo).toBe('actionAxis');
    expect(d.segments).toBe(1);
  });
});

describe('Polygons (default type)', () => {
  it('rejects a self-crossing face boundary instead of previewing a giant bow-tie face', () => {
    let s = session();
    s = click(s, 0, 0);
    s = click(s, 2, 2);
    s = click(s, 0, 2);
    s = click(s, 2, 0);
    const committed = penCommitActive(s);
    expect(committed.patches).toHaveLength(0);
    expect(committed.activeIds).toHaveLength(4);
    expect(committed.warning).toContain('crosses itself');
  });

  it('creates one vertex per click and grows the active polygon', () => {
    let s = session();
    s = click(s, 0, 0);
    expect(s.points).toHaveLength(1);
    expect(s.activeIds).toHaveLength(1);
    expect(s.patches).toHaveLength(0);

    s = click(s, 1, 0);
    s = click(s, 1, 1);
    expect(s.points).toHaveLength(3);
    expect(s.activeIds).toHaveLength(3);
    expect(s.patches).toHaveLength(0);
    // Modo numbers the vertices in sequence as they are generated.
    expect(penPointOrder(s, s.activeIds[1])).toBe(2);
  });

  it('Shift+click finishes the polygon and starts a new one without dropping the tool', () => {
    let s = session();
    s = click(s, 0, 0);
    s = click(s, 1, 0);
    s = click(s, 1, 1);
    s = click(s, 3, 3, { newPolygon: true });

    expect(s.patches).toHaveLength(1);
    expect(s.patches[0].closed).toBe(true);
    expect(s.patches[0].pointIds).toHaveLength(3);
    expect(s.activeIds).toHaveLength(1);
    expect(s.points).toHaveLength(4);
  });

  it('Shift+click with fewer than 3 vertices does not create a polygon', () => {
    let s = session();
    s = click(s, 0, 0);
    s = click(s, 2, 2, { newPolygon: true });
    expect(s.patches).toHaveLength(0);
    expect(s.activeIds).toHaveLength(1);
  });

  it('inserts a new vertex AFTER a highlighted vertex', () => {
    let s = session();
    s = click(s, 0, 0);
    s = click(s, 1, 0);
    s = click(s, 2, 0);
    const highlighted = s.activeIds[0];
    s = click(s, 0.5, 0.5, { insertAfterId: highlighted });

    expect(s.activeIds[0]).toBe(highlighted);
    expect(s.activeIds[1]).toBe(s.points[s.points.length - 1].id);
    expect(s.activeIds).toHaveLength(4);
  });

  it('commits the active chain on Enter and needs 3 vertices', () => {
    let s = session();
    s = click(s, 0, 0);
    s = click(s, 1, 0);
    expect(penCommitActive(s).patches).toHaveLength(0);

    s = click(s, 1, 1);
    const done = penCommitActive(s);
    expect(done.patches).toHaveLength(1);
    expect(done.activeIds).toHaveLength(0);
    expect(done.patches[0].kind).toBe('polygon');
  });
});

describe('Vertices / Lines / Polyline', () => {
  it('Vertices type leaves a point cloud', () => {
    let s = session({ type: 'vertices' });
    s = click(s, 0, 0);
    s = click(s, 1, 0);
    s = click(s, 2, 0);
    expect(s.points).toHaveLength(3);
    expect(s.patches).toHaveLength(0);
  });

  it('Lines type creates a two point segment per click', () => {
    let s = session({ type: 'lines' });
    s = click(s, 0, 0);
    expect(s.patches).toHaveLength(0);
    s = click(s, 1, 0);
    s = click(s, 2, 0);
    expect(s.patches).toHaveLength(2);
    expect(s.patches.every((p) => p.kind === 'segment' && p.pointIds.length === 2)).toBe(true);
    expect(s.patches.every((p) => !p.closed)).toBe(true);
  });

  it('Polyline type also emits straight segments', () => {
    let s = session({ type: 'polyline' });
    s = click(s, 0, 0);
    s = click(s, 1, 0);
    s = click(s, 2, 0);
    expect(s.patches).toHaveLength(2);
  });
});

const posOf = (s: PenSession, id: string) => s.points.find((p) => p.id === id)!.position;

describe('Make Quads', () => {
  it('completes a quad with each click after the first two vertices', () => {
    let s = session({ makeQuads: true });
    s = click(s, 0, 0);
    s = click(s, 1, 0);
    expect(s.patches).toHaveLength(0);

    s = click(s, 1, 1);
    expect(s.patches).toHaveLength(1);
    expect(s.patches[0].kind).toBe('quad');
    expect(s.patches[0].closed).toBe(true);

    const quad = s.patches[0].pointIds.map((id) => posOf(s, id));
    expect(quad[0]).toMatchObject({ x: 0, z: 0 });
    expect(quad[1]).toMatchObject({ x: 1, z: 0 });
    // The far side of the strip is generated parallel to the first two clicks.
    expect(quad[2]).toMatchObject({ x: 2, z: 1 });
    expect(quad[3]).toMatchObject({ x: 1, z: 1 });
    // The next quad grows from the cross-section just created.
    expect(s.activeIds).toHaveLength(2);
  });

  it('keeps the strip going so polygons read as a continuous quad strip', () => {
    let s = session({ makeQuads: true });
    // Click along one side of the intended strip: the tool generates the far side.
    s = click(s, 0, 0);
    s = click(s, 1, 0);
    s = click(s, 0, 2);
    s = click(s, 0, 4);

    expect(s.patches).toHaveLength(2);
    expect(s.points).toHaveLength(6);

    const first = s.patches[0].pointIds.map((id) => posOf(s, id));
    expect(first[2]).toMatchObject({ x: 1, z: 2 });
    expect(first[3]).toMatchObject({ x: 0, z: 2 });

    const second = s.patches[1].pointIds.map((id) => posOf(s, id));
    expect(second[0]).toMatchObject({ x: 0, z: 2 });
    expect(second[1]).toMatchObject({ x: 1, z: 2 });
    expect(second[2].x).toBeCloseTo(1, 6);
    expect(second[2].z).toBeCloseTo(4, 6);
    expect(second[3]).toMatchObject({ x: 0, z: 4 });
  });

  it('Ctrl creates a single triangle instead of a quad', () => {
    let s = session({ makeQuads: true });
    s = click(s, 0, 0);
    s = click(s, 1, 0);
    s = click(s, 1, 1, { triangle: true });
    expect(s.patches).toHaveLength(1);
    expect(s.patches[0].kind).toBe('triangle');
    expect(s.patches[0].pointIds).toHaveLength(3);
    // Only one new vertex: the auto-completed corner is skipped.
    expect(s.points).toHaveLength(3);
    expect(s.activeIds).toHaveLength(2);
  });

  it('is inert for non-Polygons types', () => {
    let s = session({ makeQuads: true, type: 'vertices' });
    s = click(s, 0, 0);
    s = click(s, 1, 0);
    s = click(s, 1, 1);
    expect(s.patches).toHaveLength(0);
  });
});

describe('Direct vertex editing', () => {
  it('moves a vertex, by drag or by Current Point number', () => {
    let s = session();
    s = click(s, 0, 0);
    s = click(s, 1, 0);
    const first = s.points[0].id;

    s = penMovePoint(s, first, vec(0, 0, 5));
    expect(s.points[0].position.z).toBe(5);
    // "Current Point" = 1 edits Position X/Y/Z.
    s = penSetPointByOrder(s, 1, vec(0, 0, -2));
    expect(s.points[0].position.z).toBe(-2);
    expect(s.points[1].position.x).toBe(1);
    // Out-of-range numbers are ignored.
    expect(penSetPointByOrder(s, 42, vec(9, 9, 9))).toBe(s);
  });

  it('welds a dragged vertex onto any previous vertex', () => {
    let s = session();
    s = click(s, 0, 0);
    s = click(s, 1, 0);
    s = click(s, 1, 1);
    const ids = [...s.activeIds];
    s = penCommitActive(s);

    s = click(s, 4, 0);
    s = click(s, 5, 0);
    s = click(s, 5, 1);
    const dragged = s.activeIds[2];

    const welded = penWeldPoints(s, dragged, ids[0]);
    expect(welded.points.some((p) => p.id === dragged)).toBe(false);
    expect(welded.activeIds[2]).toBe(ids[0]);
    expect(welded.patches[0].pointIds).toEqual(ids);
  });

  it('drops a patch that collapses when its vertices are welded', () => {
    let s = session();
    s = click(s, 0, 0);
    s = click(s, 1, 0);
    s = click(s, 1, 1);
    const ids = [...s.activeIds];
    s = penCommitActive(s);
    expect(penWeldPoints(s, ids[0], ids[1]).patches).toHaveLength(0);
  });

  it('Backspace drops the last active vertex, then the last patch', () => {
    let s = session();
    s = click(s, 0, 0);
    s = click(s, 1, 0);
    s = click(s, 1, 1);
    const removed = s.activeIds[2];

    const afterVertex = penUndoLastPoint(s);
    expect(afterVertex.activeIds).toHaveLength(2);
    expect(afterVertex.points.some((p) => p.id === removed)).toBe(false);

    const afterPatch = penUndoLastPoint(penCommitActive(afterVertex));
    expect(afterPatch.patches).toHaveLength(0);
  });
});

describe('Overlay guides', () => {
  it('draws closed patch outlines plus the open chain', () => {
    let s = session();
    s = click(s, 0, 0);
    s = click(s, 1, 0);
    s = click(s, 1, 1);
    s = penCommitActive(s);
    s = click(s, 3, 0);
    s = click(s, 4, 0);
    // 3 edges around the closed triangle + 1 open chain edge.
    expect(penOverlaySegments(s)).toHaveLength(4);
  });

  it('reports corner angles in degrees for Show Angles', () => {
    let s = session();
    s = click(s, 0, 0);
    s = click(s, 1, 0);
    s = click(s, 1, 1);
    const labels = penAngleLabels(s);
    expect(labels).toHaveLength(1);
    expect(labels[0].degrees).toBeCloseTo(90, 5);
  });
});

describe('Wall Mode', () => {
  it('offsets the far edge inside for Inner and outside for Outer', () => {
    const path = [vec(0, 0, 0), vec(1, 0, 0)];
    const inner = penWallProfile(path, false, 1, settings({ offset: 0.2 }), topPlane);
    expect(inner.base).toHaveLength(2);
    expect(inner.offset).toHaveLength(2);
    expect(inner.offset[0].z).toBeCloseTo(0.2, 6);
    expect(inner.offset[1].z).toBeCloseTo(0.2, 6);

    const outer = penWallProfile(path, false, -1, settings({ offset: 0.2 }), topPlane);
    expect(outer.offset[0].z).toBeCloseTo(-0.2, 6);
  });

  it('miters the corner so neighbouring segments stay connected', () => {
    const path = [vec(0, 0, 0), vec(1, 0, 0), vec(1, 0, 1)];
    const wall = penWallProfile(path, false, 1, settings({ offset: 0.2 }), topPlane);
    expect(wall.base).toHaveLength(3);
    expect(wall.offset).toHaveLength(3);
    expect(wall.offset[1].x).toBeCloseTo(0.8, 6);
    expect(wall.offset[1].z).toBeCloseTo(0.2, 6);
  });

  it('Inset + Segments bevels corners: 1 flattens, higher values round', () => {
    const path = [vec(0, 0, 0), vec(1, 0, 0), vec(1, 0, 1)];
    const flat = penWallProfile(path, false, 1, settings({ offset: 0.2, inset: 0.1, segments: 1 }), topPlane);
    expect(flat.offset).toHaveLength(3);
    expect(flat.base).toHaveLength(flat.offset.length);

    const round = penWallProfile(path, false, 1, settings({ offset: 0.2, inset: 0.1, segments: 3 }), topPlane);
    expect(round.offset).toHaveLength(5);
    expect(round.base).toHaveLength(round.offset.length);

    // The rounded corner bulges further from the sharp corner than the chamfer.
    const corner = vec(1, 0, 0);
    const flatDistance = Math.hypot(flat.offset[1].x - corner.x, flat.offset[1].z - corner.z);
    const roundDistance = Math.hypot(round.offset[2].x - corner.x, round.offset[2].z - corner.z);
    expect(roundDistance).toBeGreaterThan(flatDistance);
  });

  it('triangulates a band into n-1 + m-1 triangles, all manifold', () => {
    const baseRing = [vec(0, 0, 0), vec(1, 0, 0), vec(2, 0, 0)];
    const offset = [vec(0, 0, 1), vec(1, 0, 1), vec(2, 0, 1)];
    const tris = penBandTriangles(baseRing, offset);

    expect(tris).toHaveLength(baseRing.length - 1 + offset.length - 1);
    const total = baseRing.length + offset.length;
    const edgeUses = new Map<string, number>();
    tris.forEach((tri) => {
      tri.forEach((index) => {
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(total);
      });
      for (let i = 0; i < 3; i++) {
        const a = tri[i];
        const b = tri[(i + 1) % 3];
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        edgeUses.set(key, (edgeUses.get(key) ?? 0) + 1);
      }
    });
    // A strip shares its interior rungs and never leaves a hanging edge.
    expect([...edgeUses.values()].every((uses) => uses <= 2)).toBe(true);
    expect([...edgeUses.values()].some((uses) => uses === 2)).toBe(true);
    expect(penBandTriangles(baseRing, [offset[0]])).toHaveLength(0);
  });
});

describe('UVs (Make UVs + Project To)', () => {
  it('Action Axis projects world space along the work plane', () => {
    expect(penUVFor(vec(0.25, 0, 0.5), topPlane)).toEqual({ u: 0.25, v: 0.5 });
  });

  it('normalizes arc-length parameters for wall UVs', () => {
    // Segment lengths 1 and 2 -> parameters 0, 1/3, 1.
    expect(penPolylineParams([vec(0, 0, 0), vec(1, 0, 0), vec(3, 0, 0)])).toEqual([0, 1 / 3, 1]);
  });
});

describe('Commit to mesh', () => {
  const base = () => createPrimitiveMesh('plane');

  it('appends one face per polygon and keeps the base mesh', () => {
    let s = session();
    s = click(s, 0, 0);
    s = click(s, 1, 0);
    s = click(s, 1, 1);
    s = penCommitActive(s);
    const b = base();
    const { mesh, faceIds, vertexIds } = penSessionToMesh(b, s);

    expect(mesh.faces).toHaveLength(b.faces.length + 1);
    expect(mesh.vertices).toHaveLength(b.vertices.length + 3);
    expect(faceIds).toHaveLength(1);
    expect(vertexIds).toHaveLength(3);
    expect(mesh.faces[mesh.faces.length - 1].vertexIds).toHaveLength(3);
    // The source mesh is never mutated.
    expect(b.faces).toHaveLength(1);
  });

  it('welds vertices shared by a Make Quads strip', () => {
    let s = session({ makeQuads: true });
    s = click(s, 0, 0);
    s = click(s, 1, 0);
    s = click(s, 0, 2);
    s = click(s, 0, 4);
    expect(s.patches).toHaveLength(2);

    const b = base();
    const { mesh } = penSessionToMesh(b, s);
    expect(mesh.faces).toHaveLength(b.faces.length + 2);
    expect(mesh.vertices).toHaveLength(b.vertices.length + s.points.length);
    const [firstQuad, secondQuad] = mesh.faces.slice(-2);
    expect(firstQuad.vertexIds.filter((id) => secondQuad.vertexIds.includes(id))).toHaveLength(2);
  });

  it('tags Spline Patches and Subdivision Surfaces', () => {
    const cases = [
      ['splinePatches', 'spline'],
      ['subdivision', 'sds'],
    ] as const;
    cases.forEach(([type, tag]) => {
      let s = session({ type });
      s = click(s, 0, 0);
      s = click(s, 1, 0);
      s = click(s, 1, 1);
      s = penCommitActive(s);
      const { mesh } = penSessionToMesh(base(), s);
      expect(mesh.faces[mesh.faces.length - 1].smoothingGroup).toBe(tag);
    });
  });

  it('commits a point cloud for Vertices / Lines types', () => {
    let s = session({ type: 'vertices' });
    s = click(s, 0, 0);
    s = click(s, 1, 0);
    const b = base();
    const { mesh, faceIds } = penSessionToMesh(b, s);
    expect(faceIds).toHaveLength(0);
    expect(mesh.faces).toHaveLength(b.faces.length);
    expect(mesh.vertices).toHaveLength(b.vertices.length + 2);
  });

  it('Wall Mode writes the offset footprint instead of the outline', () => {
    let s = session({ wallMode: 'inner', offset: 0.25, makeUvs: false });
    s = click(s, 0, 0);
    s = click(s, 2, 0);
    s = click(s, 2, 2);
    s = penCommitActive(s);

    const b = base();
    const { mesh } = penSessionToMesh(b, s);
    // 3 wall segments -> a 4 triangle strip.
    expect(mesh.faces).toHaveLength(b.faces.length + 4);
    const wallVerts = mesh.vertices.slice(b.vertices.length);
    expect(wallVerts.some((v) => Math.abs(v.z - 0.25) < 1e-6)).toBe(true);
  });

  it('writes wall UVs along the path for U/V Direction', () => {
    let s = session({ wallMode: 'outer', offset: 0.2, projectTo: 'uvDirection' });
    s = click(s, 0, 0);
    s = click(s, 2, 0);
    s = click(s, 2, 2);
    s = penCommitActive(s);

    const { mesh } = penSessionToMesh(base(), s);
    const face = mesh.faces[mesh.faces.length - 1];
    expect(face.uvs).toHaveLength(3);
    expect(face.uvs.every((uv) => uv.u >= 0 && uv.u <= 1)).toBe(true);
    expect(new Set(face.uvs.map((uv) => uv.v))).toEqual(new Set([0, 1]));
  });

  it('skips UVs when Make UVs is off', () => {
    let s = session({ makeUvs: false });
    s = click(s, 0, 0);
    s = click(s, 1, 0);
    s = click(s, 1, 1);
    s = penCommitActive(s);
    const { mesh } = penSessionToMesh(base(), s);
    expect(mesh.faces[mesh.faces.length - 1].uvs.every((uv) => uv.u === 0 && uv.v === 0)).toBe(true);
  });

  it('previews the active ring as a face before commit', () => {
    let s = session();
    s = click(s, 0, 0);
    s = click(s, 1, 0);
    s = click(s, 1, 1);
    const { mesh, faceIds } = penSessionToMesh(base(), s);
    expect(faceIds).toHaveLength(1);
    expect(mesh.faces).toHaveLength(base().faces.length + 1);
  });

  it('stores pen verts in mesh-local space so world matches the overlay', () => {
    const cube = createBoxMesh(1, 1, 1);
    let s = session();
    s = click(s, 0, 0);
    s = click(s, 1, 0);
    s = click(s, 1, 1);
    s = penCommitActive(s);
    const { mesh, vertexIds } = penSessionToMesh(cube, s);
    const added = vertexIds.map((id) => mesh.vertices.find((v) => v.id === id)!);
    expect(added[0].y).toBeCloseTo(-0.5);
    const world = localPointToWorld(mesh, added[0]);
    expect(world.x).toBeCloseTo(0);
    expect(world.y).toBeCloseTo(0);
    expect(world.z).toBeCloseTo(0);
  });

  it('keeps overlay world points aligned when the object is moved and rotated', () => {
    const cube = {
      ...createBoxMesh(1, 1, 1),
      position: { x: 2, y: 0.5, z: -1 },
      rotation: { x: 0, y: Math.PI / 2, z: 0 },
    };
    let s = session();
    s = penAddPoint(s, vec(0.25, 0, 0.5));
    s = penAddPoint(s, vec(1.25, 0, 0.5));
    s = penAddPoint(s, vec(1.25, 0, 1.5));
    s = penCommitActive(s);
    const { mesh, vertexIds } = penSessionToMesh(cube, s);
    const first = mesh.vertices.find((v) => v.id === vertexIds[0])!;
    const world = localPointToWorld(mesh, first);
    expect(world.x).toBeCloseTo(0.25);
    expect(world.y).toBeCloseTo(0);
    expect(world.z).toBeCloseTo(0.5);
  });
});

describe('resolvePenWorkPlane', () => {
  const top = constructionPlaneForView('top');
  const frontRay = { origin: vec(0, 0, 10), dir: vec(0, 0, -1) };
  const topRay = { origin: vec(0, 10, 0), dir: vec(0, -1, 0) };

  it('uses the current view plane for the first vertex', () => {
    const plane = resolvePenWorkPlane({
      view: 'front',
      sessionPlane: top,
      hasPoints: false,
      rayOrigin: frontRay.origin,
      rayDir: frontRay.dir,
    });
    expect(plane.n).toEqual(constructionPlaneForView('front').n);
  });

  it('stays on the session plane when the ray can hit it', () => {
    const plane = resolvePenWorkPlane({
      view: 'top',
      sessionPlane: top,
      hasPoints: true,
      rayOrigin: topRay.origin,
      rayDir: topRay.dir,
    });
    expect(plane).toBe(top);
  });

  it('falls back to Front/Side in Quad when the Top plane is parallel', () => {
    const plane = resolvePenWorkPlane({
      view: 'front',
      sessionPlane: top,
      hasPoints: true,
      rayOrigin: frontRay.origin,
      rayDir: frontRay.dir,
    });
    expect(plane.n).toEqual(constructionPlaneForView('front').n);
  });

  it('draws on a perspective surface for the first vertex', () => {
    const plane = resolvePenWorkPlane({
      view: 'perspective',
      sessionPlane: top,
      hasPoints: false,
      rayOrigin: vec(4, 3, 6),
      rayDir: vec(-1, -0.5, -1),
      surface: { point: vec(0.5, 0.5, 0.5), normal: vec(1, 0, 0) },
    });
    expect(plane.n.x).toBeCloseTo(1);
    expect(plane.origin).toEqual(vec(0.5, 0.5, 0.5));
  });

  it('keeps later perspective clicks on the locked face even if another surface is under the cursor', () => {
    const face = constructionPlaneForView('side', vec(0.5, 0.5, 0));
    const plane = resolvePenWorkPlane({
      view: 'perspective',
      sessionPlane: face,
      hasPoints: true,
      rayOrigin: vec(4, 0.5, 0),
      rayDir: vec(-1, 0, 0),
      surface: { point: vec(0, 1, 0), normal: vec(0, 1, 0) },
    });
    expect(plane).toBe(face);
  });

  it('draws on a mesh surface in Front/Side, not only perspective', () => {
    const plane = resolvePenWorkPlane({
      view: 'front',
      sessionPlane: top,
      hasPoints: false,
      rayOrigin: frontRay.origin,
      rayDir: frontRay.dir,
      surface: { point: vec(0, 0.5, 0.5), normal: vec(0, 0, 1) },
    });
    expect(plane.n.z).toBeCloseTo(1);
    expect(plane.origin).toEqual(vec(0, 0.5, 0.5));
  });
});

describe('Pen connect to existing mesh vertices', () => {
  it('reuses cube corners instead of spawning duplicate verts', () => {
    const cube = createBoxMesh(1, 1, 1);
    const [a, b, c] = cube.vertices;
    let s = session();
    s = penAddPoint(s, localPointToWorld(cube, a), { meshVertexId: a.id });
    s = penAddPoint(s, localPointToWorld(cube, b), { meshVertexId: b.id });
    s = penAddPoint(s, localPointToWorld(cube, c), { meshVertexId: c.id });
    s = penCommitActive(s);
    const { mesh, vertexIds } = penSessionToMesh(cube, s);
    expect(vertexIds).toEqual([]);
    expect(mesh.vertices).toHaveLength(cube.vertices.length);
    expect(mesh.faces).toHaveLength(cube.faces.length + 1);
    expect(mesh.faces[mesh.faces.length - 1].vertexIds).toEqual([a.id, b.id, c.id]);
  });

  it('starts on an old vertex and draws new verts off it', () => {
    const cube = createBoxMesh(1, 1, 1);
    const corner = cube.vertices[0];
    let s = session();
    s = penAddPoint(s, localPointToWorld(cube, corner), { meshVertexId: corner.id });
    s = penAddPoint(s, vec(2, 0, 0));
    s = penAddPoint(s, vec(2, 0, 2));
    s = penCommitActive(s);
    const { mesh, vertexIds } = penSessionToMesh(cube, s);
    expect(vertexIds).toHaveLength(2);
    expect(mesh.vertices).toHaveLength(cube.vertices.length + 2);
    expect(mesh.faces[mesh.faces.length - 1].vertexIds[0]).toBe(corner.id);
  });

  it('clicking the first vertex of a 3-chain closes the polygon', () => {
    const cube = createBoxMesh(1, 1, 1);
    const [a, b, c] = cube.vertices;
    let s = session();
    s = penAddPoint(s, localPointToWorld(cube, a), { meshVertexId: a.id });
    s = penAddPoint(s, localPointToWorld(cube, b), { meshVertexId: b.id });
    s = penAddPoint(s, localPointToWorld(cube, c), { meshVertexId: c.id });
    const first = s.points[0];
    s = penConnectExisting(s, first.id);
    expect(s.activeIds).toHaveLength(0);
    expect(s.patches).toHaveLength(1);
    expect(s.patches[0].pointIds).toEqual([s.points[0].id, s.points[1].id, s.points[2].id]);
  });

  it('re-adding an already adopted mesh vertex continues that session point', () => {
    const cube = createBoxMesh(1, 1, 1);
    const [a, b] = cube.vertices;
    let s = session();
    s = penAddPoint(s, localPointToWorld(cube, a), { meshVertexId: a.id });
    s = penAddPoint(s, localPointToWorld(cube, b), { meshVertexId: b.id });
    const before = s.points.length;
    s = penAddPoint(s, localPointToWorld(cube, a), { meshVertexId: a.id });
    expect(s.points).toHaveLength(before);
    expect(s.activeIds).toEqual([s.points[0].id, s.points[1].id]);
  });

  it('undo of a connected old vertex keeps it if the chain still uses it', () => {
    const cube = createBoxMesh(1, 1, 1);
    const a = cube.vertices[0];
    let s = session();
    s = penAddPoint(s, localPointToWorld(cube, a), { meshVertexId: a.id });
    s = penAddPoint(s, vec(1.5, 0, 0));
    s = penAddPoint(s, localPointToWorld(cube, a), { meshVertexId: a.id });
    s = penUndoLastPoint(s);
    expect(s.points[0].meshVertexId).toBe(a.id);
    expect(s.activeIds[0]).toBe(s.points[0].id);
  });

  it('binds a free point onto an existing mesh vertex', () => {
    const cube = createBoxMesh(1, 1, 1);
    const a = cube.vertices[0];
    let s = session();
    s = penAddPoint(s, vec(0, 0, 0));
    const id = s.points[0].id;
    s = penBindMeshVertex(s, id, a.id, localPointToWorld(cube, a));
    const { mesh, vertexIds } = penSessionToMesh(cube, s);
    expect(vertexIds).toEqual([]);
    expect(mesh.vertices).toHaveLength(cube.vertices.length);
  });

  it('picks the nearest screen-space handle', () => {
    const hit = penNearestScreenHit(10, 10, [
      { id: 'far', sx: 80, sy: 80 },
      { id: 'near', sx: 12, sy: 11 },
    ]);
    expect(hit?.id).toBe('near');
    expect(penNearestScreenHit(10, 10, [{ id: 'far', sx: 80, sy: 80 }])).toBeNull();
  });
});
