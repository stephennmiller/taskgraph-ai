---
description: "Parse PRD with enhanced research mode for better task generation."
argument-hint: "[PRD file path]"
---

Parse PRD with enhanced research mode for better task generation.

Arguments: $ARGUMENTS (PRD file path)

## Research-Enhanced Parsing

Uses the research role, which runs on Claude Code with web search and fetch access, for more comprehensive task generation with current best practices.

## Execution

```bash
taskgraph parse-prd --input=$ARGUMENTS --research
```

## Research Benefits

1. **Current Best Practices**
   - Latest framework patterns
   - Security considerations
   - Performance optimizations
   - Accessibility requirements

2. **Technical Deep Dive**
   - Implementation approaches
   - Library recommendations
   - Architecture patterns
   - Testing strategies

3. **Comprehensive Coverage**
   - Edge cases consideration
   - Error handling tasks
   - Monitoring setup
   - Deployment tasks

## Enhanced Output

Research mode typically:
- Generates more detailed tasks
- Includes industry standards
- Adds compliance considerations
- Suggests modern tooling

## Acceptance criteria

Each generated task comes with 2-5 acceptance criteria, all unchecked. `taskgraph show <id>` numbers them, and `set-status done` refuses the task until every one is checked off with `taskgraph set-status --id=<id> --check <n>` (or `/taskgraph:to-done <id>`, which checks them against your changes first). Read them when you start a task: they say what "done" means.

## When to Use

- New technology domains
- Complex requirements
- Regulatory compliance needed
- Best practices crucial