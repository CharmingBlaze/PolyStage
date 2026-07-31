import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  FileCode,
  FolderOpen,
  Save,
  Download,
  RotateCcw,
  RotateCw,
  HelpCircle,
  Film,
  Sparkles,
  Plus,
  Trash2,
  Edit2,
  Layers,
  Square,
  LayoutGrid,
  Palette,
  Paintbrush,
  Eye,
  Columns2,
  Upload,
  Box,
  Bone,
  ChevronDown,
  PanelTopClose,
} from 'lucide-react';
import type { ToolState, CADMesh, ViewMode, CADScene, EditMode, WorkspaceMode, HeaderWorkspace, RigMode } from '../types/cad';
import {
  exportToOBJ, exportToSTL, exportToGLTF, exportToBlockbench,
  exportProjectJSON, downloadFile
} from '../utils/exporters';
import { APP_FULL, APP_NAME, APP_YEAR, PROJECT_EXT, PROJECT_EXT_LEGACY } from '../brand';
import { BrandMark } from './BrandMark';

type MenuId = 'file' | 'edit' | 'mesh' | 'skeleton' | 'window' | 'help' | null;

type MenuItem =
  | {
      type: 'item';
      label: string;
      shortcut?: string;
      disabled?: boolean;
      danger?: boolean;
      active?: boolean;
      icon?: React.ReactNode;
      onClick: () => void;
    }
  | { type: 'sep' };

interface HeaderProps {
  toolState: ToolState;
  setToolState: React.Dispatch<React.SetStateAction<ToolState>>;
  mesh: CADMesh;
  setMesh: (mesh: CADMesh) => void;
  scenes: CADScene[];
  activeSceneId: string;
  setActiveSceneId: (id: string) => void;
  onAddScene: () => void;
  onRenameScene: (id: string, newName: string) => void;
  onDeleteScene: (id: string) => void;
  activeWorkspaceMode: WorkspaceMode;
  setActiveWorkspaceMode: (mode: WorkspaceMode) => void;
  onSelectWorkspace: (workspace: HeaderWorkspace) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onOpenShortcuts: () => void;
  onOpenPresets?: () => void;
  onOpenAssetBrowser?: () => void;
  onOpenImportModal?: () => void;
  onOpenSpriteSheetModal: () => void;
  onNewModel: () => void;
  onLoadJSON: (jsonStr: string) => void;
  /** Open mesh / project files (binary-safe). Prefer this over onLoadJSON for .glb/.stl. */
  onOpenFile?: (file: File) => void;
  onToggleSelectAll?: () => void;
  onDeselectAll?: () => void;
  onExportGLB?: () => void;
  onEnterRigMode?: (mode: RigMode) => void;
  uvSplitOpen: boolean;
  isToolWindowOpen?: boolean;
  onToggleToolWindow?: () => void;
  isPaletteOpen?: boolean;
  onTogglePalette?: () => void;
  isOutlinerOpen?: boolean;
  onToggleOutliner?: () => void;
}

