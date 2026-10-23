---
description: "Add a dependency between tasks."
argument-hint: "[arguments]"
---

Add a dependency between tasks.

Arguments: $ARGUMENTS

Parse the task IDs to establish dependency relationship.

## Adding Dependencies

Creates a dependency where one task must be completed before another can start.

## Argument Parsing

Parse natural language or IDs:
- "make 5 depend on 3" → task 5 depends on task 3
- "5 needs 3" → task 5 depends on task 3
- "5 3" → task 5 depends on task 3
- "5 after 3" → task 5 depends on task 3

## Execution

```bash
taskgraph add-dependency --id=<task-id> --depends-on=<dependency-id>
```

## Links That Don't Block

When the tasks are only connected ("5 is related to 3", "found 5 while doing 3"), link them without making one wait:

```bash
taskgraph add-dependency --id=5 --depends-on=3 --type=related
taskgraph add-dependency --id=5 --depends-on=3 --type=discovered-from
```

These never block `next` or show up in `why`; `show` lists them after the task's dependencies.

## Validation

Before adding:
1. **Verify both tasks exist**
2. **Check for circular dependencies**
3. **Ensure dependency makes logical sense**
4. **Warn if creating complex chains**

## Smart Features

- Detect if dependency already exists
- Suggest related dependencies
- Show impact on task flow
- Update task priorities if needed

## Post-Addition

After adding dependency:
1. Show updated dependency graph
2. Identify any newly blocked tasks
3. Suggest task order changes
4. Update project timeline

## Example Flows

```
/taskgraph:add-dependency 5 needs 3
→ Task #5 now depends on Task #3
→ Task #5 is now blocked until #3 completes
→ Suggested: Also consider if #5 needs #4
```