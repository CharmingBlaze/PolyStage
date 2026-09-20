# Engineering Conventions: polystage

> Generated automatically by **Async IDE Living Repo Wiki**.

## Code Style & Standards
- **Language**: TypeScript (Strict mode)
- **Formatting**: Tab indentation or 2/4 spaces as configured in project root.
- **Localization**: All code, documentation, comments, and commit messages must be in English.

## Testing Conventions
- Tests run via `Vitest` (execute with `npm test` or `npx vitest run`).

## Agent Guidelines
- Always verify syntax and types via `tsc --noEmit` before marking tasks completed.
- Respect `.async/anchors` constraints and do not drift to unrequested directories.
- Use `Patch` or `Edit` for surgical updates; never discard unedited code blocks.