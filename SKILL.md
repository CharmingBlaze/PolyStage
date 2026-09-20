---
name: polystage-design-system
description: PolyStage 3D modeling application — anti-slop design system adapted from TasteSkill. Desktop-first tool UI with stylus parity. Applies color consistency lock, shape consistency lock, z-index restraint, and the Neochrome palette.
---

# PolyStage Design System (TasteSkill-Adapted)

> Desktop 3D modeling application. Not a landing page, not a dashboard.
> TasteSkill core discipline applied to tool UI: color lock, shape lock, z-index scale, ban list.

---

## 0. DESIGN READ

**Reading this as: desktop 3D modeling tool for game artists and indie devs, with a calm-professional tool language, leaning toward custom CSS + Tailwind utilities + restrained motion. Audience: long-session users who need low eye strain, muscle memory, and stylus parity.**

---

## 1. THREE DIALS (Tool-App Adaptation)

- **DESIGN_VARIANCE: 3** — Predictable tool layout. Toolbar left, viewport center, panels right. Stable muscle memory. No asymmetry in the chrome.
- **MOTION_INTENSITY: 2** — Static chrome. CSS `:hover` and `:active` states only. No automatic animations. Viewport is 3D real-time; UI must not compete.
- **VISUAL_DENSITY: 6** — Daily app density. Tight enough for power users, airy enough to scan. Collapsible sections for progressive disclosure.

---

## 2. THE LOCKS (Enforced)

### Color Consistency Lock
**One accent across the entire application: Teal `#00b4c4`.**
Gold `#e6b422` for selection highlight only (semantic, not decorative).
The accent does not change between panels, modals, or workspaces.

### Shape Consistency Lock
**One corner-radius system: `6px` for all cards, panels, inputs, buttons.**
Modal containers: `8px`.  Toolbar buttons: `6px`.  No pill shapes, no sharp corners.

### Page Theme Lock
**Dark mode only.**  The viewport is dark; a light panel would blind the user.
Off-black (`#16191e`) to off-white (`#e2e6ec`).  **Never pure `#000000` or `#ffffff`.**

---

## 3. ANTI-SLOP BANS (Tool-App Adaptation)

The following TasteSkill bans apply directly:

| Ban | Reason |
|-----|--------|
| **Pure `#000` and `#fff`** | Eye strain in dark environments |
| **Em-dashes / en-dashes** | Use hyphens or restructure |
| **Decorative status dots** | Only for real semantic state (recording, synced) |
| **`z-50`, `z-10` spam** | Use documented z-index scale (see §4) |
| **Three-equal-card rows** | Use hierarchical layouts in panels |
| **AI-purple / mesh blob gradients** | Neutral dark base, one teal accent |
| **`window.addEventListener('scroll')`** | Use ResizeObserver, IntersectionObserver |
| **Div-based fake UI** | Real interactive controls only |

Additional tool-app-specific bans:

| Ban | Reason |
|-----|--------|
| **9px body text** | Minimum 11.5px for readability |
| **Arbitrary padding values** | Use semantic spacing scale (4, 6, 8, 12, 16, 20, 28, 40) |
| **Inline `style={{}}` objects** | Use Tailwind classes or CSS custom properties |
| **Unlabeled icon buttons** | Every icon button needs `aria-label` |
| **`border-t border-b` on list rows** | Use alternating bg colors or cards |

---

## 4. Z-INDEX SCALE (Documented)

```
┌──────┬─────────────────────────────┐
│ z-0  │ Default stacking            │
│ z-10 │ Dropdown menus, popovers    │
│ z-20 │ Sticky panel headers        │
│ z-30 │ Floating panels (draggable) │
│ z-40 │ Modals, dialogs             │
│ z-50 │ Tooltips                    │
│ z-60 │ Toast notifications         │
│ z-70 │ Drag preview (highest)      │
└──────┴─────────────────────────────┘
```

No arbitrary values. No `z-[100000]`. Every z-index maps to this scale.

---

## 5. MOTION RULES

- **UI transitions**: `transition: all 150ms cubic-bezier(0.16, 1, 0.3, 1)` on hover/active states only
- **No scroll-driven animation** — this is a desktop app, not a scroll-based page
- **`prefers-reduced-motion: reduce`** — disable all transitions
- **Viewport (Three.js)** — never throttled. 3D rendering is separate from UI rendering

---

## 6. TYPOGRAPHY

- **Body**: Inter, 11.5px / 500 weight / 1.45 line-height
- **Headings**: Inter, 13px / 600 weight / 1.3 line-height
- **Monospace**: Source Code Pro, 11px / 500 weight — for coordinates, values, IDs ONLY
- **Numbers in prose**: `font-mono` mandatory (TasteSkill §6.C)

---

## 7. DARK MODE (The Only Mode)

```
Surface Hierarchy:
  App BG:     #16191e  (deepest)
  Panel:      #1c1f26  (sidebar chrome)
  Card:       #21242c  (inset sections)
  Elevated:   #282c35  (hover, active)
  Border:     #1a1c22  (separators)
  Border Hi:  #3a3f4a  (focus, active border)
```

Contrast ratios all exceed WCAG AA (4.5:1 for body, 3:1 for large).

---

## 8. PRE-FLIGHT CHECKLIST

Before shipping any UI change:

- [ ] No pure `#000` or `#fff` anywhere
- [ ] All z-indices from documented scale
- [ ] All icon buttons have `aria-label`
- [ ] No font size below 10px
- [ ] Accent color is teal `#00b4c4` (or gold `#e6b422` for selection)
- [ ] Corner radius is 6px (or 8px for modals)
- [ ] Spacing values from semantic scale
- [ ] `prefers-reduced-motion` respected
- [ ] Contrast ratios pass WCAG AA
- [ ] Build passes, tests pass