import React, { useState, useRef, useEffect } from 'react';
import {
  GripHorizontal, X, Upload, FileCode, CheckCircle, AlertCircle, Box,
  Sparkles, Maximize2, Minus, Layers
} from 'lucide-react';
import type { CADMesh } from '../types/cad';
import { import3DModelFile } from '../utils/importers';

interface ImportModelModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportMesh: (mesh: CADMesh) => void;
}

export const ImportModelModal: React.FC<ImportModelModalProps> = ({
  isOpen,
  onClose,
  onImportMesh,
}) => {
  const [position, setPosition] = useState({ x: Math.max(100, (window.innerWidth - 520) / 2), y: Math.max(80, (window.innerHeight - 420) / 2) });
  const [isDragging, setIsDragging] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [parsedMesh, setParsedMesh] = useState<CADMesh | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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

  const processFile = (file: File) => {
    setFileName(file.name);
    setErrorMsg(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      if (!content) {
        setErrorMsg('Failed to read file content.');
        return;
      }

      const mesh = import3DModelFile(file.name, content);
      if (mesh && mesh.vertices.length > 0) {
        setParsedMesh(mesh);
      } else {
        setErrorMsg(`Could not parse 3D geometry from "${file.name}". Make sure it is a valid .obj, .stl, .ply, or .json file.`);
      }
    };
    reader.readAsText(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  const handleConfirmImport = () => {
    if (parsedMesh) {
      onImportMesh(parsedMesh);
      setParsedMesh(null);
      setFileName('');
      onClose();
    }
  };

  return (
    <div
      className="fixed z-50 shadow-2xl rounded-xl border border-[#3e3e3e] bg-[#181818]/95 backdrop-blur-lg font-mono text-[11px] select-none text-[#cccccc] flex flex-col overflow-hidden"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: isMinimized ? '320px' : '520px',
        height: isMinimized ? '42px' : '420px',
      }}
    >
      {/* Title Header */}
      <div
        onMouseDown={handleMouseDown}
        className="h-10 px-3 flex items-center justify-between border-b border-[#2d2d2d] bg-[#222222] cursor-grab active:cursor-grabbing flex-shrink-0"
      >
        <div className="flex items-center gap-2 font-bold text-[#02a0e8]">
          <GripHorizontal className="w-4 h-4 text-[#666666]" />
          <Upload className="w-4 h-4 text-[#1473e6]" />
          <span>IMPORT 3D MODEL (.OBJ, .STL, .PLY, .JSON)</span>
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
        <div className="flex-1 p-4 flex flex-col justify-between overflow-hidden bg-[#181818]">
          {/* Dropzone Area */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`flex-1 border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center cursor-pointer transition ${
              dragOver
                ? 'border-[#1473e6] bg-[#1473e6]/10 text-white'
                : parsedMesh
                  ? 'border-emerald-500/50 bg-emerald-950/20 text-emerald-300'
                  : 'border-[#383838] hover:border-[#1473e6] bg-[#202020] text-[#888888]'
            }`}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".obj,.stl,.ply,.json,.bbmodel"
              className="hidden"
            />

            {parsedMesh ? (
              <div className="flex flex-col items-center gap-2 text-center">
                <CheckCircle className="w-10 h-10 text-emerald-400 animate-bounce" />
                <div className="font-bold text-white text-sm">{fileName}</div>
                <div className="text-[10px] text-emerald-400 bg-emerald-900/40 px-2.5 py-1 rounded-full border border-emerald-700/50">
                  {parsedMesh.vertices.length} Vertices • {parsedMesh.faces.length} Polygon Faces
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
                <Upload className="w-10 h-10 text-[#1473e6]" />
                <div className="font-bold text-white text-xs">Drag & Drop 3D Model File Here</div>
                <div className="text-[9px] text-[#888888]">Supports Wavefront .OBJ, .STL, .PLY, and .JSON / .BBMODEL</div>
                <button className="mt-2 px-3 py-1 bg-[#1473e6] text-white font-bold text-[10px] rounded-lg hover:bg-[#02a0e8] transition shadow">
                  Browse Files
                </button>
              </div>
            )}
          </div>

          {/* Action Footer */}
          <div className="mt-4 flex items-center justify-between flex-shrink-0 pt-3 border-t border-[#2d2d2d]">
            <span className="text-[9px] text-[#666666]">Formats: .OBJ, .STL, .PLY, .JSON</span>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="px-3 py-1.5 rounded-lg cad-button text-[#aaaaaa] font-bold text-xs"
              >
                Cancel
              </button>
              <button
                disabled={!parsedMesh}
                onClick={handleConfirmImport}
                className={`px-4 py-1.5 rounded-lg font-bold text-xs transition ${
                  parsedMesh
                    ? 'bg-[#1473e6] text-white hover:bg-[#02a0e8] shadow-md shadow-[#1473e6]/30'
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
