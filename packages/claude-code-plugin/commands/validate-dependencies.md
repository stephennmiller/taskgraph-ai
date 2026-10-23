---
description: "Validate all task dependencies for issues."
---

Validate all task dependencies for issues.

## Dependency Validation

Comprehensive check for dependency problems across the entire project.

## Execution

```bash
taskgraph validate-dependencies
```

## Validation Checks

1. **Circular Dependencies**
   - A depends on B, B depends on A
   - Complex circular chains
   - Self-dependencies

2. **Missing Dependencies**
   - References to non-existent tasks
   - Deleted task references
   - Invalid task IDs

3. **Logical Issues**
   - Completed tasks depending on pending
   - Cancelled tasks in dependency chains
   - Impossible sequences

4. **Complexity Warnings**
   - Over-complex dependency chains
   - Too many dependencies per task
   - Bottleneck tasks

5. **PRD Coverage** (once `parse-prd` has recorded each task's `metadata.source`)
   - PRD sections no task covers
   - Tasks citing a heading the PRD no longer has (renamed or removed)
   - Tasks with no PRD section

   Coverage gaps are warnings; only dependency problems make the command exit 1.

## Smart Analysis

The validation provides:
- Visual dependency graph
- Critical path analysis
- Bottleneck identification
- Suggested optimizations

## Report Format

```
Dependency Validation Report
━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ No circular dependencies found
⚠️  2 warnings found:
   - Task #23 has 7 dependencies (consider breaking down)
   - Task #45 blocks 5 other tasks (potential bottleneck)
❌ 1 error found:
   - Task #67 depends on deleted task #66

Critical Path: #1 → #5 → #23 → #45 → #50 (15 days)
```

## Actionable Output

For each issue found:
- Clear description
- Impact assessment
- Suggested fix
- Command to resolve

## Next Steps

After validation:
- Run `/taskgraph:fix-dependencies` to auto-fix
- Manually adjust problematic dependencies
- Rerun to verify fixes