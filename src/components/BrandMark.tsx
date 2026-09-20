import React from 'react';

/** Isometric octahedron — teal poly above, gold stage below. */
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
  >
    <title>{title}</title>
    {/* Lower stage facets */}
    <path d="M16 16.6 L5 17.8 L16 29.4 Z" fill="#8a7014" />
    <path d="M16 16.6 L27 14.6 L16 29.4 Z" fill="#e6b422" />
    {/* Upper poly facets */}
    <path d="M16 2.2 L5 17.8 L16 16.6 Z" fill="#006e78" />
    <path d="M16 2.2 L27 14.6 L16 16.6 Z" fill="#00b4c4" />
    <path d="M16 2.2 L20.6 13.2 L16 16.6 Z" fill="#00d4e2" />
  </svg>
);
