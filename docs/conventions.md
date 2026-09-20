# PolyStage Coding Conventions

## TypeScript

- **Strict mode** — `noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly`
- **verbatimModuleSyntax** — Use `import type` for type-only imports
- **No default exports** — Use named exports only (`export const X = ...`)
- **Interfaces over types** for object shapes (extensibility)
- **Type aliases** for unions, primitives, and utility types

```typescript
// ✅ Good
import type { CADMesh, Vector3D } from '../types/cad';
export function buildGeometry(mesh: CADMesh): THREE.BufferGeometry { ... }

// ❌ Avoid
import { CADMesh } from '../types/cad'; // type-only should use import type
export default function buildGeometry(mesh: CADMesh) { ... }
```

## React Components

- **Functional components** with hooks only
- **Props interfaces** named `{ComponentName}Props`
- **Forward refs** with `React.forwardRef` where needed
- **Lazy loading** for heavy studio components via `React.lazy()`
- **Error boundaries** wrap every major panel

```typescript
// ✅ Good
interface Viewport3DProps {
  meshes: CADMesh[];
  activeMeshId: string;
  toolState: ToolState;
}
export const Viewport3D: React.FC<Viewport3DProps> = ({ meshes, ... }) => { ... };

// ❌ Avoid
function Viewport3D(props: any) { ... }
```

## Naming

| Category      | Convention              | Example                    |
|---------------|-------------------------|----------------------------|
| Components    | PascalCase              | `Viewport3D`, `UVEditor`   |
| Hooks         | `use` + PascalCase      | `useSceneStore`            |
| Stores        | `use` + PascalCase      | `useHistoryStore`          |
| Utilities     | camelCase               | `buildThreeGeometry`       |
| Types         | PascalCase              | `CADMesh`, `ToolState`     |
| Files         | camelCase.ts/.tsx       | `meshUtils.ts`             |
| Test files    | *.test.ts               | `selection.test.ts`        |
| CSS classes   | kebab-case with prefix  | `sp-outliner__mini`        |

## CSS / Tailwind

- **Design tokens** in `src/index.css` as CSS custom properties
- **Tailwind utility classes** for layout, spacing, typography
- **Component-specific CSS** for complex chrome (panels, viewport)
- **No inline styles** except for dynamic values (positions, transforms)
- **Dark theme only** — charcoal + orange brand palette

```css
/* Design tokens in :root */
--adobe-bg: #1e2023;
--adobe-blue: #ed7300;  /* brand accent */
```

## Three.js

- **Dispose resources** — Always dispose geometries, materials, textures on unmount
- **Reuse materials** where possible, clone when per-instance tweaks needed
- **Double-buffer patterns** — Use `useRef` for mutable Three.js objects
- **RAF loops** — Always cancel animation frames on cleanup

```typescript
// ✅ Good
useEffect(() => {
  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);
  return () => {
    scene.remove(mesh);
    geometry.dispose();
    material.dispose();
  };
}, []);
```

## State Management (Zustand)

- **Single store per domain** — scene, history, vector
- **Immer-free** — Return new objects directly from setters
- **Selector pattern** — `useSceneStore((s) => s.meshes)` for granular subscriptions

## Testing (Vitest)

- **Test files co-located** with source files (`*.test.ts`)
- **Deterministic** — No random values, no network calls, no DOM
- **Pure functions preferred** — Extract logic for easy unit testing
- **Mock Three.js** when testing geometry/math utilities

```typescript
// ✅ Good
describe('edgeKey', () => {
  it('orders vertex ids consistently', () => {
    expect(edgeKey('b', 'a')).toBe('a|b');
  });
});
```

## Git

- **Conventional Commits**:
  - `feat:` — new feature
  - `fix:` — bug fix
  - `refactor:` — code restructuring
  - `docs:` — documentation
  - `test:` — test additions/updates
  - `chore:` — build/tooling
- **Branch naming**: `feat/description`, `fix/description`, `refactor/description`

## File Organization

- **Keep files under 300 lines** where possible
- **Extract hooks** from large components (>500 lines)
- **One concern per utility file** — e.g., separate selection logic from mesh building
- **Barrel exports** (`index.ts`) for module clean boundaries