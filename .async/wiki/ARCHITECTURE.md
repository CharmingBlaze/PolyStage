# System Architecture: polystage

> Generated automatically by **Async IDE Living Repo Wiki** on 2026-09-20.

## Overview
PolyStage — low-poly game content studio (model, paint, UV, rig, anim, cutscenes)

## Technology Stack
- **Runtime & Language**: TypeScript / Node.js
- **Core Frameworks**: React, Vite, TailwindCSS
- **Test Runner**: Vitest

## Core Subsystems & Directory Layout
- `/agents`: Subsystem source tree.
- `/docs`: Subsystem source tree.
- `/examples`: Subsystem source tree.
- `/js`: Subsystem source tree.
- `/public`: Subsystem source tree.
- `/scripts`: Subsystem source tree.
- `/specs`: Subsystem source tree.
- `/src`: Subsystem source tree.
- `/summaries`: Subsystem source tree.
- `/tasks`: Subsystem source tree.

## Architectural Principles
1. **Local-First & Safe**: All persistence, indexes, and session anchors remain within workspace `.async/` or user cache.
2. **Atomic Patches**: Multi-file code modifications apply atomically with rollback on failure.
3. **Anti-Drift Anchoring**: Agent reasoning is anchored to specified constraints, milestones, and factual memory.
4. **English Default**: Code, comments, documentation, and agent outputs default to clean, idiomatic English.