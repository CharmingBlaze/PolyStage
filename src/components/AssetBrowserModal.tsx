import React, { useState, useRef, useEffect } from 'react';
import {
  X, Search, Box, Sparkles, User, Dog, Shield,
  Trees, Disc, Cylinder, Globe, Pyramid, Grid, Maximize2, Minus
} from 'lucide-react';
import type { PrimitiveType, Vector3D, CADMesh } from '../types/cad';
import { generatePrimitive } from '../utils/meshUtils';

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
  { id: 'all', name: 'All', icon: <Grid className="w-3.5 h-3.5" /> },
  { id: 'primitives', name: 'Primitives', icon: <Box className="w-3.5 h-3.5" /> },
  { id: 'characters', name: 'Characters', icon: <User className="w-3.5 h-3.5" /> },
  { id: 'props', name: 'Props', icon: <Shield className="w-3.5 h-3.5" /> },
  { id: 'environment', name: 'Environment', icon: <Trees className="w-3.5 h-3.5" /> },
];

const ASSETS: AssetItem[] = [
  { id: 'cube', name: 'Cube', category: 'primitives', type: 'cube', description: '1x1x1 box', icon: <Box className="w-5 h-5" />, tags: ['box', 'cube', 'block', 'primitive'] },
  { id: 'sphere', name: 'Sphere', category: 'primitives', type: 'sphere', description: 'UV sphere', icon: <Globe className="w-5 h-5" />, tags: ['globe', 'sphere', 'round', 'ball'] },
  { id: 'cylinder', name: 'Cylinder', category: 'primitives', type: 'cylinder', description: 'Capped column', icon: <Cylinder className="w-5 h-5" />, tags: ['pipe', 'column', 'tube'] },
  { id: 'cone', name: 'Cone', category: 'primitives', type: 'cone', description: 'Pointed cone', icon: <Pyramid className="w-5 h-5" />, tags: ['pyramid', 'point', 'spike'] },
  { id: 'torus', name: 'Torus', category: 'primitives', type: 'torus', description: 'Ring', icon: <Disc className="w-5 h-5" />, tags: ['ring', 'donut', 'wheel'] },
  { id: 'plane', name: 'Plane', category: 'primitives', type: 'plane', description: 'Flat quad', icon: <Grid className="w-5 h-5" />, tags: ['floor', 'tile', 'flat'] },
  { id: 'circle', name: 'Circle', category: 'primitives', type: 'circle', description: 'Flat disk', icon: <Disc className="w-5 h-5" />, tags: ['disk', 'flat', 'circle'] },
  { id: 'ring', name: 'Ring', category: 'primitives', type: 'ring', description: 'Flat annulus', icon: <Disc className="w-5 h-5" />, tags: ['ring', 'annulus'] },
  { id: 'humanoid', name: 'Humanoid', category: 'characters', type: 'humanoid', description: 'Biped mannequin', icon: <User className="w-5 h-5" />, tags: ['mannequin', 'person', 'biped', 'character'] },
  { id: 'quadruped', name: 'Quadruped', category: 'characters', type: 'quadruped', description: 'Four-leg base', icon: <Dog className="w-5 h-5" />, tags: ['animal', 'dog', 'horse', 'creature'] },
  { id: 'tail_chain', name: 'Tail chain', category: 'characters', type: 'tail_chain', description: 'Joint spine', icon: <Sparkles className="w-5 h-5" />, tags: ['tail', 'chain', 'spine'] },
  { id: 'barrel', name: 'Barrel', category: 'props', type: 'barrel', description: 'Game barrel', icon: <Cylinder className="w-5 h-5" />, tags: ['barrel', 'wood', 'prop', 'container'] },
  { id: 'chair', name: 'Chair', category: 'props', type: 'chair', description: 'Simple seat', icon: <Box className="w-5 h-5" />, tags: ['chair', 'seat', 'furniture'] },
  { id: 'crystal', name: 'Crystal', category: 'props', type: 'crystal', description: 'Faceted gem', icon: <Sparkles className="w-5 h-5" />, tags: ['gem', 'crystal', 'diamond', 'stone'] },
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
      className="ts-float ts-float--modal flex flex-col"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: isMinimized ? '280px' : '560px',
        height: isMinimized ? '32px' : '480px',
      }}
    >
      <div onMouseDown={handleMouseDown} className="ts-float__bar shrink-0">
        <span className="ts-float__title">Primitives</span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setIsMinimized(!isMinimized)}
            className="ts-btn ts-btn--ghost w-7 h-7"
            title={isMinimized ? 'Expand' : 'Minimize'}
            aria-label={isMinimized ? 'Expand' : 'Minimize'}
          >
            {isMinimized ? <Maximize2 className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="ts-btn ts-btn--ghost w-7 h-7"
            title="Close"
            aria-label="Close primitives"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {!isMinimized && (
        <div className="flex-1 flex overflow-hidden">
          <nav className="w-[136px] border-r border-[#1a1c22] bg-[#16191e] p-1.5 flex flex-col gap-0.5 shrink-0">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setSelectedCategory(cat.id)}
                className={`prim-row ${selectedCategory === cat.id ? 'is-on' : ''}`}
              >
                {cat.icon}
                <span>{cat.name}</span>
              </button>
            ))}
          </nav>

          <div className="flex-1 flex flex-col p-3 gap-2 overflow-hidden bg-[#1c1f26]">
            <div className="relative shrink-0">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-[#6e7584]" />
              <input
                type="text"
                placeholder="Search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="ts-input w-full pl-8"
                aria-label="Search primitives"
              />
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar grid grid-cols-3 gap-2">
              {filteredAssets.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  onClick={() => handleSpawn(asset)}
                  className="asset-tile"
                  title={asset.description}
                >
                  <span className="asset-tile__icon">{asset.icon}</span>
                  <span className="text-[11.5px] font-medium">{asset.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
