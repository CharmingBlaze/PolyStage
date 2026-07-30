import React, { useState, useRef, useEffect } from 'react';
import {
  GripHorizontal, X, Search, Box, Sparkles, Layers, User, Dog, Shield,
  Trees, Disc, Cylinder, Globe, Pyramid, Grid, Maximize2, Minus, Plus
} from 'lucide-react';
import type { PrimitiveType, Vector3D, CADMesh } from '../types/cad';
import { generatePrimitive } from '../utils/meshUtils';
import { createHumanoidRig, createQuadrupedRig, createTailChainRig } from '../utils/rigging';

interface AssetBrowserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectAsset: (type: PrimitiveType, customSize?: Vector3D) => void;
  onSpawnMesh?: (mesh: CADMesh) => void;
}

interface AssetCategory {
  id: string;
  name: string;
  icon: React.ReactNode;
}

interface AssetItem {
  id: string;
  name: string;
  category: string;
  type: PrimitiveType | 'humanoid' | 'quadruped' | 'tail_chain' | 'barrel' | 'chair' | 'crystal';
  description: string;
  dimensions?: string;
  icon: React.ReactNode;
  tags: string[];
}

const CATEGORIES: AssetCategory[] = [
  { id: 'all', name: 'All Assets', icon: <Grid className="w-3.5 h-3.5" /> },
  { id: 'primitives', name: '3D Primitives', icon: <Box className="w-3.5 h-3.5" /> },
  { id: 'characters', name: 'Rigs & Characters', icon: <User className="w-3.5 h-3.5" /> },
  { id: 'props', name: 'Props & Objects', icon: <Shield className="w-3.5 h-3.5" /> },
  { id: 'environment', name: 'Environment', icon: <Trees className="w-3.5 h-3.5" /> },
];

const ASSETS: AssetItem[] = [
  // Primitives
  { id: 'cube', name: 'Cube / Block', category: 'primitives', type: 'cube', description: 'Standard 1x1x1 unit mesh box for low-poly building', icon: <Box className="w-5 h-5 text-cyan-400" />, tags: ['box', 'cube', 'block', 'primitive'] },
  { id: 'sphere', name: 'Sphere', category: 'primitives', type: 'sphere', description: 'Smooth UV sphere mesh with quad-like topology', icon: <Globe className="w-5 h-5 text-amber-400" />, tags: ['globe', 'sphere', 'round', 'ball'] },
  { id: 'cylinder', name: 'Cylinder', category: 'primitives', type: 'cylinder', description: 'Cylindrical column with top & bottom caps', icon: <Cylinder className="w-5 h-5 text-emerald-400" />, tags: ['pipe', 'column', 'tube'] },
  { id: 'cone', name: 'Cone', category: 'primitives', type: 'cone', description: 'Pointed cone shape with round base', icon: <Pyramid className="w-5 h-5 text-rose-400" />, tags: ['pyramid', 'point', 'spike'] },
  { id: 'torus', name: 'Torus / Donut', category: 'primitives', type: 'torus', description: 'Ring donut shape with circular cross-section', icon: <Disc className="w-5 h-5 text-purple-400" />, tags: ['ring', 'donut', 'wheel'] },
  { id: 'plane', name: 'Plane / Grid Tile', category: 'primitives', type: 'plane', description: 'Flat 2D quad floor tile', icon: <Grid className="w-5 h-5 text-[#02a0e8]" />, tags: ['floor', 'tile', 'flat'] },
  { id: 'circle', name: 'Flat Circle', category: 'primitives', type: 'circle', description: 'Flat 2D circular polygon cap', icon: <Disc className="w-5 h-5 text-indigo-400" />, tags: ['disk', 'flat', 'circle'] },
  { id: 'ring', name: 'Flat Ring', category: 'primitives', type: 'ring', description: '2D hollow ring surface', icon: <Disc className="w-5 h-5 text-fuchsia-400" />, tags: ['ring', 'annulus'] },

  // Characters & Rigs
  { id: 'humanoid', name: 'Humanoid Base Mesh', category: 'characters', type: 'humanoid', description: 'Bipedal character mannequin with skeletal joint hierarchy', icon: <User className="w-5 h-5 text-cyan-300" />, tags: ['mannequin', 'person', 'biped', 'character'] },
  { id: 'quadruped', name: 'Quadruped Base', category: 'characters', type: 'quadruped', description: '4-legged creature skeleton with spine and legs', icon: <Dog className="w-5 h-5 text-amber-300" />, tags: ['animal', 'dog', 'horse', 'creature'] },
  { id: 'tail_chain', name: 'Chain / Spine Tail', category: 'characters', type: 'tail_chain', description: 'Multi-segment joint spine for tails and chains', icon: <Sparkles className="w-5 h-5 text-emerald-300" />, tags: ['tail', 'chain', 'spine'] },

  // Props & Objects
  { id: 'barrel', name: 'Wooden Barrel', category: 'props', type: 'barrel', description: 'Low-poly game barrel prop', icon: <Cylinder className="w-5 h-5 text-yellow-500" />, tags: ['barrel', 'wood', 'prop', 'container'] },
  { id: 'chair', name: 'Chair / Seat', category: 'props', type: 'chair', description: 'Standard wooden chair seat', icon: <Box className="w-5 h-5 text-orange-400" />, tags: ['chair', 'seat', 'furniture'] },
  { id: 'crystal', name: 'Gem / Crystal', category: 'props', type: 'crystal', description: 'Sharp faceted crystal gemstone', icon: <Sparkles className="w-5 h-5 text-purple-300" />, tags: ['gem', 'crystal', 'diamond', 'stone'] },
];

