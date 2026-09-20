import { describe, expect, it } from 'vitest';
import {
  beginDrawSession,
  computeDrawBox,
  constructionPlaneForView,
  fitMeshToLocalBox,
  heightAlongNormal,
  isFlatPrimitive,
  lockDrawBase,
  makeConstructionPlane,
  meshFromPreview,
  MIN_DRAW_SIZE,
  placementSession,
  planeCoords,
  sessionToPreview,
  snapDrawPoint,
  updateDrawBase,
  updateDrawHeight,
  vec,
  worldUnitsPerPixel,
  resolvePrimitiveWorkPlane,
} from './primitiveDraw';
import { generatePrimitive } from './meshUtils';

describe('construction planes', () => {
  it('uses XZ for top and perspective, XY for front, ZY for side', () => {
    const top = constructionPlaneForView('top');
    expect(top.n.y).toBeCloseTo(1);
    expect(Math.abs(top.u.x)).toBeCloseTo(1);

    const front = constructionPlaneForView('front');
    expect(Math.abs(front.n.z)).toBeCloseTo(1);
    expect(Math.abs(front.u.x)).toBeCloseTo(1);
    expect(front.v.y).toBeCloseTo(1);

    const side = constructionPlaneForView('side');
    expect(side.n.x).toBeCloseTo(1);
    expect(side.v.y).toBeCloseTo(1);
  });

  it('picks the view plane in empty space for Top / Front / Side / Persp', () => {
    const cases: Array<['top' | 'front' | 'side' | 'perspective', { origin: ReturnType<typeof vec>; dir: ReturnType<typeof vec> }]> = [
      ['top', { origin: vec(1, 10, 2), dir: vec(0, -1, 0) }],
      ['front', { origin: vec(1, 2, 10), dir: vec(0, 0, -1) }],
      ['side', { origin: vec(10, 2, 1), dir: vec(-1, 0, 0) }],
      ['perspective', { origin: vec(4, 6, 8), dir: vec(-0.4, -0.6, -0.8) }],
    ];
    for (const [view, ray] of cases) {
      const resolved = resolvePrimitiveWorkPlane({
        view,
        rayOrigin: ray.origin,
        rayDir: ray.dir,
      });
      expect(resolved, view).toBeTruthy();
      expect(resolved!.plane.n).toEqual(constructionPlaneForView(view).n);
      expect(resolved!.surface).toBe(false);
    }
  });

  it('draws on a mesh face in any view when a surface hit is supplied', () => {
    const surface = { point: vec(0.5, 0.4, 0.1), normal: vec(1, 0, 0) };
    for (const view of ['perspective', 'top', 'front', 'side'] as const) {
      const resolved = resolvePrimitiveWorkPlane({
        view,
        rayOrigin: vec(4, 0.4, 0.1),
        rayDir: vec(-1, 0, 0),
        surface,
      });
      expect(resolved, view).toBeTruthy();
      expect(resolved!.surface).toBe(true);
      expect(resolved!.plane.n.x).toBeCloseTo(1);
      expect(resolved!.hit.x).toBeCloseTo(0.5);
    }
  });

  it('stays on a locked CAD plane when the ray can hit it', () => {
    const locked = constructionPlaneForView('front', vec(0, 0, 0));
    const resolved = resolvePrimitiveWorkPlane({
      view: 'perspective',
      rayOrigin: vec(0, 0, 8),
      rayDir: vec(0, 0, -1),
      surface: { point: vec(0, 1, 0), normal: vec(0, 1, 0) },
      lockedPlane: locked,
    });
    expect(resolved?.plane).toBe(locked);
    expect(resolved?.hit.z).toBeCloseTo(0);
  });
});

