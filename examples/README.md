# Usage Examples

## Studio Lighting

```typescript
import { createStudioLightRig } from '../utils/studioLighting';

const rig = createStudioLightRig(scene, { shadowQuality: 'standard' });

// In animation loop:
rig.syncToCamera(camera);

// For turntable renders:
rig.setShadowQuality('high');

// Cleanup:
rig.dispose();
```

## Custom Shadow Preset

```typescript
import { configureShadow, SHADOW_QUALITY } from '../utils/shadowQuality';

const light = new THREE.DirectionalLight('#fff', 3);
configureShadow(light, SHADOW_QUALITY.high, 12); // 4096px, tight bias, 12u span
scene.add(light);
```

## Zustand Store Selector

```typescript
import { useSceneStore } from '../store/useSceneStore';

// Granular subscription — only re-renders when activeMeshId changes
const activeMeshId = useSceneStore((s) => s.activeMeshId);
const setSelectedMeshId = useSceneStore((s) => s.setSelectedMeshId);
```