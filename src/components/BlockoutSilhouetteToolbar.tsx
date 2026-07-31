import React from 'react';
import { useVectorStore, type VectorRefPlaneId } from '../store/useVectorStore';

type Props = {
  plane: VectorRefPlaneId;
};

/**
 * Front/Side chrome: seed width/depth cages + point edit modes (mirror vs free).
 */
export const BlockoutSilhouetteToolbar: React.FC<Props> = ({ plane }) => {
  const paths = useVectorStore((s) => s.paths);
  const mode = useVectorStore((s) => s.mode);
  const pointEditMode = useVectorStore((s) => s.pointEditMode);
  const seedCompanionCage = useVectorStore((s) => s.seedCompanionCage);
  const setMode = useVectorStore((s) => s.setMode);
  const setActivePlane = useVectorStore((s) => s.setActivePlane);
  const setPointEditMode = useVectorStore((s) => s.setPointEditMode);

  const self = paths[plane];
  const otherPlane = plane === 'front' ? 'side' : 'front';
  const other = paths[otherPlane];
  const canSeed = other.closed && other.anchors.length >= 3 && !self.closed;
  const canEdit = self.anchors.length > 0;

  const enterEdit = (editMode: 'symmetric' | 'free') => {
    setActivePlane(plane);
    setMode('edit');
    setPointEditMode(editMode);
  };

  if (!canSeed && !canEdit) return null;

  return (
    <div className="blockout-sil-toolbar pointer-events-auto">
      {canSeed ? (
        <>
          <button
            type="button"
            className="blockout-ref-btn primary"
            title={
              plane === 'front'
                ? 'Add an editable Front width cage from the Side silhouette — drag points to set body width'
                : 'Add an editable Side depth cage from the Front silhouette — drag points to set depth'
            }
            onClick={() => seedCompanionCage(plane)}
          >
            {plane === 'front' ? '+ Width Polygon' : '+ Depth Polygon'}
          </button>
          <span className="blockout-ref-hint">
            {plane === 'front'
              ? 'Side profile ready — add Front lines to edit width'
              : 'Front ready — add Side lines to edit depth'}
          </span>
        </>
      ) : null}

      {canEdit ? (
        <>
          <button
            type="button"
            className={`blockout-ref-btn ${mode === 'edit' && pointEditMode === 'symmetric' ? 'active' : ''}`}
            title="Edit with Mirror — paired points move together when Mirror is on"
            onClick={() => enterEdit('symmetric')}
          >
            Mirror Move
          </button>
          <button
            type="button"
            className={`blockout-ref-btn ${mode === 'edit' && pointEditMode === 'free' ? 'active' : ''}`}
            title="Free Move — drag one point at a time with no mirroring"
            onClick={() => enterEdit('free')}
          >
            Free Move
          </button>
        </>
      ) : null}
    </div>
  );
};
