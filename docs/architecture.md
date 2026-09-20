# PolyStage Architecture

## Overview

PolyStage is a browser-based low-poly game content studio built with
React 19 + Three.js 0.185 + Zustand 5.  It replaces the legacy
Blockbench codebase (`js/`) with a modern TypeScript/React front-end.

## Tech Stack

| Layer         | Technology                      |
|---------------|---------------------------------|
| UI Framework  | React 19, JSX transform         |
| 3D Engine     | Three.js 0.185, three-mesh-bvh  |
| State         | Zustand 5                       |
| Styling       | Tailwind CSS 4, CSS modules     |
| Build         | Vite 8, Rolldown                |
| Type Check    | TypeScript 6, tsc -b            |
| Lint          | Oxlint (oxc)                    |
| Test          | Vitest 4                        |
| Icons         | Lucide React                    |

## Directory Map

```
polystage/
├── src/
│   ├── components/      # React UI panels (viewport, toolbars, modals)
│   │   └── cutscene/    # Cutscene-specific sub-components
│   ├── hooks/           # Shared React hooks
│   ├── store/           # Zustand stores (scene, history, vector)
│   ├── styles/          # Additional CSS files
│   ├── types/           # TypeScript type definitions (cad.ts, sequence.ts)
│   ├── utils/           # Domain logic (mesh, UV, paint, rig, animation)
│   │   ├── topology/    # Low-level mesh topology ops
│   │   └── bvh/         # BVH acceleration for raycasting
│   ├── assets/          # Static assets (SVG, images)
│   ├── App.tsx          # Root application component
│   ├── main.tsx         # Entry point
│   └── index.css        # Global styles + design tokens
├── js/                  # Legacy Blockbench code (unused, reference only)
├── public/              # Static public assets
├── docs/                # Architecture, conventions, screenshots
├── specs/               # Feature specifications
├── tasks/               # Atomic task files for agents
├── summaries/           # File/module summaries (token-efficient context)
├── agents/              # Agent configurations and workflows
├── examples/            # Usage examples
├── scripts/             # Automation and verification scripts
├── dist/                # Production build output
├── vite.config.ts       # Vite build configuration
├── tsconfig.json        # TypeScript project references
├── tsconfig.app.json    # App TypeScript config
├── tsconfig.node.json   # Node TypeScript config (vite.config)
└── package.json         # Dependencies and scripts
```

## Module Architecture

### State Layer (`src/store/`)
- **useSceneStore** — Mesh/bone data, selection state, edit mode
- **useHistoryStore** — Undo/redo with per-workspace providers
- **useVectorStore** — Vector blockout state and revision tracking

### Rendering Layer (`src/components/`)
- **Viewport3D** — Primary 3D viewport with orbit controls, gizmos, selection
- **QuadViewport** — 4-up layout (perspective/top/front/side)
- **UVEditor** / **UVEditorModal** — 2D UV editing canvas
- **CutsceneStudio** — Cinematic timeline, cameras, lights, weather
- **PixelPaintStudio** — Pixel art texture painting
- **FullAnimationStudio** — Dope sheet + graph editor
- **RiggingPanel** — Skeleton creation, binding, weight painting
- **MaterialPanel** / **PropertiesPanel** / **OutlinerPanel** — Inspector panels

### Domain Logic (`src/utils/`)
- **meshUtils** — Primitive generation, geometry building, ID generation
- **meshCutTools** — Loop cut, knife tool, edge loops
- **modalMeshOps** — Blender-style modal extrude/inset/bevel
- **mirrorModeling** — Symmetry, live mirror, modifiers
- **subdivision** — Catmull-Clark subdivision surfaces
- **selection** — Vertex/edge/face selection utilities
- **rigging** — Bone deformation, weight painting, IK
- **paint3dSurface** — 3D viewport surface painting
- **pixelPaint** — 2D pixel painting canvas logic
- **uvUnwrapUtils** / **uvAdvanced** / **uvTopology** — UV mapping
- **vectorBlockout** — Vector-based blockout modeling
- **studioLighting** — Professional 3-point light rig
- **shadowQuality** — Shadow map quality presets
- **viewportRenderer** — Shared WebGL renderer factory
- **importers** / **exporters** / **glbExport** — File I/O

### Type System (`src/types/`)
- **cad.ts** — Core CAD types (mesh, bone, light, camera, tool state)
- **sequence.ts** — Cutscene sequence/timeline types

## Data Flow

```
User Input → React Event → Zustand Store → useSceneStore
                                            ↓
                         Viewport3D ← useEffect ← meshes/bones state
                              ↓
                    Three.js Scene ← buildThreeGeometry()
                              ↓
                       WebGL Renderer
```

## Key Design Decisions

1. **CADMesh as source of truth** — All geometry is stored as logical
   vertex/edge/face data, not Three.js BufferGeometry.  Three.js meshes
   are rebuilt on every change via `buildThreeGeometry()`.

2. **Lazy-loaded studios** — CutsceneStudio and PixelPaintStudio are
   `React.lazy()` imports to keep the initial bundle under 1MB.

3. **Camera-relative lighting** — The studio light rig follows the orbit
   camera so models are always well-lit from any angle.

4. **Modal mesh operators** — Extrude, inset, bevel, loop cut, and knife
   use Blender-style modal interaction (LMB confirm, Esc/RMB cancel).

5. **BVH acceleration** — three-mesh-bvh provides fast raycasting for
   vertex/edge/face picking and 3D paint strokes.