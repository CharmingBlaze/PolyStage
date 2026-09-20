import React, { useEffect, useState } from 'react';
import {
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Trash2,
  FolderPlus,
  Folder,
  FolderOpen,
  Plus,
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
  Sparkles,
  CloudSun,
} from 'lucide-react';
import { BlenderIcon } from './icons/BlenderIcon';
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
    bone.color = '#00b4c4';
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
  const handleStartRename = (id: string, currentName: string, e?: React.MouseEvent | React.SyntheticEvent) => {
    e?.stopPropagation();
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
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleStartRename(m.id, m.name, e);
        }}
        className={`ol-row p-1.5 rounded-[6px] flex items-center justify-between font-mono text-[11.5px] cursor-pointer ${
          isSelected && isActive
            ? 'is-sel is-active'
            : isSelected
              ? 'is-sel'
              : isActive
                ? 'is-active'
                : ''
        } ${m.visible === false ? 'ol-row--hidden' : ''} ${m.locked ? 'ol-row--locked' : ''}`}
      >
        {/* Left: Mesh Icon & Name / Input */}
        <div className="flex items-center gap-1.5 min-w-0 flex-1 mr-2">
          <BlenderIcon
            name="object"
            size={14}
            className={`shrink-0 ${
              isActive
                ? 'text-[var(--ts-accent)]'
                : isSelected
                  ? 'text-[var(--ts-text-hi)]'
                  : 'text-[var(--ts-text-muted)]'
            }`}
          />
          {isEditing ? (
            <input
              type="text"
              value={editNameInput}
              onChange={(e) => setEditNameInput(e.target.value)}
              onBlur={() => handleSaveRename('mesh', m.id)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveRename('mesh', m.id)}
              autoFocus
              onClick={(e) => e.stopPropagation()}
              className="cad-input px-1 py-0.5 text-[10px] font-mono text-[#e2e6ec] outline-none w-28 bg-[#282c35] rounded-[6px] border border-[#3a3f4a]"
              aria-label="Rename mesh"
            />
          ) : (
            <span className="font-medium truncate text-[#eaedf1]" title="Double-click to rename">
              {m.name}
            </span>
          )}

          <span className="ol-meta text-[10px] text-[#6e7584] shrink-0 font-mono">
            {m.vertices?.length || 0}v {m.faces?.length || 0}f
          </span>

          {boundBone && (
            <span className="text-[#00b4c4] shrink-0" title={`Rigged to ${boundBone.name}`}>
              <Link className="w-3 h-3" />
            </span>
          )}
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          <input
            type="color"
            value={m.faces[0]?.color || '#00d4e2'}
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
            className="w-3.5 h-3.5 rounded-[6px] bg-transparent border-0 cursor-pointer shrink-0"
            title="Base color"
            aria-label="Base color"
          />
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleMeshVisibility(m.id);
            }}
            className="p-0.5 hover:bg-[#282c35] rounded-[6px] text-[#858a93]"
            title={m.visible === false ? 'Show object' : 'Hide object'}
            aria-label={m.visible === false ? 'Show object' : 'Hide object'}
          >
            {m.visible === false ? <EyeOff className="w-3 h-3 text-[#e0556a]" /> : <Eye className="w-3 h-3" />}
          </button>
        </div>

        <div className="ol-ops flex items-center gap-0.5 shrink-0 ml-0.5">
          {/* Move to Group dropdown */}
          {groups.length > 0 && (
            <select
              value={m.groupId || ''}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => handleMoveMeshToGroup(m.id, e.target.value || null)}
              className="bg-[#282c35] text-[#00b4c4] text-[10px] font-mono px-1 py-0.5 rounded-[6px] border border-[#3a3f4a] outline-none cursor-pointer"
              title="Assign object to group folder"
              aria-label="Assign object to group folder"
            >
              <option value="">Root</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          )}

          <button
            onClick={(e) => handleStartRename(m.id, m.name, e)}
            className="p-0.5 hover:bg-[#282c35] rounded-[6px] text-[#858a93]"
            title="Rename"
            aria-label="Rename"
          >
            <Edit2 className="w-3 h-3" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleDuplicate(m);
            }}
            className="p-0.5 hover:bg-[#282c35] rounded-[6px] text-[#858a93] hover:text-[#00b4c4]"
            title="Duplicate"
            aria-label="Duplicate"
          >
            <Copy className="w-3 h-3" />
          </button>
          {onSeparateMesh && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleSeparate(m);
              }}
              className="p-0.5 hover:bg-[#282c35] rounded-[6px] text-[#858a93]"
              title="Separate loose parts (P)"
              aria-label="Separate loose parts"
            >
              <Unlink className="w-3 h-3" />
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleMeshLock(m.id);
            }}
            className="p-0.5 hover:bg-[#282c35] rounded-[6px] text-[#858a93]"
            title={m.locked ? 'Unlock' : 'Lock'}
            aria-label={m.locked ? 'Unlock' : 'Lock'}
          >
            {m.locked ? <Lock className="w-3 h-3 text-[#e6b422]" /> : <Unlock className="w-3 h-3 text-[#51565f]" />}
          </button>
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
              className={`p-0.5 rounded-[6px] ${
                m.boneId === selectedBoneId ? 'text-[#e0556a]' : 'text-[#00b4c4]'
              }`}
              title={m.boneId === selectedBoneId ? 'Unbind from bone' : 'Rig to active bone'}
              aria-label={m.boneId === selectedBoneId ? 'Unbind from bone' : 'Rig to active bone'}
            >
              {m.boneId === selectedBoneId ? <Unlink className="w-3 h-3" /> : <Link className="w-3 h-3" />}
            </button>
          )}

          {/* Delete Button */}
          {meshes.length > 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDeleteMesh(m.id);
              }}
              className="p-1 hover:bg-[#e0556a] rounded-[6px] text-[#858a93] hover:text-[#e2e6ec]"
              title="Delete Object"
              aria-label="Delete Object"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className={`flex flex-col h-full bg-[var(--ts-panel)] text-[var(--ts-text)] font-sans text-xs select-none ${floating ? '' : ''}`}>
      <div className="h-8 px-1.5 bg-[var(--ts-app)] border-b border-[var(--ts-border)] flex items-center gap-0.5 shrink-0">
        <button
          type="button"
          onClick={() => setOutlinerTab('meshes')}
          className={`insp-subtab ${outlinerTab === 'meshes' ? 'is-on' : ''}`}
        >
          Mesh {meshes.length}
        </button>
        {showSceneObjects && (
          <button
            type="button"
            onClick={() => setOutlinerTab('scene')}
            className={`insp-subtab ${outlinerTab === 'scene' ? 'is-on' : ''}`}
          >
            Scene
          </button>
        )}
        <button
          type="button"
          onClick={() => setOutlinerTab('bones')}
          className={`insp-subtab ${outlinerTab === 'bones' ? 'is-on' : ''}`}
        >
          Bones {bones.length}
        </button>
        <div className="flex-1" />
        <button onClick={handleSelectAll} className="p-1 rounded-[6px] text-[#858a93] hover:text-[#eaedf1] hover:bg-[#282c35]" title="Select all" aria-label="Select all">
          <CheckSquare className="w-3.5 h-3.5" />
        </button>
        <button onClick={handleDeselectAll} className="p-1 rounded-[6px] text-[#858a93] hover:text-[#eaedf1] hover:bg-[#282c35]" title="Deselect all" aria-label="Deselect all">
          <SquareDashed className="w-3.5 h-3.5" />
        </button>
        <button onClick={handleShowAll} className="p-1 rounded-[6px] text-[#858a93] hover:text-[#eaedf1] hover:bg-[#282c35]" title="Show all" aria-label="Show all">
          <Eye className="w-3.5 h-3.5" />
        </button>
        <button onClick={handleHideAll} className="p-1 rounded-[6px] text-[#858a93] hover:text-[#eaedf1] hover:bg-[#282c35]" title="Hide all" aria-label="Hide all">
          <EyeOff className="w-3.5 h-3.5" />
        </button>
        <button onClick={handleAddGroup} className="p-1 rounded-[6px] text-[#858a93] hover:bg-[#282c35] hover:text-[#00b4c4]" title="New group" aria-label="New group">
          <FolderPlus className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => onSpawnPrimitive('cube')} className="p-1 rounded-[6px] text-[#858a93] hover:bg-[#282c35] hover:text-[#00b4c4]" title="Add cube" aria-label="Add cube">
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="px-1.5 py-1 bg-[#1c1f26] border-b border-[#1a1c22] flex flex-col gap-1">
        <div className="flex items-center gap-1 bg-[#282c35] px-2 py-1 rounded-[6px] border border-[#3a3f4a] text-[11.5px]">
          <Search className="w-3 h-3 text-[#858a93]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={
              outlinerTab === 'meshes'
                ? 'Search objects'
                : outlinerTab === 'scene'
                  ? 'Search cameras, lights'
                  : 'Search bones'
            }
            className="bg-transparent text-[#eaedf1] outline-none w-full placeholder:text-[#6e6e6e]"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="text-[#858a93]" aria-label="Clear search">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {outlinerTab === 'meshes' && selectedMeshIds.length > 0 && (
          <div className="flex items-center gap-1.5 pt-0.5">
            <button
              type="button"
              onClick={handleGroupSelected}
              className="px-2.5 py-1 rounded-[6px] bg-[var(--ts-card)] hover:bg-[var(--ts-elevated)] border border-[var(--ts-border-hi)] text-[var(--ts-text-hi)] font-medium text-[11px] flex items-center gap-1.5 transition shadow-sm"
              title="Group selected (Ctrl+G)"
            >
              <FolderPlus className="w-3.5 h-3.5 text-[var(--ts-accent)]" />
              Group
            </button>
            <button
              type="button"
              disabled={!meshes.some((m) => selectedMeshIds.includes(m.id) && Boolean(m.groupId))}
              onClick={handleUngroupSelected}
              className="px-2.5 py-1 rounded-[6px] bg-transparent hover:bg-[var(--ts-hover)] border border-transparent hover:border-[var(--ts-border)] text-[var(--ts-text-muted)] hover:text-[var(--ts-text)] font-medium text-[11px] flex items-center gap-1 transition disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:border-transparent disabled:pointer-events-none"
              title="Ungroup"
            >
              Ungroup
            </button>
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
                <span className="text-[10px] font-mono font-bold text-[#00b4c4] uppercase tracking-wider flex items-center gap-1">
                  <BlenderIcon name="camera" size={12} /> Cameras ({cameras.length})
                </span>
                <button
                  type="button"
                  className="px-1.5 py-0.5 rounded-[6px] bg-[#00b4c4]/20 text-[#00b4c4] text-[10px] font-bold flex items-center gap-0.5 hover:bg-[#00b4c4]/40"
                  onClick={() => {
                    if (!setCameras) return;
                    const cam = createCamera(`Camera ${cameras.length + 1}`);
                    setCameras((prev) => [...prev, cam]);
                    setActiveCameraId?.(cam.id);
                    setSceneSelection?.({ kind: 'camera', id: cam.id });
                    setSelectedMeshIds?.([]);
                  }}
                  aria-label="Add camera"
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
                      className={`ol-row p-1.5 rounded-[6px] flex items-center justify-between font-mono text-[11px] cursor-pointer ${
                        selected ? 'is-sel is-active' : ''
                      }`}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <BlenderIcon name="camera" size={14} className="text-[var(--ts-accent)] shrink-0" />
                        <span className="truncate">{cam.name}</span>
                      </div>
                      <div className="flex items-center gap-0.5">
                        <button
                          type="button"
                          className="p-0.5 hover:bg-[#282c35] rounded-[6px]"
                          onClick={(e) => {
                            e.stopPropagation();
                            setCameras?.((prev) =>
                              prev.map((c) => (c.id === cam.id ? { ...c, visible: c.visible === false } : c)),
                            );
                          }}
                          aria-label={cam.visible === false ? 'Show camera' : 'Hide camera'}
                        >
                          {cam.visible === false ? <EyeOff className="w-3 h-3 text-[#e0556a]" /> : <Eye className="w-3 h-3 text-[#34a87a]" />}
                        </button>
                        <button
                          type="button"
                          className="p-0.5 hover:bg-[#e0556a] rounded-[6px]"
                          onClick={(e) => {
                            e.stopPropagation();
                            setCameras?.((prev) => prev.filter((c) => c.id !== cam.id));
                            if (selected) setSceneSelection?.(null);
                          }}
                          aria-label="Delete camera"
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
                <span className="text-[10px] font-mono font-bold text-[#00b4c4] uppercase tracking-wider flex items-center gap-1">
                  <BlenderIcon name="light" size={12} /> Lights ({lights.length})
                </span>
                <div className="flex gap-0.5">
                  {(['point', 'directional', 'spot', 'area'] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      className="px-1.5 py-0.5 rounded-[6px] bg-[#00b4c4]/20 text-[#00b4c4] text-[10px] font-bold uppercase hover:bg-[#00b4c4]/40"
                      onClick={() => {
                        if (!setLights) return;
                        const L = createCADLight(type);
                        setLights((prev) => [...prev, L]);
                        setSceneSelection?.({ kind: 'light', id: L.id });
                        setSelectedMeshIds?.([]);
                      }}
                      aria-label={`Add ${type} light`}
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
                      className={`ol-row p-1.5 rounded-[6px] flex items-center justify-between font-mono text-[11px] cursor-pointer ${
                        selected ? 'is-sel is-active' : ''
                      }`}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <BlenderIcon name="light" size={14} className="text-[var(--ts-accent)] shrink-0" />
                        <span className="truncate">{L.name}</span>
                        <span className="text-[10px] text-[#6e7584] uppercase">{L.type}</span>
                      </div>
                      <div className="flex items-center gap-0.5">
                        <button
                          type="button"
                          className="p-0.5 hover:bg-[#282c35] rounded-[6px]"
                          onClick={(e) => {
                            e.stopPropagation();
                            setLights?.((prev) =>
                              prev.map((x) => (x.id === L.id ? { ...x, visible: x.visible === false } : x)),
                            );
                          }}
                          aria-label={L.visible === false ? 'Show light' : 'Hide light'}
                        >
                          {L.visible === false ? <EyeOff className="w-3 h-3 text-[#e0556a]" /> : <Eye className="w-3 h-3 text-[#34a87a]" />}
                        </button>
                        <button
                          type="button"
                          className="p-0.5 hover:bg-[#e0556a] rounded-[6px]"
                          onClick={(e) => {
                            e.stopPropagation();
                            setLights?.((prev) => prev.filter((x) => x.id !== L.id));
                            if (selected) setSceneSelection?.(null);
                          }}
                          aria-label="Delete light"
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
                <span className="text-[10px] font-mono font-bold text-[#00b4c4] uppercase tracking-wider flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> Particles ({particles.length})
                </span>
                <button
                  type="button"
                  className="px-1.5 py-0.5 rounded-[6px] bg-[#00b4c4]/20 text-[#00b4c4] text-[10px] font-bold flex items-center gap-0.5 hover:bg-[#00b4c4]/40"
                  onClick={() => {
                    if (!setParticles) return;
                    const fx = createParticleEmitter(`FX ${particles.length + 1}`);
                    setParticles((prev) => [...prev, fx]);
                    setSceneSelection?.({ kind: 'particle', id: fx.id });
                    setSelectedMeshIds?.([]);
                  }}
                  aria-label="Add particle FX"
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
                      className={`ol-row p-1.5 rounded-[6px] flex items-center justify-between font-mono text-[11px] cursor-pointer ${
                        selected ? 'is-sel is-active' : ''
                      }`}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Sparkles className="w-3.5 h-3.5 text-[#00b4c4] shrink-0" />
                        <span className="truncate">{p.name}</span>
                      </div>
                      <button
                        type="button"
                        className="p-0.5 hover:bg-[#e0556a] rounded-[6px]"
                        onClick={(e) => {
                          e.stopPropagation();
                          setParticles?.((prev) => prev.filter((x) => x.id !== p.id));
                          if (selected) setSceneSelection?.(null);
                        }}
                        aria-label="Delete particle FX"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
            </div>

            {/* Weather */}
            <div className="space-y-1">
              <span className="text-[10px] font-mono font-bold text-[#8aa0b8] uppercase tracking-wider flex items-center gap-1 px-1">
                <CloudSun className="w-3 h-3" /> Weather / Environment
              </span>
              <div
                onClick={() => {
                  setSceneSelection?.({ kind: 'weather', id: 'environment' });
                  setSelectedMeshIds?.([]);
                  if (!environment && setEnvironment) setEnvironment(createDefaultEnvironment());
                }}
                className={`ol-row p-1.5 rounded-[6px] font-mono text-[11px] cursor-pointer ${
                  sceneSelection?.kind === 'weather' ? 'is-sel is-active' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-1.5 mb-1.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <CloudSun className="w-3.5 h-3.5 text-[#8aa0b8] shrink-0" />
                    <span className="capitalize truncate">{(environment || createDefaultEnvironment()).weather} weather</span>
                    <span className="text-[10px] text-[#6e7584] shrink-0">(volume)</span>
                  </div>
                  <button
                    type="button"
                    className="p-0.5 hover:bg-[#282c35] rounded-[6px] shrink-0"
                    title={(environment?.visible === true) ? 'Hide weather volume' : 'Show weather volume'}
                    aria-label={(environment?.visible === true) ? 'Hide weather volume' : 'Show weather volume'}
                    onClick={(e) => {
                      e.stopPropagation();
                      setEnvironment?.((prev) => {
                        const base = prev || createDefaultEnvironment();
                        return { ...base, visible: base.visible === true ? false : true };
                      });
                    }}
                  >
                    {(environment?.visible === true)
                      ? <Eye className="w-3 h-3 text-[#34a87a]" />
                      : <EyeOff className="w-3 h-3 text-[#e0556a]" />}
                  </button>
                </div>
                <div className="flex flex-wrap gap-0.5" onClick={(e) => e.stopPropagation()}>
                  {(['clear', 'fog', 'rain', 'snow', 'storm', 'overcast'] as WeatherPreset[]).map((w) => (
                    <button
                      key={w}
                      type="button"
                      className={`px-1.5 py-0.5 rounded-[6px] text-[10px] uppercase font-bold ${
                        (environment || createDefaultEnvironment()).weather === w
                          ? 'bg-[#00b4c4] text-[#0a1114]'
                          : 'bg-[#16191e] text-[#858a93] hover:text-[#e2e6ec]'
                      }`}
                      onClick={() => {
                        setEnvironment?.((prev) => weatherPresetToEnv(w, prev));
                        setSceneSelection?.({ kind: 'weather', id: 'environment' });
                      }}
                      aria-label={`Select weather ${w}`}
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
                <div key={group.id} className="ts-card border border-[#3a3f4a] bg-[#21242c] rounded-[6px] p-1.5 space-y-1">
                  {/* Group Folder Header */}
                  <div
                    onClick={() => handleToggleGroupCollapse(group.id)}
                    className="flex items-center justify-between font-mono text-[10px] cursor-pointer py-1 px-1.5 bg-[#1c1f26] rounded-[6px] hover:bg-[#16191e] transition"
                  >
                    <div className="flex items-center gap-1.5 min-w-0 flex-1 mr-2">
                      {isCollapsed ? <ChevronRight className="w-3 h-3 text-[#858a93]" /> : <ChevronDown className="w-3 h-3 text-[#858a93]" />}
                      {isCollapsed ? <Folder className="w-3.5 h-3.5 text-[#00b4c4]" /> : <FolderOpen className="w-3.5 h-3.5 text-[#00b4c4]" />}
                      {isEditing ? (
                        <input
                          type="text"
                          value={editNameInput}
                          onChange={(e) => setEditNameInput(e.target.value)}
                          onBlur={() => handleSaveRename('group', group.id)}
                          onKeyDown={(e) => e.key === 'Enter' && handleSaveRename('group', group.id)}
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                          className="cad-input px-1 py-0.5 text-[10px] font-mono text-[#e2e6ec] outline-none w-28 bg-[#282c35] rounded-[6px] border border-[#3a3f4a]"
                          aria-label="Rename group folder"
                        />
                      ) : (
                        <span
                          onDoubleClick={(e) => handleStartRename(group.id, group.name, e)}
                          className="font-bold text-[#00b4c4] truncate"
                          title="Double-click to rename group"
                        >
                          {group.name}
                        </span>
                      )}
                      <span className="text-[10px] text-[#858a93]">({groupMeshes.length})</span>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => handleStartRename(group.id, group.name, e)}
                        className="p-0.5 hover:bg-[#282c35] rounded-[6px] text-[#858a93] hover:text-[#e2e6ec]"
                        title="Rename Group Folder"
                        aria-label="Rename Group Folder"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => handleToggleGroupLock(group.id, e)}
                        className="p-0.5 hover:bg-[#282c35] rounded-[6px] text-[#858a93]"
                        title={anyLocked ? 'Unlock All Group Meshes' : 'Lock All Group Meshes'}
                        aria-label={anyLocked ? 'Unlock All Group Meshes' : 'Lock All Group Meshes'}
                      >
                        {anyLocked ? <Lock className="w-3 h-3 text-[#e6b422]" /> : <Unlock className="w-3 h-3 text-[#51565f]" />}
                      </button>
                      <button
                        onClick={(e) => handleToggleGroupVisibility(group.id, e)}
                        className="p-0.5 hover:bg-[#282c35] rounded-[6px] text-[#858a93]"
                        title={allVisible ? 'Hide Group' : 'Show Group'}
                        aria-label={allVisible ? 'Hide Group' : 'Show Group'}
                      >
                        {allVisible ? <Eye className="w-3 h-3 text-[#34a87a]" /> : <EyeOff className="w-3 h-3 text-[#e0556a]" />}
                      </button>
                      <button
                        onClick={(e) => handleDeleteGroup(group.id, e)}
                        className="p-0.5 hover:bg-[#e0556a] rounded-[6px] text-[#858a93] hover:text-[#e2e6ec]"
                        title="Delete Group Folder"
                        aria-label="Delete Group Folder"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  {/* Group Children */}
                  {!isCollapsed && (
                    <div className="pl-3 border-l-2 border-[#00b4c4]/30 space-y-1 pt-0.5">
                      {groupMeshes.length === 0 ? (
                        <div className="text-[10px] font-mono text-[#51565f] italic py-1 pl-1">
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
                <div className="text-[10px] font-mono text-[#858a93] font-bold uppercase tracking-wider px-1 pt-1">
                  Ungrouped objects ({filteredMeshes.filter((m) => !m.groupId).length})
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
            <div className="ts-card p-2.5 space-y-2 border border-[#3a3f4a] bg-[#21242c] rounded-[6px]">
              <span className="text-[10px] font-mono text-[#858a93] uppercase font-bold block">
                CREATE NEW BONE (PARENT: {bones.find((b) => b.id === selectedBoneId)?.name || 'ROOT'})
              </span>
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={newBoneName}
                  onChange={(e) => setNewBoneName(e.target.value)}
                  className="cad-input flex-1 px-2 py-1 text-[10px] font-mono text-[#00b4c4] outline-none rounded-[6px] border border-[#3a3f4a] bg-[#16191e]"
                  placeholder="New Bone Name..."
                  aria-label="New bone name"
                />
                <button
                  onClick={handleAddBone}
                  className="px-2.5 py-1 bg-[#00b4c4] hover:bg-[#00d4e2] text-[#0a1114] font-mono text-[10px] font-bold rounded-[6px] flex items-center gap-1 transition"
                  aria-label="Add bone"
                >
                  <Plus className="w-3 h-3" />
                  <span>+ BONE</span>
                </button>
              </div>
            </div>

            {/* Bone Hierarchy */}
            <div className="space-y-0.5">
              {filteredBones.length === 0 ? (
                <div className="text-[10px] font-mono text-[#51565f] italic text-center py-4">
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
                          className={`ol-row min-h-[28px] ${isSelected ? 'is-sel is-active' : ''}`}
                          style={{ paddingLeft: 4 + depth * 12 }}
                        >
                          <button
                            type="button"
                            className={`w-4 h-4 shrink-0 flex items-center justify-center ${hasKids ? 'text-[#858a93]' : 'opacity-0 pointer-events-none'}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setCollapsedBones((prev) => ({ ...prev, [bone.id]: !prev[bone.id] }));
                            }}
                            aria-label={collapsed ? 'Expand bone' : 'Collapse bone'}
                          >
                            {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          </button>
                          <BlenderIcon name="bone" size={14} className={`shrink-0 ${isSelected ? 'text-[var(--ts-accent)]' : 'text-[var(--ts-text-muted)]'}`} />
                          {isEditing ? (
                            <input
                              type="text"
                              value={editNameInput}
                              onChange={(e) => setEditNameInput(e.target.value)}
                              onBlur={() => handleSaveRename('bone', bone.id)}
                              onKeyDown={(e) => e.key === 'Enter' && handleSaveRename('bone', bone.id)}
                              autoFocus
                              onClick={(e) => e.stopPropagation()}
                              className="cad-input px-1 py-0.5 text-[10px] font-mono text-[#e2e6ec] outline-none w-28 bg-[#282c35] rounded-[6px] border border-[#3a3f4a]"
                              aria-label="Rename bone"
                            />
                          ) : (
                            <span className="font-bold truncate text-[#eaedf1] flex-1">{bone.name}</span>
                          )}
                          <button
                            onClick={(e) => handleStartRename(bone.id, bone.name, e)}
                            className="p-1 hover:bg-[#282c35] rounded-[6px] text-[#858a93] hover:text-[#e2e6ec]"
                            title="Rename Bone"
                            aria-label="Rename Bone"
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteBone(bone.id);
                            }}
                            className="p-1 hover:bg-[#e0556a] rounded-[6px] text-[#858a93] hover:text-[#e2e6ec]"
                            title="Delete Bone"
                            aria-label="Delete Bone"
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
