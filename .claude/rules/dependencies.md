---
description: Guidelines for managing task dependencies and relationships
paths:
  - "scripts/modules/dependency-manager.js"
---

# Dependency Management Guidelines

## Archived tasks

A task moved to `.taskgraph/tasks/archive.json` by `taskgraph archive` is done for dependency purposes. Validation and fixing must not report or strip a dependency on it: read the tag's archived IDs with `readArchivedIdsSync(tasksPath, tag)` from `@tm/core` and test each dependency with `isArchivedReference`. Code that picks or counts ready work takes `satisfyArchivedDependencies(tasks, archivedIds)` first. New task IDs come from `nextTaskId(ids, archived.highestId)` so an archived ID is never reused.

## Dependency Structure Principles

- **Dependency References**:
  - ✅ DO: Represent task dependencies as arrays of task IDs
  - ✅ DO: Store a top-level task's dependencies as strings (`"3"`, `"3.2"`), the form tm-core's file storage saves; older files may still hold numbers, so compare with `String()`
  - ✅ DO: On a subtask, keep the type: a bare number up to 99 is a sibling, `"3"` is a task, `"3.2"` is that subtask
  - ❌ DON'T: Mix reference types without proper conversion

  ```javascript
  // ✅ DO: Use consistent dependency formats
  // For main tasks
  task.dependencies = ["1", "2", "3.2"]; // Tasks 1 and 2, subtask 3.2

  // For subtasks of task 2
  subtask.dependencies = [1, "3", "3.2"]; // Sibling 2.1, task 3, subtask 3.2
  ```

- **Subtask Dependencies**:
  - ✅ DO: Read and write them by the rule in `@tm/core` (`resolveSubtaskDependency`): a number up to 99 is a sibling, a dotted string is that subtask, anything else is a task
  - ✅ DO: Parse IDs a user types with `parseSubtaskDependencyInput` (`3` is task 3, as in `add-dependency`), and clean what the AI writes with `cleanGeneratedSubtaskDependencies`
  - ✅ DO: Allow numeric subtask IDs to reference other subtasks within the same parent
  - ✅ DO: Convert between formats appropriately when needed
  - ❌ DON'T: Create circular dependencies between subtasks

  ```javascript
  // ✅ DO: Properly normalize subtask dependencies
  // When a subtask refers to another subtask in the same parent
  if (typeof depId === 'number' && depId < 100) {
    // It's likely a reference to another subtask in the same parent task
    const fullSubtaskId = `${parentId}.${depId}`;
    // Now use fullSubtaskId for validation
  }
  ```

## Dependency Validation

- **Existence Checking**:
  - ✅ DO: Validate that referenced tasks exist before adding dependencies
  - ✅ DO: Provide clear error messages for non-existent dependencies
  - ✅ DO: Remove references to non-existent tasks during validation

  ```javascript
  // ✅ DO: Check if the dependency exists before adding
  if (!taskExists(data.tasks, formattedDependencyId)) {
    log('error', `Dependency target ${formattedDependencyId} does not exist in tasks.json`);
    process.exit(1);
  }
  ```

- **Circular Dependency Prevention**:
  - ✅ DO: Check for circular dependencies before adding new relationships
  - ✅ DO: Use graph traversal algorithms (DFS) to detect cycles
  - ✅ DO: Provide clear error messages explaining the circular chain

  ```javascript
  // ✅ DO: Check for circular dependencies before adding
  const dependencyChain = [formattedTaskId];
  if (isCircularDependency(data.tasks, formattedDependencyId, dependencyChain)) {
    log('error', `Cannot add dependency ${formattedDependencyId} to task ${formattedTaskId} as it would create a circular dependency.`);
    process.exit(1);
  }
  ```

- **Self-Dependency Prevention**:
  - ✅ DO: Prevent tasks from depending on themselves
  - ✅ DO: Handle both direct and indirect self-dependencies

  ```javascript
  // ✅ DO: Prevent self-dependencies
  if (String(formattedTaskId) === String(formattedDependencyId)) {
    log('error', `Task ${formattedTaskId} cannot depend on itself.`);
    process.exit(1);
  }
  ```

## Dependency Modification

