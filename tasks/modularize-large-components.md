# Task: Modularize Large Components

**Status**: pending
**Agent**: programmer
**Priority**: medium
**Depends on**: none

## Description

Several components exceed 500 lines and should be broken into custom
hooks for maintainability:

- `App.tsx` (~2750 lines) → extract workspace hooks
- `Viewport3D.tsx` (~210KB) → extract rendering hook, interaction hook
- `CutsceneStudio.tsx` (~254KB) → extract timeline hook, renderer hook
- `PixelPaintStudio.tsx` (~126KB) → extract tool hooks, canvas hook

## Acceptance Criteria
- [ ] `App.tsx` under 800 lines
- [ ] `Viewport3D.tsx` under 500 lines
- [ ] All tests still pass
- [ ] No behavior changes

## Files to Modify
- `src/App.tsx`
- `src/components/Viewport3D.tsx`
- `src/components/CutsceneStudio.tsx`
- `src/components/PixelPaintStudio.tsx`

## Notes

Each extracted hook should be co-located with its component (e.g.,
`src/components/viewport3d/useViewportRenderer.ts`) or in
`src/hooks/` if shared across components.