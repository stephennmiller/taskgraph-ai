---
description: Guidelines for managing task dependencies and relationships
paths:
  - "packages/tm-core/src/modules/dependencies/**"
---

# Dependency management

The code is in
[`packages/tm-core/src/modules/dependencies/`](../../packages/tm-core/src/modules/dependencies/).
Each file starts with a `@fileoverview` saying what it owns.

## Archived tasks

A task moved to `.taskgraph/tasks/archive.json` by `taskgraph archive` is
done for dependency purposes. Validation and fixing must not report or strip
a dependency on it: read the tag's archived IDs with
`readArchivedIdsSync(tasksPath, tag)` from `@tm/core` and test each
dependency with `isArchivedReference`. Code that picks or counts ready work
takes `satisfyArchivedDependencies(tasks, archivedIds)` first. New task IDs
come from `nextTaskId(ids, archived.highestId)` so an archived ID is never
reused.

## ID forms

- A top-level task's dependencies are stored as strings (`"3"`, `"3.2"`),
  through `toTaskDependency`. Older files may hold numbers, so compare with
  `String()`.
- A subtask's dependencies keep their type, because the type carries the
  meaning: a bare number up to 99 is a sibling, `"3"` is a task, `"3.2"` is
  that subtask. Read them with `resolveSubtaskDependency`.
- Parse what a user types with `parseSubtaskDependencyInput` (`3` is task
  3), and clean what the AI writes with `cleanGeneratedSubtaskDependencies`.

  ```typescript
  task.dependencies = ['1', '2', '3.2']; // tasks 1 and 2, subtask 3.2
  subtask.dependencies = [1, '3', '3.2']; // sibling, task 3, subtask 3.2
  ```

## Adding and removing

- `addDependencyIn` (`dependency-edit.ts`) throws, changing nothing, for a
  missing or archived target, a self-dependency, or one that would close a
  loop (`wouldCloseDependencyLoop` in `dependency-edges.ts`). Adding one
  that exists already is a no-op with a message.
- `related` and `discovered-from` links live in the task's metadata
  (`task-links.ts`), never in `dependencies`, so they can't block a task or
  make a loop.
- Removing a task removes every dependency and link to it
  (`removed-references.ts`).

## Validating and fixing

`dependency-check.ts` backs `validate-dependencies` and `fix-dependencies`.
Fixing removes what needs no decision (missing, self, duplicate, loops made
only of subtasks) and leaves loops through a task for the user to break.

## Loops

- Find loops in one pass with strongly connected components
  (`stronglyConnectedComponents` in `dependency-graph.ts`) over the edges
  `dependencyEdges` builds. A subtask also waits on its parent's
  dependencies, and a parent on its subtasks.
- Keep traversals iterative; projects have chains of 10,000+ tasks.
- Don't run a reachability search per task or per dependency (quadratic) or
  recurse along dependency chains (overflows the stack).
