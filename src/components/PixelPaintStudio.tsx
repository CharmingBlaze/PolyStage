import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pencil,
  Eraser,
  PaintBucket,
  Pipette,
  Grid3x3,
  Slash,
  Square,
  Circle,
  ZoomIn,
  ZoomOut,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Copy,
  Play,
  Pause,
  SkipBack,
  Undo2,
  Redo2,
  Download,
  Layers,
  Move,
  SprayCan,
  Box,
  MousePointer2,
  Wand2,
  Hand,
  FlipHorizontal,
  FlipVertical,
  RotateCw,
  RotateCcw,
  Contrast,
  ChevronDown,
  ImagePlus,
  Film,
  Edit2,
  PlayCircle,
  X,
  Star,
  Sliders,
  Sparkles,
  Crop,
  ArrowUp,
  ArrowDown,
  Lock,
  Unlock,
  Combine,
  Sun,
  Wand,
} from 'lucide-react';
import type { CADMesh, MeshTextureAnimation, ToolState } from '../types/cad';
import {
  applyPhotoAdjustments,
  cleanPixelPerfectPath,
  DEFAULT_ADJUSTMENTS,
  drawDitheredGradient,
  blendPixel,
  type ImageAdjustmentSettings,
  type LayerBlendMode,
} from '../utils/pixelPhotoFilters';
import {
  drawBresenham,
  drawEllipseOutline,
  floodFill,
  hexToRgba,
  rgbaToHex,
} from '../utils/pixelPaint';
import {
  getPaintPalette,
  PAINT_PALETTES,
  type PaintPaletteId,
} from '../utils/paintPalettes';
import {
  createPresetTextureClips,
  exportTextureSpritesheetAsync,
  magicWandSelect,
} from '../utils/textureAnimation';

export type PaintTool =
  | 'pencil'
  | 'eraser'
  | 'fill'
  | 'picker'
  | 'dither'
  | 'line'
  | 'rect'
  | 'ellipse'
  | 'spray'
  | 'hand'
  | 'select'
  | 'wand'
  | 'move'
  | 'shade'
  | 'lighten'
  | 'noise'
  | 'gradient'
  | 'dodge'
  | 'burn';

export type LayerMeta = {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  blendMode?: LayerBlendMode;
  lockedAlpha?: boolean;
};

type FrameMeta = {
  id: string;
  name: string;
  durationMs: number;
  layers: LayerMeta[];
  tags?: string[];
};

type TexClipMeta = {
  id: string;
  name: string;
  frameIds: string[];
  loop: boolean;
};

type PixelSelection = {
  x: number;
  y: number;
  w: number;
  h: number;
  /** wand: set of pixel indices; marquee uses rect */
  mask?: Set<number>;
} | null;

const ZOOM_MIN = 1;
const ZOOM_MAX = 256;
export const PIXEL_CANVAS_SIZES = [16, 32, 64, 128, 256, 512, 1024] as const;
export type PixelCanvasSize = (typeof PIXEL_CANVAS_SIZES)[number];

function nearestCanvasSize(w: number, h: number): PixelCanvasSize {
  const dim = Math.max(w, h);
  let best: PixelCanvasSize = PIXEL_CANVAS_SIZES[0];
  for (const s of PIXEL_CANVAS_SIZES) {
    best = s;
    if (s >= dim) break;
  }
  return best;
}

type ImportPrompt = {
  dataUrl: string;
  naturalW: number;
  naturalH: number;
};

export type Paint3DBridge = {
  paintUv: (
    uvU: number,
    uvV: number,
    color: string,
    brushSize: number,
    paintTool: PaintTool,
    opacity: number,
    spacing: number,
    mirrorU: boolean,
    faceId?: string | null,
  ) => void;
  endStroke: () => void;
};

interface PixelPaintStudioProps {
  toolState: ToolState;
  setToolState: React.Dispatch<React.SetStateAction<ToolState>>;
  onTextureUpdated: (canvas: HTMLCanvasElement) => void;
  textureCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  initialDataUrl?: string | null;
  paintBridgeRef?: React.MutableRefObject<Paint3DBridge | null>;
  mesh?: CADMesh | null;
  selectedFaceIds?: string[];
  /** Persist multi-frame strip + clips onto the mesh. */
  onTextureAnimationChange?: (anim: MeshTextureAnimation) => void;
}

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

function createLayerCanvas(w: number, h: number, fillTransparent = true): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  if (!fillTransparent) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
  } else {
    ctx.clearRect(0, 0, w, h);
  }
  return c;
}

