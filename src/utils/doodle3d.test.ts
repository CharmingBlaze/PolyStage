import { describe, expect, it } from 'vitest';
import { buildDoodleMesh, createDoodleSession, DEFAULT_DOODLE_SETTINGS } from './doodle3d';

describe('3D Doodle topology', () => {
  it('extrudes a sharp closed outline with caps and quad walls', () => {
    const session = createDoodleSession({ ...DEFAULT_DOODLE_SETTINGS, mode: 'sharp', depth: 1 });
    session.points = [
      { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 },
      { x: 1, y: 0, z: 1 }, { x: 0, y: 0, z: 1 },
    ];
    session.closed = true;
    const result = buildDoodleMesh(session, { x: 0, y: 1, z: 0 });
    expect(result.warning).toBeNull();
    expect(result.mesh?.vertices).toHaveLength(8);
    expect(result.mesh?.faces).toHaveLength(6);
    expect(result.mesh?.faces.filter((face) => face.vertexIds.length === 4)).toHaveLength(6);
    expect(result.mesh?.edges.every((edge) => edge.v1Id !== edge.v2Id)).toBe(true);
  });

  it('rejects a self-intersecting closed outline', () => {
    const session = createDoodleSession(DEFAULT_DOODLE_SETTINGS);
    session.points = [
      { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 1 },
      { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 0 },
    ];
    session.closed = true;
    expect(buildDoodleMesh(session).warning).toMatch(/crosses itself/i);
  });

  it('creates a capped open tube using quad side topology', () => {
    const session = createDoodleSession({ ...DEFAULT_DOODLE_SETTINGS, mode: 'open', openOutput: 'tube', topologyPreset: 'custom', resolution: 6, simplifyTolerance: 0, smoothing: 0 });
    session.points = [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 2 }];
    const result = buildDoodleMesh(session);
    expect(result.mesh?.vertices).toHaveLength(18);
    expect(result.mesh?.faces).toHaveLength(14);
    expect(result.mesh?.faces.slice(0, 12).every((face) => face.vertexIds.length === 4)).toBe(true);
  });

  it('uses bevel rings for a soft doodle without over-tessellating the caps', () => {
    const session = createDoodleSession({ ...DEFAULT_DOODLE_SETTINGS, mode: 'soft', resolution: 3, bevel: 0.1 });
    session.points = [
      { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 },
      { x: 1, y: 0, z: 1 }, { x: 0, y: 0, z: 1 },
    ];
    session.closed = true;
    const result = buildDoodleMesh(session);
    expect(result.warning).toBeNull();
    expect(result.mesh?.vertices.length).toBeGreaterThan(16);
    expect(result.mesh?.modifiers?.[0]?.type).toBe('subdivision');
  });

  it('builds a finite tube from a fully non-planar Free 3D stroke', () => {
    const session = createDoodleSession({
      ...DEFAULT_DOODLE_SETTINGS,
      mode: 'open',
      plane: 'free3d',
      openOutput: 'tube',
      smoothing: 0.7,
      resolution: 8,
    });
    session.points = [
      { x: -1, y: 0, z: 0 },
      { x: -0.4, y: 0.7, z: 0.5 },
      { x: 0.3, y: -0.2, z: 1.3 },
      { x: 0.8, y: 0.9, z: 2.1 },
    ];
    const result = buildDoodleMesh(session);
    expect(result.warning).toBeNull();
    expect(result.mesh?.faces.length).toBeGreaterThan(20);
    expect(result.mesh?.vertices.every((vertex) => [vertex.x, vertex.y, vertex.z].every(Number.isFinite))).toBe(true);
  });

  it('creates real rounded cap topology when requested', () => {
    const session = createDoodleSession({
      ...DEFAULT_DOODLE_SETTINGS,
      mode: 'open', openOutput: 'tube', topologyPreset: 'custom', simplifyTolerance: 0, smoothing: 0, resolution: 6, capStyle: 'round', capEnds: true,
    });
    session.points = [{ x: 0, y: 0, z: 0 }, { x: 0.5, y: 0.4, z: 1 }];
    const rounded = buildDoodleMesh(session).mesh!;
    expect(rounded.vertices.length).toBe(26);
    expect(rounded.faces.some((face) => face.vertexIds.length === 3)).toBe(true);
  });

  it('keeps low-poly strokes lighter than mid-poly while preserving the silhouette', () => {
    const points = Array.from({ length: 25 }, (_, index) => ({
      x: index * 0.08,
      y: Math.sin(index * 0.32) * 0.45,
      z: Math.cos(index * 0.21) * 0.2,
    }));
    const low = createDoodleSession({ ...DEFAULT_DOODLE_SETTINGS, mode: 'open', plane: 'free3d', topologyPreset: 'low', smoothing: 0 });
    const mid = createDoodleSession({ ...DEFAULT_DOODLE_SETTINGS, mode: 'open', plane: 'free3d', topologyPreset: 'mid', smoothing: 0 });
    low.points = points;
    mid.points = points;
    const lowMesh = buildDoodleMesh(low).mesh!;
    const midMesh = buildDoodleMesh(mid).mesh!;
    expect(lowMesh.faces.length).toBeLessThan(midMesh.faces.length);
    expect(lowMesh.vertices.length).toBeLessThan(midMesh.vertices.length);
    expect(lowMesh.vertices.length).toBeGreaterThan(12);
  });
});
