import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import * as THREE from 'three';
import type { BezierPath, VectorPlane, VectorPoint } from '../utils/vectorBlockout';
import { silhouetteKeyHeights } from '../utils/vectorBlockout';
import { useVectorStore } from '../store/useVectorStore';
import {
  getVectorViewport,
  type VectorViewportKind,
} from '../utils/vectorViewportRegistry';

type DragTarget =
  | { type: 'anchor'; plane: VectorPlane; index: number }
  | { type: 'handleIn' | 'handleOut'; plane: VectorPlane; index: number }
  | null;

const worldPoint = (plane: VectorPlane, p: VectorPoint) =>
  plane === 'front'
    ? new THREE.Vector3(p.u, p.v, 0.035)
    : plane === 'side'
      ? new THREE.Vector3(0.035, p.v, p.u)
      : new THREE.Vector3(p.u, 0.035, p.v);

function projectPoint(kind: VectorViewportKind, plane: VectorPlane, p: VectorPoint) {
  const vp = getVectorViewport(kind);
  if (!vp) return null;
  const projected = worldPoint(plane, p).project(vp.camera);
  return {
    x: ((projected.x + 1) * vp.container.clientWidth) / 2,
    y: ((1 - projected.y) * vp.container.clientHeight) / 2,
    visible: projected.z >= -1 && projected.z <= 1,
  };
}

function clientToLocal(kind: VectorViewportKind, clientX: number, clientY: number) {
  const vp = getVectorViewport(kind);
  if (!vp) return null;
  const rect = vp.container.getBoundingClientRect();
  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function planesForViewport(kind: VectorViewportKind): VectorPlane[] {
  return kind === 'perspective' ? ['front', 'side', 'top'] : [kind];
}

function pointOnPlane(
  kind: VectorViewportKind,
  plane: VectorPlane,
  clientX: number,
  clientY: number
): VectorPoint | null {
  const vp = getVectorViewport(kind);
  if (!vp) return null;
  const rect = vp.container.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1,
    -(((clientY - rect.top) / Math.max(rect.height, 1)) * 2 - 1)
  );
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, vp.camera);
  const hit = new THREE.Vector3();
  const plane3 =
    plane === 'front'
      ? new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)
      : plane === 'side'
        ? new THREE.Plane(new THREE.Vector3(1, 0, 0), 0)
        : new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  if (!ray.ray.intersectPlane(plane3, hit)) return null;
  return plane === 'front'
    ? { u: hit.x, v: hit.y }
    : plane === 'side'
      ? { u: hit.z, v: hit.y }
      : { u: hit.x, v: hit.z };
}

