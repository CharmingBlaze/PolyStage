# Scripts

Automation and verification scripts.

| Script | Purpose |
|--------|---------|
| `verify-paint-live-preview.mjs` | Playwright-based E2E verification of 3D paint → texture preview sync |

## Running

```bash
node scripts/verify-paint-live-preview.mjs
```

## Conventions

- Use `.mjs` extension for Node ESM scripts
- Use `#!/usr/bin/env node` shebang for executable scripts
- Keep scripts self-contained with minimal dependencies