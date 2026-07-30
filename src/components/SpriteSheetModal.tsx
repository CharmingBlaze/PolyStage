import React, { useState } from 'react';
import { X, Film, Download, RefreshCw } from 'lucide-react';
import type { CADMesh } from '../types/cad';
import { downloadDataUrl, generateSpriteSheet } from '../utils/exporters';

interface SpriteSheetModalProps {
  isOpen: boolean;
  onClose: () => void;
  mesh: CADMesh;
}

export const SpriteSheetModal: React.FC<SpriteSheetModalProps> = ({ isOpen, onClose, mesh }) => {
  const [frameCount, setFrameCount] = useState<number>(16);
  const [frameSize, setFrameSize] = useState<number>(128);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleGenerate = () => {
    const canvas = document.createElement('canvas');
    canvas.width = frameSize;
    canvas.height = frameSize;
    const ctx = canvas.getContext('2d')!;

    const url = generateSpriteSheet(canvas, frameCount, frameSize, frameSize, (angle) => {
      ctx.fillStyle = '#1a1f2b';
      ctx.fillRect(0, 0, frameSize, frameSize);

      ctx.save();
      ctx.translate(frameSize / 2, frameSize / 2);
      ctx.rotate(angle);

      ctx.fillStyle = '#5eb1ef';
      ctx.fillRect(-frameSize / 4, -frameSize / 4, frameSize / 2, frameSize / 2);
      ctx.strokeStyle = '#f07178';
      ctx.lineWidth = 2;
      ctx.strokeRect(-frameSize / 4, -frameSize / 4, frameSize / 2, frameSize / 2);

      ctx.restore();
    });

    setPreviewUrl(url);
  };

  const handleDownload = () => {
    if (previewUrl) {
      downloadDataUrl(`${mesh.name.toLowerCase().replace(/\s+/g, '_')}_spritesheet.png`, previewUrl);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/55 backdrop-blur-sm flex items-center justify-center z-50 p-4 select-none font-sans">
      <div className="modal-shell max-w-lg w-full text-xs">
        <div className="modal-header">
          <div className="flex items-center gap-2 font-semibold text-sm">
            <Film className="w-4 h-4 text-[var(--color-accent)]" />
            <span>Sprite Sheet Generator</span>
          </div>
          <button onClick={onClose} className="win-button p-1.5 flex items-center justify-center">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-semibold text-[var(--color-muted)] uppercase tracking-wider mb-1.5">Frame Count</label>
              <select
                value={frameCount}
                onChange={(e) => setFrameCount(parseInt(e.target.value))}
                className="w-full win-inset p-2 font-mono text-xs outline-none"
              >
                <option value={8}>8 Frames</option>
                <option value={16}>16 Frames</option>
                <option value={32}>32 Frames</option>
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-[var(--color-muted)] uppercase tracking-wider mb-1.5">Frame Size</label>
              <select
                value={frameSize}
                onChange={(e) => setFrameSize(parseInt(e.target.value))}
                className="w-full win-inset p-2 font-mono text-xs outline-none"
              >
                <option value={64}>64×64</option>
                <option value={128}>128×128</option>
                <option value={256}>256×256</option>
              </select>
            </div>
          </div>

          <div className="win-inset p-4 flex flex-col items-center justify-center min-h-[160px] relative overflow-hidden bg-[var(--color-app)]">
            {previewUrl ? (
              <img src={previewUrl} alt="Sprite Sheet Preview" className="max-h-[180px] object-contain image-rendering-pixelated" />
            ) : (
              <div className="text-center text-[var(--color-muted)] space-y-2 font-mono">
                <Film className="w-8 h-8 mx-auto text-[var(--color-accent)] opacity-70" />
                <p className="text-[11px]">Generate a 360° sprite sheet preview</p>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <button onClick={handleGenerate} className="flex-1 py-2 win-button font-semibold flex items-center justify-center gap-2">
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Generate</span>
            </button>

            {previewUrl && (
              <button onClick={handleDownload} className="px-4 py-2 win-button font-semibold flex items-center gap-2 text-[var(--color-accent)]">
                <Download className="w-3.5 h-3.5" />
                <span>Download</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
