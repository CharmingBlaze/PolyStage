# Three.js Dynamic Shadow System for PolyStage 3D Modeler

In a 3D modeling environment where geometry is dynamic, constantly extruded, sculpted, transformed, or rigged, baked lightmaps cannot be used. PolyStage utilizes dynamic real-time shadow mapping in Three.js, engineered to balance visual realism, texel clarity, and interactive viewport performance.

---

## 1. The Three.js Shadow Maps (Ranked by Quality)

Three.js exposes four built-in shadow map algorithms configured via `renderer.shadowMap.type`. PolyStage provides full runtime support for all four, plus a complete disable toggle.

| Algorithm | Three.js Constant | Quality Rank | Performance | Best Used For |
|---|---|---|---|---|
| **PCF Soft** | `THREE.PCFSoftShadowMap` | **#1 (Recommended)** | High / Balanced | **3D Viewport Modeling** (realistic feathered contact shadows, eliminates harsh pixel steps) |
| **PCF Standard** | `THREE.PCFShadowMap` | **#2** | Very Good | General rendering when sharper shadow silhouettes are preferred |
| **Basic** | `THREE.BasicShadowMap` | **#3** | Maximum (Fastest) | Low-end laptops, mobile GPUs, or retro/low-poly aesthetics |
| **VSM** | `THREE.VSMShadowMap` | Special | Good | Large outdoor terrains; finicky with arbitrary dynamic geometry due to light bleeding |
| **Disabled** | `enabled = false` | N/A | Highest | Maximum framerate during intense sculpting or dense vertex operations |

### 1. `THREE.PCFSoftShadowMap` (Recommended for Modelers)
- **How it works**: Uses Percentage-Closer Filtering (PCF) and averages multiple depth samples around each texel to produce feathered, soft shadow penumbras.
- **Pros**: Natural, polished visual aesthetic; conceals texel aliasing on curved and angled surfaces; looks superior on clay and PBR materials.
- **Cons**: Requires slightly higher GPU fillrate than standard PCF.

### 2. `THREE.PCFShadowMap` (The Three.js Default)
- **How it works**: Standard PCF sampling test against neighboring shadow map texels.
- **Pros**: Lower GPU memory bandwidth and slightly higher framerates than soft shadows.
- **Cons**: Edges show stair-stepped aliasing depending on the shadow map resolution and frustum volume.

### 3. `THREE.BasicShadowMap`
- **How it works**: Unfiltered single-sample depth comparison per fragment.
- **Pros**: Fastest possible shadow rendering; virtually zero filtering overhead.
- **Cons**: Hard, jagged, blocky pixel edges. Suitable for low-poly/retro aesthetics or fallback modes for high vertex count scenes.

### 4. `THREE.VSMShadowMap` (Variance Shadow Maps)
- **How it works**: Stores shadow depth and depth-squared in a 2-channel texture and uses statistical Chebyshev upper bounds to compute penumbra softness.
- **Pros**: Extremely smooth soft shadows with wide blur kernels.
- **Cons**: Suffers from "light bleeding" artifacts where solid objects allow illumination to leak through occluded geometry. Highly sensitive to scene parameters and bias, making it less reliable for dynamic arbitrary modeling meshes.

---

## 2. Core Implementation Architecture

### Renderer Configuration
The shared renderer factory (`src/utils/viewportRenderer.ts`) initializes `THREE.PCFSoftShadowMap` by default:

```typescript
// Enable dynamic shadows and set PCF Soft algorithm
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
```

When switching algorithms at runtime, Three.js requires shader material updates. PolyStage triggers `invalidateSceneShadowMaterials(scene)` to increment `material.needsUpdate`, causing Three.js to recompile shadow shader chunks cleanly without restarting the WebGL context.

### Directional Key Light & Frustum Sizing
Shadow calculations originate from the primary directional "sun" or "key" light in `src/utils/studioLighting.ts`:

```typescript
const dirLight = new THREE.DirectionalLight('#fff5ec', 2.8);
dirLight.castShadow = true;

// 1. Shadow Map Resolution (2048x2048 recommended for 3D modeling)
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;

// 2. Tightened Shadow Camera Frustum (Orthographic)
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 50;
dirLight.shadow.camera.left = -10;
dirLight.shadow.camera.right = 10;
dirLight.shadow.camera.top = 10;
dirLight.shadow.camera.bottom = -10;

// 3. Shadow Acne & Peter-Panning Biases
dirLight.shadow.bias = -0.0001;
dirLight.shadow.normalBias = 0.02;

scene.add(dirLight);
```

