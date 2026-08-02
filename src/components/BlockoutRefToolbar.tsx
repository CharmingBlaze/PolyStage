import React, { useRef } from 'react';
import {
  useVectorStore,
  type VectorRefImage,
  type VectorRefPlaneId,
} from '../store/useVectorStore';

function readRefFile(file: File, plane: VectorRefPlaneId) {
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = String(reader.result || '');
    if (!dataUrl) return;
    const img = new Image();
    img.onload = () => {
      const aspect = (img.naturalWidth || img.width || 1) / Math.max(1, img.naturalHeight || img.height || 1);
      const image: VectorRefImage = {
        name: file.name,
        dataUrl,
        opacity: 0.55,
        scale: 4,
        aspect,
        offsetU: 0,
        offsetV: 0,
        locked: false,
      };
      const store = useVectorStore.getState();
      store.setRefImage(plane, image);
      store.setRefTool('move', plane);
    };
    img.src = dataUrl;
  };
  reader.readAsDataURL(file);
}

type Props = {
  plane: VectorRefPlaneId;
};

/**
 * Front / Side viewport chrome for loading and transforming blockout reference planes.
 */
export const BlockoutRefToolbar: React.FC<Props> = ({ plane }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const refImage = useVectorStore((s) => s.refImages[plane]);
  const refTool = useVectorStore((s) => s.refTool);
  const refEditPlane = useVectorStore((s) => s.refEditPlane);
  const setRefImage = useVectorStore((s) => s.setRefImage);
  const patchRefImage = useVectorStore((s) => s.patchRefImage);
  const setRefTool = useVectorStore((s) => s.setRefTool);

  const editingHere = refEditPlane === plane && refTool !== 'none';
  const locked = Boolean(refImage?.locked);

  return (
    <div className="blockout-ref-toolbar pointer-events-auto" data-plane={plane}>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) readRefFile(file, plane);
        }}
      />

      <span className="blockout-plane-chip" data-plane={plane}>
        Ref
      </span>

      {!refImage ? (
        <button
          type="button"
          className="blockout-ref-btn primary"
          title={`Load a ${plane} reference image (3D plane, both sides)`}
          onClick={() => fileRef.current?.click()}
        >
          + Ref Image
        </button>
      ) : (
        <>
          <button
            type="button"
            className={`blockout-ref-btn ${refTool === 'move' && editingHere ? 'active' : ''}`}
            disabled={locked}
            title={locked ? 'Unlock to move' : 'Drag in the viewport to move the reference'}
            onClick={() => setRefTool(refTool === 'move' && editingHere ? 'none' : 'move', plane)}
          >
            Move
          </button>
          <button
            type="button"
            className={`blockout-ref-btn ${refTool === 'scale' && editingHere ? 'active' : ''}`}
            disabled={locked}
            title={locked ? 'Unlock to scale' : 'Drag up/down or scroll to scale'}
            onClick={() => setRefTool(refTool === 'scale' && editingHere ? 'none' : 'scale', plane)}
          >
            Scale
          </button>
          <button
            type="button"
            className={`blockout-ref-btn ${locked ? 'active lock' : ''}`}
            title={locked ? 'Unlock reference' : 'Lock position & size'}
            onClick={() => {
              patchRefImage(plane, { locked: !locked });
              if (!locked) setRefTool('none', plane);
            }}
          >
            {locked ? 'Locked' : 'Lock'}
          </button>
          <label className="blockout-ref-opacity" title="Reference opacity">
            <span>Op</span>
            <input
              type="range"
              min={0.15}
              max={0.95}
              step={0.05}
              value={refImage.opacity}
              onChange={(e) => patchRefImage(plane, { opacity: Number(e.target.value) })}
            />
          </label>
          <button
            type="button"
            className="blockout-ref-btn"
            title="Replace reference image"
            onClick={() => fileRef.current?.click()}
          >
            Replace
          </button>
          <button
            type="button"
            className="blockout-ref-btn danger"
            title="Remove reference"
            onClick={() => {
              setRefTool('none', null);
              setRefImage(plane, null);
            }}
          >
            Clear
          </button>
        </>
      )}
      {editingHere && !locked && (
        <span className="blockout-ref-hint">
          {refTool === 'move' ? 'Drag to move · Esc done' : 'Drag / scroll to scale · Esc done'}
        </span>
      )}
    </div>
  );
};