function svgPath(kind: VectorViewportKind, path: BezierPath) {
  if (!path.anchors.length) return '';
  const first = projectPoint(kind, path.plane, path.anchors[0].point);
  if (!first) return '';
  let d = `M ${first.x.toFixed(2)} ${first.y.toFixed(2)}`;
  const count = path.closed ? path.anchors.length : path.anchors.length - 1;
  for (let i = 0; i < count; i++) {
    const a = path.anchors[i];
    const b = path.anchors[(i + 1) % path.anchors.length];
    const h1 = projectPoint(kind, path.plane, a.handleOut);
    const h2 = projectPoint(kind, path.plane, b.handleIn);
    const end = projectPoint(kind, path.plane, b.point);
    if (h1 && h2 && end) {
      d += ` C ${h1.x.toFixed(2)} ${h1.y.toFixed(2)}, ${h2.x.toFixed(2)} ${h2.y.toFixed(2)}, ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
    }
  }
  if (path.closed) d += ' Z';
  return d;
}

function planeForViewport(kind: VectorViewportKind, activePlane: VectorPlane): VectorPlane {
  if (kind === 'perspective') return activePlane;
  return kind;
}

/** RMB/MMB hit an SVG handle — forward the gesture to the WebGL canvas so OrbitControls still pans/zooms. */
function retargetNavToCanvas(
  kind: VectorViewportKind,
  e: ReactPointerEvent,
  svg: SVGSVGElement | null
): boolean {
  if (e.button === 0) return false;
  const vp = getVectorViewport(kind);
  const canvas = vp?.container.querySelector('canvas') as HTMLElement | null;
  if (!canvas || !svg) return false;

  e.preventDefault();
  e.stopPropagation();

  svg.style.pointerEvents = 'none';
  const release = () => {
    svg.style.pointerEvents = '';
    window.removeEventListener('pointerup', release, true);
    window.removeEventListener('pointercancel', release, true);
  };
  window.addEventListener('pointerup', release, true);
  window.addEventListener('pointercancel', release, true);

  const init: PointerEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    pointerId: e.pointerId,
    pointerType: e.pointerType,
    isPrimary: e.isPrimary,
    clientX: e.clientX,
    clientY: e.clientY,
    screenX: e.screenX,
    screenY: e.screenY,
    button: e.button,
    buttons: e.buttons,
    ctrlKey: e.ctrlKey,
    shiftKey: e.shiftKey,
    altKey: e.altKey,
    metaKey: e.metaKey,
    view: window,
  };
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    /* ignore */
  }
  canvas.dispatchEvent(new PointerEvent('pointerdown', init));
  return true;
}

interface VectorOverlayProps {
  kind: VectorViewportKind;
  /** When false, overlay is hidden (workspace not in blockout). */
  active: boolean;
}

export function VectorOverlay({ kind, active }: VectorOverlayProps) {
  const paths = useVectorStore((s) => s.paths);
  const mode = useVectorStore((s) => s.mode);
  const pathStyle = useVectorStore((s) => s.pathStyle);
  const refTool = useVectorStore((s) => s.refTool);
  const selected = useVectorStore((s) => s.selected);
  const selectedIndices = useVectorStore((s) => s.selectedIndices);
  useVectorStore((s) => s.revision);
  const drag = useRef<DragTarget>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const pendingMoveRef = useRef<{
    target: Exclude<DragTarget, null>;
    clientX: number;
    clientY: number;
    altKey: boolean;
  } | null>(null);
  const moveRafRef = useRef(0);
  const kindRef = useRef(kind);
  kindRef.current = kind;
  const pathStyleRef = useRef(pathStyle);
  pathStyleRef.current = pathStyle;
  const [, setFrame] = useState(0);
  const [marqueeBox, setMarqueeBox] = useState<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  } | null>(null);
  const marqueeRef = useRef<{
    x1: number;
    y1: number;
    additive: boolean;
  } | null>(null);

  // Reproject SVG when camera / size changes. Throttled so orbit damping doesn't
  // flood React (3 overlays × 60fps was freezing navigation).
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let lastKey = '';
    let lastEmit = 0;
    let trailing: ReturnType<typeof setTimeout> | null = null;
    const scratchPos = new THREE.Vector3();

    const emit = () => {
      lastEmit = performance.now();
      setFrame((n) => (n + 1) % 1_000_000);
    };

    const loop = () => {
      const vp = getVectorViewport(kind);
      if (vp) {
        vp.camera.updateMatrixWorld();
        scratchPos.setFromMatrixPosition(vp.camera.matrixWorld);
        const e = vp.camera.matrixWorld.elements;
        const key = `${scratchPos.x.toFixed(3)},${scratchPos.y.toFixed(3)},${scratchPos.z.toFixed(3)},${e[0].toFixed(4)},${e[5].toFixed(4)},${e[10].toFixed(4)},${vp.container.clientWidth}x${vp.container.clientHeight}`;
        if (key !== lastKey) {
          lastKey = key;
          const now = performance.now();
          if (now - lastEmit >= 48) {
            if (trailing) {
              clearTimeout(trailing);
              trailing = null;
            }
            emit();
          } else if (!trailing) {
            trailing = setTimeout(() => {
              trailing = null;
              emit();
            }, 48 - (now - lastEmit));
          }
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      if (trailing) clearTimeout(trailing);
    };
  }, [active, kind]);

  const flushPendingMove = () => {
    moveRafRef.current = 0;
    const pending = pendingMoveRef.current;
    if (!pending) return;
    // Pointer released mid-frame — drop stale drag updates.
    if (!drag.current) {
      pendingMoveRef.current = null;
      return;
    }
    const { target, clientX, clientY, altKey } = pending;
    const point = pointOnPlane(kindRef.current, target.plane, clientX, clientY);
    if (!point) return;
    const store = useVectorStore.getState();
    if (target.type === 'anchor') store.moveAnchor(target.plane, target.index, point);
    else store.moveHandle(target.plane, target.index, target.type, point, !altKey);
  };

  const scheduleMove = (
    target: Exclude<DragTarget, null>,
    clientX: number,
    clientY: number,
    altKey: boolean
  ) => {
    pendingMoveRef.current = { target, clientX, clientY, altKey };
    if (moveRafRef.current) return;
    moveRafRef.current = requestAnimationFrame(flushPendingMove);
  };

  const endDrag = (pointerId?: number, el?: HTMLElement | null) => {
    if (moveRafRef.current) {
      cancelAnimationFrame(moveRafRef.current);
      flushPendingMove();
    }
    drag.current = null;
    pendingMoveRef.current = null;
    if (el && pointerId != null) {
      try {
        if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
      } catch {
        /* ignore */
      }
    }
  };

  // Pen drawing listens on the WebGL canvas so empty space still receives
  // RMB/MMB pan / wheel zoom from OrbitControls.
  // IMPORTANT: do NOT capture-phase stopPropagation or setPointerCapture — that
  // desyncs OrbitControls' internal pointer list and kills pan after 1–2 gestures
  // (especially Front/Side ortho).
  useEffect(() => {
    if (!active || mode !== 'pen' || refTool !== 'none') return;

    let cancelled = false;
    let tries = 0;
    let el: HTMLElement | null = null;
    let onDown: ((e: PointerEvent) => void) | null = null;
    let onMove: ((e: PointerEvent) => void) | null = null;
    let onUp: (() => void) | null = null;
    let onDblClick: ((e: MouseEvent) => void) | null = null;

    const bind = () => {
      if (cancelled) return;
      const vp = getVectorViewport(kind);
      if (!vp) {
        if (tries++ < 30) requestAnimationFrame(bind);
        return;
      }
      el = (vp.container.querySelector('canvas') as HTMLElement | null) ?? vp.container;

      onDown = (e: PointerEvent) => {
        if (e.button !== 0 || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
        if (e.getModifierState?.('Space')) return;

        const hit = document.elementFromPoint(e.clientX, e.clientY);
        if (hit?.closest?.('.vector-anchor.close-target, .vector-panel')) return;

        const drawingPlane = planeForViewport(kind, useVectorStore.getState().activePlane);
        const point = pointOnPlane(kind, drawingPlane, e.clientX, e.clientY);
        if (!point) return;

        // Don't stopPropagation / setPointerCapture — OrbitControls LEFT is disabled
        // (-1) so it can track the pointer without starting a camera gesture.
        const index = useVectorStore.getState().addAnchor(drawingPlane, point);
        if (index >= 0 && pathStyleRef.current === 'curve') {
          drag.current = { type: 'handleOut', plane: drawingPlane, index };
        }
      };

      onMove = (e: PointerEvent) => {
        const target = drag.current;
        if (!target) return;
        if ((e.buttons & 1) === 0) {
          endDrag();
          return;
        }
        scheduleMove(target, e.clientX, e.clientY, e.altKey);
      };

      onUp = () => {
        if (!drag.current) return;
        endDrag();
      };

      onDblClick = (e: MouseEvent) => {
        if (e.ctrlKey || e.metaKey) return;
        e.preventDefault();
        useVectorStore
          .getState()
          .closePath(planeForViewport(kind, useVectorStore.getState().activePlane));
      };

      el.addEventListener('pointerdown', onDown);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
      el.addEventListener('dblclick', onDblClick);
    };

    bind();

    return () => {
      cancelled = true;
      endDrag();
      if (el && onDown) el.removeEventListener('pointerdown', onDown);
      if (onMove) window.removeEventListener('pointermove', onMove);
      if (onUp) {
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      }
      if (el && onDblClick) el.removeEventListener('dblclick', onDblClick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bind per viewport/mode; helpers use refs
  }, [active, mode, kind, refTool]);

  // Marquee (box) select silhouette points — Ctrl/Cmd + LMB drag only.
  // Plain LMB stays free for 3D view interaction / orbit.
  useEffect(() => {
    if (!active || refTool !== 'none') return;

    let cancelled = false;
    let tries = 0;
    let el: HTMLElement | null = null;
    let onDown: ((e: PointerEvent) => void) | null = null;
    let onMove: ((e: PointerEvent) => void) | null = null;
    let onUp: ((e: PointerEvent) => void) | null = null;

    const finishMarquee = (clientX: number, clientY: number) => {
      const start = marqueeRef.current;
      marqueeRef.current = null;
      setMarqueeBox(null);
      if (!start) return;
      const end = clientToLocal(kind, clientX, clientY);
      if (!end) return;
      const minX = Math.min(start.x1, end.x);
      const maxX = Math.max(start.x1, end.x);
      const minY = Math.min(start.y1, end.y);
      const maxY = Math.max(start.y1, end.y);
      if (maxX - minX < 4 && maxY - minY < 4) {
        if (!start.additive) useVectorStore.getState().setSelected(null);
        return;
      }

      const store = useVectorStore.getState();
      const planes = planesForViewport(kind);
      let bestPlane: VectorPlane | null = null;
      let bestIndices: number[] = [];
      for (const plane of planes) {
        const path = store.paths[plane];
        const hits: number[] = [];
        path.anchors.forEach((anchor, index) => {
          const p = projectPoint(kind, plane, anchor.point);
          if (!p?.visible) return;
          if (p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY) {
            hits.push(index);
          }
        });
        if (hits.length > bestIndices.length) {
          bestPlane = plane;
          bestIndices = hits;
        } else if (
          hits.length === bestIndices.length &&
          hits.length > 0 &&
          plane === store.activePlane
        ) {
          bestPlane = plane;
          bestIndices = hits;
        }
      }
      if (!bestPlane) {
        if (!start.additive) store.setSelected(null);
        return;
      }
      store.selectPoints(bestPlane, bestIndices, { additive: start.additive });
    };

    const bind = () => {
      if (cancelled) return;
      const vp = getVectorViewport(kind);
      if (!vp) {
        if (tries++ < 30) requestAnimationFrame(bind);
        return;
      }
      el = vp.container;

      onDown = (e: PointerEvent) => {
        if (e.button !== 0) return;
        if (!(e.ctrlKey || e.metaKey)) return;
        if (e.altKey || e.getModifierState?.('Space')) return;
        if (drag.current) return;

        const hit = document.elementFromPoint(e.clientX, e.clientY);
        if (hit?.closest?.('.vector-panel')) return;

        const local = clientToLocal(kind, e.clientX, e.clientY);
        if (!local) return;
        e.preventDefault();
        e.stopPropagation();
        marqueeRef.current = {
          x1: local.x,
          y1: local.y,
          additive: e.shiftKey,
        };
        setMarqueeBox({ x1: local.x, y1: local.y, x2: local.x, y2: local.y });
      };

      onMove = (e: PointerEvent) => {
        if (!marqueeRef.current) return;
        const local = clientToLocal(kind, e.clientX, e.clientY);
        if (!local) return;
        setMarqueeBox({
          x1: marqueeRef.current.x1,
          y1: marqueeRef.current.y1,
          x2: local.x,
          y2: local.y,
        });
      };

      onUp = (e: PointerEvent) => {
        if (!marqueeRef.current) return;
        finishMarquee(e.clientX, e.clientY);
      };

      el.addEventListener('pointerdown', onDown, true);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    };

    bind();

    return () => {
      cancelled = true;
      marqueeRef.current = null;
      setMarqueeBox(null);
      if (el && onDown) el.removeEventListener('pointerdown', onDown, true);
      if (onMove) window.removeEventListener('pointermove', onMove);
      if (onUp) {
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      }
    };
  }, [active, kind, refTool]);

  const visiblePaths = useMemo(
    () =>
      kind === 'perspective'
        ? [paths.front, paths.side, paths.top]
        : [paths[kind]],
    [kind, paths]
  );

  const heightGuides = useMemo(() => {
    if (kind === 'perspective' || kind === 'top') return [] as number[];
    const other = kind === 'front' ? paths.side : paths.front;
    return silhouetteKeyHeights(other);
  }, [kind, paths]);

  if (!active) return null;

  const beginDrag = (
    e: ReactPointerEvent<SVGElement>,
    target: Exclude<DragTarget, null>
  ) => {
    if (retargetNavToCanvas(kind, e, svgRef.current)) return;
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const store = useVectorStore.getState();
    if (store.pointEditMode === 'free') {
      // Free Move: always one point, never keep a multi-select group.
      store.setSelected({ plane: target.plane, index: target.index });
    } else if (e.shiftKey) {
      store.togglePoint(target.plane, target.index);
    } else {
      const already =
        store.selected?.plane === target.plane &&
        store.selectedIndices.includes(target.index);
      if (!already) {
        store.setSelected({ plane: target.plane, index: target.index });
      } else {
        // Keep multi-select; promote primary for handles / insert-after.
        store.selectPoints(target.plane, store.selectedIndices, {
          primary: target.index,
        });
      }
    }
    store.checkpoint();
    drag.current = target;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onOverlayPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const target = drag.current;
    if (!target) return;
    if ((e.buttons & 1) === 0) {
      endDrag(e.pointerId, e.currentTarget);
      return;
    }
    // Canvas-driven pen drag is handled on the canvas listeners.
    if (mode === 'pen' && target.type === 'handleOut') return;
    scheduleMove(target, e.clientX, e.clientY, e.altKey);
  };

  const endOverlayDrag = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!drag.current) return;
    // Pen placement drag ends via canvas listener.
    if (mode === 'pen' && drag.current.type === 'handleOut') return;
    endDrag(e.pointerId, e.currentTarget);
  };

  return (
    <svg
      ref={svgRef}
      className={`vector-overlay vector-${mode} vector-style-${pathStyle}${refTool !== 'none' ? ' vector-ref-edit' : ''}`}
      style={refTool !== 'none' ? { pointerEvents: 'none' } : undefined}
      onPointerMove={onOverlayPointerMove}
      onPointerUp={endOverlayDrag}
      onPointerCancel={endOverlayDrag}
    >
      <rect className="vector-draw-surface" width="100%" height="100%" fill="transparent" />
      {heightGuides.map((v) => {
        const a = projectPoint(kind, kind, { u: -40, v });
        const b = projectPoint(kind, kind, { u: 40, v });
        if (!a || !b) return null;
        return (
          <line
            key={`guide-${v}`}
            className="vector-height-guide"
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
          />
        );
      })}
      {visiblePaths.map((path) => {
        const d = svgPath(kind, path);
        const isActive = selected?.plane === path.plane;
        const showHandles = mode === 'edit' && pathStyle === 'curve';
        const showIndices = mode === 'edit' || path.closed || path.anchors.length > 0;
        return (
          <g key={path.id} className={isActive ? 'active' : ''}>
            {d ? (
              <path
                className="vector-path-hit"
                d={d}
                onPointerDown={(e) => {
                  if (retargetNavToCanvas(kind, e, svgRef.current)) return;
                  if (e.button !== 0) return;
                  e.stopPropagation();
                  const store = useVectorStore.getState();
                  store.setActivePlane(path.plane);
                  if (path.closed) store.setMode('edit');
                  // Alt-click an edge to insert a polygon point (mirrors when Mirror is on).
                  if (e.altKey && (store.pathStyle === 'polygon' || pathStyle === 'polygon')) {
                    const pt = pointOnPlane(kind, path.plane, e.clientX, e.clientY);
                    if (pt) {
                      e.preventDefault();
                      store.insertAtPoint(path.plane, pt);
                    }
                  }
                }}
              />
            ) : null}
            {d ? <path className={`vector-path plane-${path.plane}`} d={d} /> : null}
            {path.anchors.map((anchor, index) => {
              const point = projectPoint(kind, path.plane, anchor.point);
              const handleIn = projectPoint(kind, path.plane, anchor.handleIn);
              const handleOut = projectPoint(kind, path.plane, anchor.handleOut);
              if (!point?.visible) return null;
              const pointSelected =
                selected?.plane === path.plane && selectedIndices.includes(index);
              const handlesVisible =
                showHandles && selected?.plane === path.plane && selected.index === index;
              const closeTarget =
                mode === 'pen' && !path.closed && index === 0 && path.anchors.length >= 3;
              return (
                <g key={index}>
                  {handlesVisible && handleIn && handleOut ? (
                    <>
                      <line x1={handleIn.x} y1={handleIn.y} x2={point.x} y2={point.y} className="vector-handle-line" />
                      <line x1={point.x} y1={point.y} x2={handleOut.x} y2={handleOut.y} className="vector-handle-line" />
                      <circle
                        cx={handleIn.x}
                        cy={handleIn.y}
                        r={4}
                        className="vector-handle"
                        onPointerDown={(e) => beginDrag(e, { type: 'handleIn', plane: path.plane, index })}
                      />
                      <circle
                        cx={handleOut.x}
                        cy={handleOut.y}
                        r={4}
                        className="vector-handle"
                        onPointerDown={(e) => beginDrag(e, { type: 'handleOut', plane: path.plane, index })}
                      />
                    </>
                  ) : null}
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r={closeTarget ? 7 : pathStyle === 'polygon' ? 5.5 : 4.5}
                    className={`vector-anchor${pointSelected ? ' selected' : ''}${closeTarget ? ' close-target' : ''}`}
                    onPointerDown={(e) => {
                      if (retargetNavToCanvas(kind, e, svgRef.current)) return;
                      if (e.button !== 0) return;
                      if (closeTarget) {
                        e.preventDefault();
                        e.stopPropagation();
                        useVectorStore.getState().closePath(path.plane);
                        return;
                      }
                      if (mode !== 'edit' && path.closed) {
                        useVectorStore.getState().setMode('edit');
                      }
                      beginDrag(e, { type: 'anchor', plane: path.plane, index });
                    }}
                  />
                  {showIndices ? (
                    <text x={point.x + 10} y={point.y - 8} className="vector-point-index">
                      {index + 1}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </g>
        );
      })}
      {marqueeBox ? (
        <rect
          className="vector-marquee"
          x={Math.min(marqueeBox.x1, marqueeBox.x2)}
          y={Math.min(marqueeBox.y1, marqueeBox.y2)}
          width={Math.abs(marqueeBox.x2 - marqueeBox.x1)}
          height={Math.abs(marqueeBox.y2 - marqueeBox.y1)}
        />
      ) : null}
    </svg>
  );
}
