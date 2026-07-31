import React from 'react';

/** Geometric mark — Substance-style orange facet on mid-gray tile. */
export const BrandMark: React.FC<{ size?: number; className?: string; title?: string }> = ({
  size = 20,
  className = '',
  title = 'PolyStage',
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className={className}
    role="img"
    aria-label={title}
  >
    <title>{title}</title>
    <rect width="24" height="24" rx="2" fill="#2d2d2d" stroke="#4d4d4d" strokeWidth="1" />
    <path d="M12 4.2 L19.2 12 L12 15.4 L4.8 12 Z" fill="#ed7300" />
    <path d="M12 15.4 L19.2 12 L19.2 15.6 L12 19.8 Z" fill="#ff9a3c" />
    <path d="M12 15.4 L4.8 12 L4.8 15.6 L12 19.8 Z" fill="#c96a00" />
  </svg>
);
