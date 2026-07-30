import React from 'react';

/** Geometric mark — not letter initials (avoids Photoshop "PS" look). */
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
    {/* Soft dark tile — not Adobe blue */}
    <rect width="24" height="24" rx="5" fill="#1c2433" />
    {/* Low-poly stage / facet gem */}
    <path d="M12 4.2 L19.2 12 L12 15.4 L4.8 12 Z" fill="#e68619" />
    <path d="M12 15.4 L19.2 12 L19.2 15.6 L12 19.8 Z" fill="#f0a85a" />
    <path d="M12 15.4 L4.8 12 L4.8 15.6 L12 19.8 Z" fill="#b45309" />
    <path d="M12 4.2 L19.2 12 L12 15.4 Z" fill="#5aa0ff" opacity="0.85" />
  </svg>
);