describe('primitive draw session', () => {
  it('draws a cube base on the ground then extrudes height', () => {
    const plane = constructionPlaneForView('perspective');
    let session = beginDrawSession({
      primitiveType: 'cube',
      viewKind: 'perspective',
      plane,
      start: vec(0, 0, 0),
    });
    session = updateDrawBase(session, vec(2, 0, 3), { kind: 'none', point: vec(2, 0, 3) });
    const baseBox = computeDrawBox(session);
    expect(baseBox.size.x).toBeCloseTo(2);
    expect(baseBox.size.z).toBeCloseTo(3);

    session = lockDrawBase(session);
    session = updateDrawHeight(session, 1.5, { kind: 'none', point: vec(2, 1.5, 3) });
    const preview = sessionToPreview(session);
    expect(preview.dimensions.x).toBeCloseTo(2);
    expect(preview.dimensions.y).toBeCloseTo(1.5);
    expect(preview.dimensions.z).toBeCloseTo(3);

    const mesh = meshFromPreview(preview);
    expect(mesh.position.x).toBeCloseTo(preview.boundingBox.center.x);
    expect(mesh.position.y).toBeCloseTo(preview.boundingBox.center.y);
    expect(mesh.position.z).toBeCloseTo(preview.boundingBox.center.z);
    expect(mesh.rotation).toEqual(preview.orientation);

    const xs = mesh.vertices.map((v) => v.x);
    const ys = mesh.vertices.map((v) => v.y);
    const zs = mesh.vertices.map((v) => v.z);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(2, 4);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(1.5, 4);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(3, 4);
  });

  it('keeps plane primitives flat and skips height', () => {
    expect(isFlatPrimitive('plane')).toBe(true);
    const plane = constructionPlaneForView('top');
    let session = beginDrawSession({
      primitiveType: 'plane',
      viewKind: 'top',
      plane,
      start: vec(-1, 0, -1),
    });
    session = updateDrawBase(session, vec(1, 0, 1), { kind: 'none', point: vec(1, 0, 1) });
    const preview = sessionToPreview(session);
    expect(preview.isFlat).toBe(true);
    expect(preview.dimensions.y).toBeLessThan(0.01);
    const mesh = meshFromPreview(preview);
    const ys = mesh.vertices.map((v) => v.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(0.02);
  });

  it('orients a front-view box so height is along Z', () => {
    const plane = constructionPlaneForView('front');
    let session = beginDrawSession({
      primitiveType: 'cube',
      viewKind: 'front',
      plane,
      start: vec(0, 0, 0),
    });
    session = updateDrawBase(session, vec(2, 1, 0), { kind: 'none', point: vec(2, 1, 0) });
    session = lockDrawBase(session);
    session = updateDrawHeight(session, 4, { kind: 'none', point: vec(2, 1, 4) });
    const preview = sessionToPreview(session);
    expect(preview.dimensions.x).toBeCloseTo(2);
    expect(preview.dimensions.y).toBeCloseTo(4);
    expect(preview.dimensions.z).toBeCloseTo(1);
    expect(preview.boundingBox.center.z).toBeCloseTo(-2);
    const uv = planeCoords(preview.boundingBox.center, plane);
    expect(uv.u).toBeCloseTo(1);
    expect(uv.v).toBeCloseTo(0.5);
  });

  it('finalizes a sphere that fills the same box as the preview', () => {
    const plane = constructionPlaneForView('top');
    let session = beginDrawSession({
      primitiveType: 'sphere',
      viewKind: 'top',
      plane,
      start: vec(0, 0, 0),
    });
    session = updateDrawBase(session, vec(2, 0, 2), { kind: 'none', point: vec(2, 0, 2) });
    session = lockDrawBase(session);
    session = updateDrawHeight(session, 2, { kind: 'none', point: vec(2, 2, 2) });
    const preview = sessionToPreview(session);
    const ghost = meshFromPreview(preview);
    const finalMesh = meshFromPreview(preview);
    expect(finalMesh.position).toEqual(ghost.position);
    expect(finalMesh.rotation).toEqual(ghost.rotation);
    const span = (mesh: typeof ghost, axis: 'x' | 'y' | 'z') => {
      const vs = mesh.vertices.map((v) => v[axis]);
      return Math.max(...vs) - Math.min(...vs);
    };
    expect(span(finalMesh, 'x')).toBeCloseTo(span(ghost, 'x'), 5);
    expect(span(finalMesh, 'y')).toBeCloseTo(2, 3);
  });

  it('snaps to grid when Shift is held', () => {
    const plane = constructionPlaneForView('top');
    const snapped = snapDrawPoint({
      point: vec(1.12, 0, 2.37),
      plane,
      gridStep: 0.25,
      shiftSnap: true,
    });
    expect(snapped.kind).toBe('grid');
    expect(snapped.point.x).toBeCloseTo(1);
    expect(snapped.point.z).toBeCloseTo(2.25);
  });
});

describe('screen to world', () => {
  it('converts ortho pixels using the camera span', () => {
    expect(worldUnitsPerPixel({ ortho: true, orthoSpan: 8, fovDeg: 38, distance: 10, viewH: 400 })).toBeCloseTo(0.02);
  });

  it('uses screen delta when the camera looks along the plane normal', () => {
    const plane = constructionPlaneForView('front');
    const h = heightAlongNormal({
      hit: vec(1, 1, 10),
      plane,
      screenDeltaPx: 50,
      worldPerPixel: 0.02,
      cameraParallelToNormal: true,
    });
    expect(h).toBeCloseTo(1);
  });
});

describe('fitMeshToLocalBox', () => {
  it('scales any primitive into the target box', () => {
    const cube = generatePrimitive('cube', { x: 1, y: 1, z: 1 });
    const fitted = fitMeshToLocalBox(cube, { x: 3, y: 0.5, z: 2 });
    const span = (axis: 'x' | 'y' | 'z') => {
      const vs = fitted.vertices.map((v) => v[axis]);
      return Math.max(...vs) - Math.min(...vs);
    };
    expect(span('x')).toBeCloseTo(3, 4);
    expect(span('y')).toBeCloseTo(0.5, 4);
    expect(span('z')).toBeCloseTo(2, 4);
  });

  it('fits torus, stairs, roof, arch, wall, window and ladder in the box', () => {
    for (const type of ['torus', 'stairs', 'roof', 'arch', 'wall', 'window', 'ladder'] as const) {
      const plane = constructionPlaneForView('perspective');
      let session = beginDrawSession({ primitiveType: type, viewKind: 'perspective', plane, start: vec(0, 0, 0) });
      session = updateDrawBase(session, vec(2, 0, 1), { kind: 'none', point: vec(2, 0, 1) });
      session = lockDrawBase(session);
      session = updateDrawHeight(session, 1.2, { kind: 'none', point: vec(2, 1.2, 1) });
      const mesh = meshFromPreview(sessionToPreview(session));
      const span = (axis: 'x' | 'y' | 'z') => {
        const vs = mesh.vertices.map((v) => v[axis]);
        return Math.max(...vs) - Math.min(...vs);
      };
      expect(span('x'), type).toBeCloseTo(Math.max(MIN_DRAW_SIZE, 2), 3);
      expect(span('y'), type).toBeCloseTo(1.2, 3);
      expect(span('z'), type).toBeCloseTo(1, 3);
      expect(mesh.faces.length, type).toBeGreaterThan(0);
    }
  });

  it('sits a click-placed cube on a vertical surface along the face normal', () => {
    const plane = makeConstructionPlane(vec(0.5, 0.5, 0), vec(1, 0, 0));
    const session = placementSession({
      primitiveType: 'cube',
      viewKind: 'perspective',
      plane,
    });
    const mesh = meshFromPreview(sessionToPreview(session));
    expect(mesh.position.x).toBeCloseTo(1);
    expect(mesh.position.y).toBeCloseTo(0.5);
    expect(Math.abs(mesh.rotation.x) + Math.abs(mesh.rotation.y) + Math.abs(mesh.rotation.z)).toBeGreaterThan(0.5);
  });
});
