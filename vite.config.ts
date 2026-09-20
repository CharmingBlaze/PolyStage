import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Three.js core into its own chunk (shared across all viewports)
          if (id.includes('node_modules/three/build/three.module.js')) return 'three';
          if (id.includes('node_modules/three/')) return 'three-extras';
          // Lucide icons — huge tree but only a fraction is imported per page
          if (id.includes('node_modules/lucide-react/')) return 'lucide';
          // React + ReactDOM into framework chunk
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) return 'react';
          if (id.includes('node_modules/scheduler/')) return 'react';
          // Zustand — small but used everywhere; keep with react
          if (id.includes('node_modules/zustand/')) return 'react';
          // Three-mesh-bvh — used in viewport picking
          if (id.includes('node_modules/three-mesh-bvh/')) return 'three-extras';
          // Sequence runtime (already lazy-loaded, but additional isolation)
          if (id.includes('src/utils/sequence')) return 'sequence-runtime';
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  },
});
