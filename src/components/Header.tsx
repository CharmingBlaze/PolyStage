import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ToolState, CADMesh, ViewMode, CADScene, EditMode, WorkspaceMode, HeaderWorkspace, RigMode } from '../types/cad';
import {
  exportToOBJ, exportToSTL, exportToGLTF, exportToBlockbench,
  exportProjectJSON, downloadFile
} from '../utils/exporters';
import { APP_NAME, PROJECT_EXT, PROJECT_EXT_LEGACY } from '../brand';
import { BrandMark } from './BrandMark';
import { BlenderIcon } from './icons/BlenderIcon';

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
      /** Omitted when the host app did not wire the action; the item renders disabled. */
      onClick?: () => void;
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
  onSaveProject?: () => void;
  documentDirty?: boolean;
  onRecoverSession?: () => void;
  recoverAvailable?: boolean;
  onEnterRigMode?: (mode: RigMode) => void;
  uvSplitOpen: boolean;
  isToolWindowOpen?: boolean;
  onToggleToolWindow?: () => void;
  isPaletteOpen?: boolean;
  onTogglePalette?: () => void;
  isOutlinerOpen?: boolean;
  onToggleOutliner?: () => void;
  isToolbarOpen?: boolean;
  onToggleToolbar?: () => void;
  isToolbarFloating?: boolean;
  onToggleToolbarFloat?: () => void;
  materialControls?: React.ReactNode;
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
      data-menu-id={id}
      className="relative"
      onMouseEnter={() => {
        if (openMenu) setOpenMenu(id);
      }}
    >
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpenMenu(open ? null : id)}
        className={`px-2 py-0.5 text-[11px] rounded-[6px] transition ${
          open ? 'bg-[var(--ts-surface)] text-[var(--ts-text-hi)]' : accent ? 'text-[var(--ts-accent)] hover:bg-[var(--ts-hover)]' : 'text-[var(--ts-text)] hover:bg-[var(--ts-hover)] hover:text-[var(--ts-text-hi)]'
        }`}
      >
        {label}
      </button>
      {open &&
        createPortal(
          <div
            className="fixed z-[9999] min-w-[220px] py-0 adobe-menu"
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
                  disabled={item.disabled || !item.onClick}
                  onClick={() => {
                    if (item.disabled || !item.onClick) return;
                    item.onClick();
                    setOpenMenu(null);
                  }}
                  className={`adobe-menu-item ${
                    item.disabled || !item.onClick
                      ? ''
                      : item.danger
                        ? 'is-danger'
                        : item.active
                          ? 'is-on'
                          : ''
                  }`}
                >
                  <span className="flex items-center gap-2">
                    {item.icon}
                    {item.label}
                  </span>
                  {item.shortcut && <span className="font-mono text-[10px] text-[var(--ts-text-muted)]">{item.shortcut}</span>}
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
  onSaveProject,
  documentDirty = false,
  onRecoverSession,
  recoverAvailable = false,
  onEnterRigMode,
  uvSplitOpen,
  isToolWindowOpen,
  onToggleToolWindow,
  isPaletteOpen,
  onTogglePalette,
  isOutlinerOpen,
  onToggleOutliner,
  isToolbarOpen = true,
  onToggleToolbar,
  isToolbarFloating = false,
  onToggleToolbarFloat,
  materialControls,
}) => {
  const [isRenamingScene, setIsRenamingScene] = useState(false);
  const [sceneNameInput, setSceneNameInput] = useState('');
  const [openMenu, setOpenMenu] = useState<MenuId>(null);
  const [isViewOpen, setIsViewOpen] = useState(false);
  const viewBtnRef = useRef<HTMLButtonElement>(null);
  const viewMenuRef = useRef<HTMLDivElement>(null);
  const [viewPos, setViewPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const [headerCollapsed, setHeaderCollapsed] = useState(false);
  const menuBarRef = useRef<HTMLDivElement>(null);
  const headerShellRef = useRef<HTMLDivElement>(null);

  const activeScene = scenes.find((s) => s.id === activeSceneId) || scenes[0];

  useEffect(() => {
    if (!isViewOpen || !viewBtnRef.current) return;
    const place = () => {
      const rect = viewBtnRef.current!.getBoundingClientRect();
      setViewPos({
        top: rect.bottom + 4,
        right: Math.max(8, window.innerWidth - rect.right),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [isViewOpen]);

  useEffect(() => {
    const onDocDown = (e: MouseEvent) => {
      const root = headerShellRef.current;
      const viewMenu = viewMenuRef.current;
      const target = e.target as Node;
      if (!root?.contains(target)) {
        setOpenMenu(null);
      }
      if (!viewBtnRef.current?.contains(target) && !viewMenu?.contains(target)) {
        setIsViewOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenMenu(null);
        setIsViewOpen(false);
      }
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
    if (onSaveProject) {
      onSaveProject();
      return;
    }
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
    { type: 'item', label: `Save Project (${PROJECT_EXT})${documentDirty ? ' •' : ''}`, shortcut: 'Ctrl+S', onClick: handleExportJSON },
    { type: 'item', label: 'Restore Last Session', disabled: !recoverAvailable, onClick: onRecoverSession },
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
      label: 'Transform Gizmo',
      shortcut: 'T',
      onClick: () => setToolState((s) => ({ ...s, transformMode: 'combined' })),
    },
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
    {
      type: 'item',
      label: 'Pivot Tool',
      shortcut: '.',
      onClick: () => setToolState((s) => ({ ...s, transformMode: 'pivot' })),
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
    { type: 'item', label: 'Blockout Workspace', onClick: () => onSelectWorkspace('blockout') },
    { type: 'item', label: 'Paint Workspace', onClick: () => onSelectWorkspace('paint') },
    { type: 'item', label: 'Easy Rig Workspace', onClick: () => onSelectWorkspace('rig') },
    { type: 'item', label: 'Animation Workspace', onClick: () => onSelectWorkspace('animation') },
    { type: 'sep' },
    {
      type: 'item',
      label: isToolbarOpen ? 'Hide Toolbar' : 'Show Toolbar',
      onClick: () => onToggleToolbar?.(),
    },
    {
      type: 'item',
      label: isToolbarFloating ? 'Dock Toolbar' : 'Float Toolbar',
      onClick: () => onToggleToolbarFloat?.(),
    },
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
    {
      type: 'item',
      label: `X-Ray${toolState.xray ? ' ✓' : ''}`,
      shortcut: 'Alt+Z',
      active: !!toolState.xray,
      onClick: () => setToolState((s) => ({ ...s, xray: !s.xray })),
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
      className="relative sp-menubar select-none font-sans text-[var(--ts-text)]"
    >
      {headerCollapsed ? (
        <div className="h-6 px-2 flex items-center gap-2 bg-[var(--ts-panel)]">
          <BrandMark size={16} className="shrink-0" />
          <span className="sp-wordmark truncate">{APP_NAME}</span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setHeaderCollapsed(false)}
            className="h-6 px-1.5 rounded-[6px] border border-[var(--ts-border-hi)] bg-[var(--ts-app)] text-[var(--ts-text-muted)] hover:text-[var(--ts-text-hi)] hover:border-[var(--ts-active-border)] flex items-center gap-1 text-[11px]"
            title="Show header"
            aria-label="Show header"
          >
            <BlenderIcon name="show" size={12} />
            Show
          </button>
        </div>
      ) : (
        <div className="sp-header-main h-10 px-2 grid grid-cols-[minmax(0,1fr)_auto_auto_minmax(0,1fr)] items-center gap-2 bg-[var(--ts-panel)]">
          {/* Brand + menus */}
          <div className="sp-header-left flex items-center gap-1.5 min-w-0">
            <BrandMark size={24} className="shrink-0" />
            <span className="sp-wordmark hidden md:inline">
              <span className="sp-wordmark__poly">Poly</span>
              <span className="sp-wordmark__stage">Stage</span>
            </span>
            <div className="sp-sep-v h-3.5 mx-0.5 self-center" />
            <div ref={menuBarRef} className="flex items-center gap-0.5 text-[11px]">
              <MenuDropdown id="file" label="File" openMenu={openMenu} setOpenMenu={setOpenMenu} items={fileMenu} />
              <MenuDropdown id="edit" label="Edit" openMenu={openMenu} setOpenMenu={setOpenMenu} items={editMenu} />
              <MenuDropdown id="mesh" label="Mesh" openMenu={openMenu} setOpenMenu={setOpenMenu} items={meshMenu} />
              <MenuDropdown id="skeleton" label="Skeleton" openMenu={openMenu} setOpenMenu={setOpenMenu} items={skeletonMenu} />
              <MenuDropdown id="window" label="Window" openMenu={openMenu} setOpenMenu={setOpenMenu} items={windowMenu} />
              <MenuDropdown id="help" label="Help" openMenu={openMenu} setOpenMenu={setOpenMenu} items={helpMenu} />
            </div>
          </div>

          <nav className="sp-workspace-seg justify-self-center" aria-label="Workspaces">
            <button
              type="button"
              onClick={() => onSelectWorkspace('modeling')}
              className={
                activeWorkspaceMode === 'modeling' && !toolState.isPainting3D && !uvSplitOpen
                  ? 'is-active'
                  : ''
              }
              title="Model workspace"
              aria-label="Model workspace"
              aria-pressed={activeWorkspaceMode === 'modeling' && !toolState.isPainting3D && !uvSplitOpen}
            >
              <BlenderIcon name="object" size={13} />
              <span className="sp-workspace-label-full">Model</span>
              <span className="sp-workspace-label-short">Model</span>
            </button>
            <button
              type="button"
              onClick={() => onSelectWorkspace('blockout')}
              className={activeWorkspaceMode === 'blockout' ? 'is-active' : ''}
              title="Vector Blockout"
              aria-label="Blockout workspace"
            >
              <BlenderIcon name="blockout" size={13} />
              <span className="sp-workspace-label-full">Blockout</span>
              <span className="sp-workspace-label-short">Block</span>
            </button>
            <button
              type="button"
              onClick={() => onSelectWorkspace('paint')}
              className={activeWorkspaceMode === 'paint' ? 'is-active' : ''}
              title="Paint"
              aria-label="Paint workspace"
            >
              <BlenderIcon name="brush" size={13} />
              <span className="sp-workspace-label-full">Paint</span>
              <span className="sp-workspace-label-short">Paint</span>
            </button>
            <button
              type="button"
              onClick={() => onSelectWorkspace('brush')}
              className={
                toolState.isPainting3D && activeWorkspaceMode === 'modeling' && !uvSplitOpen ? 'is-active' : ''
              }
              title="3D Brush (B)"
              aria-label="3D brush"
            >
              <BlenderIcon name="settings" size={13} />
              <span className="sp-workspace-label-full">Brush</span>
              <span className="sp-workspace-label-short">Brush</span>
            </button>
            <button
              type="button"
              onClick={() => onSelectWorkspace('rig')}
              className={activeWorkspaceMode === 'rigging' ? 'is-active' : ''}
              title="Rig and Skin"
              aria-label="Rig workspace"
            >
              <BlenderIcon name="bone" size={13} />
              <span className="sp-workspace-label-full">Rig</span>
              <span className="sp-workspace-label-short">Rig</span>
            </button>
            <button
              type="button"
              onClick={() => onSelectWorkspace('animation')}
              className={activeWorkspaceMode === 'animation' ? 'is-active' : ''}
              title="Animation"
              aria-label="Animation workspace"
            >
              <BlenderIcon name="anim" size={13} />
              <span className="sp-workspace-label-full">Animate</span>
              <span className="sp-workspace-label-short">Anim</span>
            </button>
            <button
              type="button"
              onClick={() => onSelectWorkspace('uv')}
              className={uvSplitOpen ? 'is-active' : ''}
              title="UV Editor"
              aria-label="UV workspace"
            >
              <BlenderIcon name="uv" size={13} />
              <span className="sp-workspace-label-full">UV</span>
              <span className="sp-workspace-label-short">UV</span>
            </button>
          </nav>

          {materialControls && (
            <div className="sp-header-material-inline" aria-label="Material topbar">
              {materialControls}
            </div>
          )}

          <div className="sp-header-right flex items-center justify-end gap-1.5 min-w-0">
          {/* Scene */}
          <div className="ts-chip shrink-0 min-w-0">
            <BlenderIcon name="scene" size={12} className="text-[var(--ts-accent)] shrink-0" />
            {isRenamingScene ? (
              <input
                type="text"
                value={sceneNameInput}
                onChange={(e) => setSceneNameInput(e.target.value)}
                onBlur={handleSaveRenameScene}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveRenameScene()}
                autoFocus
                className="cad-input px-1 py-0 text-[11px] text-[var(--ts-accent)] outline-none w-24 font-mono"
              />
            ) : (
              <select
                value={activeSceneId}
                onChange={(e) => setActiveSceneId(e.target.value)}
                className="bg-transparent font-mono text-[11px] text-[var(--ts-accent)] font-semibold outline-none cursor-pointer max-w-[140px]"
              >
                {scenes.map((scene: CADScene) => (
                  <option key={scene.id} value={scene.id} className="bg-[var(--ts-app)] text-[var(--ts-accent)]">
                    {scene.name} ({scene.meshes.length})
                  </option>
                ))}
              </select>
            )}
            <button type="button" onClick={handleStartRenameScene} className="ts-chrome-btn" title="Rename Scene" aria-label="Rename scene">
              <BlenderIcon name="rename" size={12} />
            </button>
            <button type="button" onClick={onAddScene} className="ts-chrome-btn text-[var(--ts-accent)]" title="Add Scene" aria-label="Add scene">
              <BlenderIcon name="add" size={12} />
            </button>
            {scenes.length > 1 && (
              <button type="button" onClick={() => onDeleteScene(activeSceneId)} className="ts-chrome-btn text-[var(--ts-danger)]" title="Delete Scene" aria-label="Delete scene">
                <BlenderIcon name="trash" size={12} />
              </button>
            )}
          </div>

          {/* History */}
          <div className="ts-chip shrink-0 p-0.5">
            <button type="button" onClick={undo} disabled={!canUndo} className={`ts-chrome-btn ${!canUndo && 'opacity-30'}`} title="Undo" aria-label="Undo">
              <BlenderIcon name="undo" size={12} />
            </button>
            <button type="button" onClick={redo} disabled={!canRedo} className={`ts-chrome-btn ${!canRedo && 'opacity-30'}`} title="Redo" aria-label="Redo">
              <BlenderIcon name="redo" size={12} />
            </button>
          </div>

          {/* View and docks stay one click away, not always on the bar. */}
          <div className="relative shrink-0">
            <button
              ref={viewBtnRef}
              type="button"
              onClick={() => {
                setOpenMenu(null);
                setIsViewOpen((prev) => !prev);
              }}
              className={`px-2 py-1 rounded-[6px] border text-[11px] font-semibold uppercase tracking-wide transition ${
                isViewOpen
                  ? 'border-dashed border-[var(--ts-accent)] bg-transparent text-[var(--ts-accent)]'
                  : 'border-[var(--ts-border)] bg-[var(--ts-app)] text-[var(--ts-text-muted)] hover:text-[var(--ts-text-hi)]'
              }`}
            >
              View
            </button>
            {isViewOpen &&
              createPortal(
                <div
                  ref={viewMenuRef}
                  className="fixed z-[9999] min-w-[220px] p-2 adobe-menu flex flex-col gap-2"
                  style={{ top: `${viewPos.top}px`, right: `${viewPos.right}px` }}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => setToolState((s) => ({ ...s, viewportLayout: 'single' }))}
                      className={`flex-1 px-1.5 py-1 rounded-[6px] text-[11.5px] ${
                        toolState.viewportLayout === 'single' ? 'text-[var(--ts-accent)] border border-dashed border-[var(--ts-accent)] bg-transparent' : 'text-[var(--ts-text-muted)] hover:text-[var(--ts-text-hi)]'
                      }`}
                    >
                      Single
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
                      className={`flex-1 px-1.5 py-1 rounded-[6px] text-[11.5px] ${
                        toolState.viewportLayout === 'quad' ? 'text-[var(--ts-accent)] border border-dashed border-[var(--ts-accent)] bg-transparent' : 'text-[var(--ts-text-muted)] hover:text-[var(--ts-text-hi)]'
                      }`}
                    >
                      Quad
                    </button>
                  </div>
                  <label className="flex items-center gap-2 text-[11px] text-[var(--ts-text-muted)]">
                    Shading
                    <select
                      value={toolState.viewMode}
                      onChange={(e) => setToolState((s) => ({ ...s, viewMode: e.target.value as ViewMode }))}
                      className="flex-1 bg-[var(--ts-app)] border border-[var(--ts-border-hi)] rounded-[6px] px-1.5 py-1 text-[var(--ts-text-hi)] outline-none"
                      aria-label="Shading mode"
                    >
                      {viewModes.map((mode) => (
                        <option key={mode.id} value={mode.id}>
                          {mode.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => setToolState((s) => ({ ...s, xray: !s.xray }))}
                    className={`px-1.5 py-1 rounded-[6px] text-[11px] text-left ${
                      toolState.xray ? 'border border-dashed border-[var(--ts-accent)] bg-transparent text-[var(--ts-accent-hi)]' : 'text-[var(--ts-text-muted)] hover:text-[var(--ts-text-hi)]'
                    }`}
                  >
                    X-Ray (Alt+Z)
                  </button>
                  <div className="flex items-center gap-0.5 border-t border-[var(--ts-border)] pt-2">
                    {onToggleOutliner && (
                      <button type="button" onClick={onToggleOutliner} className={`ts-chrome-btn ${isOutlinerOpen ? 'is-on' : ''}`} title="Outliner (O)" aria-label="Toggle outliner">
                        <BlenderIcon name="outliner" size={12} />
                      </button>
                    )}
                    {onToggleToolWindow && (
                      <button type="button" onClick={onToggleToolWindow} className={`ts-chrome-btn ${isToolWindowOpen ? 'is-on' : ''}`} title="Tools (Shift+T)" aria-label="Toggle tools">
                        <BlenderIcon name="tools" size={12} />
                      </button>
                    )}
                    {onTogglePalette && (
                      <button type="button" onClick={onTogglePalette} className={`ts-chrome-btn ${isPaletteOpen ? 'is-on' : ''}`} title="Primitives" aria-label="Toggle primitives">
                        <BlenderIcon name="primitives" size={12} />
                      </button>
                    )}
                    <button type="button" onClick={onOpenAssetBrowser || onOpenPresets} className="ts-chrome-btn" title="3D Assets" aria-label="Open 3D assets">
                      <BlenderIcon name="mesh" size={12} />
                    </button>
                    {onOpenImportModal && (
                      <button type="button" onClick={onOpenImportModal} className="ts-chrome-btn" title="Import 3D (Ctrl+I)" aria-label="Import 3D">
                        <BlenderIcon name="import" size={12} />
                      </button>
                    )}
                  </div>
                </div>,
                document.body,
              )}
          </div>

          <button
            type="button"
            onClick={onOpenShortcuts}
            className="ts-chrome-btn"
            title="Shortcuts (?)"
            aria-label="Keyboard shortcuts"
          >
            <BlenderIcon name="help" size={12} />
          </button>
          <button
            type="button"
            onClick={() => setHeaderCollapsed(true)}
            className="ts-chrome-btn"
            title="Hide header"
            aria-label="Hide header"
          >
            <BlenderIcon name="hide" size={12} />
          </button>
          </div>

        </div>
      )}
    </div>
  );
};