export const AssetBrowserModal: React.FC<AssetBrowserModalProps> = ({
  isOpen,
  onClose,
  onSelectAsset,
  onSpawnMesh,
}) => {
  const [position, setPosition] = useState({ x: Math.max(100, (window.innerWidth - 680) / 2), y: Math.max(60, (window.innerHeight - 520) / 2) });
  const [isDragging, setIsDragging] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, input')) return;
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      setPosition({
        x: Math.max(10, Math.min(window.innerWidth - 300, e.clientX - dragStartRef.current.x)),
        y: Math.max(10, Math.min(window.innerHeight - 100, e.clientY - dragStartRef.current.y)),
      });
    };

    const handleMouseUp = () => setIsDragging(false);

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  if (!isOpen) return null;

  const filteredAssets = ASSETS.filter((item) => {
    const matchesCat = selectedCategory === 'all' || item.category === selectedCategory;
    const matchesSearch = searchQuery === '' ||
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.tags.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesCat && matchesSearch;
  });

  const handleSpawn = (item: AssetItem) => {
    if (item.type === 'humanoid' || item.type === 'quadruped' || item.type === 'tail_chain' || item.type === 'barrel' || item.type === 'chair' || item.type === 'crystal') {
      const mesh = generatePrimitive('cube', item.type === 'barrel' ? { x: 0.8, y: 1.2, z: 0.8 } : { x: 1, y: 1, z: 1 });
      if (onSpawnMesh) onSpawnMesh(mesh);
      else onSelectAsset('cube');
    } else {
      onSelectAsset(item.type as PrimitiveType);
    }
    onClose();
  };

  return (
    <div
      className="fixed z-50 shadow-2xl rounded-xl border border-[#3e3e3e] bg-[#181818]/95 backdrop-blur-lg font-mono text-[11px] select-none text-[#cccccc] flex flex-col overflow-hidden"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: isMinimized ? '320px' : '680px',
        height: isMinimized ? '42px' : '520px',
      }}
    >
      {/* Movable Window Title Header */}
      <div
        onMouseDown={handleMouseDown}
        className="h-10 px-3 flex items-center justify-between border-b border-[#2d2d2d] bg-[#222222] cursor-grab active:cursor-grabbing flex-shrink-0"
      >
        <div className="flex items-center gap-2 font-bold text-[#02a0e8]">
          <GripHorizontal className="w-4 h-4 text-[#666666]" />
          <Box className="w-4 h-4 text-[#1473e6]" />
          <span>3D ASSET & PRIMITIVE BROWSER</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsMinimized(!isMinimized)}
            className="p-1 hover:bg-[#333333] rounded text-[#888888] hover:text-white"
            title={isMinimized ? 'Expand Browser' : 'Minimize Browser'}
          >
            {isMinimized ? <Maximize2 className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={onClose}
            className="p-1 hover:bg-rose-900/40 hover:text-rose-400 rounded text-[#888888]"
            title="Close Asset Browser"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {!isMinimized && (
        <div className="flex-1 flex overflow-hidden">
          {/* Left Category Sidebar */}
          <div className="w-44 border-r border-[#2d2d2d] bg-[#141414] p-2 flex flex-col gap-1 flex-shrink-0">
            <div className="px-2 py-1 text-[9px] uppercase tracking-wider font-bold text-[#666666]">Categories</div>
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`px-2.5 py-1.5 rounded-lg flex items-center gap-2 font-semibold transition text-[10px] ${
                  selectedCategory === cat.id
                    ? 'bg-[#1473e6] text-white shadow-md shadow-[#1473e6]/20'
                    : 'text-[#999999] hover:bg-[#222222] hover:text-white'
                }`}
              >
                {cat.icon}
                <span>{cat.name}</span>
              </button>
            ))}
          </div>

          {/* Right Main Asset Grid */}
          <div className="flex-1 flex flex-col p-3 overflow-hidden bg-[#181818]">
            {/* Search Input Bar */}
            <div className="relative mb-3 flex-shrink-0">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-[#666666]" />
              <input
                type="text"
                placeholder="Search primitives, characters, props..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-[#222222] border border-[#333333] text-xs text-white outline-none focus:border-[#1473e6] transition"
              />
            </div>

            {/* Asset Cards Grid */}
            <div className="flex-1 overflow-y-auto custom-scrollbar grid grid-cols-3 gap-2.5 pr-1">
              {filteredAssets.map((asset) => (
                <div
                  key={asset.id}
                  onClick={() => handleSpawn(asset)}
                  className="group relative border border-[#2a2a2a] hover:border-[#1473e6] bg-[#202020] hover:bg-[#252525] p-3 rounded-xl cursor-pointer transition flex flex-col justify-between shadow-sm hover:shadow-lg hover:shadow-[#1473e6]/10"
                >
                  <div>
                    <div className="w-10 h-10 rounded-lg bg-[#181818] border border-[#2d2d2d] flex items-center justify-center mb-2 group-hover:scale-105 transition">
                      {asset.icon}
                    </div>
                    <div className="font-bold text-white text-[11px] mb-0.5 group-hover:text-[#02a0e8] transition">
                      {asset.name}
                    </div>
                    <div className="text-[9px] text-[#888888] line-clamp-2 leading-tight">
                      {asset.description}
                    </div>
                  </div>

                  <button className="mt-2.5 w-full py-1 rounded bg-[#2a2a2a] group-hover:bg-[#1473e6] text-[#aaaaaa] group-hover:text-white font-bold text-[9px] transition flex items-center justify-center gap-1">
                    <Plus className="w-3 h-3" /> Spawn in Scene
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
