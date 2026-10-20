---
description: "Execute a pipeline of commands based on a specification."
argument-hint: "[arguments]"
---

Execute a pipeline of commands based on a specification.

Arguments: $ARGUMENTS

## Command Pipeline Execution

Parse pipeline specification from arguments. Supported formats:

### Simple Pipeline
`init-project → expand-all-tasks → next-task`

### Conditional Pipeline
`project-status → if:pending>10 → list-tasks pending → else → next-task`

### Iterative Pipeline
`for:pending-tasks → expand-task → complexity-report`

### Smart Pipeline Patterns

**1. Project Setup Pipeline**
```
init-project [prd] →
expand-all-tasks →
complexity-report →
list-tasks pending →
next-task
```

**2. Daily Work Pipeline**
```
project-status →
if:in-progress → continue →
else → next-task → to-in-progress
```

**3. Task Completion Pipeline**
```
to-done [id] →
(commit your work) →
if:blocked-tasks-freed → list-tasks pending →
next-task
```

**4. Quality Check Pipeline**
```
list in-progress →
for:each → check-idle-time →
if:idle>1day → prompt-update
```

### Pipeline Features

**Variables**
- Store results: `project-status → $count=pending-count`
- Use in conditions: `if:$count>10`
- Pass between commands: `expand-task $high-priority-tasks`

**Error Handling**
- On failure: `try:to-done → catch:show-blockers`
- Skip on error: `optional:test-run`
- Retry logic: `retry:3:to-done`

**Parallel Execution**
- Parallel branches: `[analyze | test | lint]`
- Join results: `parallel → join:report`

### Execution Flow

1. Parse pipeline specification
2. Validate command sequence
3. Execute with state passing
4. Handle conditions and loops
5. Aggregate results
6. Show summary

This enables complex workflows like:
`parse-prd → expand-all-tasks → filter:complex>70 → next-task`