export const PixelPaintStudio: React.FC<PixelPaintStudioProps> = ({
  toolState,
  setToolState,
  onTextureUpdated,
  textureCanvasRef,
  initialDataUrl,
  paintBridgeRef,
  mesh = null,
  selectedFaceIds = [],
  onTextureAnimationChange,
}) => {
  const [canvasSize, setCanvasSize] = useState(32);
  const [tool, setTool] = useState<PaintTool>('pencil');
  const [brushSize, setBrushSize] = useState(1);
  const [zoom, setZoom] = useState(12);
  const [showGrid, setShowGrid] = useState(true);
  const [showUvOverlay, setShowUvOverlay] = useState(() => {
    try {
      const saved = localStorage.getItem('cad.paintShowUvOverlay');
      if (saved === null) return true;
      return saved === '1' || saved === 'true';
    } catch {
      return true;
    }
  });
  const [onionSkin, setOnionSkin] = useState(true);
  const [pixelPerfect, setPixelPerfect] = useState(true);
  const [adjustmentsModalOpen, setAdjustmentsModalOpen] = useState(false);
  const [adjustments, setAdjustments] = useState<ImageAdjustmentSettings>(DEFAULT_ADJUSTMENTS);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPlaying, setIsPlaying] = useState(false);
  const [shapeFilled, setShapeFilled] = useState(false);
  const [selection, setSelection] = useState<PixelSelection>(null);
  const [texClips, setTexClips] = useState<TexClipMeta[]>([]);
  const [defaultClipId, setDefaultClipId] = useState<string | null>(null);
  const [clipModalOpen, setClipModalOpen] = useState(false);
  const [editingClip, setEditingClip] = useState<TexClipMeta | null>(null);
  const [previewClipId, setPreviewClipId] = useState<string | null>(null);
  const [clipboardFrame, setClipboardFrame] = useState<FrameMeta | null>(null);
  const [sizeMenuOpen, setSizeMenuOpen] = useState(false);
  const [importPrompt, setImportPrompt] = useState<ImportPrompt | null>(null);
  const [importSize, setImportSize] = useState<PixelCanvasSize>(32);
  const [importSizeMenuOpen, setImportSizeMenuOpen] = useState(false);
  const [paletteId, setPaletteId] = useState<PaintPaletteId>(() => {
    try {
      const saved = localStorage.getItem('cad.paintPaletteId') as PaintPaletteId | null;
      if (saved && PAINT_PALETTES.some((p) => p.id === saved)) return saved;
    } catch {
      /* ignore */
    }
    return 'aseprite';
  });
  const [paletteMenuOpen, setPaletteMenuOpen] = useState(false);
  const sizeMenuRef = useRef<HTMLDivElement | null>(null);
  const paletteMenuRef = useRef<HTMLDivElement | null>(null);
  const selectionDragRef = useRef<{
    mode: 'marquee' | 'move';
    startX: number;
    startY: number;
    origin?: PixelSelection;
    snapshot?: ImageData;
  } | null>(null);
  const persistTimerRef = useRef<number | null>(null);
  const hydratedMeshIdRef = useRef<string | null>(null);
  const readyToPersistRef = useRef(false);

  const [frames, setFrames] = useState<FrameMeta[]>(() => {
    const layerId = uid('layer');
    return [
      {
        id: uid('frame'),
        name: 'Frame 1',
        durationMs: 100,
        layers: [{ id: layerId, name: 'Layer 1', visible: true, opacity: 1 }],
      },
    ];
  });
  const [frameIndex, setFrameIndex] = useState(0);
  const [activeLayerId, setActiveLayerId] = useState(frames[0].layers[0].id);

  const layerCanvasMap = useRef(new Map<string, HTMLCanvasElement>());
  const onTextureUpdatedRef = useRef(onTextureUpdated);
  const displayRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const compositeRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const shapeStartRef = useRef<{ x: number; y: number } | null>(null);
  const snapshotBeforeStrokeRef = useRef<ImageData | null>(null);
  const panDragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);
  const paint3DStrokeRef = useRef<{ u: number; v: number; px: number; py: number; faceId: string | null } | null>(null);
  const [, bumpUndoUi] = useState(0);

  useEffect(() => {
    onTextureUpdatedRef.current = onTextureUpdated;
  }, [onTextureUpdated]);

  const frame = frames[frameIndex] || frames[0];
  const layers = frame?.layers || [];

  const ensureLayerCanvas = useCallback(
    (layerId: string, fillBg = false) => {
      let c = layerCanvasMap.current.get(layerId);
      if (!c || c.width !== canvasSize || c.height !== canvasSize) {
        const next = createLayerCanvas(canvasSize, canvasSize, !fillBg);
        if (c) {
          const ctx = next.getContext('2d')!;
          ctx.drawImage(c, 0, 0);
        } else if (fillBg) {
          const ctx = next.getContext('2d')!;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvasSize, canvasSize);
          // starter checker accent like old editor
          ctx.fillStyle = toolState.activeColor || '#ed7300';
          for (let y = 0; y < canvasSize; y++) {
            for (let x = 0; x < canvasSize; x++) {
              if ((x + y) % 2 === 0) ctx.fillRect(x, y, 1, 1);
            }
          }
        }
        layerCanvasMap.current.set(layerId, next);
        c = next;
      }
      return c;
    },
    [canvasSize, toolState.activeColor]
  );

  const getComposite = useCallback(() => {
    if (!compositeRef.current) {
      compositeRef.current = createLayerCanvas(canvasSize, canvasSize, true);
    }
    const out = compositeRef.current;
    if (out.width !== canvasSize || out.height !== canvasSize) {
      out.width = canvasSize;
      out.height = canvasSize;
    }
    const ctx = out.getContext('2d')!;
    ctx.clearRect(0, 0, canvasSize, canvasSize);
    // checkerboard underlay for transparency preview only on display, not export
    layers.forEach((layer) => {
      if (!layer.visible) return;
      const lc = ensureLayerCanvas(layer.id);
      ctx.globalAlpha = layer.opacity;
      const mode = layer.blendMode || 'normal';
      ctx.globalCompositeOperation = mode === 'normal' ? 'source-over' : (mode as GlobalCompositeOperation);
      ctx.drawImage(lc, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    });
    return out;
  }, [canvasSize, layers, ensureLayerCanvas]);

  const pushHistory = useCallback(() => {
    const layer = layers.find((l) => l.id === activeLayerId);
    if (!layer) return;
    const c = ensureLayerCanvas(layer.id);
    undoStack.current.push(c.toDataURL());
    if (undoStack.current.length > 40) undoStack.current.shift();
    redoStack.current = [];
    bumpUndoUi((n) => n + 1);
  }, [activeLayerId, layers, ensureLayerCanvas]);

  const restoreLayerFromDataUrl = (dataUrl: string) => {
    const layer = layers.find((l) => l.id === activeLayerId);
    if (!layer) return;
    const c = ensureLayerCanvas(layer.id);
    const img = new Image();
    img.onload = () => {
      const ctx = c.getContext('2d')!;
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0);
      paint();
    };
    img.src = dataUrl;
  };

  const undo = () => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    const layer = layers.find((l) => l.id === activeLayerId);
    if (!layer) return;
    const c = ensureLayerCanvas(layer.id);
    redoStack.current.push(c.toDataURL());
    restoreLayerFromDataUrl(prev);
    bumpUndoUi((n) => n + 1);
  };

  const redo = () => {
    const next = redoStack.current.pop();
    if (!next) return;
    const layer = layers.find((l) => l.id === activeLayerId);
    if (!layer) return;
    const c = ensureLayerCanvas(layer.id);
    undoStack.current.push(c.toDataURL());
    restoreLayerFromDataUrl(next);
    bumpUndoUi((n) => n + 1);
  };

  const paint = useCallback(() => {
    const composite = getComposite();
    textureCanvasRef.current = composite;
    onTextureUpdatedRef.current(composite);

    const display = displayRef.current;
    if (!display) return;
    if (display.width !== canvasSize || display.height !== canvasSize) {
      display.width = canvasSize;
      display.height = canvasSize;
    }
    const dctx = display.getContext('2d')!;
    dctx.imageSmoothingEnabled = false;
    // checkerboard
    const tile = 1;
    for (let y = 0; y < canvasSize; y += tile) {
      for (let x = 0; x < canvasSize; x += tile) {
        dctx.fillStyle = (x + y) % 2 === 0 ? '#2a2a2a' : '#1a1a1a';
        dctx.fillRect(x, y, tile, tile);
      }
    }

    if (onionSkin && frameIndex > 0) {
      const prev = frames[frameIndex - 1];
      dctx.globalAlpha = 0.28;
      prev.layers.forEach((layer) => {
        if (!layer.visible) return;
        dctx.drawImage(ensureLayerCanvas(layer.id), 0, 0);
      });
      dctx.globalAlpha = 1;
    }

    dctx.drawImage(composite, 0, 0);
  }, [
    getComposite,
    textureCanvasRef,
    canvasSize,
    onionSkin,
    frameIndex,
    frames,
    ensureLayerCanvas,
  ]);

  // Init first layer / load mesh texture or textureAnimation strip
  useEffect(() => {
    const meshId = mesh?.id || null;
    if (hydratedMeshIdRef.current === meshId && meshId) return;
    hydratedMeshIdRef.current = meshId;
    readyToPersistRef.current = false;
    setImportPrompt(null);

    const anim = mesh?.textureAnimation;
    if (anim?.frames?.length) {
      setCanvasSize(anim.width || 32);
      const nextFrames: FrameMeta[] = [];
      const map = new Map<string, HTMLCanvasElement>();
      let loaded = 0;
      anim.frames.forEach((f) => {
        const layerId = uid('layer');
        const c = createLayerCanvas(anim.width, anim.height, true);
        map.set(layerId, c);
        const img = new Image();
        img.onload = () => {
          c.getContext('2d')!.drawImage(img, 0, 0, anim.width, anim.height);
          loaded += 1;
          if (loaded === anim.frames.length) {
            paint();
            readyToPersistRef.current = true;
          }
        };
        img.src = f.dataUrl;
        nextFrames.push({
          id: f.id,
          name: f.name,
          durationMs: f.durationMs,
          tags: f.tags || [],
          layers: [{ id: layerId, name: 'Layer 1', visible: true, opacity: 1 }],
        });
      });
      layerCanvasMap.current = map;
      setFrames(nextFrames);
      setFrameIndex(0);
      setActiveLayerId(nextFrames[0].layers[0].id);
      setTexClips(anim.clips || []);
      setDefaultClipId(anim.defaultClipId || null);
      return;
    }

    const uvUrl = initialDataUrl || mesh?.textureCanvasDataUrl;
    if (uvUrl) {
      const img = new Image();
      img.onload = () => {
        const nw = img.naturalWidth || img.width;
        const nh = img.naturalHeight || img.height;
        const snapped = nearestCanvasSize(nw, nh);
        setCanvasSize(snapped);
        const layerId = frames[0]?.layers[0]?.id || uid('layer');
        const c = createLayerCanvas(snapped, snapped, true);
        const ctx = c.getContext('2d')!;
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, snapped, snapped);
        ctx.drawImage(img, 0, 0, snapped, snapped);
        layerCanvasMap.current.set(layerId, c);
        readyToPersistRef.current = true;
        paint();
      };
      img.src = uvUrl;
    } else {
      const first = frames[0]?.layers[0];
      if (first) ensureLayerCanvas(first.id, true);
      paint();
      readyToPersistRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesh?.id, mesh?.textureAnimation?.frames?.length, initialDataUrl]);

  useEffect(() => {
    if (!sizeMenuOpen && !importSizeMenuOpen && !paletteMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (sizeMenuRef.current && !sizeMenuRef.current.contains(t)) setSizeMenuOpen(false);
      if (paletteMenuRef.current && !paletteMenuRef.current.contains(t)) setPaletteMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [sizeMenuOpen, importSizeMenuOpen, paletteMenuOpen]);

  const activePalette = useMemo(() => getPaintPalette(paletteId), [paletteId]);
  const paletteGroups = useMemo(() => {
    const map = new Map<string, typeof PAINT_PALETTES>();
    PAINT_PALETTES.forEach((p) => {
      const list = map.get(p.group) || [];
      list.push(p);
      map.set(p.group, list);
    });
    return [...map.entries()];
  }, []);

  const applyImportedImage = (mode: 'keep' | 'resize', size?: number) => {
    if (!importPrompt) return;
    const dataUrl = importPrompt.dataUrl;
    const { naturalW, naturalH } = importPrompt;

    let snapped: PixelCanvasSize;
    if (mode === 'resize') {
      snapped = size || importSize;
    } else if (
      naturalW === naturalH &&
      (PIXEL_CANVAS_SIZES as readonly number[]).includes(naturalW)
    ) {
      snapped = naturalW as PixelCanvasSize;
    } else {
      snapped = nearestCanvasSize(naturalW, naturalH);
    }

    setCanvasSize(snapped);
    const layerId = frames[0]?.layers[0]?.id || uid('layer');
    const c = createLayerCanvas(snapped, snapped, true);
    layerCanvasMap.current.set(layerId, c);
    const img = new Image();
    img.onload = () => {
      const ctx = c.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, snapped, snapped);
      if (mode === 'resize') {
        ctx.drawImage(img, 0, 0, snapped, snapped);
      } else if (naturalW <= snapped && naturalH <= snapped) {
        const ox = Math.floor((snapped - naturalW) / 2);
        const oy = Math.floor((snapped - naturalH) / 2);
        ctx.drawImage(img, ox, oy);
      } else {
        // Larger than max allowed canvas — fit without smoothing.
        ctx.drawImage(img, 0, 0, snapped, snapped);
      }
      setFrames([
        {
          id: uid('frame'),
          name: 'Frame 1',
          durationMs: 100,
          tags: ['idle'],
          layers: [{ id: layerId, name: 'Layer 1', visible: true, opacity: 1 }],
        },
      ]);
      setActiveLayerId(layerId);
      setFrameIndex(0);
      setImportPrompt(null);
      readyToPersistRef.current = true;
      requestAnimationFrame(() => {
        paint();
        schedulePersist();
      });
    };
    img.src = dataUrl;
  };

  const buildTextureAnimation = useCallback((): MeshTextureAnimation => {
    const outFrames = frames.map((f) => {
      const c = createLayerCanvas(canvasSize, canvasSize, true);
      const ctx = c.getContext('2d')!;
      f.layers.forEach((layer) => {
        if (!layer.visible) return;
        const lc = layerCanvasMap.current.get(layer.id) || ensureLayerCanvas(layer.id);
        ctx.globalAlpha = layer.opacity;
        ctx.drawImage(lc, 0, 0);
        ctx.globalAlpha = 1;
      });
      return {
        id: f.id,
        name: f.name,
        durationMs: f.durationMs,
        dataUrl: c.toDataURL('image/png'),
        tags: f.tags || [],
      };
    });
    let clips = texClips.length ? texClips : createPresetTextureClips(outFrames);
    if (!clips.length && outFrames.length) {
      clips = [
        {
          id: uid('texclip'),
          name: 'Idle',
          frameIds: outFrames.map((f) => f.id),
          loop: true,
        },
      ];
    }
    return {
      width: canvasSize,
      height: canvasSize,
      frames: outFrames,
      clips,
      defaultClipId: defaultClipId || clips[0]?.id || null,
    };
  }, [frames, canvasSize, texClips, defaultClipId, ensureLayerCanvas]);

  const schedulePersist = useCallback(() => {
    if (!onTextureAnimationChange || !readyToPersistRef.current) return;
    if (persistTimerRef.current) window.clearTimeout(persistTimerRef.current);
    persistTimerRef.current = window.setTimeout(() => {
      onTextureAnimationChange(buildTextureAnimation());
    }, 250);
  }, [onTextureAnimationChange, buildTextureAnimation]);

  useEffect(() => {
    schedulePersist();
  }, [frames, texClips, defaultClipId, canvasSize, schedulePersist]);

  useEffect(() => {
    paint();
  }, [frameIndex, layers, canvasSize, onionSkin, paint]);

  // Animation playback (supports previewing a specific clip)
  useEffect(() => {
    if (!isPlaying) return;
    const targetClip = previewClipId ? texClips.find((c) => c.id === previewClipId) : null;
    const seqFrameIds = targetClip?.frameIds?.length
      ? targetClip.frameIds
      : frames.map((f) => f.id);

    const timer = window.setInterval(() => {
      setFrameIndex((currentIdx) => {
        const curFrameId = frames[currentIdx]?.id;
        const seqIdx = seqFrameIds.indexOf(curFrameId);
        const nextSeqIdx = (seqIdx + 1) % seqFrameIds.length;
        const nextFrameId = seqFrameIds[nextSeqIdx];
        const found = frames.findIndex((f) => f.id === nextFrameId);
        return found >= 0 ? found : (currentIdx + 1) % frames.length;
      });
    }, frames[frameIndex]?.durationMs || 100);

    return () => clearInterval(timer);
  }, [isPlaying, frames, frameIndex, previewClipId, texClips]);

  // Hotkeys
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const k = e.key.toLowerCase();
      const select = (next: PaintTool) => {
        setTool(next);
        if (next === 'hand') return;
        const drawTool = next === 'rect' ? 'rectangle' : next;
        setToolState((s) => ({ ...s, drawTool: drawTool as ToolState['drawTool'], brushSize }));
      };
      if (e.ctrlKey && k === 'z') {
        e.preventDefault();
        undo();
      } else if (e.ctrlKey && k === 'y') {
        e.preventDefault();
        redo();
      } else if (k === 'b') select('pencil');
      else if (k === 'e') select('eraser');
      else if (k === 'g') {
        e.preventDefault();
        select('fill');
      } else if (k === 'i') select('picker');
      else if (k === 'u') select('rect');
      else if (k === 'l') select('line');
      else if (k === 'c' && !e.ctrlKey && !e.metaKey) select('ellipse');
      else if (k === 'h') select('hand');
      else if (k === 'm') select('move');
      else if (k === 'w') select('wand');
      else if (k === 'v' && !e.ctrlKey && !e.metaKey) select('select');
      else if ((e.ctrlKey || e.metaKey) && k === 'c') {
        e.preventDefault();
        setClipboardFrame(frames[frameIndex] || null);
      } else if ((e.ctrlKey || e.metaKey) && k === 'v' && clipboardFrame) {
        e.preventDefault();
        const src = clipboardFrame;
        const newLayers = src.layers.map((layer) => {
          const nid = uid('layer');
          const srcC = layerCanvasMap.current.get(layer.id);
          const dst = createLayerCanvas(canvasSize, canvasSize);
          if (srcC) dst.getContext('2d')!.drawImage(srcC, 0, 0);
          layerCanvasMap.current.set(nid, dst);
          return { ...layer, id: nid };
        });
        const f: FrameMeta = {
          id: uid('frame'),
          name: `${src.name} paste`,
          durationMs: src.durationMs,
          tags: [...(src.tags || [])],
          layers: newLayers,
        };
        setFrames((prev) => {
          const next = [...prev];
          next.splice(frameIndex + 1, 0, f);
          return next;
        });
        setFrameIndex((i) => i + 1);
        setActiveLayerId(newLayers[0].id);
      } else if (k === ' ') {
        e.preventDefault();
        select('hand');
      } else if (k === '[') {
        setBrushSize((s) => {
          const next = Math.max(1, s - 1);
          setToolState((st) => ({ ...st, brushSize: next }));
          return next;
        });
      } else if (k === ']') {
        setBrushSize((s) => {
          const next = Math.min(16, s + 1);
          setToolState((st) => ({ ...st, brushSize: next }));
          return next;
        });
      }      else if (k === '=' || k === '+') setZoom((z) => Math.min(ZOOM_MAX, z + (e.ctrlKey ? 1 : 4)));
      else if (k === '-') setZoom((z) => Math.max(ZOOM_MIN, z - (e.ctrlKey ? 1 : 4)));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, brushSize, setToolState]);

  const activeLayerCanvas = () => {
    const layer = layers.find((l) => l.id === activeLayerId) || layers[0];
    if (!layer) return null;
    return ensureLayerCanvas(layer.id);
  };

  const toPixel = (e: React.PointerEvent): { x: number; y: number } | null => {
    const display = displayRef.current;
    if (!display) return null;
    const rect = display.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * canvasSize);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * canvasSize);
    return {
      x: Math.max(0, Math.min(canvasSize - 1, x)),
      y: Math.max(0, Math.min(canvasSize - 1, y)),
    };
  };

  const plotBrush = (
    ctx: CanvasRenderingContext2D,
    px: number,
    py: number,
    erase: boolean,
    dither = false
  ) => {
    const color = toolState.activeColor || '#ed7300';
    for (let by = 0; by < brushSize; by++) {
      for (let bx = 0; bx < brushSize; bx++) {
        const x = px + bx;
        const y = py + by;
        if (x < 0 || y < 0 || x >= canvasSize || y >= canvasSize) continue;
        if (erase) {
          ctx.clearRect(x, y, 1, 1);
        } else if (dither) {
          if ((x + y) % 2 === 0) {
            ctx.fillStyle = color;
            ctx.fillRect(x, y, 1, 1);
          }
        } else {
          ctx.fillStyle = color;
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
  };

  useEffect(() => {
    if (!paintBridgeRef) return;
    paintBridgeRef.current = {
      paintUv: (uvU, uvV, color, size, paintTool, opacity, spacing, mirrorU, faceId = null) => {
        const canvas = activeLayerCanvas();
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.imageSmoothingEnabled = false;

        const x = Math.max(0, Math.min(canvasSize - 1, Math.floor(uvU * canvasSize)));
        // Match Viewport textures (flipY=false): UV.v → canvas Y.
        const y = Math.max(0, Math.min(canvasSize - 1, Math.floor(uvV * canvasSize)));
        if (paintTool === 'picker') {
          const sample = getComposite().getContext('2d')!.getImageData(x, y, 1, 1).data;
          if (sample[3]) setToolState((state) => ({ ...state, activeColor: rgbaToHex(sample[0], sample[1], sample[2]), drawTool: 'pencil' }));
          return;
        }

        if (!paint3DStrokeRef.current) pushHistory();
        if (paintTool === 'fill') {
          // One flood per stroke — pointer-move must not re-run fill.
          if (paint3DStrokeRef.current) return;
          const image = ctx.getImageData(0, 0, canvasSize, canvasSize);
          floodFill(image, x, y, hexToRgba(color, Math.round(opacity * 255)));
          ctx.putImageData(image, 0, 0);
          paint3DStrokeRef.current = { u: uvU, v: uvV, px: x, py: y, faceId: faceId ?? null };
          paint();
          return;
        } else {
          const stamp = (px: number, py: number) => {
            const stampAt = (cx: number) => {
              const half = Math.floor(size / 2);
              ctx.save();
              ctx.globalAlpha = opacity;
              if (paintTool === 'eraser') ctx.globalCompositeOperation = 'destination-out';
              ctx.fillStyle = paintTool === 'eraser' ? '#000000' : color;
              if (paintTool === 'spray') {
                const radius = Math.max(2, size * 1.8);
                for (let i = 0; i < Math.max(8, size * 5); i++) {
                  const angle = Math.random() * Math.PI * 2;
                  const distance = Math.sqrt(Math.random()) * radius;
                  ctx.fillRect(Math.round(cx + Math.cos(angle) * distance), Math.round(py + Math.sin(angle) * distance), 1, 1);
                }
              } else {
                for (let by = 0; by < size; by++) for (let bx = 0; bx < size; bx++) {
                  const sx = cx - half + bx;
                  const sy = py - half + by;
                  if (sx < 0 || sy < 0 || sx >= canvasSize || sy >= canvasSize) continue;
                  if (paintTool !== 'dither' || (sx + sy) % 2 === 0) ctx.fillRect(sx, sy, 1, 1);
                }
              }
              ctx.restore();
            };
            stampAt(px);
            if (mirrorU) stampAt(canvasSize - 1 - px);
          };

          const previous = paint3DStrokeRef.current;
          // Screen-space sampling already walks the 3D surface — never UV-lerp across
          // packed islands (that painted empty atlas and looked like sloppy dots).
          const sameIsland =
            !!previous &&
            ((faceId && previous.faceId && faceId === previous.faceId) ||
              (!faceId &&
                !previous.faceId &&
                Math.abs(uvU - previous.u) <= 0.22 &&
                Math.abs(uvV - previous.v) <= 0.22));

          if (!previous || !sameIsland) {
            stamp(x, y);
          } else if (previous.px === x && previous.py === y) {
            // Same texel as last sample — skip overdraw.
          } else {
            const stepPx = size <= 1 ? 1 : Math.max(1, Math.round(size * Math.max(0.05, spacing)));
            let traveled = 0;
            let lastStampAt = -stepPx;
            drawBresenham(ctx, previous.px, previous.py, x, y, 1, (px, py) => {
              if (traveled - lastStampAt >= stepPx) {
                stamp(px, py);
                lastStampAt = traveled;
              }
              traveled += 1;
            });
            if (lastStampAt !== traveled - 1) stamp(x, y);
          }
          paint3DStrokeRef.current = { u: uvU, v: uvV, px: x, py: y, faceId: faceId ?? null };
        }
        // live composite without full undo push — keep textureCanvasRef on the same canvas the 3D view samples
        const composite = getComposite();
        textureCanvasRef.current = composite;
        const display = displayRef.current;
        if (display) {
          const dctx = display.getContext('2d');
          if (dctx) {
            dctx.imageSmoothingEnabled = false;
            dctx.clearRect(0, 0, canvasSize, canvasSize);
            dctx.drawImage(composite, 0, 0);
          }
        }
      },
      endStroke: () => {
        paint3DStrokeRef.current = null;
        paint();
      },
    };
    return () => {
      paintBridgeRef.current = null;
    };
  }, [paintBridgeRef, activeLayerId, canvasSize, layers, getComposite, paint, textureCanvasRef, pushHistory, setToolState, ensureLayerCanvas]);

  const applyToolAt = (px: number, py: number) => {
    const canvas = activeLayerCanvas();
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;

    if (tool === 'picker') {
      const d = ctx.getImageData(px, py, 1, 1).data;
      if (d[3] > 0) setToolState((s) => ({ ...s, activeColor: rgbaToHex(d[0], d[1], d[2]) }));
      setTool('pencil');
      return;
    }
    if (tool === 'fill') {
      const img = ctx.getImageData(0, 0, canvasSize, canvasSize);
      floodFill(img, px, py, hexToRgba(toolState.activeColor || '#ed7300'));
      ctx.putImageData(img, 0, 0);
      paint();
      return;
    }
    if (tool === 'spray') {
      for (let i = 0; i < 8 * brushSize; i++) {
        const ox = Math.floor((Math.random() - 0.5) * brushSize * 3);
        const oy = Math.floor((Math.random() - 0.5) * brushSize * 3);
        plotBrush(ctx, px + ox, py + oy, false);
      }
      paint();
      return;
    }
    if (tool === 'shade' || tool === 'lighten' || tool === 'noise') {
      const img = ctx.getImageData(0, 0, canvasSize, canvasSize);
      const d = img.data;
      for (let by = 0; by < brushSize; by++) {
        for (let bx = 0; bx < brushSize; bx++) {
          const x = px + bx;
          const y = py + by;
          if (x < 0 || y < 0 || x >= canvasSize || y >= canvasSize) continue;
          const i = (y * canvasSize + x) * 4;
          if (tool === 'noise') {
            const n = Math.floor(Math.random() * 256);
            d[i] = n;
            d[i + 1] = n;
            d[i + 2] = n;
            d[i + 3] = 255;
          } else if (d[i + 3] > 0) {
            const f = tool === 'shade' ? 0.85 : 1.15;
            d[i] = Math.max(0, Math.min(255, Math.round(d[i] * f)));
            d[i + 1] = Math.max(0, Math.min(255, Math.round(d[i + 1] * f)));
            d[i + 2] = Math.max(0, Math.min(255, Math.round(d[i + 2] * f)));
          }
        }
      }
      ctx.putImageData(img, 0, 0);
      paint();
      return;
    }
    if (tool === 'eraser') {
      plotBrush(ctx, px, py, true);
      paint();
      return;
    }
    if (tool === 'dither') {
      plotBrush(ctx, px, py, false, true);
      paint();
      return;
    }
    // pencil default
    plotBrush(ctx, px, py, false);
    paint();
  };

  const onPointerDown = (e: React.PointerEvent) => {
    // RMB / MMB pan · wheel zooms — LMB stays for paint tools
    if (tool === 'hand' || e.button === 1 || e.button === 2) {
      e.preventDefault();
      panDragRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    const coords = toPixel(e);
    if (!coords) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    if (tool === 'select') {
      selectionDragRef.current = { mode: 'marquee', startX: coords.x, startY: coords.y };
      setSelection({ x: coords.x, y: coords.y, w: 0, h: 0 });
      drawingRef.current = true;
      return;
    }
    if (tool === 'wand') {
      const canvas = activeLayerCanvas();
      if (!canvas) return;
      const img = canvas.getContext('2d')!.getImageData(0, 0, canvasSize, canvasSize);
      const mask = magicWandSelect(img, coords.x, coords.y, 0);
      if (!mask.size) {
        setSelection(null);
        return;
      }
      let minX = canvasSize;
      let minY = canvasSize;
      let maxX = 0;
      let maxY = 0;
      mask.forEach((idx) => {
        const x = idx % canvasSize;
        const y = Math.floor(idx / canvasSize);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      });
      setSelection({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, mask });
      return;
    }
    if (tool === 'move' && selection) {
      const c = activeLayerCanvas();
      if (!c) return;
      pushHistory();
      selectionDragRef.current = {
        mode: 'move',
        startX: coords.x,
        startY: coords.y,
        origin: selection,
        snapshot: c.getContext('2d')!.getImageData(0, 0, canvasSize, canvasSize),
      };
      drawingRef.current = true;
      return;
    }

    drawingRef.current = true;

    if (tool === 'line' || tool === 'rect' || tool === 'ellipse') {
      pushHistory();
      const c = activeLayerCanvas();
      if (c) snapshotBeforeStrokeRef.current = c.getContext('2d')!.getImageData(0, 0, canvasSize, canvasSize);
      shapeStartRef.current = coords;
      return;
    }

    pushHistory();
    applyToolAt(coords.x, coords.y);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (panDragRef.current) {
      const d = panDragRef.current;
      setPan({
        x: d.panX + (e.clientX - d.x),
        y: d.panY + (e.clientY - d.y),
      });
      return;
    }
    if (!drawingRef.current) return;
    const coords = toPixel(e);
    if (!coords) return;

    const selDrag = selectionDragRef.current;
    if (selDrag?.mode === 'marquee') {
      const x = Math.min(selDrag.startX, coords.x);
      const y = Math.min(selDrag.startY, coords.y);
      const w = Math.abs(coords.x - selDrag.startX);
      const h = Math.abs(coords.y - selDrag.startY);
      setSelection({ x, y, w: Math.max(1, w), h: Math.max(1, h) });
      return;
    }
    if (selDrag?.mode === 'move' && selDrag.origin && selDrag.snapshot) {
      const c = activeLayerCanvas();
      if (!c) return;
      const ctx = c.getContext('2d')!;
      ctx.putImageData(selDrag.snapshot, 0, 0);
      const dx = coords.x - selDrag.startX;
      const dy = coords.y - selDrag.startY;
      const o = selDrag.origin;
      const tmp = document.createElement('canvas');
      tmp.width = o.w;
      tmp.height = o.h;
      const tctx = tmp.getContext('2d')!;
      if (o.mask) {
        const src = selDrag.snapshot;
        const img = tctx.createImageData(o.w, o.h);
        for (let yy = 0; yy < o.h; yy++) {
          for (let xx = 0; xx < o.w; xx++) {
            const gx = o.x + xx;
            const gy = o.y + yy;
            const gidx = gy * canvasSize + gx;
            if (!o.mask.has(gidx)) continue;
            const si = (gy * canvasSize + gx) * 4;
            const di = (yy * o.w + xx) * 4;
            img.data[di] = src.data[si];
            img.data[di + 1] = src.data[si + 1];
            img.data[di + 2] = src.data[si + 2];
            img.data[di + 3] = src.data[si + 3];
            const clearI = si;
            src.data[clearI + 3] = 0;
          }
        }
        // clear source from restored snapshot copy
        const cleared = new ImageData(new Uint8ClampedArray(selDrag.snapshot.data), canvasSize, canvasSize);
        o.mask.forEach((idx) => {
          const i = idx * 4;
          cleared.data[i + 3] = 0;
        });
        ctx.putImageData(cleared, 0, 0);
        tctx.putImageData(img, 0, 0);
      } else {
        tctx.drawImage(c, o.x, o.y, o.w, o.h, 0, 0, o.w, o.h);
        ctx.clearRect(o.x, o.y, o.w, o.h);
      }
      ctx.drawImage(tmp, o.x + dx, o.y + dy);
      setSelection({ ...o, x: o.x + dx, y: o.y + dy });
      paint();
      return;
    }

    if ((tool === 'line' || tool === 'rect' || tool === 'ellipse') && shapeStartRef.current) {
      const c = activeLayerCanvas();
      if (!c || !snapshotBeforeStrokeRef.current) return;
      const ctx = c.getContext('2d')!;
      ctx.putImageData(snapshotBeforeStrokeRef.current, 0, 0);
      const s = shapeStartRef.current;
      const color = toolState.activeColor || '#ed7300';
      ctx.fillStyle = color;
      ctx.strokeStyle = color;

      if (tool === 'line') {
        drawBresenham(ctx, s.x, s.y, coords.x, coords.y, brushSize, (x, y) => {
          ctx.fillRect(x, y, 1, 1);
        });
      } else if (tool === 'rect') {
        const x = Math.min(s.x, coords.x);
        const y = Math.min(s.y, coords.y);
        const w = Math.abs(coords.x - s.x);
        const h = Math.abs(coords.y - s.y);
        if (shapeFilled) ctx.fillRect(x, y, w + 1, h + 1);
        else {
          for (let i = 0; i <= w; i++) {
            ctx.fillRect(x + i, y, 1, 1);
            ctx.fillRect(x + i, y + h, 1, 1);
          }
          for (let j = 0; j <= h; j++) {
            ctx.fillRect(x, y + j, 1, 1);
            ctx.fillRect(x + w, y + j, 1, 1);
          }
        }
      } else if (tool === 'ellipse') {
        const cx = Math.round((s.x + coords.x) / 2);
        const cy = Math.round((s.y + coords.y) / 2);
        const rx = Math.abs(coords.x - s.x) / 2;
        const ry = Math.abs(coords.y - s.y) / 2;
        if (shapeFilled) {
          for (let y = -ry; y <= ry; y++) {
            for (let x = -rx; x <= rx; x++) {
              if ((x * x) / (rx * rx || 1) + (y * y) / (ry * ry || 1) <= 1) {
                ctx.fillRect(cx + Math.round(x), cy + Math.round(y), 1, 1);
              }
            }
          }
        } else {
          drawEllipseOutline((x, y) => ctx.fillRect(x, y, 1, 1), cx, cy, Math.round(rx), Math.round(ry));
        }
      }
      paint();
      return;
    }

    if (tool !== 'fill' && tool !== 'picker') applyToolAt(coords.x, coords.y);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    panDragRef.current = null;
    drawingRef.current = false;
    shapeStartRef.current = null;
    snapshotBeforeStrokeRef.current = null;
    selectionDragRef.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    schedulePersist();
  };

  const addLayer = () => {
    const id = uid('layer');
    ensureLayerCanvas(id);
    setFrames((prev) =>
      prev.map((f, i) =>
        i === frameIndex
          ? {
              ...f,
              layers: [...f.layers, { id, name: `Layer ${f.layers.length + 1}`, visible: true, opacity: 1 }],
            }
          : f
      )
    );
    setActiveLayerId(id);
  };

  const deleteLayer = (id: string) => {
    if (layers.length <= 1) return;
    layerCanvasMap.current.delete(id);
    setFrames((prev) =>
      prev.map((f, i) =>
        i === frameIndex ? { ...f, layers: f.layers.filter((l) => l.id !== id) } : f
      )
    );
    if (activeLayerId === id) {
      const next = layers.find((l) => l.id !== id);
      if (next) setActiveLayerId(next.id);
    }
  };

  const addFrame = () => {
    const layerId = uid('layer');
    ensureLayerCanvas(layerId);
    const f: FrameMeta = {
      id: uid('frame'),
      name: `Frame ${frames.length + 1}`,
      durationMs: 100,
      layers: [{ id: layerId, name: 'Layer 1', visible: true, opacity: 1 }],
    };
    setFrames((prev) => [...prev, f]);
    setFrameIndex(frames.length);
    setActiveLayerId(layerId);
  };

  const duplicateFrame = () => {
    const src = frames[frameIndex];
    const newLayers = src.layers.map((l) => {
      const nid = uid('layer');
      const srcC = ensureLayerCanvas(l.id);
      const dst = createLayerCanvas(canvasSize, canvasSize);
      dst.getContext('2d')!.drawImage(srcC, 0, 0);
      layerCanvasMap.current.set(nid, dst);
      return { ...l, id: nid };
    });
    const f: FrameMeta = {
      id: uid('frame'),
      name: `${src.name} copy`,
      durationMs: src.durationMs,
      layers: newLayers,
    };
    setFrames((prev) => {
      const next = [...prev];
      next.splice(frameIndex + 1, 0, f);
      return next;
    });
    setFrameIndex(frameIndex + 1);
    setActiveLayerId(newLayers[0].id);
  };

  const deleteFrame = () => {
    if (frames.length <= 1) return;
    setFrames((prev) => prev.filter((_, i) => i !== frameIndex));
    setFrameIndex((i) => Math.max(0, i - 1));
  };

  const exportPng = () => {
    const c = getComposite();
    const a = document.createElement('a');
    a.href = c.toDataURL('image/png');
    a.download = `pixel_${canvasSize}x${canvasSize}.png`;
    a.click();
  };

  const exportSheet = async () => {
    const anim = buildTextureAnimation();
    const url = await exportTextureSpritesheetAsync(anim);
    const a = document.createElement('a');
    a.href = url;
    a.download = `spritesheet_${canvasSize}x${canvasSize}_x${anim.frames.length}.png`;
    a.click();
  };

  const setFrameDuration = (ms: number) => {
    setFrames((prev) =>
      prev.map((f, i) => (i === frameIndex ? { ...f, durationMs: Math.max(16, Math.round(ms)) } : f)),
    );
  };

  const toggleFrameTag = (tag: string) => {
    setFrames((prev) =>
      prev.map((f, i) => {
        if (i !== frameIndex) return f;
        const tags = new Set(f.tags || []);
        if (tags.has(tag)) tags.delete(tag);
        else tags.add(tag);
        return { ...f, tags: [...tags] };
      }),
    );
  };

  const rebuildClipsFromTags = () => {
    const animFrames = frames.map((f) => ({
      id: f.id,
      name: f.name,
      durationMs: f.durationMs,
      dataUrl: '',
      tags: f.tags || [],
    }));
    const clips = createPresetTextureClips(animFrames);
    setTexClips(clips);
    if (clips[0]) setDefaultClipId(clips[0].id);
  };

  const copyFrame = () => setClipboardFrame(frames[frameIndex] || null);

  const pasteFrame = () => {
    if (!clipboardFrame) return;
    const src = clipboardFrame;
    const newLayers = src.layers.map((layer) => {
      const nid = uid('layer');
      const srcC = layerCanvasMap.current.get(layer.id);
      const dst = createLayerCanvas(canvasSize, canvasSize);
      if (srcC) dst.getContext('2d')!.drawImage(srcC, 0, 0);
      layerCanvasMap.current.set(nid, dst);
      return { ...layer, id: nid };
    });
    const f: FrameMeta = {
      id: uid('frame'),
      name: `${src.name} paste`,
      durationMs: src.durationMs,
      tags: [...(src.tags || [])],
      layers: newLayers,
    };
    setFrames((prev) => {
      const next = [...prev];
      next.splice(frameIndex + 1, 0, f);
      return next;
    });
    setFrameIndex(frameIndex + 1);
    setActiveLayerId(newLayers[0].id);
  };

  const resizeCanvas = (size: number) => {
    setCanvasSize(size);
    setSizeMenuOpen(false);
    layerCanvasMap.current.forEach((c, id) => {
      const next = createLayerCanvas(size, size);
      next.getContext('2d')!.imageSmoothingEnabled = false;
      next.getContext('2d')!.drawImage(c, 0, 0, size, size);
      layerCanvasMap.current.set(id, next);
    });
    if (compositeRef.current) {
      compositeRef.current.width = size;
      compositeRef.current.height = size;
    }
    requestAnimationFrame(() => paint());
  };

  const withActiveLayer = (fn: (ctx: CanvasRenderingContext2D, c: HTMLCanvasElement) => void) => {
    const canvas = activeLayerCanvas();
    if (!canvas) return;
    pushHistory();
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    fn(ctx, canvas);
    paint();
    schedulePersist();
  };

  const flipLayer = (axis: 'h' | 'v') => {
    withActiveLayer((ctx, c) => {
      const tmp = createLayerCanvas(c.width, c.height, true);
      const tctx = tmp.getContext('2d')!;
      tctx.imageSmoothingEnabled = false;
      if (axis === 'h') {
        tctx.translate(c.width, 0);
        tctx.scale(-1, 1);
      } else {
        tctx.translate(0, c.height);
        tctx.scale(1, -1);
      }
      tctx.drawImage(c, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(tmp, 0, 0);
    });
  };

  const rotateLayer = (dir: 1 | -1) => {
    withActiveLayer((ctx, c) => {
      const tmp = createLayerCanvas(c.width, c.height, true);
      const tctx = tmp.getContext('2d')!;
      tctx.imageSmoothingEnabled = false;
      tctx.translate(c.width / 2, c.height / 2);
      tctx.rotate((dir * Math.PI) / 2);
      tctx.drawImage(c, -c.width / 2, -c.height / 2);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(tmp, 0, 0);
    });
  };

  const invertLayer = () => {
    withActiveLayer((ctx, c) => {
      const img = ctx.getImageData(0, 0, c.width, c.height);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue;
        d[i] = 255 - d[i];
        d[i + 1] = 255 - d[i + 1];
        d[i + 2] = 255 - d[i + 2];
      }
      ctx.putImageData(img, 0, 0);
    });
  };

  const clearLayer = () => {
    withActiveLayer((ctx, c) => {
      ctx.clearRect(0, 0, c.width, c.height);
    });
  };

  const outlineLayer = () => {
    withActiveLayer((ctx, c) => {
      const src = ctx.getImageData(0, 0, c.width, c.height);
      const out = ctx.createImageData(c.width, c.height);
      const s = src.data;
      const o = out.data;
      const w = c.width;
      const h = c.height;
      const color = hexToRgba(toolState.activeColor || '#ed7300');
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          if (s[i + 3] < 8) continue;
          let edge = false;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
              edge = true;
              break;
            }
            if (s[(ny * w + nx) * 4 + 3] < 8) {
              edge = true;
              break;
            }
          }
          if (edge) {
            o[i] = color[0];
            o[i + 1] = color[1];
            o[i + 2] = color[2];
            o[i + 3] = 255;
          } else {
            o[i] = s[i];
            o[i + 1] = s[i + 1];
            o[i + 2] = s[i + 2];
            o[i + 3] = s[i + 3];
          }
        }
      }
      ctx.putImageData(out, 0, 0);
    });
  };

  const tools: { id: PaintTool; icon: React.ReactNode; title: string; group: 'draw' | 'select' | 'shape' | 'nav' }[] = useMemo(
    () => [
      { id: 'pencil', icon: <Pencil className="w-3.5 h-3.5" />, title: 'Pencil (B)', group: 'draw' },
      { id: 'eraser', icon: <Eraser className="w-3.5 h-3.5" />, title: 'Eraser (E)', group: 'draw' },
      { id: 'fill', icon: <PaintBucket className="w-3.5 h-3.5" />, title: 'Flood Fill (G)', group: 'draw' },
      { id: 'picker', icon: <Pipette className="w-3.5 h-3.5" />, title: 'Eyedropper (I)', group: 'draw' },
      { id: 'dither', icon: <Grid3x3 className="w-3.5 h-3.5" />, title: 'Dither', group: 'draw' },
      { id: 'spray', icon: <SprayCan className="w-3.5 h-3.5" />, title: 'Spray', group: 'draw' },
      { id: 'shade', icon: <span className="text-[10px] font-bold">Dk</span>, title: 'Shade / darken', group: 'draw' },
      { id: 'lighten', icon: <span className="text-[10px] font-bold">Lt</span>, title: 'Lighten', group: 'draw' },
      { id: 'noise', icon: <span className="text-[10px] font-bold">Nz</span>, title: 'Noise', group: 'draw' },
      { id: 'select', icon: <MousePointer2 className="w-3.5 h-3.5" />, title: 'Marquee Select (V)', group: 'select' },
      { id: 'wand', icon: <Wand2 className="w-3.5 h-3.5" />, title: 'Magic Wand (W)', group: 'select' },
      { id: 'move', icon: <Move className="w-3.5 h-3.5" />, title: 'Move Selection (M)', group: 'select' },
      { id: 'line', icon: <Slash className="w-3.5 h-3.5" />, title: 'Line (L)', group: 'shape' },
      { id: 'rect', icon: <Square className="w-3.5 h-3.5" />, title: 'Rectangle (U)', group: 'shape' },
      { id: 'ellipse', icon: <Circle className="w-3.5 h-3.5" />, title: 'Ellipse (C)', group: 'shape' },
      { id: 'hand', icon: <Hand className="w-3.5 h-3.5" />, title: 'Hand / Pan (H / Space)', group: 'nav' },
    ],
    []
  );

  // Sync from main toolbar (Fill / Pencil / …) into the pixel editor tool dock.
  useEffect(() => {
    const dt = toolState.drawTool;
    if (!dt) return;
    const mapped: PaintTool =
      dt === 'rectangle' ? 'rect' :
      (dt as PaintTool);
    if (tools.some((t) => t.id === mapped)) setTool(mapped);
  }, [toolState.drawTool, tools]);

  const displayPx = canvasSize * zoom;
  const selectedFaceSet = useMemo(() => new Set(selectedFaceIds), [selectedFaceIds]);

  const toggleUvOverlay = () => {
    setShowUvOverlay((v) => {
      const next = !v;
      try {
        localStorage.setItem('cad.paintShowUvOverlay', next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  return (
    <div className="pixel-paint flex flex-col h-full w-full select-none overflow-hidden text-[11px]">
      {/* Header */}
      <header className="pixel-paint__header shrink-0">
        <div className="pixel-paint__brand">
          <span className="pixel-paint__brand-mark" aria-hidden />
          <div className="min-w-0">
            <div className="pixel-paint__title">Pixel Paint</div>
            <div className="pixel-paint__subtitle truncate">{mesh?.name || 'Texture'}</div>
          </div>
        </div>

        <div className="pixel-paint__seg pixel-paint__size-menu" ref={sizeMenuRef}>
          <button
            type="button"
            className="pixel-paint__size-trigger"
            onClick={() => setSizeMenuOpen((v) => !v)}
            title="Canvas resolution"
          >
            <span>{canvasSize}×{canvasSize}</span>
            <ChevronDown className="w-3 h-3 opacity-70" />
          </button>
          {sizeMenuOpen && (
            <div className="pixel-paint__size-dropdown" role="listbox">
              {PIXEL_CANVAS_SIZES.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="option"
                  aria-selected={canvasSize === s}
                  className={`pixel-paint__size-option ${canvasSize === s ? 'is-active' : ''}`}
                  onClick={() => resizeCanvas(s)}
                >
                  {s}×{s}
                  {s >= 512 ? <span className="pixel-paint__size-hint">HD</span> : null}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="pixel-paint__seg" title="Transform active layer">
          <button type="button" className="pixel-paint__icon-btn" onClick={() => flipLayer('h')} title="Flip horizontal">
            <FlipHorizontal className="w-3.5 h-3.5" />
          </button>
          <button type="button" className="pixel-paint__icon-btn" onClick={() => flipLayer('v')} title="Flip vertical">
            <FlipVertical className="w-3.5 h-3.5" />
          </button>
          <button type="button" className="pixel-paint__icon-btn" onClick={() => rotateLayer(-1)} title="Rotate 90° CCW">
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button type="button" className="pixel-paint__icon-btn" onClick={() => rotateLayer(1)} title="Rotate 90° CW">
            <RotateCw className="w-3.5 h-3.5" />
          </button>
          <button type="button" className="pixel-paint__icon-btn" onClick={invertLayer} title="Invert colors">
            <Contrast className="w-3.5 h-3.5" />
          </button>
          <button type="button" className="pixel-paint__text-btn" onClick={outlineLayer} title="Outline opaque pixels">
            Outline
          </button>
          <button type="button" className="pixel-paint__text-btn" onClick={clearLayer} title="Clear layer">
            Clear
          </button>
          <button
            type="button"
            className="pixel-paint__text-btn flex items-center gap-1 font-bold text-amber-400"
            onClick={() => setAdjustmentsModalOpen(true)}
            title="Photo Adjustments & Filters (Brightness, Contrast, Hue, Posterize, Lineart)"
          >
            <Sliders className="w-3.5 h-3.5 text-amber-400" />
            Filters
          </button>
          <button
            type="button"
            className={`pixel-paint__text-btn flex items-center gap-1 ${pixelPerfect ? 'is-active' : ''}`}
            onClick={() => setPixelPerfect((v) => !v)}
            title="Pixel-Perfect pencil mode (removes L-shaped corner double pixels)"
          >
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            P-Perfect
          </button>
        </div>

        <div className="pixel-paint__seg">
          <button type="button" className="pixel-paint__icon-btn" onClick={undo} title="Undo Ctrl+Z">
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button type="button" className="pixel-paint__icon-btn" onClick={redo} title="Redo Ctrl+Y">
            <Redo2 className="w-3.5 h-3.5" />
          </button>
          <div className="pixel-paint__vdiv" />
          <button type="button" className="pixel-paint__icon-btn" onClick={exportPng} title="Export PNG">
            <Download className="w-3.5 h-3.5" />
          </button>
          <button type="button" className="pixel-paint__text-btn" onClick={exportSheet} title="Export spritesheet">
            Sheet
          </button>
        </div>

        <div className="flex-1" />

        <div className="pixel-paint__seg pixel-paint__color-chip">
          <input
            type="color"
            value={toolState.activeColor || '#ed7300'}
            onChange={(e) => setToolState((s) => ({ ...s, activeColor: e.target.value, brushSize }))}
            className="pixel-paint__color-input"
            title="Brush color"
          />
          <span className="font-mono text-[10px] text-[#9a9a9a] uppercase tracking-wide">
            {(toolState.activeColor || '#ed7300').replace('#', '')}
          </span>
        </div>

        <div className="pixel-paint__seg" title="Brush size">
          {[1, 2, 3, 4, 8].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setBrushSize(s);
                setToolState((st) => ({ ...st, brushSize: s }));
              }}
              className={`pixel-paint__size-btn ${brushSize === s ? 'is-active' : ''}`}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="pixel-paint__seg">
          <button
            type="button"
            className={`pixel-paint__text-btn ${showUvOverlay ? 'is-active' : ''}`}
            onClick={toggleUvOverlay}
            title="UV outlines"
          >
            <Box className="w-3.5 h-3.5" />
            UV
          </button>
          <button
            type="button"
            className="pixel-paint__text-btn flex items-center gap-1"
            onClick={() => {
              const fileInput = document.createElement('input');
              fileInput.type = 'file';
              fileInput.accept = 'image/*';
              fileInput.onchange = (e) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                  if (typeof reader.result === 'string') {
                    const img = new Image();
                    img.onload = () => {
                      setImportSize(nearestCanvasSize(img.naturalWidth, img.naturalHeight));
                      setImportPrompt({ dataUrl: reader.result as string, naturalW: img.naturalWidth, naturalH: img.naturalHeight });
                    };
                    img.src = reader.result;
                  }
                };
                reader.readAsDataURL(file);
              };
              fileInput.click();
            }}
            title="Load custom UV Image onto canvas"
          >
            <ImagePlus className="w-3.5 h-3.5" />
            Load UV
          </button>
          <button
            type="button"
            className={`pixel-paint__text-btn ${shapeFilled ? 'is-active' : ''}`}
            onClick={() => setShapeFilled((v) => !v)}
            title="Filled shapes"
          >
            Fill
          </button>
        </div>
      </header>

      <div className="flex-1 min-h-0 flex">
        {/* Tool rail */}
        <aside className="pixel-paint__rail shrink-0">
          {(['draw', 'select', 'shape', 'nav'] as const).map((group, gi) => (
            <React.Fragment key={group}>
              {gi > 0 && <div className="pixel-paint__rail-sep" />}
              {tools.filter((t) => t.group === group).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  title={t.title}
                  onClick={() => {
                    setTool(t.id);
                    if (t.id === 'hand') return;
                    const drawTool = t.id === 'rect' ? 'rectangle' : t.id;
                    setToolState((s) => ({ ...s, drawTool: drawTool as ToolState['drawTool'], brushSize }));
                  }}
                  className={`pixel-paint__tool ${tool === t.id ? 'is-active' : ''}`}
                >
                  {t.icon}
                </button>
              ))}
            </React.Fragment>
          ))}
        </aside>

        {/* Stage */}
        <div
          ref={stageRef}
          className="pixel-paint__stage flex-1 relative overflow-hidden"
          onWheel={(e) => {
            e.preventDefault();
            const step = e.ctrlKey ? 1 : e.shiftKey ? 8 : 4;
            setZoom((z) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z + (e.deltaY > 0 ? -step : step))));
          }}
        >
          <div
            className="absolute left-1/2 top-1/2"
            style={{ transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px))` }}
          >
            <div className="pixel-paint__canvas-frame" style={{ width: displayPx, height: displayPx }}>
              <canvas
                ref={displayRef}
                width={canvasSize}
                height={canvasSize}
                className="w-full h-full cursor-crosshair"
                style={{ imageRendering: 'pixelated' }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onContextMenu={(e) => e.preventDefault()}
              />
              {showGrid && (
                <div
                  className="absolute inset-0 pointer-events-none opacity-25"
                  style={{
                    backgroundImage:
                      'linear-gradient(to right, rgba(180,180,180,0.45) 1px, transparent 1px), linear-gradient(to bottom, rgba(180,180,180,0.45) 1px, transparent 1px)',
                    backgroundSize: `${100 / canvasSize}% ${100 / canvasSize}%`,
                  }}
                />
              )}
              {showUvOverlay && mesh && mesh.faces.length > 0 && (
                <svg
                  className="absolute inset-0 w-full h-full pointer-events-none"
                  viewBox="0 0 1 1"
                  preserveAspectRatio="none"
                  aria-hidden
                >
                  {mesh.faces.map((face) => {
                    if (face.uvs.length < 2) return null;
                    const selected = selectedFaceSet.has(face.id);
                    // Match paint/3D mapping (texture.flipY=false): v=0 at canvas top.
                    const points = face.uvs.map((p) => `${p.u},${p.v}`).join(' ');
                    return (
                      <polygon
                        key={face.id}
                        points={points}
                        fill={selected ? 'rgba(230,134,25,0.14)' : 'none'}
                        stroke={selected ? '#e68619' : 'rgba(20,115,230,0.85)'}
                        strokeWidth={selected ? 1.75 : 1.15}
                        vectorEffect="non-scaling-stroke"
                      />
                    );
                  })}
                </svg>
              )}
              {selection && selection.w > 0 && selection.h > 0 && (
                <div
                  className="absolute pointer-events-none border border-dashed border-[#e68619] bg-[#e68619]/12"
                  style={{
                    left: `${(selection.x / canvasSize) * 100}%`,
                    top: `${(selection.y / canvasSize) * 100}%`,
                    width: `${(selection.w / canvasSize) * 100}%`,
                    height: `${(selection.h / canvasSize) * 100}%`,
                  }}
                />
              )}
            </div>
          </div>

          <div className="pixel-paint__hud">
            <button type="button" className={`pixel-paint__hud-btn ${showGrid ? 'is-active' : ''}`} onClick={() => setShowGrid((v) => !v)}>
              Grid
            </button>
            <button type="button" className={`pixel-paint__hud-btn ${showUvOverlay ? 'is-active' : ''}`} onClick={toggleUvOverlay}>
              UV
            </button>
            <button type="button" className={`pixel-paint__hud-btn ${onionSkin ? 'is-active' : ''}`} onClick={() => setOnionSkin((v) => !v)}>
              Onion
            </button>
            <div className="pixel-paint__vdiv" />
            <button type="button" className="pixel-paint__hud-btn is-square" onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z - 4))} title="Zoom out">
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="pixel-paint__zoom-label" title="Ctrl+wheel for fine zoom">{zoom * 100}%</span>
            <button type="button" className="pixel-paint__hud-btn is-square" onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z + 4))} title="Zoom in">
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Inspector */}
        <aside className="pixel-paint__inspector shrink-0 flex flex-col min-h-0">
          <div className="pixel-paint__section-head">
            <span>Palette</span>
            <span className="text-[9px] font-mono normal-case tracking-normal text-[#666]">
              {activePalette.colors.length}
            </span>
          </div>
          <div className="px-2 pt-2 pb-1" ref={paletteMenuRef}>
            <button
              type="button"
              className="pixel-paint__palette-trigger"
              onClick={() => setPaletteMenuOpen((v) => !v)}
              title="Choose color palette"
            >
              <span className="truncate">{activePalette.name}</span>
              <ChevronDown className="w-3 h-3 shrink-0 opacity-70" />
            </button>
            {paletteMenuOpen && (
              <div className="pixel-paint__palette-menu">
                {paletteGroups.map(([group, list]) => (
                  <div key={group} className="pixel-paint__palette-group">
                    <div className="pixel-paint__palette-group-label">{group}</div>
                    {list.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className={`pixel-paint__palette-option ${paletteId === p.id ? 'is-active' : ''}`}
                        onClick={() => {
                          setPaletteId(p.id);
                          setPaletteMenuOpen(false);
                          try {
                            localStorage.setItem('cad.paintPaletteId', p.id);
                          } catch {
                            /* ignore */
                          }
                        }}
                      >
                        <span className="pixel-paint__palette-swatches" aria-hidden>
                          {p.colors.slice(0, 8).map((c) => (
                            <i key={c} style={{ background: c }} />
                          ))}
                        </span>
                        <span className="truncate flex-1 text-left">{p.name}</span>
                        <span className="font-mono text-[9px] text-[#666]">{p.colors.length}</span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="pixel-paint__palette">
            {activePalette.colors.map((c, i) => (
              <button
                key={`${c}_${i}`}
                type="button"
                title={c}
                onClick={() => setToolState((s) => ({ ...s, activeColor: c }))}
                className={`pixel-paint__swatch ${toolState.activeColor === c ? 'is-active' : ''}`}
                style={{ background: c }}
              />
            ))}
          </div>

          <div className="pixel-paint__section-head">
            <span className="inline-flex items-center gap-1.5">
              <Layers className="w-3 h-3 opacity-70" /> Layers
            </span>
            <button type="button" className="pixel-paint__icon-btn is-compact" onClick={addLayer} title="Add layer">
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
            {[...layers].reverse().map((layer) => (
              <div
                key={layer.id}
                className={`pixel-paint__layer ${activeLayerId === layer.id ? 'is-active' : ''}`}
                onClick={() => setActiveLayerId(layer.id)}
              >
                <button
                  type="button"
                  className="pixel-paint__layer-eye"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFrames((prev) =>
                      prev.map((f, i) =>
                        i === frameIndex
                          ? {
                              ...f,
                              layers: f.layers.map((l) =>
                                l.id === layer.id ? { ...l, visible: !l.visible } : l
                              ),
                            }
                          : f
                      )
                    );
                  }}
                >
                  {layer.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                </button>
                <span className="flex-1 truncate text-[11px] text-[#d8d8d8]">{layer.name}</span>

                <select
                  value={layer.blendMode || 'normal'}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    const blendMode = e.target.value as LayerBlendMode;
                    setFrames((prev) =>
                      prev.map((f, i) =>
                        i === frameIndex
                          ? {
                              ...f,
                              layers: f.layers.map((l) => (l.id === layer.id ? { ...l, blendMode } : l)),
                            }
                          : f
                      )
                    );
                  }}
                  className="bg-[#2b2b2b] text-[#b0b0b0] text-[8px] rounded px-0.5 py-0.5 outline-none border border-[#4d4d4d]"
                  title="Layer Blend Mode"
                >
                  <option value="normal">Norm</option>
                  <option value="multiply">Mult</option>
                  <option value="screen">Scrn</option>
                  <option value="overlay">Over</option>
                  <option value="darken">Dark</option>
                  <option value="lighten">Lite</option>
                  <option value="color-dodge">Ddg</option>
                  <option value="soft-light">Soft</option>
                </select>

                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={layer.opacity}
                  title="Opacity"
                  className="pixel-paint__opacity"
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    const opacity = parseFloat(e.target.value);
                    setFrames((prev) =>
                      prev.map((f, i) =>
                        i === frameIndex
                          ? {
                              ...f,
                              layers: f.layers.map((l) => (l.id === layer.id ? { ...l, opacity } : l)),
                            }
                          : f
                      )
                    );
                  }}
                />

                <button
                  type="button"
                  className="p-0.5 text-[#8c8c8c] hover:text-white"
                  title="Move Layer Up"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFrames((prev) =>
                      prev.map((f, i) => {
                        if (i !== frameIndex) return f;
                        const idx = f.layers.findIndex((l) => l.id === layer.id);
                        if (idx >= f.layers.length - 1) return f;
                        const nextLayers = [...f.layers];
                        const [moved] = nextLayers.splice(idx, 1);
                        nextLayers.splice(idx + 1, 0, moved);
                        return { ...f, layers: nextLayers };
                      })
                    );
                  }}
                >
                  <ArrowUp className="w-2.5 h-2.5" />
                </button>

                <button
                  type="button"
                  className="p-0.5 text-[#8c8c8c] hover:text-white"
                  title="Move Layer Down"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFrames((prev) =>
                      prev.map((f, i) => {
                        if (i !== frameIndex) return f;
                        const idx = f.layers.findIndex((l) => l.id === layer.id);
                        if (idx <= 0) return f;
                        const nextLayers = [...f.layers];
                        const [moved] = nextLayers.splice(idx, 1);
                        nextLayers.splice(idx - 1, 0, moved);
                        return { ...f, layers: nextLayers };
                      })
                    );
                  }}
                >
                  <ArrowDown className="w-2.5 h-2.5" />
                </button>

                <button
                  type="button"
                  className="pixel-paint__layer-del"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteLayer(layer.id);
                  }}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>

          {/* UV Texture Animation Clips Panel */}
          <div className="border-t border-[#1a1a1a] px-2 py-2 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[9px] uppercase tracking-[0.12em] text-[#8c8c8c] font-bold flex items-center gap-1">
                <Film className="w-3 h-3 text-[#ed7300]" /> Clips & Animations
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setEditingClip({
                      id: uid('texclip'),
                      name: `Clip ${texClips.length + 1}`,
                      frameIds: frames.map((f) => f.id),
                      loop: true,
                    });
                    setClipModalOpen(true);
                  }}
                  className="px-1.5 py-0.5 bg-[#ed7300] text-white text-[9px] font-bold rounded flex items-center gap-0.5"
                  title="Create Custom Texture Animation Clip"
                >
                  <Plus className="w-2.5 h-2.5" /> + Clip
                </button>
              </div>
            </div>

            <div className="space-y-1.5 max-h-40 overflow-y-auto custom-scrollbar">
              {texClips.length === 0 ? (
                <div className="text-[10px] text-[#666] italic py-1">
                  No animation clips created. Tag frames or click + Clip to create one.
                </div>
              ) : (
                texClips.map((c) => {
                  const isDefault = defaultClipId === c.id;
                  const isPreviewing = isPlaying && previewClipId === c.id;
                  return (
                    <div
                      key={c.id}
                      className={`p-1.5 rounded border text-[10px] flex items-center justify-between transition ${
                        isPreviewing
                          ? 'bg-[#ed7300]/20 border-[#ed7300] text-[#ed7300]'
                          : 'bg-[#212121] border-[#4d4d4d] text-[#d8d8d8]'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 truncate flex-1">
                        <button
                          type="button"
                          onClick={() => {
                            if (isPreviewing) {
                              setIsPlaying(false);
                              setPreviewClipId(null);
                            } else {
                              setPreviewClipId(c.id);
                              setIsPlaying(true);
                            }
                          }}
                          className={`p-0.5 rounded ${isPreviewing ? 'text-[#ed7300]' : 'text-[#8c8c8c] hover:text-white'}`}
                          title={isPreviewing ? 'Stop Preview' : 'Play Clip Preview'}
                        >
                          {isPreviewing ? <Pause className="w-3 h-3" /> : <PlayCircle className="w-3 h-3" />}
                        </button>

                        <span className="font-semibold truncate">{c.name}</span>
                        {isDefault && (
                          <span title="Default Clip" className="shrink-0 flex items-center">
                            <Star className="w-2.5 h-2.5 text-amber-400 fill-amber-400" />
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-[8px] px-1 py-0.2 bg-[#2a2a2a] text-[#8c8c8c] rounded font-mono">
                          {c.frameIds.length}f · {c.loop ? 'loop' : 'once'}
                        </span>

                        <button
                          type="button"
                          onClick={() => {
                            setEditingClip(c);
                            setClipModalOpen(true);
                          }}
                          className="p-1 text-[#8c8c8c] hover:text-white"
                          title="Edit Clip"
                        >
                          <Edit2 className="w-2.5 h-2.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setTexClips((prev) => prev.filter((item) => item.id !== c.id));
                            if (defaultClipId === c.id) setDefaultClipId(null);
                            if (previewClipId === c.id) setPreviewClipId(null);
                          }}
                          className="p-1 text-[#8c8c8c] hover:text-rose-400"
                          title="Delete Clip"
                        >
                          <Trash2 className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* Timeline */}
      <footer className="pixel-paint__timeline shrink-0">
        <div className="pixel-paint__transport">
          <button type="button" className="pixel-paint__icon-btn" onClick={() => setFrameIndex(0)} title="First frame">
            <SkipBack className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            className={`pixel-paint__play ${isPlaying ? 'is-active' : ''}`}
            onClick={() => setIsPlaying((v) => !v)}
            title="Play / Pause"
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          </button>
          <div className="pixel-paint__vdiv" />
          <button type="button" className="pixel-paint__text-btn" onClick={addFrame} title="Add frame">
            <Plus className="w-3 h-3" /> Frame
          </button>
          <button type="button" className="pixel-paint__icon-btn" onClick={duplicateFrame} title="Duplicate">
            <Copy className="w-3.5 h-3.5" />
          </button>
          <button type="button" className="pixel-paint__icon-btn" onClick={copyFrame} title="Copy frame">
            <span className="text-[9px] font-semibold">C</span>
          </button>
          <button type="button" className="pixel-paint__icon-btn" onClick={pasteFrame} title="Paste frame" disabled={!clipboardFrame}>
            <span className="text-[9px] font-semibold">V</span>
          </button>
          <button type="button" className="pixel-paint__icon-btn is-danger" onClick={deleteFrame} title="Delete frame">
            <Trash2 className="w-3.5 h-3.5" />
          </button>

          <div className="pixel-paint__vdiv" />

          <label className="pixel-paint__duration" title="Frame duration">
            <span>Dur</span>
            <input
              type="number"
              min={16}
              step={16}
              value={frame?.durationMs || 100}
              onChange={(e) => setFrameDuration(Number(e.target.value))}
            />
            <span className="opacity-50">ms</span>
          </label>

          <div className="pixel-paint__tags">
            {(['idle', 'talk', 'blink'] as const).map((tag) => {
              const on = frame?.tags?.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  className={`pixel-paint__tag ${on ? 'is-active' : ''}`}
                  onClick={() => toggleFrameTag(tag)}
                  title={`Tag as ${tag}`}
                >
                  {tag}
                </button>
              );
            })}
            <button type="button" className="pixel-paint__text-btn" onClick={rebuildClipsFromTags} title="Build Idle/Talk/Blink from tags">
              Build
            </button>
          </div>

          <div className="flex-1" />
          <div className="pixel-paint__status font-mono">
            {frameIndex + 1}/{frames.length}
            <span className="opacity-40 mx-1.5">·</span>
            {canvasSize}²
            <span className="opacity-40 mx-1.5">·</span>
            {tool}
          </div>
        </div>

        <div className="pixel-paint__frames">
          {frames.map((f, i) => (
            <button
              key={f.id}
              type="button"
              onClick={() => {
                setFrameIndex(i);
                setActiveLayerId(f.layers[0]?.id);
                setIsPlaying(false);
              }}
              className={`pixel-paint__frame ${i === frameIndex ? 'is-active' : ''}`}
            >
              <span className="pixel-paint__frame-num">{i + 1}</span>
              <span className="pixel-paint__frame-ms">{f.durationMs}ms</span>
              {f.tags?.length ? (
                <span className="pixel-paint__frame-tags">{f.tags.join(' · ')}</span>
              ) : (
                <span className="pixel-paint__frame-tags is-empty">untagged</span>
              )}
            </button>
          ))}
        </div>
      </footer>

      {importPrompt && (
        <div className="pixel-paint__modal-backdrop">
          <div className="pixel-paint__modal" role="dialog" aria-labelledby="pixel-import-title">
            <div className="pixel-paint__modal-icon">
              <ImagePlus className="w-5 h-5" />
            </div>
            <h2 id="pixel-import-title" className="pixel-paint__modal-title">Import UV texture</h2>
            <p className="pixel-paint__modal-copy">
              This mesh already has a texture ({importPrompt.naturalW}×{importPrompt.naturalH}).
              Resize it for Pixel Paint, or keep it as-is.
            </p>
            <div className="pixel-paint__modal-preview">
              <img src={importPrompt.dataUrl} alt="Texture preview" />
            </div>

            <div className="pixel-paint__modal-field">
              <span>Resize to</span>
              <div className="pixel-paint__seg pixel-paint__size-menu">
                <button
                  type="button"
                  className="pixel-paint__size-trigger"
                  onClick={() => setImportSizeMenuOpen((v) => !v)}
                >
                  <span>{importSize}×{importSize}</span>
                  <ChevronDown className="w-3 h-3 opacity-70" />
                </button>
                {importSizeMenuOpen && (
                  <div className="pixel-paint__size-dropdown is-up" role="listbox">
                    {PIXEL_CANVAS_SIZES.map((s) => (
                      <button
                        key={s}
                        type="button"
                        className={`pixel-paint__size-option ${importSize === s ? 'is-active' : ''}`}
                        onClick={() => {
                          setImportSize(s);
                          setImportSizeMenuOpen(false);
                        }}
                      >
                        {s}×{s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="pixel-paint__modal-actions">
              <button
                type="button"
                className="pixel-paint__modal-btn is-primary"
                onClick={() => applyImportedImage('resize', importSize)}
              >
                Resize to {importSize}×{importSize}
              </button>
              <button
                type="button"
                className="pixel-paint__modal-btn"
                onClick={() => applyImportedImage('keep')}
              >
                Keep as-is ({importPrompt.naturalW}×{importPrompt.naturalH})
              </button>
            </div>
          </div>
        </div>
      )}

      {clipModalOpen && editingClip && (
        <div className="pixel-paint__modal-backdrop">
          <div className="pixel-paint__modal w-96 max-w-full" role="dialog">
            <div className="flex items-center justify-between pb-2 border-b border-[#4d4d4d]">
              <div className="flex items-center gap-2 font-bold text-white text-sm">
                <Film className="w-4 h-4 text-[#ed7300]" />
                <span>Edit Animation Clip</span>
              </div>
              <button
                type="button"
                onClick={() => setClipModalOpen(false)}
                className="p-1 text-[#8c8c8c] hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="py-3 space-y-3 font-mono text-xs">
              <label className="block space-y-1">
                <span className="text-[#8c8c8c] text-[10px] uppercase">Clip Name</span>
                <input
                  type="text"
                  value={editingClip.name}
                  onChange={(e) => setEditingClip({ ...editingClip, name: e.target.value })}
                  placeholder="e.g. Talk Happy, Blink Loop, Dialog Laugh"
                  className="w-full bg-[#2b2b2b] border border-[#4d4d4d] rounded px-2 py-1 text-white outline-none focus:border-[#ed7300]"
                />
              </label>

              <div className="flex items-center justify-between py-1 border-t border-b border-[#1a1a1a]">
                <div>
                  <div className="font-bold text-white">Loop Animation</div>
                  <div className="text-[9px] text-[#8c8c8c]">Repeats infinitely vs plays once</div>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingClip({ ...editingClip, loop: !editingClip.loop })}
                  className={`px-2 py-1 rounded font-bold text-[10px] ${
                    editingClip.loop ? 'bg-[#ed7300] text-white' : 'bg-[#404040] text-[#8c8c8c]'
                  }`}
                >
                  {editingClip.loop ? 'LOOP' : 'ONCE'}
                </button>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-[#1a1a1a]">
                <div>
                  <div className="font-bold text-white">Default Mesh Clip</div>
                  <div className="text-[9px] text-[#8c8c8c]">Plays when no animation key is active</div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (defaultClipId === editingClip.id) {
                      setDefaultClipId(null);
                    } else {
                      setDefaultClipId(editingClip.id);
                    }
                  }}
                  className={`p-1 rounded ${
                    defaultClipId === editingClip.id ? 'text-amber-400 bg-amber-400/20' : 'text-[#8c8c8c] bg-[#404040]'
                  }`}
                >
                  <Star className="w-3.5 h-3.5 fill-current" />
                </button>
              </div>

              <div>
                <div className="font-bold text-white mb-1.5 flex items-center justify-between">
                  <span>Include Frames ({editingClip.frameIds.length}/{frames.length})</span>
                  <div className="flex gap-1 text-[9px]">
                    <button
                      type="button"
                      onClick={() => setEditingClip({ ...editingClip, frameIds: frames.map((f) => f.id) })}
                      className="text-[#ed7300] hover:underline"
                    >
                      All
                    </button>
                    <span>·</span>
                    <button
                      type="button"
                      onClick={() => setEditingClip({ ...editingClip, frameIds: [frames[0]?.id].filter(Boolean) })}
                      className="text-[#8c8c8c] hover:underline"
                    >
                      First
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-1.5 max-h-36 overflow-y-auto custom-scrollbar p-1 bg-[#2b2b2b] rounded border border-[#1a1a1a]">
                  {frames.map((f, i) => {
                    const included = editingClip.frameIds.includes(f.id);
                    return (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => {
                          const nextIds = included
                            ? editingClip.frameIds.filter((id) => id !== f.id)
                            : [...editingClip.frameIds, f.id];
                          setEditingClip({ ...editingClip, frameIds: nextIds });
                        }}
                        className={`p-1.5 rounded border flex flex-col items-center justify-center transition ${
                          included
                            ? 'bg-[#ed7300]/20 border-[#ed7300] text-white font-bold'
                            : 'bg-[#212121] border-[#4d4d4d] text-[#8c8c8c] opacity-60'
                        }`}
                      >
                        <span className="text-[10px]">f{i + 1}</span>
                        <span className="text-[8px] truncate max-w-full">{f.name || `${f.durationMs}ms`}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="pixel-paint__modal-actions pt-2 border-t border-[#4d4d4d]">
              <button
                type="button"
                className="pixel-paint__modal-btn is-primary"
                onClick={() => {
                  setTexClips((prev) => {
                    const exists = prev.some((c) => c.id === editingClip.id);
                    if (exists) return prev.map((c) => (c.id === editingClip.id ? editingClip : c));
                    return [...prev, editingClip];
                  });
                  setClipModalOpen(false);
                }}
              >
                Save Clip
              </button>
              <button
                type="button"
                className="pixel-paint__modal-btn"
                onClick={() => setClipModalOpen(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {adjustmentsModalOpen && (
        <div className="pixel-paint__modal-backdrop">
          <div className="pixel-paint__modal w-[480px] max-w-full" role="dialog">
            <div className="flex items-center justify-between pb-2 border-b border-[#4d4d4d]">
              <div className="flex items-center gap-2 font-bold text-white text-sm">
                <Sliders className="w-4 h-4 text-amber-400" />
                <span>Photo Editing & Image Adjustments</span>
              </div>
              <button
                type="button"
                onClick={() => setAdjustmentsModalOpen(false)}
                className="p-1 text-[#8c8c8c] hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="py-3 space-y-3 font-mono text-xs max-h-[420px] overflow-y-auto custom-scrollbar">
              {/* Preset Buttons */}
              <div className="flex items-center gap-1.5 flex-wrap pb-2 border-b border-[#1a1a1a]">
                <button
                  type="button"
                  onClick={() => setAdjustments(DEFAULT_ADJUSTMENTS)}
                  className="px-2 py-0.5 bg-[#2a2a2a] hover:bg-[#4d4d4d] text-white rounded text-[10px]"
                >
                  Reset All
                </button>
                <button
                  type="button"
                  onClick={() => setAdjustments({ ...DEFAULT_ADJUSTMENTS, grayscale: true })}
                  className="px-2 py-0.5 bg-[#2a2a2a] hover:bg-[#4d4d4d] text-white rounded text-[10px]"
                >
                  Grayscale
                </button>
                <button
                  type="button"
                  onClick={() => setAdjustments({ ...DEFAULT_ADJUSTMENTS, sepia: true })}
                  className="px-2 py-0.5 bg-[#2a2a2a] hover:bg-[#4d4d4d] text-amber-300 rounded text-[10px]"
                >
                  Sepia
                </button>
                <button
                  type="button"
                  onClick={() => setAdjustments({ ...DEFAULT_ADJUSTMENTS, posterizeLevels: 8 })}
                  className="px-2 py-0.5 bg-[#2a2a2a] hover:bg-[#4d4d4d] text-emerald-400 rounded text-[10px]"
                >
                  8-Color Pixel Quantize
                </button>
                <button
                  type="button"
                  onClick={() => setAdjustments({ ...DEFAULT_ADJUSTMENTS, edgeDetection: true, edgeThreshold: 45 })}
                  className="px-2 py-0.5 bg-[#2a2a2a] hover:bg-[#4d4d4d] text-cyan-400 rounded text-[10px]"
                >
                  Sobel Pixel Lineart
                </button>
              </div>

              {/* Sliders Grid */}
              <div className="space-y-2">
                <label className="block">
                  <div className="flex justify-between text-[#8c8c8c] text-[10px]">
                    <span>Brightness</span>
                    <span className="text-white">{adjustments.brightness}</span>
                  </div>
                  <input
                    type="range"
                    min={-100}
                    max={100}
                    value={adjustments.brightness}
                    onChange={(e) => setAdjustments({ ...adjustments, brightness: Number(e.target.value) })}
                    className="w-full accent-[#ed7300]"
                  />
                </label>

                <label className="block">
                  <div className="flex justify-between text-[#8c8c8c] text-[10px]">
                    <span>Contrast</span>
                    <span className="text-white">{adjustments.contrast}</span>
                  </div>
                  <input
                    type="range"
                    min={-100}
                    max={100}
                    value={adjustments.contrast}
                    onChange={(e) => setAdjustments({ ...adjustments, contrast: Number(e.target.value) })}
                    className="w-full accent-[#ed7300]"
                  />
                </label>

                <label className="block">
                  <div className="flex justify-between text-[#8c8c8c] text-[10px]">
                    <span>Hue Shift</span>
                    <span className="text-white">{adjustments.hue}°</span>
                  </div>
                  <input
                    type="range"
                    min={-180}
                    max={180}
                    value={adjustments.hue}
                    onChange={(e) => setAdjustments({ ...adjustments, hue: Number(e.target.value) })}
                    className="w-full accent-[#ed7300]"
                  />
                </label>

                <label className="block">
                  <div className="flex justify-between text-[#8c8c8c] text-[10px]">
                    <span>Saturation</span>
                    <span className="text-white">{adjustments.saturation}</span>
                  </div>
                  <input
                    type="range"
                    min={-100}
                    max={100}
                    value={adjustments.saturation}
                    onChange={(e) => setAdjustments({ ...adjustments, saturation: Number(e.target.value) })}
                    className="w-full accent-[#ed7300]"
                  />
                </label>

                <label className="block">
                  <div className="flex justify-between text-[#8c8c8c] text-[10px]">
                    <span>Posterize (Color Levels)</span>
                    <span className="text-white">{adjustments.posterizeLevels || 'Off'}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={32}
                    value={adjustments.posterizeLevels}
                    onChange={(e) => setAdjustments({ ...adjustments, posterizeLevels: Number(e.target.value) })}
                    className="w-full accent-[#ed7300]"
                  />
                </label>

                <label className="block">
                  <div className="flex justify-between text-[#8c8c8c] text-[10px]">
                    <span>Threshold (B&W Cutoff)</span>
                    <span className="text-white">{adjustments.threshold || 'Off'}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={254}
                    value={adjustments.threshold}
                    onChange={(e) => setAdjustments({ ...adjustments, threshold: Number(e.target.value) })}
                    className="w-full accent-[#ed7300]"
                  />
                </label>
              </div>

              {/* Checkbox Toggles */}
              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#1a1a1a]">
                <label className="flex items-center gap-1.5 cursor-pointer text-white">
                  <input
                    type="checkbox"
                    checked={adjustments.invert}
                    onChange={(e) => setAdjustments({ ...adjustments, invert: e.target.checked })}
                    className="accent-[#ed7300]"
                  />
                  <span>Invert Colors</span>
                </label>

                <label className="flex items-center gap-1.5 cursor-pointer text-white">
                  <input
                    type="checkbox"
                    checked={adjustments.grayscale}
                    onChange={(e) => setAdjustments({ ...adjustments, grayscale: e.target.checked })}
                    className="accent-[#ed7300]"
                  />
                  <span>Grayscale</span>
                </label>

                <label className="flex items-center gap-1.5 cursor-pointer text-white">
                  <input
                    type="checkbox"
                    checked={adjustments.sepia}
                    onChange={(e) => setAdjustments({ ...adjustments, sepia: e.target.checked })}
                    className="accent-[#ed7300]"
                  />
                  <span>Sepia Filter</span>
                </label>

                <label className="flex items-center gap-1.5 cursor-pointer text-white">
                  <input
                    type="checkbox"
                    checked={adjustments.edgeDetection}
                    onChange={(e) => setAdjustments({ ...adjustments, edgeDetection: e.target.checked })}
                    className="accent-[#ed7300]"
                  />
                  <span>Sobel Lineart</span>
                </label>
              </div>
            </div>

            <div className="pixel-paint__modal-actions pt-2 border-t border-[#4d4d4d]">
              <button
                type="button"
                className="pixel-paint__modal-btn is-primary"
                onClick={() => {
                  const layer = layers.find((l) => l.id === activeLayerId);
                  if (!layer) return;
                  pushHistory();
                  const lc = ensureLayerCanvas(layer.id);
                  const ctx = lc.getContext('2d')!;
                  const srcData = ctx.getImageData(0, 0, canvasSize, canvasSize);
                  const outData = applyPhotoAdjustments(srcData, adjustments);
                  ctx.putImageData(outData, 0, 0);
                  paint();
                  schedulePersist();
                  setAdjustmentsModalOpen(false);
                }}
              >
                Apply to Active Layer
              </button>
              <button
                type="button"
                className="pixel-paint__modal-btn"
                onClick={() => setAdjustmentsModalOpen(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PixelPaintStudio;
