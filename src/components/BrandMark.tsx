import React from 'react';

/**
 * PolyStage mark: an open isometric poly-cube with a stage cut into its
 * front plane. The broad silhouette stays recognizable down to 16px.
 */
export const BrandMark: React.FC<{ size?: number; className?: string; title?: string }> = ({
  size = 20,
  className = '',
  title = 'PolyStage',
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 32 32"
    className={className}
    role="img"
    aria-label={title}
    shapeRendering="geometricPrecision"
  >
    <title>{title}</title>
    <path d="M16 2.25 29 9.35 16 16.45 3 9.35 16 2.25Z" fill="#62e1e7" />
    <path d="M3 9.35 16 16.45V29.75L3 22.65V9.35Z" fill="#087783" />
    <path d="M16 16.45 29 9.35V22.65L16 29.75V16.45Z" fill="#00b4c4" />
    <path d="M16 18.85 23.75 14.62V20.48L16 24.72V18.85Z" fill="#15171c" />
    <path d="M16 24.72 23.75 20.48 26.15 21.8 16 27.35 11.1 24.68 13.5 23.37 16 24.72Z" fill="#7ce7eb" />
  </svg>
);
