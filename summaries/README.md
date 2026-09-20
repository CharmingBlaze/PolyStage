# Summaries

Token-efficient module summaries for AI agents and developers.

## Usage

When an agent needs context about a module, it reads the summary instead
of the full source file.  Summaries should be:

- **Concise** — under 200 lines
- **Complete** — covers public API, dependencies, internal structure
- **Current** — regenerated when the module changes significantly

## Format

```markdown
# {module-name}

**Purpose**: One-line description
**Path**: `src/utils/example.ts`
**Dependencies**: three, ../types/cad
**Exports**: functionA, ClassB, typeC

## Public API

### `functionA(input: Type): Output`
Description of what it does.

## Internal Structure
- Helper functions
- Constants
- Types

## Usage Example
\`\`\`typescript
import { functionA } from './example';
const result = functionA({ x: 1, y: 2 });
\`\`\`
```

## Generating Summaries

Run the summary generation script:
```bash
node scripts/generate-summaries.mjs
```

Or ask the doc agent to generate a specific module summary.