function MenuDropdown({
  id,
  label,
  openMenu,
  setOpenMenu,
  items,
  accent,
}: {
  id: Exclude<MenuId, null>;
  label: string;
  openMenu: MenuId;
  setOpenMenu: (id: MenuId) => void;
  items: MenuItem[];
  accent?: boolean;
}) {
  const open = openMenu === id;
  const btnRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  useEffect(() => {
    if (!open || !btnRef.current) return;
    const place = () => {
      const rect = btnRef.current!.getBoundingClientRect();
      setMenuPos({ top: rect.bottom + 2, left: rect.left });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  return (
    <div
      className="relative"
      onMouseEnter={() => {
        if (openMenu) setOpenMenu(id);
      }}
    >
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpenMenu(open ? null : id)}
        className={`px-2 py-0.5 text-[11px] transition ${
          open ? 'bg-[#4d4d4d] text-white' : accent ? 'text-[#ed7300] hover:bg-[#404040]' : 'text-[#cccccc] hover:bg-[#404040] hover:text-white'
        }`}
      >
        {label}
      </button>
      {open &&
        createPortal(
          <div
            className="fixed z-[100000] min-w-[220px] py-0 adobe-menu"
            style={{ top: menuPos.top, left: menuPos.left }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {items.map((item, i) =>
              item.type === 'sep' ? (
                <div key={`sep-${i}`} className="sp-sep-h my-0.5" />
              ) : (
                <button
                  key={`${item.label}-${i}`}
                  type="button"
                  disabled={item.disabled}
                  onClick={() => {
                    if (item.disabled) return;
                    item.onClick();
                    setOpenMenu(null);
                  }}
                  className={`w-full px-3 py-1.5 flex items-center justify-between gap-6 text-left text-[11px] transition ${
                    item.disabled
                      ? 'text-[#6e6e6e] cursor-not-allowed'
                      : item.danger
                        ? 'text-[#ec5b62] hover:bg-[#3a3a3a]'
                        : 'text-[#cccccc] hover:bg-[#ed7300] hover:text-white'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    {item.icon}
                    {item.label}
                  </span>
                  {item.shortcut && <span className="font-mono text-[10px] text-[#8c8c8c]">{item.shortcut}</span>}
                </button>
              )
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

export const Header: React.FC<HeaderProps> = ({
  toolState,
  setToolState,
  mesh,
  scenes,
  activeSceneId,
  setActiveSceneId,
  onAddScene,
  onRenameScene,
  onDeleteScene,
  activeWorkspaceMode,
  setActiveWorkspaceMode,
  onSelectWorkspace,
  undo,
  redo,
  canUndo,
  canRedo,
  onOpenShortcuts,
  onOpenPresets,
  onOpenAssetBrowser,
  onOpenImportModal,
  onOpenSpriteSheetModal,
  onNewModel,
  onLoadJSON,
  onOpenFile,
  onToggleSelectAll,
  onDeselectAll,
  onExportGLB,
  onEnterRigMode,
  uvSplitOpen,
  isToolWindowOpen,
  onToggleToolWindow,
  isPaletteOpen,
  onTogglePalette,
  isOutlinerOpen,
  onToggleOutliner,
}) => {
  const [isRenamingScene, setIsRenamingScene] = useState(false);
  const [sceneNameInput, setSceneNameInput] = useState('');
  const [openMenu, setOpenMenu] = useState<MenuId>(null);
  const [headerCollapsed, setHeaderCollapsed] = useState(false);
  const menuBarRef = useRef<HTMLDivElement>(null);
  const headerShellRef = useRef<HTMLDivElement>(null);

  const activeScene = scenes.find((s) => s.id === activeSceneId) || scenes[0];

  useEffect(() => {
    const onDocDown = (e: MouseEvent) => {
      const root = headerShellRef.current;
      if (!root?.contains(e.target as Node)) setOpenMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(null);
    };
    document.addEventListener('mousedown', onDocDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const handleStartRenameScene = () => {
    if (activeScene) {
      setSceneNameInput(activeScene.name);
      setIsRenamingScene(true);
    }
  };

  const handleSaveRenameScene = () => {
    if (sceneNameInput.trim() && activeScene) {
      onRenameScene(activeScene.id, sceneNameInput.trim());
    }
    setIsRenamingScene(false);
  };

  const handleExportOBJ = () => {
    const { obj, mtl } = exportToOBJ(mesh);
    downloadFile(`${mesh.name.toLowerCase().replace(/\s+/g, '_')}.obj`, obj, 'text/plain');
    downloadFile(`${mesh.name.toLowerCase().replace(/\s+/g, '_')}.mtl`, mtl, 'text/plain');
  };

  const handleExportSTL = () => {
    const stl = exportToSTL(mesh);
    downloadFile(`${mesh.name.toLowerCase().replace(/\s+/g, '_')}.stl`, stl, 'model/stl');
  };

  const handleExportGLTF = () => {
    void (async () => {
      try {
        const gltf = await exportToGLTF(mesh);
        downloadFile(`${mesh.name.toLowerCase().replace(/\s+/g, '_')}.gltf`, gltf, 'model/gltf+json');
      } catch (err) {
        console.error('glTF export failed:', err);
      }
    })();
  };

  const handleExportBlockbench = () => {
    const bb = exportToBlockbench(mesh);
    downloadFile(`${mesh.name.toLowerCase().replace(/\s+/g, '_')}.bbmodel`, bb, 'application/json');
  };

  const handleExportJSON = () => {
    const jsonStr = exportProjectJSON(mesh);
    downloadFile(`${mesh.name.toLowerCase().replace(/\s+/g, '_')}${PROJECT_EXT}`, jsonStr, 'application/json');
  };

  const handleOpenFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = [
      PROJECT_EXT,
      PROJECT_EXT_LEGACY,
      '.json',
      '.obj',
      '.stl',
      '.ply',
      '.gltf',
      '.glb',
      '.bbmodel',
    ].join(',');
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      if (onOpenFile) {
        onOpenFile(file);
        return;
      }
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          onLoadJSON(event.target.result as string);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const setEditMode = (editMode: EditMode) => {
    setToolState((s) => ({
      ...s,
      editMode,
      isPainting3D: false,
      // Leaving bone/rig edit should drop the forced skeleton overlay.
      ...(editMode !== 'bone' && (s.editMode === 'bone' || activeWorkspaceMode === 'rigging')
        ? { showBones: false }
        : editMode === 'bone'
          ? { showBones: true }
          : {}),
    }));
    setActiveWorkspaceMode(editMode === 'bone' ? 'rigging' : 'modeling');
  };

  const viewModes: { id: ViewMode; label: string }[] = [
    { id: 'lit', label: 'Lit PBR' },
    { id: 'textured', label: 'Textured' },
    { id: 'flat', label: 'Flat' },
    { id: 'polygon-wire', label: 'Poly Wire' },
    { id: 'wireframe', label: 'Tri Wire' },
  ];

  const fileMenu: MenuItem[] = [
    { type: 'item', label: 'New Model', shortcut: 'Ctrl+N', onClick: onNewModel },
    { type: 'item', label: 'Open Project…', shortcut: 'Ctrl+O', onClick: handleOpenFile },
    { type: 'item', label: 'Import 3D Model (.obj, .stl, .ply, .gltf, .glb)…', shortcut: 'Ctrl+I', onClick: onOpenImportModal || handleOpenFile },
    { type: 'sep' },
    { type: 'item', label: `Save Project (${PROJECT_EXT})`, shortcut: 'Ctrl+S', onClick: handleExportJSON },
    { type: 'item', label: 'Export OBJ + MTL (Blender/Unity)…', onClick: handleExportOBJ },
    { type: 'item', label: 'Export GLB (rigged + animations)…', onClick: () => onExportGLB?.() },
    { type: 'item', label: 'Export glTF 2.0 (.gltf)…', onClick: handleExportGLTF },
    { type: 'item', label: 'Export 3D Printing STL (.stl)…', onClick: handleExportSTL },
    { type: 'item', label: 'Export Blockbench Model (.bbmodel)…', onClick: handleExportBlockbench },
    { type: 'item', label: 'Render Sprite Sheet…', onClick: onOpenSpriteSheetModal },
    { type: 'sep' },
    { type: 'item', label: '3D Asset Browser…', onClick: onOpenAssetBrowser || onOpenPresets },
  ];

  const editMenu: MenuItem[] = [
    { type: 'item', label: 'Undo', shortcut: 'Ctrl+Z', disabled: !canUndo, onClick: undo },
    { type: 'item', label: 'Redo', shortcut: 'Ctrl+Y', disabled: !canRedo, onClick: redo },
    { type: 'sep' },
    {
      type: 'item',
      label: 'Select / Deselect All',
      shortcut: 'A',
      onClick: () => onToggleSelectAll?.(),
    },
    {
      type: 'item',
      label: 'Deselect All',
      shortcut: 'Alt+A',
      onClick: () => onDeselectAll?.(),
    },
    { type: 'sep' },
    {
      type: 'item',
      label: 'Toggle Grid Snap',
      onClick: () => setToolState((s) => ({ ...s, gridSnap: s.gridSnap === 0 ? 0.25 : 0 })),
    },
    {
      type: 'item',
      label: toolState.showTriangulation ? 'Hide Triangulation Debug' : 'Show Triangulation Debug',
      onClick: () => setToolState((s) => ({ ...s, showTriangulation: !s.showTriangulation })),
    },
  ];

  const meshMenu: MenuItem[] = [
    { type: 'item', label: 'Object Mode', shortcut: '1', onClick: () => setEditMode('object') },
    { type: 'item', label: 'Vertex Mode', shortcut: '2', onClick: () => setEditMode('vertex') },
    { type: 'item', label: 'Edge Mode', shortcut: '3', onClick: () => setEditMode('edge') },
    { type: 'item', label: 'Face Mode', shortcut: '4', onClick: () => setEditMode('face') },
    { type: 'sep' },
    {
      type: 'item',
      label: 'Move Tool',
      shortcut: 'G',
      onClick: () => setToolState((s) => ({ ...s, transformMode: 'move' })),
    },
    {
      type: 'item',
      label: 'Rotate Tool',
      shortcut: 'R',
      onClick: () => setToolState((s) => ({ ...s, transformMode: 'rotate' })),
    },
    {
      type: 'item',
      label: 'Scale Tool',
      shortcut: 'S',
      onClick: () => setToolState((s) => ({ ...s, transformMode: 'scale' })),
    },
    { type: 'sep' },
    { type: 'item', label: 'Add Primitive…', onClick: onOpenAssetBrowser || onOpenPresets },
  ];

  const skeletonMenu: MenuItem[] = [
    { type: 'item', label: 'Easy Rig Workspace', onClick: () => onSelectWorkspace('rig') },
    { type: 'sep' },
    { type: 'item', label: 'Bone Edit Mode', shortcut: '5', onClick: () => (onEnterRigMode ? onEnterRigMode('edit') : setEditMode('bone')) },
    { type: 'item', label: 'Pose Mode', onClick: () => onEnterRigMode?.('pose') },
    { type: 'item', label: 'Weight Paint (Skin)', onClick: () => onEnterRigMode?.('skin') },
    { type: 'sep' },
    {
      type: 'item',
      label: 'Open Rig Panel',
      onClick: () => onEnterRigMode?.(toolState.rigMode || 'edit'),
    },
    {
      type: 'item',
      label: 'Open Animation Workspace',
      onClick: () => onSelectWorkspace('animation'),
    },
  ];

  const windowMenu: MenuItem[] = [
    { type: 'item', label: 'Modeling Workspace', onClick: () => onSelectWorkspace('modeling') },
    { type: 'item', label: 'Paint Workspace', onClick: () => onSelectWorkspace('paint') },
    { type: 'item', label: 'Easy Rig Workspace', onClick: () => onSelectWorkspace('rig') },
    { type: 'item', label: 'Animation Workspace', onClick: () => onSelectWorkspace('animation') },
    { type: 'sep' },
    {
      type: 'item',
      label: isOutlinerOpen ? 'Hide Floating Outliner' : 'Floating Outliner',
      shortcut: 'O',
      active: !!isOutlinerOpen,
      onClick: () => onToggleOutliner?.(),
    },
    {
      type: 'item',
      label: toolState.viewportLayout === 'single' ? 'Quad Viewport' : 'Single Viewport',
      shortcut: 'Ctrl+Alt+Q',
      onClick: () => {
        onSelectWorkspace('modeling');
        setToolState((s) => ({
          ...s,
          viewportLayout: s.viewportLayout === 'single' ? 'quad' : 'single',
        }));
      },
    },
    ...viewModes.map(
      (mode): MenuItem => ({
        type: 'item',
        label: `View: ${mode.label}${toolState.viewMode === mode.id ? ' ✓' : ''}`,
        onClick: () => setToolState((s) => ({ ...s, viewMode: mode.id })),
      })
    ),
  ];

  const helpMenu: MenuItem[] = [
    { type: 'item', label: 'Keyboard Shortcuts…', shortcut: '?', onClick: onOpenShortcuts },
    { type: 'item', label: 'Primitive Presets…', onClick: onOpenAssetBrowser || onOpenPresets },
  ];

  return (
    <div
      ref={headerShellRef}
      className="relative sp-menubar select-none z-[5000] font-sans text-[#cccccc]"
    >
      {headerCollapsed ? (
        <div className="h-6 px-2 flex items-center gap-2 bg-[#333333]">
          <BrandMark size={16} className="shrink-0 shadow-sm" />
          <span className="text-[10px] text-[#8c8c8c] font-mono truncate">{APP_FULL}</span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setHeaderCollapsed(false)}
            className="h-5 px-1.5 rounded border border-[#4d4d4d] bg-[#262626] text-[#8c8c8c] hover:text-white hover:border-[#ed7300] flex items-center gap-1 text-[9px] font-mono"
            title="Show header"
          >
            <ChevronDown className="w-3 h-3" />
            Show
          </button>
        </div>
      ) : (
        <div className="h-9 px-2 flex items-center gap-1.5 bg-[#333333] overflow-x-auto overflow-y-visible custom-scrollbar">
          {/* Brand + menus */}
          <div className="flex items-center gap-1.5 shrink-0">
            <BrandMark size={20} className="shrink-0 shadow-md" />
            <span className="font-semibold text-[11px] text-[#e8e8e8] whitespace-nowrap hidden md:inline">
              {APP_NAME} <span className="text-[9px] text-[#8c8c8c] font-mono">{APP_YEAR}</span>
            </span>
            <div className="sp-sep-v h-3.5 mx-0.5 self-center" />
            <div ref={menuBarRef} className="flex items-center gap-0.5 text-[11px]">
              <MenuDropdown id="file" label="File" openMenu={openMenu} setOpenMenu={setOpenMenu} items={fileMenu} />
              <MenuDropdown id="edit" label="Edit" openMenu={openMenu} setOpenMenu={setOpenMenu} items={editMenu} />
              <MenuDropdown id="mesh" label="Mesh" openMenu={openMenu} setOpenMenu={setOpenMenu} items={meshMenu} />
              <MenuDropdown id="skeleton" label="Skeleton" openMenu={openMenu} setOpenMenu={setOpenMenu} items={skeletonMenu} />
              <MenuDropdown id="window" label="Window" openMenu={openMenu} setOpenMenu={setOpenMenu} items={windowMenu} />
              <MenuDropdown id="help" label="Help" openMenu={openMenu} setOpenMenu={setOpenMenu} items={helpMenu} accent />
            </div>
          </div>

          <div className="sp-sep-v h-4 shrink-0 self-center" />

          {/* Workspaces */}
          <div className="sp-workspace-seg shrink-0">
            <button
              type="button"
              onClick={() => onSelectWorkspace('modeling')}
              className={
                activeWorkspaceMode === 'modeling' && !toolState.isPainting3D && !uvSplitOpen
                  ? 'is-active'
                  : ''
              }
            >
              Model
            </button>
            <button
              type="button"
              onClick={() => onSelectWorkspace('paint')}
              className={`inline-flex items-center gap-0.5 ${activeWorkspaceMode === 'paint' ? 'is-active' : ''}`}
              title="Paint"
            >
              <Palette className="w-3 h-3" />
              <span className="hidden lg:inline">Paint</span>
            </button>
            <button
              type="button"
              onClick={() => onSelectWorkspace('brush')}
              className={`inline-flex items-center gap-0.5 ${
                toolState.isPainting3D && activeWorkspaceMode === 'modeling' && !uvSplitOpen ? 'is-active' : ''
              }`}
              title="3D Brush (B)"
            >
              <Paintbrush className="w-3 h-3" />
              <span className="hidden lg:inline">Brush</span>
            </button>
            <button
              type="button"
              onClick={() => onSelectWorkspace('rig')}
              className={`inline-flex items-center gap-0.5 ${activeWorkspaceMode === 'rigging' ? 'is-active' : ''}`}
              title="Easy Rig & Skin"
            >
              <Bone className="w-3 h-3" />
              <span className="hidden lg:inline">Rig</span>
            </button>
            <button
              type="button"
              onClick={() => onSelectWorkspace('animation')}
              className={`inline-flex items-center gap-0.5 ${activeWorkspaceMode === 'animation' ? 'is-active' : ''}`}
              title="Animation"
            >
              <Film className="w-3 h-3" />
              <span className="hidden lg:inline">Anim</span>
            </button>
            <button
              type="button"
              onClick={() => onSelectWorkspace('uv')}
              className={`inline-flex items-center gap-0.5 ${uvSplitOpen ? 'is-active' : ''}`}
              title="UV Editor"
            >
              <Columns2 className="w-3 h-3" />
              <span className="hidden lg:inline">UV</span>
            </button>
          </div>

          {/* Scene */}
          <div className="flex items-center gap-1 bg-[#262626] px-1.5 py-0.5 rounded border border-[#1a1a1a] shrink-0 min-w-0">
            <Layers className="w-3 h-3 text-[#e68619] shrink-0" />
            {isRenamingScene ? (
              <input
                type="text"
                value={sceneNameInput}
                onChange={(e) => setSceneNameInput(e.target.value)}
                onBlur={handleSaveRenameScene}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveRenameScene()}
                autoFocus
                className="cad-input px-1 py-0 text-[10px] text-[#e68619] outline-none w-24 font-mono"
              />
            ) : (
              <select
                value={activeSceneId}
                onChange={(e) => setActiveSceneId(e.target.value)}
                className="bg-transparent font-mono text-[10px] text-[#e68619] font-bold outline-none cursor-pointer max-w-[140px]"
              >
                {scenes.map((scene: CADScene) => (
                  <option key={scene.id} value={scene.id} className="bg-[#262626] text-[#e68619]">
                    {scene.name} ({scene.meshes.length})
                  </option>
                ))}
              </select>
            )}
            <button type="button" onClick={handleStartRenameScene} className="p-0.5 text-[#8c8c8c] hover:text-white" title="Rename Scene">
              <Edit2 className="w-3 h-3" />
            </button>
            <button type="button" onClick={onAddScene} className="p-0.5 text-[#ed7300] hover:text-white" title="Add Scene">
              <Plus className="w-3 h-3" />
            </button>
            {scenes.length > 1 && (
              <button type="button" onClick={() => onDeleteScene(activeSceneId)} className="p-0.5 text-[#ec5b62]" title="Delete Scene">
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>

          <div className="flex-1 min-w-2" />

          {/* History */}
          <div className="flex items-center gap-0.5 bg-[#262626] p-0.5 rounded border border-[#1a1a1a] shrink-0">
            <button type="button" onClick={undo} disabled={!canUndo} className={`p-1 rounded hover:bg-[#404040] ${!canUndo && 'opacity-30'}`} title="Undo">
              <RotateCcw className="w-3 h-3" />
            </button>
            <button type="button" onClick={redo} disabled={!canRedo} className={`p-1 rounded hover:bg-[#404040] ${!canRedo && 'opacity-30'}`} title="Redo">
              <RotateCw className="w-3 h-3" />
            </button>
          </div>

          {/* Viewport layout */}
          <div className="flex items-center gap-0.5 bg-[#262626] p-0.5 rounded border border-[#1a1a1a] font-mono text-[10px] shrink-0">
            <button
              type="button"
              onClick={() => setToolState((s) => ({ ...s, viewportLayout: 'single' }))}
              className={`px-1.5 py-0.5 rounded flex items-center gap-0.5 ${
                toolState.viewportLayout === 'single' ? 'bg-[#ed7300] text-white font-bold' : 'text-[#888] hover:text-white'
              }`}
              title="Single view"
            >
              <Square className="w-3 h-3" />
              1
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveWorkspaceMode('modeling');
                setToolState((s) => ({
                  ...s,
                  viewportLayout: 'quad',
                  ...(activeWorkspaceMode === 'rigging' || s.editMode === 'bone'
                    ? { editMode: 'object' as const, showBones: false }
                    : {}),
                }));
              }}
              className={`px-1.5 py-0.5 rounded flex items-center gap-0.5 ${
                toolState.viewportLayout === 'quad' ? 'bg-[#ed7300] text-white font-bold' : 'text-[#888] hover:text-white'
              }`}
              title="Quad view"
            >
              <LayoutGrid className="w-3 h-3" />
              Quad
            </button>
          </div>

          {/* Shading */}
          <div className="flex items-center gap-1 bg-[#262626] px-1.5 py-0.5 rounded border border-[#1a1a1a] font-mono text-[10px] shrink-0">
            <Eye className="w-3 h-3 text-[#ed7300]" />
            <select
              value={toolState.viewMode}
              onChange={(e) => setToolState((s) => ({ ...s, viewMode: e.target.value as ViewMode }))}
              className="bg-transparent font-mono text-[10px] text-[#e8e8e8] font-bold outline-none cursor-pointer max-w-[88px]"
            >
              {viewModes.map((mode) => (
                <option key={mode.id} value={mode.id} className="bg-[#262626] text-white">
                  {mode.label}
                </option>
              ))}
            </select>
          </div>

          {/* Quick docks — icon buttons */}
          <div className="flex items-center gap-0.5 bg-[#262626] p-0.5 rounded border border-[#1a1a1a] shrink-0">
            {onToggleOutliner && (
              <button
                type="button"
                onClick={onToggleOutliner}
                className={`p-1 rounded ${isOutlinerOpen ? 'bg-[#ed7300] text-white' : 'text-[#8c8c8c] hover:text-white'}`}
                title="Floating Outliner (O)"
              >
                <Layers className="w-3 h-3" />
              </button>
            )}
            {onToggleToolWindow && (
              <button
                type="button"
                onClick={onToggleToolWindow}
                className={`p-1 rounded ${isToolWindowOpen ? 'bg-[#ff9a3c] text-white' : 'text-[#8c8c8c] hover:text-white'}`}
                title="Tool Palette (Shift+T)"
              >
                <Sparkles className="w-3 h-3" />
              </button>
            )}
            {onTogglePalette && (
              <button
                type="button"
                onClick={onTogglePalette}
                className={`p-1 rounded ${isPaletteOpen ? 'bg-[#ed7300] text-white' : 'text-[#8c8c8c] hover:text-white'}`}
                title="Primitives"
              >
                <Box className="w-3 h-3" />
              </button>
            )}
            <button
              type="button"
              onClick={onOpenAssetBrowser || onOpenPresets}
              className="p-1 rounded text-[#e68619] hover:bg-[#404040]"
              title="3D Assets"
            >
              <Layers className="w-3 h-3" />
            </button>
            {onOpenImportModal && (
              <button
                type="button"
                onClick={onOpenImportModal}
                className="p-1 rounded text-[#8c8c8c] hover:text-white hover:bg-[#404040]"
                title="Import 3D (Ctrl+I)"
              >
                <Upload className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Collapse / help */}
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              onClick={onOpenShortcuts}
              className="p-1 hover:bg-[#404040] text-[#8c8c8c] hover:text-[#ed7300] rounded"
              title="Shortcuts (?)"
            >
              <HelpCircle className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={() => setHeaderCollapsed(true)}
              className="h-6 px-1.5 rounded border border-[#4d4d4d] bg-[#262626] text-[#8c8c8c] hover:text-white hover:border-[#ed7300] flex items-center gap-1 text-[9px] font-mono"
              title="Hide header to free vertical space"
            >
              <PanelTopClose className="w-3.5 h-3.5" />
              Hide
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
