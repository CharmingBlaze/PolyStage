import React, { useEffect, useState } from 'react';
import {
  Layers,
  Box,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Trash2,
  FolderPlus,
  Folder,
  FolderOpen,
  Plus,
  Bone,
  Link,
  Unlink,
  Search,
  X,
  Edit2,
  Copy,
  CheckSquare,
  SquareDashed,
  ChevronRight,
  ChevronDown,
  FolderMinus,
  Camera,
  Lightbulb,
  Sparkles,
  CloudSun,
} from 'lucide-react';
import type {
  CADMesh,
  SceneGroup,
  CADBone,
  CADCamera,
  CADLight,
  ParticleEmitter,
  EnvironmentSettings,
  SceneSelection,
  WeatherPreset,
} from '../types/cad';
import { generateId } from '../utils/meshUtils';
import { createBone, deleteBoneBranch } from '../utils/rigging';
import { createCamera, createParticleEmitter, createDefaultEnvironment, weatherPresetToEnv } from '../utils/cutsceneEnv';
import { createCADLight } from '../utils/cutsceneLights';

interface OutlinerPanelProps {
  meshes: CADMesh[];
  setMeshes: React.Dispatch<React.SetStateAction<CADMesh[]>>;
  groups: SceneGroup[];
  setGroups: React.Dispatch<React.SetStateAction<SceneGroup[]>>;
  bones: CADBone[];
  setBones: React.Dispatch<React.SetStateAction<CADBone[]>>;
  activeMeshId: string;
  setActiveMeshId: (id: string) => void;
  selectedMeshIds?: string[];
  setSelectedMeshIds?: React.Dispatch<React.SetStateAction<string[]>>;
  selectedBoneId?: string;
  setSelectedBoneId?: (id: string) => void;
  onSpawnPrimitive: (type: any) => void;
  onDeleteMesh: (id: string) => void;
  onDuplicateMesh?: (id: string) => void;
  onSeparateMesh?: (id: string) => void;
  cameras?: CADCamera[];
  setCameras?: React.Dispatch<React.SetStateAction<CADCamera[]>>;
  lights?: CADLight[];
  setLights?: React.Dispatch<React.SetStateAction<CADLight[]>>;
  particles?: ParticleEmitter[];
  setParticles?: React.Dispatch<React.SetStateAction<ParticleEmitter[]>>;
  environment?: EnvironmentSettings;
  setEnvironment?: (env: EnvironmentSettings | ((prev: EnvironmentSettings) => EnvironmentSettings)) => void;
  sceneSelection?: SceneSelection | null;
  setSceneSelection?: (sel: SceneSelection | null) => void;
  setActiveCameraId?: (id: string | null) => void;
  /** Hide Cameras / Lights / Particles / Weather (Model view). */
  showSceneObjects?: boolean;
  /** Hide the docked panel chrome when hosted in FloatingOutliner. */
  floating?: boolean;
}