### Mesh Shadow Casting & Receiving
All models, primitives, and ground catchers in PolyStage declare shadow relationships:

```typescript
// Scene model meshes
meshObj.castShadow = true;
meshObj.receiveShadow = true;

// Shadow catcher ground floor
groundPlane.receiveShadow = true;
```

---

## 3. Modeler Pro-Features

### A. Shadow Camera Frustum Helper (`THREE.CameraHelper`)
To inspect shadow texel efficiency, PolyStage incorporates a wireframe frustum visualizer:

```typescript
const shadowHelper = new THREE.CameraHelper(dirLight.shadow.camera);
scene.add(shadowHelper);
```

**Why it matters**: If the wireframe frustum box is excessively large relative to the model, shadow map resolution is wasted on empty space, causing shadows on the model to appear blurry or pixelated. The helper can be toggled on/off in the Render Studio panel.

### B. Dynamic Shadows Based on Scene Size (`fitShadowCameraToScene`)
Users routinely zoom out, import large multi-part meshes, or scale objects. If geometry expands beyond the static shadow frustum bounds, shadows are abruptly cut off.

PolyStage implements `fitShadowCameraToScene`:
1. Traverses active scene meshes (ignoring helpers, grids, and floor planes).
2. Computes the collective `THREE.Box3` bounding box and bounding sphere.
3. Dynamically resizes `dirLight.shadow.camera` bounds (`left`, `right`, `top`, `bottom`) with safety padding (default 1.35x).
4. Invokes `cam.updateProjectionMatrix()` and sets `dirLight.shadow.needsUpdate = true`.

This keeps shadows as sharp and detailed as possible regardless of model scale.

### C. Shadow Acne Prevention
Shadow acne refers to moiré-like banded artifacts on flat surfaces caused by depth-buffer floating point precision limits.

- **`shadow.bias = -0.0001`**: Offsets depth comparison slightly towards the light. Excessive negative bias causes "Peter-Panning" (shadows detaching from the base of objects).
- **`shadow.normalBias = 0.02`**: Offsets depth sampling along surface normals. This prevents acne on curved and planar geometry without detaching shadows at contact points.
- **Interactive UI**: Sliders for both `bias` and `normalBias` are exposed under Render Studio, with a quick "Reset Recommended" button.

---

## 4. UI Controls in Render Studio (`RenderExportPanel.tsx`)

In the **Render Studio** sidebar (`RenderExportPanel`), the **Shadow System (Three.js)** card provides:

1. **Algorithm Switcher**:
   - `PCF Soft` (Recommended)
   - `PCF Std` (Default Three.js)
   - `Basic` (High Performance)
   - `VSM` (Variance Shadow Maps)
   - `Disabled` (Off)
2. **Resolution Selector**:
   - `1024` (Draft / Fast)
   - `2048` (Standard / Recommended 2K)
   - `4096` (High / Cinematic 4K)
3. **Dynamic Bounding**:
   - `Auto-Fit Bounds`: Continuously wraps the shadow frustum to the scene geometry.
4. **Frustum Box**:
   - `Frustum Box`: Toggles `THREE.CameraHelper` wireframe to visualize the shadow volume.
5. **Bias Adjustments**:
   - `Shadow Bias` slider (`-0.001` to `0.0001`)
   - `Normal Bias` slider (`0.00` to `0.08`)
   - `Reset Recommended Biases` button (`bias = -0.0001`, `normalBias = 0.02`)

---

## 5. File References

- **Shadow Utilities & Presets**: [`src/utils/shadowQuality.ts`](file:///c:/Users/Snow/Documents/Projects/polystage/src/utils/shadowQuality.ts)
- **Studio Lighting Rig**: [`src/utils/studioLighting.ts`](file:///c:/Users/Snow/Documents/Projects/polystage/src/utils/studioLighting.ts)
- **Shared Renderer Factory**: [`src/utils/viewportRenderer.ts`](file:///c:/Users/Snow/Documents/Projects/polystage/src/utils/viewportRenderer.ts)
- **3D Viewport Component**: [`src/components/Viewport3D.tsx`](file:///c:/Users/Snow/Documents/Projects/polystage/src/components/Viewport3D.tsx)
- **UI Settings Panel**: [`src/components/RenderExportPanel.tsx`](file:///c:/Users/Snow/Documents/Projects/polystage/src/components/RenderExportPanel.tsx)
- **Unit Tests**: [`src/utils/shadowSystem.test.ts`](file:///c:/Users/Snow/Documents/Projects/polystage/src/utils/shadowSystem.test.ts)
