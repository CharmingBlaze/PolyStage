import React, { useState, useRef, useEffect } from 'react';
import {
  GripHorizontal, X, Upload, CheckCircle, AlertCircle,
  Maximize2, Minus,
} from 'lucide-react';
import type { CADMesh } from '../types/cad';
import { import3DModelFromFile, SUPPORTED_IMPORT_EXTENSIONS } from '../utils/importers';

interface ImportModelModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportMeshes: (meshes: CADMesh[]) => void;
}

const ACCEPT = SUPPORTED_IMPORT_EXTENSIONS.join(',');

export const ImportModelModal: React.FC<ImportModelModalProps> = ({
  isOpen,
  onClose,
  onImportMeshes,
}) => {
  const [position, setPosition] = useState({ x: Math.max(100, (window.innerWidth - 520) / 2), y: Math.max(80, (window.innerHeight - 420) / 2) });
  const [isDragging, setIsDragging] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [parsedMeshes, setParsedMeshes] = useState<CADMesh[]>([]);
  const [fileName, setFileName] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
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

  const preview = parsedMeshes[0] ?? null;
  const totalVerts = parsedMeshes.reduce((n, m) => n + m.vertices.length, 0);
  const totalFaces = parsedMeshes.reduce((n, m) => n + m.faces.length, 0);

  const processFile = async (file: File) => {
    setFileName(file.name);
    setErrorMsg(null);
    setParsedMeshes([]);
    setIsLoading(true);
    try {
      const result = await import3DModelFromFile(file);
      if (result.meshes.length > 0) {
        setParsedMeshes(result.meshes);
      } else {
        setErrorMsg(
          result.error ||
            `Could not parse 3D geometry from "${file.name}". Supported: OBJ, STL, PLY, glTF/GLB, JSON, bbmodel.`,
        );
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : `Failed to read "${file.name}".`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void processFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void processFile(file);
  };

  const handleConfirmImport = () => {
    if (parsedMeshes.length) {
      onImportMeshes(parsedMeshes);
      setParsedMeshes([]);
      setFileName('');
      onClose();
    }
  };

  return (
    <div
      className="fixed z-50 shadow-2xl rounded-xl border border-[#4d4d4d] bg-[#2a2a2a]/95 backdrop-blur-lg font-mono text-[11px] select-none text-[#cccccc] flex flex-col overflow-hidden"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: isMinimized ? '320px' : '520px',
        height: isMinimized ? '42px' : '420px',
      }}
    >
      <div
        onMouseDown={handleMouseDown}
        className="h-10 px-3 flex items-center justify-between border-b border-[#1a1a1a] bg-[#222222] cursor-grab active:cursor-grabbing flex-shrink-0"
      >
        <div className="flex items-center gap-2 font-bold text-[#ff9a3c]">
          <GripHorizontal className="w-4 h-4 text-[#666666]" />
          <Upload className="w-4 h-4 text-[#ed7300]" />
          <span>IMPORT 3D MODEL</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsMinimized(!isMinimized)}
            className="p-1 hover:bg-[#333333] rounded text-[#888888] hover:text-white"
            title={isMinimized ? 'Expand Dialog' : 'Minimize Dialog'}
          >
            {isMinimized ? <Maximize2 className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={onClose}
            className="p-1 hover:bg-rose-900/40 hover:text-rose-400 rounded text-[#888888]"
            title="Close Dialog"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {!isMinimized && (
        <div className="flex-1 p-4 flex flex-col justify-between overflow-hidden bg-[#2a2a2a]">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => !isLoading && fileInputRef.current?.click()}
            className={`flex-1 border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center cursor-pointer transition ${
              dragOver
                ? 'border-[#ed7300] bg-[#ed7300]/10 text-white'
                : preview
                  ? 'border-emerald-500/50 bg-emerald-950/20 text-emerald-300'
                  : 'border-[#4d4d4d] hover:border-[#ed7300] bg-[#2e2e2e] text-[#888888]'
            }`}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept={ACCEPT}
              className="hidden"
            />

            {isLoading ? (
              <div className="flex flex-col items-center gap-2 text-center text-[#aaaaaa]">
                <Upload className="w-10 h-10 text-[#ed7300] animate-pulse" />
                <div className="font-bold text-white text-sm">Parsing {fileName}…</div>
              </div>
            ) : preview ? (
              <div className="flex flex-col items-center gap-2 text-center">
                <CheckCircle className="w-10 h-10 text-emerald-400 animate-bounce" />
                <div className="font-bold text-white text-sm">{fileName}</div>
                <div className="text-[10px] text-emerald-400 bg-emerald-900/40 px-2.5 py-1 rounded-full border border-emerald-700/50">
                  {parsedMeshes.length > 1 ? `${parsedMeshes.length} Meshes • ` : ''}
                  {totalVerts} Vertices • {totalFaces} Faces
                </div>
                <div className="text-[9px] text-[#aaaaaa] mt-1">Click to choose a different file</div>
              </div>
            ) : errorMsg ? (
              <div className="flex flex-col items-center gap-2 text-center text-rose-400">
                <AlertCircle className="w-10 h-10 text-rose-500" />
                <div className="font-bold text-xs">{errorMsg}</div>
                <div className="text-[9px] text-[#aaaaaa]">Click or drag to try another file</div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 text-center">
                <Upload className="w-10 h-10 text-[#ed7300]" />
                <div className="font-bold text-white text-xs">Drag & Drop 3D Model File Here</div>
                <div className="text-[9px] text-[#888888]">
                  OBJ, STL, PLY, glTF/GLB, JSON, bbmodel
                </div>
                <button className="mt-2 px-3 py-1 bg-[#ed7300] text-white font-bold text-[10px] rounded-lg hover:bg-[#ff9a3c] transition shadow">
                  Browse Files
                </button>
              </div>
            )}
          </div>

          <div className="mt-4 flex items-center justify-between flex-shrink-0 pt-3 border-t border-[#1a1a1a]">
            <span className="text-[9px] text-[#666666]">Formats: .OBJ .STL .PLY .GLTF .GLB .JSON .BBMODEL</span>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="px-3 py-1.5 rounded-lg cad-button text-[#aaaaaa] font-bold text-xs"
              >
                Cancel
              </button>
              <button
                disabled={!preview}
                onClick={handleConfirmImport}
                className={`px-4 py-1.5 rounded-lg font-bold text-xs transition ${
                  preview
                    ? 'bg-[#ed7300] text-white hover:bg-[#ff9a3c] shadow-md shadow-[#ed7300]/30'
                    : 'bg-[#2a2a2a] text-[#555555] cursor-not-allowed'
                }`}
              >
                Import to Scene
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