export const OutlinerPanel: React.FC<OutlinerPanelProps> = ({
  meshes,
  setMeshes,
  groups,
  setGroups,
  bones,
  setBones,
  activeMeshId,
  setActiveMeshId,
  selectedMeshIds = [],
  setSelectedMeshIds,
  selectedBoneId: selectedBoneIdProp,
  setSelectedBoneId: setSelectedBoneIdProp,
  onSpawnPrimitive,
  onDeleteMesh,
  onDuplicateMesh,
  onSeparateMesh,
  cameras = [],
  setCameras,
  lights = [],
  setLights,
  particles = [],
  setParticles,
  environment,
  setEnvironment,
  sceneSelection = null,
  setSceneSelection,
  setActiveCameraId,
  showSceneObjects = true,
  floating = false,
}) => {
  const [outlinerTab, setOutlinerTab] = useState<'meshes' | 'scene' | 'bones'>('meshes');
  const [localBoneId, setLocalBoneId] = useState<string>(bones[0]?.id || '');
  const [collapsedBones, setCollapsedBones] = useState<Record<string, boolean>>({});
  const selectedBoneId = selectedBoneIdProp ?? localBoneId;
  const setSelectedBoneId = setSelectedBoneIdProp ?? setLocalBoneId;
  const [newBoneName, setNewBoneName] = useState<string>('Bone_Spine');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNameInput, setEditNameInput] = useState<string>('');
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!showSceneObjects && outlinerTab === 'scene') setOutlinerTab('meshes');
  }, [showSceneObjects, outlinerTab]);

  // Group creation & management
  const handleAddGroup = () => {
    const newGroup: SceneGroup = {
      id: `group_${Date.now()}`,
      name: `Group ${groups.length + 1}`,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      visible: true,
      locked: false,
    };
    setGroups((prev) => [...prev, newGroup]);
  };

  const handleGroupSelected = () => {
    if (selectedMeshIds.length === 0) return;
    const newGroupId = `group_${Date.now()}`;
    const newGroup: SceneGroup = {
      id: newGroupId,
      name: `Group ${groups.length + 1}`,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      visible: true,
      locked: false,
    };
    setGroups((prev) => [...prev, newGroup]);
    setMeshes((prev) =>
      prev.map((m) => (selectedMeshIds.includes(m.id) ? { ...m, groupId: newGroupId } : m))
    );
  };

  const handleUngroupSelected = () => {
    if (selectedMeshIds.length === 0) return;
    setMeshes((prev) =>
      prev.map((m) => (selectedMeshIds.includes(m.id) ? { ...m, groupId: null } : m))
    );
  };

  const handleDeleteGroup = (groupId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setGroups((prev) => prev.filter((g) => g.id !== groupId));
    setMeshes((prev) => prev.map((m) => (m.groupId === groupId ? { ...m, groupId: null } : m)));
  };

  const handleToggleGroupCollapse = (groupId: string) => {
    setCollapsedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const handleToggleGroupVisibility = (groupId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const groupMeshes = meshes.filter((m) => m.groupId === groupId);
    const anyVisible = groupMeshes.some((m) => m.visible !== false);
    const targetState = !anyVisible;
    setMeshes((prev) =>
      prev.map((m) => (m.groupId === groupId ? { ...m, visible: targetState } : m))
    );
  };

  const handleToggleGroupLock = (groupId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const groupMeshes = meshes.filter((m) => m.groupId === groupId);
    const anyUnlocked = groupMeshes.some((m) => !m.locked);
    const targetLock = anyUnlocked;
    setMeshes((prev) =>
      prev.map((m) => (m.groupId === groupId ? { ...m, locked: targetLock } : m))
    );
  };

  const handleMoveMeshToGroup = (meshId: string, targetGroupId: string | null) => {
    setMeshes((prev) =>
      prev.map((m) => (m.id === meshId ? { ...m, groupId: targetGroupId } : m))
    );
  };

  // Bone creation & management
  const handleAddBone = () => {
    const parent = bones.find((b) => b.id === selectedBoneId);
    const bone = createBone(
      newBoneName.trim() || `Bone_${bones.length + 1}`,
      parent?.id || null,
      parent ? { x: 0, y: parent.length, z: 0 } : { x: 0, y: bones.length * 0.5 + 0.5, z: 0 },
    );
    bone.color = '#e68619';
    setBones([...bones, bone]);
    setSelectedBoneId(bone.id);
    setNewBoneName(`Bone_${bones.length + 2}`);
  };

  const handleDeleteBone = (boneId: string) => {
    const removed = new Set<string>();
    const collect = (id: string) => {
      removed.add(id);
      bones.forEach((b) => {
        if (b.parentId === id) collect(b.id);
      });
    };
    collect(boneId);
    setBones((prev) => deleteBoneBranch(prev, boneId));
    setMeshes((prev) =>
      prev.map((m) => ({
        ...m,
        boneId: m.boneId && removed.has(m.boneId) ? null : m.boneId,
        skinWeights: m.skinWeights
          ? Object.fromEntries(
              Object.entries(m.skinWeights).map(([vertexId, weights]) => [
                vertexId,
                weights.filter((weight) => !removed.has(weight.boneId)),
              ]),
            )
          : undefined,
      })),
    );
    if (selectedBoneId === boneId || removed.has(selectedBoneId)) setSelectedBoneId('');
  };

  // Bone binding
  const handleBindMeshToBone = (meshId: string, boneId: string) => {
    setMeshes((prev) =>
      prev.map((m) => (m.id === meshId ? { ...m, boneId } : m))
    );
    setBones((prev) =>
      prev.map((b) => {
        if (b.id === boneId) {
          return {
            ...b,
            assignedMeshIds: Array.from(new Set([...b.assignedMeshIds, meshId])),
          };
        }
        return b;
      })
    );
  };

  const handleUnbindMeshFromBone = (meshId: string) => {
    setMeshes((prev) =>
      prev.map((m) => (m.id === meshId ? { ...m, boneId: null } : m))
    );
  };

  // Visibility & Locking
  const toggleMeshVisibility = (id: string) => {
    setMeshes((prev) =>
      prev.map((m) => (m.id === id ? { ...m, visible: m.visible === false ? true : false } : m))
    );
  };

  const toggleMeshLock = (id: string) => {
    setMeshes((prev) =>
      prev.map((m) => (m.id === id ? { ...m, locked: !m.locked } : m))
    );
  };

  const handleShowAll = () => {
    setMeshes((prev) => prev.map((m) => ({ ...m, visible: true })));
  };

  const handleHideAll = () => {
    setMeshes((prev) => prev.map((m) => ({ ...m, visible: false })));
  };

  const handleSelectAll = () => {
    const allIds = meshes.map((m) => m.id);
    setSelectedMeshIds?.(allIds);
    if (allIds.length > 0) setActiveMeshId(allIds[0]);
  };

  const handleDeselectAll = () => {
    setSelectedMeshIds?.([]);
  };

  // Duplication fallback
  const handleDuplicate = (meshToDup: CADMesh) => {
    if (onDuplicateMesh) {
      onDuplicateMesh(meshToDup.id);
      return;
    }
    const dupId = generateId('mesh');
    const duplicated: CADMesh = {
      ...meshToDup,
      id: dupId,
      name: `${meshToDup.name}_copy`,
      position: {
        x: meshToDup.position.x + 0.5,
        y: meshToDup.position.y,
        z: meshToDup.position.z + 0.5,
      },
      vertices: meshToDup.vertices.map((v) => ({ ...v, id: generateId('v') })),
      edges: meshToDup.edges.map((e) => ({ ...e, id: generateId('e') })),
      faces: meshToDup.faces.map((f) => ({ ...f, id: generateId('f') })),
    };
    setMeshes((prev) => [...prev, duplicated]);
    setActiveMeshId(dupId);
    setSelectedMeshIds?.([dupId]);
  };

  const handleSeparate = (meshToSep: CADMesh) => {
    onSeparateMesh?.(meshToSep.id);
  };

  // Inline Renaming handlers
  const handleStartRename = (id: string, currentName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(id);
    setEditNameInput(currentName);
  };

  const handleSaveRename = (type: 'mesh' | 'bone' | 'group', id: string) => {
    if (editNameInput.trim()) {
      if (type === 'mesh') {
        setMeshes((prev) =>
          prev.map((m) => (m.id === id ? { ...m, name: editNameInput.trim() } : m))
        );
      } else if (type === 'group') {
        setGroups((prev) =>
          prev.map((g) => (g.id === id ? { ...g, name: editNameInput.trim() } : g))
        );
      } else {
        setBones((prev) =>
          prev.map((b) => (b.id === id ? { ...b, name: editNameInput.trim() } : b))
        );
      }
    }
    setEditingId(null);
  };

  // Filtered lists
  const query = searchQuery.trim().toLowerCase();
  const filteredMeshes = meshes.filter((m) => m.name.toLowerCase().includes(query));
  const filteredBones = bones.filter((b) => b.name.toLowerCase().includes(query));

  // Single mesh item renderer
  const renderMeshItem = (m: CADMesh) => {
    const isActive = m.id === activeMeshId;
    const isSelected = selectedMeshIds.includes(m.id);
    const isEditing = editingId === m.id;
    const boundBone = bones.find((b) => b.id === m.boneId);

    return (
      <div
        key={m.id}
        onClick={(e) => {
          if (e.shiftKey && setSelectedMeshIds) {
            setSelectedMeshIds((prev) => {
              const has = prev.includes(m.id);
              const next = has ? prev.filter((id) => id !== m.id) : [...prev, m.id];
              if (!has || m.id === activeMeshId) setActiveMeshId(m.id);
              else if (has && next.length > 0) setActiveMeshId(next[next.length - 1]);
              return next;
            });
          } else {
            setActiveMeshId(m.id);
            setSelectedMeshIds?.([m.id]);
            setSceneSelection?.({ kind: 'mesh', id: m.id });
          }
        }}
        onDoubleClick={(e) => handleStartRename(m.id, m.name, e)}
        className={`p-1.5 rounded flex items-center justify-between font-mono text-[10px] cursor-pointer transition ${
          isSelected && isActive
            ? 'bg-[#ed7300]/30 border border-[#ed7300] text-white shadow-sm'
            : isSelected
              ? 'bg-[#ed7300]/15 border border-[#ed7300]/60 text-white'
              : 'bg-[#2a2a2a] border border-[#1a1a1a] text-[#b3b3b3] hover:border-[#ed7300]/50 hover:bg-[#2e2e2e]'
        }`}
      >
        {/* Left: Mesh Icon & Name / Input */}
        <div className="flex items-center gap-1.5 min-w-0 flex-1 mr-2">
          <Box className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-[#ed7300]' : 'text-[#8c8c8c]'}`} />
          {isEditing ? (
            <input
              type="text"
              value={editNameInput}
              onChange={(e) => setEditNameInput(e.target.value)}
              onBlur={() => handleSaveRename('mesh', m.id)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveRename('mesh', m.id)}
              autoFocus
              onClick={(e) => e.stopPropagation()}
              className="cad-input px-1 py-0.2 text-[10px] font-mono text-white outline-none w-28 bg-[#3a3a3a]"
            />
          ) : (
            <span className="font-bold truncate text-[#e8e8e8]" title="Double-click to rename">
              {m.name}
            </span>
          )}

          <span className="text-[8.5px] text-[#6e6e6e] shrink-0 font-mono">
            v:{m.vertices?.length || 0} f:{m.faces?.length || 0}
          </span>

          {boundBone && (
            <span className="text-[8.5px] text-[#ed7300] bg-[#ed7300]/15 px-1 py-0.2 rounded border border-[#ed7300]/30 flex items-center gap-0.5 shrink-0" title={`Rigged to ${boundBone.name}`}>
              <Link className="w-2.5 h-2.5" />
              {boundBone.name}
            </span>
          )}
        </div>

        {/* Right: Quick Operations */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Quick Color Swatch */}
          <input
            type="color"
            value={m.faces[0]?.color || '#ff9a3c'}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              const newColor = e.target.value;
              setMeshes((prev) =>
                prev.map((meshItem) => {
                  if (meshItem.id === m.id) {
                    const canvas = document.createElement('canvas');
                    canvas.width = 256;
                    canvas.height = 256;
                    const ctx = canvas.getContext('2d');
                    if (ctx) {
                      ctx.fillStyle = newColor;
                      ctx.fillRect(0, 0, 256, 256);
                    }
                    const dataUrl = canvas.toDataURL('image/png');
                    return {
                      ...meshItem,
                      textureCanvasDataUrl: dataUrl,
                      faces: meshItem.faces.map((f) => ({ ...f, color: newColor })),
                      revision: (meshItem.revision || 0) + 1,
                    };
                  }
                  return meshItem;
                })
              );
            }}
            className="w-4 h-4 rounded bg-transparent border-0 cursor-pointer shrink-0"
            title="Quick Assign Base Color / Material to Object"
          />
          {/* Move to Group dropdown */}
          {groups.length > 0 && (
            <select
              value={m.groupId || ''}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => handleMoveMeshToGroup(m.id, e.target.value || null)}
              className="bg-[#3a3a3a] text-[#e68619] text-[8.5px] font-mono px-1 py-0.5 rounded border border-[#4d4d4d] outline-none cursor-pointer"
              title="Assign object to group folder"
            >
              <option value="">Root</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          )}

          {/* Inline Rename button */}
          <button
            onClick={(e) => handleStartRename(m.id, m.name, e)}
            className="p-1 hover:bg-[#404040] rounded text-[#8c8c8c] hover:text-white"
            title="Rename Object"
          >
            <Edit2 className="w-3 h-3" />
          </button>

          {/* Duplicate Button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleDuplicate(m);
            }}
            className="p-1 hover:bg-[#404040] rounded text-[#8c8c8c] hover:text-[#ed7300]"
            title="Duplicate Object"
          >
            <Copy className="w-3 h-3" />
          </button>

          {onSeparateMesh && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleSeparate(m);
              }}
              className="p-1 hover:bg-[#404040] rounded text-[#8c8c8c] hover:text-amber-400"
              title="Separate loose parts (P)"
            >
              <Unlink className="w-3 h-3" />
            </button>
          )}

          {/* Lock / Unlock Toggle */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleMeshLock(m.id);
            }}
            className="p-1 hover:bg-[#404040] rounded text-[#8c8c8c]"
            title={m.locked ? 'Unlock Object' : 'Lock Object'}
          >
            {m.locked ? <Lock className="w-3 h-3 text-amber-400" /> : <Unlock className="w-3 h-3 text-[#666666]" />}
          </button>

          {/* Visibility Toggle */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleMeshVisibility(m.id);
            }}
            className="p-1 hover:bg-[#404040] rounded text-[#8c8c8c]"
            title={m.visible === false ? 'Show Object' : 'Hide Object'}
          >
            {m.visible === false ? <EyeOff className="w-3 h-3 text-[#ec5b62]" /> : <Eye className="w-3 h-3 text-[#2d9d78]" />}
          </button>

          {/* Rig/Bind Trigger if Bone is selected */}
          {selectedBoneId && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (m.boneId === selectedBoneId) {
                  handleUnbindMeshFromBone(m.id);
                } else {
                  handleBindMeshToBone(m.id, selectedBoneId);
                }
              }}
              className={`px-1.5 py-0.5 rounded text-[8.5px] font-bold flex items-center gap-0.5 transition ${
                m.boneId === selectedBoneId
                  ? 'bg-[#ec5b62] text-white'
                  : 'bg-[#c96a00] hover:bg-[#ed7300] text-white'
              }`}
              title={m.boneId === selectedBoneId ? 'Unbind Mesh from Bone' : 'Rig Mesh to Active Bone'}
            >
              {m.boneId === selectedBoneId ? <Unlink className="w-2.5 h-2.5" /> : <Link className="w-2.5 h-2.5" />}
              <span>{m.boneId === selectedBoneId ? 'UNBIND' : 'RIG'}</span>
            </button>
          )}

          {/* Delete Button */}
          {meshes.length > 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDeleteMesh(m.id);
              }}
              className="p-1 hover:bg-[#ec5b62] rounded text-[#8c8c8c] hover:text-white"
              title="Delete Object"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className={`flex flex-col h-full bg-[#333333] text-[#cccccc] font-sans text-xs select-none ${floating ? '' : ''}`}>
      {/* Outliner Header Bar — skipped in floating shell (title lives on window chrome) */}
      {!floating && (
      <div className="h-8 bg-[#262626] border-b border-[#4d4d4d] px-2.5 flex items-center justify-between font-mono text-[10px] text-[#ed7300] font-bold">
        <span className="flex items-center gap-1.5 uppercase">
          <Layers className="w-3.5 h-3.5 text-[#ed7300]" />
          SCENE HIERARCHY
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={handleSelectAll}
            className="p-1 hover:bg-[#404040] rounded text-[#8c8c8c] hover:text-white"
            title="Select All Meshes"
          >
            <CheckSquare className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleDeselectAll}
            className="p-1 hover:bg-[#404040] rounded text-[#8c8c8c] hover:text-white"
            title="Deselect All Meshes"
          >
            <SquareDashed className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleShowAll}
            className="p-1 hover:bg-[#404040] rounded text-[#2d9d78]"
            title="Show All Objects"
          >
            <Eye className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleHideAll}
            className="p-1 hover:bg-[#404040] rounded text-[#ec5b62]"
            title="Hide All Objects"
          >
            <EyeOff className="w-3.5 h-3.5" />
          </button>
          <div className="sp-sep-v h-3 mx-0.5 self-center" />
          <button
            onClick={handleAddGroup}
            className="p-1 hover:bg-[#404040] rounded text-[#e68619]"
            title="New Group Folder"
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onSpawnPrimitive('cube')}
            className="p-1 hover:bg-[#404040] rounded text-[#ed7300]"
            title="New Mesh Primitive"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      )}

      {floating && (
        <div className="px-1.5 py-1 bg-[#2d2d2d] border-b border-[#1a1a1a] flex items-center gap-1 shrink-0">
          <button
            onClick={handleSelectAll}
            className="p-1 hover:bg-[#404040] rounded text-[#8c8c8c] hover:text-white"
            title="Select All"
          >
            <CheckSquare className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleDeselectAll}
            className="p-1 hover:bg-[#404040] rounded text-[#8c8c8c] hover:text-white"
            title="Deselect All"
          >
            <SquareDashed className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleShowAll}
            className="p-1 hover:bg-[#404040] rounded text-[#2d9d78]"
            title="Show All"
          >
            <Eye className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleHideAll}
            className="p-1 hover:bg-[#404040] rounded text-[#ec5b62]"
            title="Hide All"
          >
            <EyeOff className="w-3.5 h-3.5" />
          </button>
          <div className="flex-1" />
          <button
            onClick={handleAddGroup}
            className="p-1 hover:bg-[#404040] rounded text-[#e68619]"
            title="New Group"
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onSpawnPrimitive('cube')}
            className="p-1 hover:bg-[#404040] rounded text-[#ed7300]"
            title="Add Cube"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Sub Tabs: Meshes / Scene / Bones */}
      <div className="flex border-b border-[#1a1a1a] bg-[#262626] text-[10px] font-mono font-bold">
        <button
          onClick={() => setOutlinerTab('meshes')}
          className={`flex-1 py-1.5 flex items-center justify-center gap-1 transition border-b-2 ${
            outlinerTab === 'meshes'
              ? 'border-[#ed7300] bg-[#333333] text-[#ed7300]'
              : 'border-transparent text-[#8c8c8c] hover:text-[#e0e0e0] hover:bg-[#2a2a2a]'
          }`}
        >
          <Box className="w-3 h-3" />
          <span>MESH ({meshes.length})</span>
        </button>
        {showSceneObjects && (
          <button
            onClick={() => setOutlinerTab('scene')}
            className={`flex-1 py-1.5 flex items-center justify-center gap-1 transition border-b-2 ${
              outlinerTab === 'scene'
                ? 'border-[#e68619] bg-[#333333] text-[#e68619]'
                : 'border-transparent text-[#8c8c8c] hover:text-[#e0e0e0] hover:bg-[#2a2a2a]'
            }`}
          >
            <Layers className="w-3 h-3" />
            <span>SCENE</span>
          </button>
        )}
        <button
          onClick={() => setOutlinerTab('bones')}
          className={`flex-1 py-1.5 flex items-center justify-center gap-1 transition border-b-2 ${
            outlinerTab === 'bones'
              ? 'border-[#ed7300] bg-[#333333] text-[#ed7300]'
              : 'border-transparent text-[#8c8c8c] hover:text-[#e0e0e0] hover:bg-[#2a2a2a]'
          }`}
        >
          <Bone className="w-3 h-3" />
          <span>BONES ({bones.length})</span>
        </button>
      </div>

      {/* Group Quick Action Bar & Filter */}
      <div className="p-1.5 bg-[#2a2a2a] border-b border-[#1a1a1a] flex flex-col gap-1.5">
        <div className="flex items-center gap-1 bg-[#3a3a3a] px-2 py-1 rounded border border-[#4d4d4d] text-[10px] font-mono">
          <Search className="w-3 h-3 text-[#8c8c8c]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={
              outlinerTab === 'meshes'
                ? 'Search mesh objects & groups...'
                : outlinerTab === 'scene'
                  ? 'Search cameras, lights, FX...'
                  : 'Search skeleton bones...'
            }
            className="bg-transparent text-[#e8e8e8] outline-none w-full placeholder:text-[#6e6e6e]"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="text-[#8c8c8c] hover:text-white">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {outlinerTab === 'meshes' && (
          <div className="flex items-center justify-between text-[9px] font-mono pt-0.5">
            <span className="text-[#8c8c8c]">Group Tools:</span>
            <div className="flex items-center gap-1">
              <button
                onClick={handleGroupSelected}
                disabled={selectedMeshIds.length === 0}
                className={`px-2 py-0.5 rounded font-bold flex items-center gap-1 transition ${
                  selectedMeshIds.length > 0
                    ? 'bg-[#e68619] hover:bg-[#f59e0b] text-white shadow-sm'
                    : 'bg-[#262626] text-[#666666] cursor-not-allowed'
                }`}
                title="Group Selected Objects into a folder (Ctrl+G)"
              >
                <FolderPlus className="w-3 h-3" />
                <span>Group Selected</span>
              </button>
              <button
                onClick={handleUngroupSelected}
                disabled={selectedMeshIds.length === 0}
                className={`px-2 py-0.5 rounded flex items-center gap-1 transition ${
                  selectedMeshIds.length > 0
                    ? 'bg-[#333333] hover:bg-[#444444] text-[#e0e0e0]'
                    : 'bg-[#262626] text-[#666666] cursor-not-allowed'
                }`}
                title="Remove selected objects from their group"
              >
                <FolderMinus className="w-3 h-3" />
                <span>Ungroup</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Main Tab Content */}
      <div className="flex-1 overflow-y-auto p-1.5 space-y-2 custom-scrollbar">
        {outlinerTab === 'scene' && showSceneObjects ? (
          <div className="space-y-3">
            {/* Cameras */}
            <div className="space-y-1">
              <div className="flex items-center justify-between px-1">
                <span className="text-[9px] font-mono font-bold text-[#ed7300] uppercase tracking-wider flex items-center gap-1">
                  <Camera className="w-3 h-3" /> Cameras ({cameras.length})
                </span>
                <button
                  type="button"
                  className="px-1.5 py-0.5 rounded bg-[#ed7300]/20 text-[#ed7300] text-[9px] font-bold flex items-center gap-0.5 hover:bg-[#ed7300]/40"
                  onClick={() => {
                    if (!setCameras) return;
                    const cam = createCamera(`Camera ${cameras.length + 1}`);
                    setCameras((prev) => [...prev, cam]);
                    setActiveCameraId?.(cam.id);
                    setSceneSelection?.({ kind: 'camera', id: cam.id });
                    setSelectedMeshIds?.([]);
                  }}
                >
                  <Plus className="w-3 h-3" /> Add
                </button>
              </div>
              {cameras
                .filter((c) => !query || c.name.toLowerCase().includes(query))
                .map((cam) => {
                  const selected = sceneSelection?.kind === 'camera' && sceneSelection.id === cam.id;
                  return (
                    <div
                      key={cam.id}
                      onClick={() => {
                        setSceneSelection?.({ kind: 'camera', id: cam.id });
                        setActiveCameraId?.(cam.id);
                        setSelectedMeshIds?.([]);
                      }}
                      className={`p-1.5 rounded flex items-center justify-between font-mono text-[10px] cursor-pointer border ${
                        selected
                          ? 'bg-[#ed7300]/25 border-[#ed7300] text-white'
                          : 'bg-[#2a2a2a] border-[#1a1a1a] text-[#b3b3b3] hover:border-[#ed7300]/50'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Camera className="w-3.5 h-3.5 text-[#ed7300] shrink-0" />
                        <span className="truncate">{cam.name}</span>
                      </div>
                      <div className="flex items-center gap-0.5">
                        <button
                          type="button"
                          className="p-0.5 hover:bg-[#404040] rounded"
                          onClick={(e) => {
                            e.stopPropagation();
                            setCameras?.((prev) =>
                              prev.map((c) => (c.id === cam.id ? { ...c, visible: c.visible === false } : c)),
                            );
                          }}
                        >
                          {cam.visible === false ? <EyeOff className="w-3 h-3 text-[#ec5b62]" /> : <Eye className="w-3 h-3 text-[#2d9d78]" />}
                        </button>
                        <button
                          type="button"
                          className="p-0.5 hover:bg-[#ec5b62] rounded"
                          onClick={(e) => {
                            e.stopPropagation();
                            setCameras?.((prev) => prev.filter((c) => c.id !== cam.id));
                            if (selected) setSceneSelection?.(null);
                          }}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
            </div>

            {/* Lights */}
            <div className="space-y-1">
              <div className="flex items-center justify-between px-1">
                <span className="text-[9px] font-mono font-bold text-[#e68619] uppercase tracking-wider flex items-center gap-1">
                  <Lightbulb className="w-3 h-3" /> Lights ({lights.length})
                </span>
                <div className="flex gap-0.5">
                  {(['point', 'directional', 'spot', 'area'] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      className="px-1 py-0.5 rounded bg-[#e68619]/20 text-[#e68619] text-[8px] font-bold uppercase hover:bg-[#e68619]/40"
                      onClick={() => {
                        if (!setLights) return;
                        const L = createCADLight(type);
                        setLights((prev) => [...prev, L]);
                        setSceneSelection?.({ kind: 'light', id: L.id });
                        setSelectedMeshIds?.([]);
                      }}
                    >
                      +{type === 'directional' ? 'sun' : type.slice(0, 3)}
                    </button>
                  ))}
                </div>
              </div>
              {lights
                .filter((L) => !query || L.name.toLowerCase().includes(query))
                .map((L) => {
                  const selected = sceneSelection?.kind === 'light' && sceneSelection.id === L.id;
                  return (
                    <div
                      key={L.id}
                      onClick={() => {
                        setSceneSelection?.({ kind: 'light', id: L.id });
                        setSelectedMeshIds?.([]);
                      }}
                      className={`p-1.5 rounded flex items-center justify-between font-mono text-[10px] cursor-pointer border ${
                        selected
                          ? 'bg-[#e68619]/25 border-[#e68619] text-white'
                          : 'bg-[#2a2a2a] border-[#1a1a1a] text-[#b3b3b3] hover:border-[#e68619]/50'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Lightbulb className="w-3.5 h-3.5 text-[#e68619] shrink-0" />
                        <span className="truncate">{L.name}</span>
                        <span className="text-[8px] text-[#666666] uppercase">{L.type}</span>
                      </div>
                      <div className="flex items-center gap-0.5">
                        <button
                          type="button"
                          className="p-0.5 hover:bg-[#404040] rounded"
                          onClick={(e) => {
                            e.stopPropagation();
                            setLights?.((prev) =>
                              prev.map((x) => (x.id === L.id ? { ...x, visible: x.visible === false } : x)),
                            );
                          }}
                        >
                          {L.visible === false ? <EyeOff className="w-3 h-3 text-[#ec5b62]" /> : <Eye className="w-3 h-3 text-[#2d9d78]" />}
                        </button>
                        <button
                          type="button"
                          className="p-0.5 hover:bg-[#ec5b62] rounded"
                          onClick={(e) => {
                            e.stopPropagation();
                            setLights?.((prev) => prev.filter((x) => x.id !== L.id));
                            if (selected) setSceneSelection?.(null);
                          }}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
            </div>

            {/* Particles / FX */}
            <div className="space-y-1">
              <div className="flex items-center justify-between px-1">
                <span className="text-[9px] font-mono font-bold text-[#ff9a3c] uppercase tracking-wider flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> Particles ({particles.length})
                </span>
                <button
                  type="button"
                  className="px-1.5 py-0.5 rounded bg-[#ff9a3c]/20 text-[#ff9a3c] text-[9px] font-bold flex items-center gap-0.5 hover:bg-[#ff9a3c]/40"
                  onClick={() => {
                    if (!setParticles) return;
                    const fx = createParticleEmitter(`FX ${particles.length + 1}`);
                    setParticles((prev) => [...prev, fx]);
                    setSceneSelection?.({ kind: 'particle', id: fx.id });
                    setSelectedMeshIds?.([]);
                  }}
                >
                  <Plus className="w-3 h-3" /> Add
                </button>
              </div>
              {particles
                .filter((p) => !query || p.name.toLowerCase().includes(query))
                .map((p) => {
                  const selected = sceneSelection?.kind === 'particle' && sceneSelection.id === p.id;
                  return (
                    <div
                      key={p.id}
                      onClick={() => {
                        setSceneSelection?.({ kind: 'particle', id: p.id });
                        setSelectedMeshIds?.([]);
                      }}
                      className={`p-1.5 rounded flex items-center justify-between font-mono text-[10px] cursor-pointer border ${
                        selected
                          ? 'bg-[#ff9a3c]/25 border-[#ff9a3c] text-white'
                          : 'bg-[#2a2a2a] border-[#1a1a1a] text-[#b3b3b3] hover:border-[#ff9a3c]/50'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Sparkles className="w-3.5 h-3.5 text-[#ff9a3c] shrink-0" />
                        <span className="truncate">{p.name}</span>
                      </div>
                      <button
                        type="button"
                        className="p-0.5 hover:bg-[#ec5b62] rounded"
                        onClick={(e) => {
                          e.stopPropagation();
                          setParticles?.((prev) => prev.filter((x) => x.id !== p.id));
                          if (selected) setSceneSelection?.(null);
                        }}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
            </div>

            {/* Weather */}
            <div className="space-y-1">
              <span className="text-[9px] font-mono font-bold text-[#8aa0b8] uppercase tracking-wider flex items-center gap-1 px-1">
                <CloudSun className="w-3 h-3" /> Weather / Environment
              </span>
              <div
                onClick={() => {
                  setSceneSelection?.({ kind: 'weather', id: 'environment' });
                  setSelectedMeshIds?.([]);
                  if (!environment && setEnvironment) setEnvironment(createDefaultEnvironment());
                }}
                className={`p-1.5 rounded font-mono text-[10px] cursor-pointer border ${
                  sceneSelection?.kind === 'weather'
                    ? 'bg-[#8aa0b8]/25 border-[#8aa0b8] text-white'
                    : 'bg-[#2a2a2a] border-[#1a1a1a] text-[#b3b3b3] hover:border-[#8aa0b8]/50'
                }`}
              >
                <div className="flex items-center justify-between gap-1.5 mb-1.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <CloudSun className="w-3.5 h-3.5 text-[#8aa0b8] shrink-0" />
                    <span className="capitalize truncate">{(environment || createDefaultEnvironment()).weather} weather</span>
                    <span className="text-[8px] text-[#666666] shrink-0">(move / rotate / scale volume)</span>
                  </div>
                  <button
                    type="button"
                    className="p-0.5 hover:bg-[#404040] rounded shrink-0"
                    title={(environment?.visible === true) ? 'Hide weather volume' : 'Show weather volume'}
                    onClick={(e) => {
                      e.stopPropagation();
                      setEnvironment?.((prev) => {
                        const base = prev || createDefaultEnvironment();
                        return { ...base, visible: base.visible === true ? false : true };
                      });
                    }}
                  >
                    {(environment?.visible === true)
                      ? <Eye className="w-3 h-3 text-[#2d9d78]" />
                      : <EyeOff className="w-3 h-3 text-[#ec5b62]" />}
                  </button>
                </div>
                <div className="flex flex-wrap gap-0.5" onClick={(e) => e.stopPropagation()}>
                  {(['clear', 'fog', 'rain', 'snow', 'storm', 'overcast'] as WeatherPreset[]).map((w) => (
                    <button
                      key={w}
                      type="button"
                      className={`px-1.5 py-0.5 rounded text-[8px] uppercase font-bold ${
                        (environment || createDefaultEnvironment()).weather === w
                          ? 'bg-[#ed7300] text-white'
                          : 'bg-[#262626] text-[#8c8c8c] hover:text-white'
                      }`}
                      onClick={() => {
                        setEnvironment?.((prev) => weatherPresetToEnv(w, prev));
                        setSceneSelection?.({ kind: 'weather', id: 'environment' });
                      }}
                    >
                      {w}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : outlinerTab === 'meshes' ? (
          /* MESH OBJECTS TAB CONTENT WITH GROUP FOLDERS */
          <div className="space-y-2">
            {/* Group Folders Section */}
            {groups.map((group) => {
              const groupMeshes = filteredMeshes.filter((m) => m.groupId === group.id);
              const isCollapsed = collapsedGroupIds.has(group.id);
              const isEditing = editingId === group.id;
              const allVisible = groupMeshes.length > 0 && groupMeshes.every((m) => m.visible !== false);
              const anyLocked = groupMeshes.some((m) => m.locked);

              return (
                <div key={group.id} className="cad-card border border-[#4d4d4d] bg-[#2e2e2e] rounded p-1 space-y-1">
                  {/* Group Folder Header */}
                  <div
                    onClick={() => handleToggleGroupCollapse(group.id)}
                    className="flex items-center justify-between font-mono text-[10px] cursor-pointer py-1 px-1.5 bg-[#2a2a2a] rounded hover:bg-[#282828] transition"
                  >
                    <div className="flex items-center gap-1.5 min-w-0 flex-1 mr-2">
                      {isCollapsed ? <ChevronRight className="w-3 h-3 text-[#8c8c8c]" /> : <ChevronDown className="w-3 h-3 text-[#8c8c8c]" />}
                      {isCollapsed ? <Folder className="w-3.5 h-3.5 text-[#e68619]" /> : <FolderOpen className="w-3.5 h-3.5 text-[#e68619]" />}
                      {isEditing ? (
                        <input
                          type="text"
                          value={editNameInput}
                          onChange={(e) => setEditNameInput(e.target.value)}
                          onBlur={() => handleSaveRename('group', group.id)}
                          onKeyDown={(e) => e.key === 'Enter' && handleSaveRename('group', group.id)}
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                          className="cad-input px-1 py-0.2 text-[10px] font-mono text-white outline-none w-28 bg-[#3a3a3a]"
                        />
                      ) : (
                        <span
                          onDoubleClick={(e) => handleStartRename(group.id, group.name, e)}
                          className="font-bold text-[#e68619] truncate"
                          title="Double-click to rename group"
                        >
                          {group.name}
                        </span>
                      )}
                      <span className="text-[8.5px] text-[#8c8c8c]">({groupMeshes.length})</span>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => handleStartRename(group.id, group.name, e)}
                        className="p-0.5 hover:bg-[#404040] rounded text-[#8c8c8c] hover:text-white"
                        title="Rename Group Folder"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => handleToggleGroupLock(group.id, e)}
                        className="p-0.5 hover:bg-[#404040] rounded text-[#8c8c8c]"
                        title={anyLocked ? 'Unlock All Group Meshes' : 'Lock All Group Meshes'}
                      >
                        {anyLocked ? <Lock className="w-3 h-3 text-amber-400" /> : <Unlock className="w-3 h-3 text-[#666666]" />}
                      </button>
                      <button
                        onClick={(e) => handleToggleGroupVisibility(group.id, e)}
                        className="p-0.5 hover:bg-[#404040] rounded text-[#8c8c8c]"
                        title={allVisible ? 'Hide Group' : 'Show Group'}
                      >
                        {allVisible ? <Eye className="w-3 h-3 text-[#2d9d78]" /> : <EyeOff className="w-3 h-3 text-[#ec5b62]" />}
                      </button>
                      <button
                        onClick={(e) => handleDeleteGroup(group.id, e)}
                        className="p-0.5 hover:bg-[#ec5b62] rounded text-[#8c8c8c] hover:text-white"
                        title="Delete Group Folder"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  {/* Group Children */}
                  {!isCollapsed && (
                    <div className="pl-3 border-l-2 border-[#e68619]/30 space-y-1 pt-0.5">
                      {groupMeshes.length === 0 ? (
                        <div className="text-[9px] font-mono text-[#666666] italic py-1 pl-1">
                          (Empty group — drag or select meshes to group)
                        </div>
                      ) : (
                        groupMeshes.map(renderMeshItem)
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Ungrouped Meshes Container */}
            <div className="space-y-1">
              {groups.length > 0 && (
                <div className="text-[9px] font-mono text-[#8c8c8c] font-bold uppercase tracking-wider px-1 pt-1">
                  UNGROUPED OBJECTS ({filteredMeshes.filter((m) => !m.groupId).length})
                </div>
              )}
              {filteredMeshes
                .filter((m) => !m.groupId)
                .map(renderMeshItem)}
            </div>
          </div>
        ) : (
          /* SKELETON BONES TAB CONTENT */
          <div className="space-y-2">
            {/* Add Bone Creation Bar */}
            <div className="cad-card p-2 space-y-1.5 border border-[#4d4d4d] bg-[#222222]">
              <span className="text-[9px] font-mono text-[#8c8c8c] uppercase font-bold block">
                CREATE NEW BONE (PARENT: {bones.find((b) => b.id === selectedBoneId)?.name || 'ROOT'})
              </span>
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={newBoneName}
                  onChange={(e) => setNewBoneName(e.target.value)}
                  className="cad-input flex-1 px-2 py-1 text-[10px] font-mono text-[#ed7300] outline-none"
                  placeholder="New Bone Name..."
                />
                <button
                  onClick={handleAddBone}
                  className="px-2.5 py-1 bg-[#ed7300] hover:bg-[#ed7300] text-white font-mono text-[10px] font-bold rounded flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" />
                  <span>+ BONE</span>
                </button>
              </div>
            </div>

            {/* Bone Hierarchy */}
            <div className="space-y-0.5">
              {filteredBones.length === 0 ? (
                <div className="text-[10px] font-mono text-[#666666] italic text-center py-4">
                  No skeleton bones created
                </div>
              ) : (
                (() => {
                  const childrenOf = (parentId: string | null) =>
                    bones.filter((b) => (b.parentId || null) === parentId);
                  const matches = (bone: CADBone): boolean => {
                    if (!query) return true;
                    if (bone.name.toLowerCase().includes(query)) return true;
                    return childrenOf(bone.id).some(matches);
                  };
                  const renderNode = (bone: CADBone, depth: number): React.ReactNode => {
                    if (!matches(bone)) return null;
                    const kids = childrenOf(bone.id);
                    const hasKids = kids.length > 0;
                    const collapsed = !!collapsedBones[bone.id];
                    const isSelected = bone.id === selectedBoneId;
                    const isEditing = editingId === bone.id;
                    return (
                      <div key={bone.id}>
                        <div
                          onClick={() => setSelectedBoneId(bone.id)}
                          onDoubleClick={(e) => handleStartRename(bone.id, bone.name, e)}
                          className={`h-7 rounded flex items-center gap-0.5 font-mono text-[10px] cursor-pointer transition pr-1 ${
                            isSelected
                              ? 'bg-[#ed7300]/20 border border-[#ed7300] text-[#ffffff]'
                              : 'bg-[#2a2a2a] border border-transparent text-[#b3b3b3] hover:border-[#ed7300]/45'
                          }`}
                          style={{ paddingLeft: 4 + depth * 12 }}
                        >
                          <button
                            type="button"
                            className={`w-4 h-4 shrink-0 flex items-center justify-center ${hasKids ? 'text-[#8c8c8c]' : 'opacity-0 pointer-events-none'}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setCollapsedBones((prev) => ({ ...prev, [bone.id]: !prev[bone.id] }));
                            }}
                          >
                            {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          </button>
                          <Bone className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-[#ed7300]' : 'text-[#8c8c8c]'}`} />
                          {isEditing ? (
                            <input
                              type="text"
                              value={editNameInput}
                              onChange={(e) => setEditNameInput(e.target.value)}
                              onBlur={() => handleSaveRename('bone', bone.id)}
                              onKeyDown={(e) => e.key === 'Enter' && handleSaveRename('bone', bone.id)}
                              autoFocus
                              onClick={(e) => e.stopPropagation()}
                              className="cad-input px-1 py-0.2 text-[10px] font-mono text-white outline-none w-28 bg-[#3a3a3a]"
                            />
                          ) : (
                            <span className="font-bold truncate text-[#e8e8e8] flex-1">{bone.name}</span>
                          )}
                          <button
                            onClick={(e) => handleStartRename(bone.id, bone.name, e)}
                            className="p-1 hover:bg-[#404040] rounded text-[#8c8c8c] hover:text-white"
                            title="Rename Bone"
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteBone(bone.id);
                            }}
                            className="p-1 hover:bg-[#ec5b62] rounded text-[#8c8c8c] hover:text-white"
                            title="Delete Bone"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                        {hasKids && !collapsed && kids.map((child) => renderNode(child, depth + 1))}
                      </div>
                    );
                  };
                  return childrenOf(null).map((root) => renderNode(root, 0));
                })()
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