- **Adding Dependencies**:
  - ✅ DO: Format task and dependency IDs consistently
  - ✅ DO: Check for existing dependencies to prevent duplicates
  - ✅ DO: Sort dependencies for better readability
  - ✅ DO: Store a top-level task's dependencies through `toTaskDependency` from `@tm/core` (`"3"` for a task, `"3.2"` for a subtask); never on a subtask's list, where a bare number is a sibling

  ```javascript
  // ✅ DO: Format IDs consistently when adding dependencies
  const formattedTaskId = typeof taskId === 'string' && taskId.includes('.') 
    ? taskId : parseInt(taskId, 10);
  
  const formattedDependencyId = formatTaskId(dependencyId);
  ```

- **Removing Dependencies**:
  - ✅ DO: Check if the dependency exists before removing
  - ✅ DO: Handle different ID formats consistently
  - ✅ DO: Provide feedback about the removal result

  ```javascript
  // ✅ DO: Properly handle dependency removal
  const dependencyIndex = targetTask.dependencies.findIndex(dep => {
    // Convert both to strings for comparison
    let depStr = String(dep);
    
    // Handle relative subtask references
    if (typeof dep === 'number' && dep < 100 && isSubtask) {
      const [parentId] = formattedTaskId.split('.');
      depStr = `${parentId}.${dep}`;
    }
    
    return depStr === normalizedDependencyId;
  });
  
  if (dependencyIndex === -1) {
    log('info', `Task ${formattedTaskId} does not depend on ${formattedDependencyId}, no changes made.`);
    return;
  }
  
  // Remove the dependency
  targetTask.dependencies.splice(dependencyIndex, 1);
  ```

## Dependency Cleanup

- **Duplicate Removal**:
  - ✅ DO: Use Set objects to identify and remove duplicates
  - ✅ DO: Handle both numeric and string ID formats

  ```javascript
  // ✅ DO: Remove duplicate dependencies
  const uniqueDeps = new Set();
  const uniqueDependencies = task.dependencies.filter(depId => {
    // Convert to string for comparison to handle both numeric and string IDs
    const depIdStr = String(depId);
    if (uniqueDeps.has(depIdStr)) {
      log('warn', `Removing duplicate dependency from task ${task.id}: ${depId}`);
      return false;
    }
    uniqueDeps.add(depIdStr);
    return true;
  });
  ```

- **Invalid Reference Cleanup**:
  - ✅ DO: Check for and remove references to non-existent tasks
  - ✅ DO: Check for and remove self-references
  - ✅ DO: Track and report changes made during cleanup

  ```javascript
  // ✅ DO: Filter invalid task dependencies
  task.dependencies = task.dependencies.filter(depId => {
    const numericId = typeof depId === 'string' ? parseInt(depId, 10) : depId;
    if (!validTaskIds.has(numericId)) {
      log('warn', `Removing invalid task dependency from task ${task.id}: ${depId} (task does not exist)`);
      return false;
    }
    return true;
  });
  ```

## Dependency Visualization

- **Status Indicators**:
  - ✅ DO: Use visual indicators to show dependency status (✅/⏱️)
  - ✅ DO: Format dependency lists consistently

  ```javascript
  // ✅ DO: Format dependencies with status indicators
  function formatDependenciesWithStatus(dependencies, allTasks) {
    if (!dependencies || dependencies.length === 0) {
      return 'None';
    }
    
    return dependencies.map(depId => {
      const depTask = findTaskById(allTasks, depId);
      if (!depTask) return `${depId} (Not found)`;
      
      const isDone = depTask.status === 'done';
      const statusIcon = isDone ? '✅' : '⏱️';
      
      return `${statusIcon} ${depId} (${depTask.status})`;
    }).join(', ');
  }
  ```

## Cycle Detection

- **Graph Traversal**:
  - ✅ DO: Find loops with strongly connected components, in one pass:
    `buildDependencyGraph` then `findLoopMembers` (validate) or
    `breakSubtaskLoops` (fix), built on `findStronglyConnectedComponents`
  - ✅ DO: Keep traversals iterative; projects have chains of 10,000+ tasks
  - ✅ DO: Support both task and subtask dependencies
  - ❌ DON'T: Run a reachability search per task or per dependency (quadratic)
    or recurse along dependency chains (overflows the stack)

  ```javascript
  // ✅ DO: Reuse the one-pass helpers
  const graph = buildDependencyGraph(tasks);
  const inLoop = findLoopMembers(graph); // Set of full IDs ("3", "3.2")
  ```

Refer to [`dependency-manager.js`](../../scripts/modules/dependency-manager.js) for implementation examples and `new-features.md` for integration guidelines. 