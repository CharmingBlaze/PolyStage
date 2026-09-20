# Agent Workflows

## Agent Types

| Agent | Role | Triggers |
|-------|------|----------|
| **planner** | Task decomposition, architecture planning | Large feature requests |
| **programmer** | Code implementation, refactoring | Implementation tasks |
| **tester** | Test generation, test maintenance | Code changes, new features |
| **doc-writer** | Documentation generation | Missing docs, API changes |
| **reviewer** | Code review, convention enforcement | PR review requests |

## Workflow: Feature Implementation

1. **User request** → Create task file in `/tasks/`
2. **Planner agent** → Generates `/specs/{feature}.md` with architecture
3. **Programmer agent** → Implements code, writes tests
4. **Tester agent** → Validates test coverage, runs CI
5. **Doc-writer agent** → Updates `/docs/`, generates summaries
6. **Reviewer agent** → Reviews diff against conventions

## Task File Format

Tasks live in `/tasks/` as Markdown files:

```markdown
# {task-id}

**Status**: pending | in-progress | done
**Agent**: programmer | planner | tester | doc-writer
**Priority**: high | medium | low
**Depends on**: {task-id} (optional)

## Description
Brief description of what needs to be done.

## Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2

## Files to Modify
- `src/utils/example.ts`
- `src/components/Example.tsx`

## Notes
Any additional context or constraints.
```

## CI Pipeline

On every push / PR:
1. `npm run lint` — Oxlint (0 errors required)
2. `npm run build` — TypeScript + Vite (must pass)
3. `npm test` — Vitest (all tests must pass)

## Communication

Agents communicate through:
- Task files in `/tasks/`
- Comments on diffs
- Module summaries in `/summaries/`
- Spec documents in `/specs/`