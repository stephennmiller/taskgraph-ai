---
description: Guidelines for implementing CLI commands using Commander.js
paths:
  - "apps/cli/src/program.ts"
  - "apps/cli/src/command-registry.ts"
  - "apps/cli/src/commands/**/*.ts"
---

# Command-Line Interface Implementation Guidelines

**Note on Interaction Method:**

While this document details the implementation of TaskGraph's **CLI commands**, the **preferred method for interacting with TaskGraph in integrated environments (like Claude Code) is through the MCP server tools**. 

- **Use MCP Tools First**: Always prefer using the MCP tools (e.g., `get_tasks`, `add_task`) when interacting programmatically or via an integrated tool. They offer better performance, structured data, and richer error handling. See `taskgraph.md` for a comprehensive list of MCP tools and their corresponding CLI commands.
- **CLI as Fallback/User Interface**: The `taskgraph` CLI commands described here are primarily intended for:
    - Direct user interaction in the terminal.
    - A fallback mechanism if the MCP server is unavailable or a specific functionality is not exposed via an MCP tool.
- **Implementation Context**: This document (`commands.md`) focuses on the standards for *implementing* the CLI commands using Commander.js in `apps/cli/src/commands/`, registered in [`command-registry.ts`](../../apps/cli/src/command-registry.ts) and run by [`program.ts`](../../apps/cli/src/program.ts).

How output should look (results, errors, prompts, spinners) is in `ui.md`. This file covers command structure; its examples print the way `ui.md` describes.

## Command Structure Standards

- **Basic Command Template**:
  ```javascript
  // ✅ DO: Follow this structure for all commands
  programInstance
    .command('command-name')
    .description('Clear, concise description of what the command does')
    .option('-o, --option <value>', 'Option description', 'default value')
    .option('--long-option <value>', 'Option description')
    .action(async (options) => {
      // Command implementation
    });
  ```

- **Command Handler Organization**:
  - ✅ DO: Keep action handlers concise and focused
  - ✅ DO: Extract core functionality to appropriate modules
  - ✅ DO: Have the action handler import and call the relevant functions from core modules, like `task-manager.js`, passing the parsed `options`.
  - ✅ DO: Perform basic parameter validation, such as checking for required options, within the action handler or at the start of the called core function.
  - ❌ DON'T: Implement business logic in command handlers

## Removal/Delete Commands

See `commands-removal.md` for commands that delete or remove data, like `remove-task`.

## Option Naming Conventions

- **Command Names**:
  - ✅ DO: Use kebab-case for command names (`analyze-complexity`)
  - ❌ DON'T: Use camelCase for command names (`analyzeComplexity`)
  - ✅ DO: Use descriptive, action-oriented names

- **Option Names**:
  - ✅ DO: Use kebab-case for long-form option names, like `--output-format`
  - ✅ DO: Provide single-letter shortcuts when appropriate, like `-f, --file`
  - ❌ DON'T: Give a short flag a second meaning: `-p` is `--project` in every command (#882), so `--prompt` and `--parent` have no short form
  - ✅ DO: Use consistent option names across similar commands
  - ❌ DON'T: Use different names for the same concept, such as `--file` in one command and `--path` in another

  ```javascript
  // ✅ DO: Use consistent option naming
  .option('-f, --file <path>', 'Path to the tasks file', 'tasks/tasks.json')
  .option('-o, --output <dir>', 'Output directory', 'tasks')
  
  // ❌ DON'T: Use inconsistent naming
  .option('-f, --file <path>', 'Path to the tasks file')
  .option('-p, --path <dir>', 'Output directory') // Should be --output
  ```

  > **Note**: Although options are defined with kebab-case, like `--num-tasks`, Commander.js stores them internally as camelCase properties. Access them in code as `options.numTasks`, not `options['num-tasks']`.

- **Boolean Flag Conventions**:
  - ✅ DO: Use positive flags with `--skip-` prefix for disabling behavior
  - ❌ DON'T: Use negated boolean flags with `--no-` prefix
  - ✅ DO: Use consistent flag handling across all commands

  ```javascript
  // ✅ DO: Use positive flag with skip- prefix 
  .option('--skip-generate', 'Skip generating task files')
  
  // ❌ DON'T: Use --no- prefix 
  .option('--no-generate', 'Skip generating task files')
  ```

  > **Important**: When handling boolean flags in the code, make your intent clear:
  ```javascript
  // ✅ DO: Use clear variable naming that matches the flag's intent
  const generateFiles = !options.skipGenerate;
  
  // ❌ DON'T: Use confusing double negatives
  const dontSkipGenerate = !options.skipGenerate;
  ```

## Input Validation

- **Required Parameters**:
  - ✅ DO: Check that required parameters are provided
  - ✅ DO: Provide clear error messages when parameters are missing
  - ✅ DO: Use `printError(message, hint)` from `@tm/cli`, then `process.exit(1)`
  - ✅ DO: Validate everything before any AI call or write

  ```javascript
  // ✅ DO: Validate required parameters early
  if (!prompt) {
    printError(
      'add-task needs a description',
      "Example: taskgraph add-task --prompt='Add a login page'"
    );
    process.exit(1);
  }
  ```

- **Parameter Type Conversion**:
  - ✅ DO: Convert string inputs to appropriate types, such as numbers or booleans
  - ✅ DO: Handle conversion errors gracefully

  ```javascript
  // ✅ DO: Parse numeric parameters properly, quoting what was typed
  const fromId = parseInt(options.from, 10);
  if (isNaN(fromId)) {
    printError(`--from must be a task number, not "${options.from}"`);
    process.exit(1);
  }
  ```

- **Enhanced Input Validation**:
  - ✅ DO: Validate file existence for critical file operations
  - ✅ DO: Provide context-specific validation for identifiers
  - ✅ DO: Check that IDs exist, not just that they're well formed

  ```javascript
  // ✅ DO: Validate file existence
  if (!fs.existsSync(tasksPath)) {
    printError(
      `No tasks file at ${path.relative(process.cwd(), tasksPath)}`,
      'Run `taskgraph init` or `taskgraph parse-prd <file>` to create one'
    );
    process.exit(1);
  }

  // ✅ DO: Validate task ID format, then that it exists
  if (!/^\d+(\.\d+)?$/.test(options.id)) {
    printError(`"${options.id}" isn't a task ID`, 'Use --id=15 or --id=15.2');
    process.exit(1);
  }
  if (!findTaskById(tasks, options.id).task) {
    printError(`Task ${options.id} doesn't exist in tag '${tag}'`, 'Run `taskgraph list` to see task IDs');
    process.exit(1);
  }
  ```

## User Feedback

Follow `ui.md`. In short:

- **Print the result, once, when the work is done.** Don't announce each step ("Parsing PRD file…", "Generating 10 tasks…"); use a spinner for waits and `log('debug', …)` for progress.
- **Lead with a `✓` line** saying what changed, with details as aligned rows below it.
- **At most one next step,** as a plain line. No "Next Steps" box.
- **Format in a `.ts` formatter** under `apps/cli/src/ui/formatters/`, and call it through `ui` from `@tm/cli`.

```javascript
// ✅ DO: Return data from the core function; the command prints it
// (this is clear-subtasks)
const result = await tmCore.tasks.clearSubtasks(ids, { tag });
console.log(formatClearedSubtasks(result));
//   ✓ Cleared 4 subtasks from 2 tasks
//     1  3 subtasks  Set up the database schema
//     2  1 subtask   Build the login API
//   Run taskgraph expand --id=<id> to add new ones

// ❌ DON'T: Box a success message and number the next steps
console.log(boxen(chalk.white.bold('Subtasks Cleared Successfully') + '\n\nNext Steps:\n1. …'));
```

## Command Registration

- **Command Grouping**:
  - ✅ DO: Group related commands together in the code
  - ✅ DO: Add related commands in a logical order
  - ✅ DO: Use comments to delineate command groups

## Context-Aware Command Pattern

For AI-powered commands that benefit from project context, follow the research command pattern:

- **Context Integration**:
  - ✅ DO: Use `ContextGatherer` utility for multi-source context extraction
  - ✅ DO: Support task IDs, file paths, custom context, and project tree
  - ✅ DO: Implement fuzzy search for automatic task discovery
  - ✅ DO: Print one muted line saying what context was used (`ui.formatResearchContext`); the AI usage line reports tokens

  ```javascript
  // ✅ DO: Follow this pattern for context-aware commands
  programInstance
    .command('research')
    .description('Perform AI-powered research queries with project context')
    .argument('<prompt>', 'Research prompt to investigate')
    .option('-i, --id <ids>', 'Comma-separated task/subtask IDs to include as context')
    .option('-f, --files <paths>', 'Comma-separated file paths to include as context')
    .option('-c, --context <text>', 'Additional custom context')
    .option('--tree', 'Include project file tree structure')
    .option('-d, --detail <level>', 'Output detail level: low, medium, high', 'medium')
    .action(async (prompt, options) => {
      // 1. Parameter validation and parsing
      const taskIds = options.id ? parseTaskIds(options.id) : [];
      const filePaths = options.files ? parseFilePaths(options.files) : [];
      
      // 2. Initialize context gatherer
      const projectRoot = findProjectRoot() || '.';
      const gatherer = new ContextGatherer(projectRoot, tasksPath);
      
      // 3. Auto-discover relevant tasks if none specified
      if (taskIds.length === 0) {
        const fuzzySearch = new FuzzyTaskSearch(tasksData.tasks, 'research');
        const discoveredIds = fuzzySearch.getTaskIds(
          fuzzySearch.findRelevantTasks(prompt)
        );
        taskIds.push(...discoveredIds);
      }
      
      // 4. Gather context with token breakdown
      const contextResult = await gatherer.gather({
        tasks: taskIds,
        files: filePaths,
        customContext: options.context,
        includeProjectTree: options.projectTree,
        format: 'research',
        includeTokenCounts: true
      });
      
      // 5. One context line, then a spinner while the AI call runs
      // Implementation continues in apps/cli/src/commands/research.command.ts
    });
  ```

## Error Handling

- **Exception Management**:
  - ✅ DO: Wrap async operations in try/catch blocks
  - ✅ DO: Display user-friendly error messages
  - ✅ DO: Include detailed error information in debug mode

  ```javascript
  // ✅ DO: Handle errors properly: print once, at the command, then exit 1
  try {
    // Command implementation
  } catch (error) {
    printError(`Couldn't expand task ${taskId}: ${error.message}`);
    log('debug', error.stack);
    process.exit(1);
  }
  ```

- **Unknown Options and Commands**:
  - ✅ DO: Let Commander's errors go through the shared handler. `runCLI` formats them with `formatCommanderError` from `@tm/cli`, which adds a "Did you mean" or `--help` hint
  - ✅ DO: Point to `taskgraph <command> --help` in a hint rather than printing a custom help box
  - ❌ DON'T: Allow unknown options with `.allowUnknownOption()`
  - ❌ DON'T: Add `showXHelp()` functions that print boxed usage text; `--help` is generated from the command's options

- **Contextual Error Handling**:
  - ✅ DO: Turn known failures into a plain message plus a hint that fixes them
  - ✅ DO: Keep stack traces behind debug logging

  ```javascript
  // ✅ DO: Provide specific guidance in the hint
  try {
    // Implementation
  } catch (error) {
    const notFound = /not found/i.test(error.message);
    printError(
      error.message,
      notFound ? 'Run `taskgraph list` to see task IDs' : undefined
    );
    log('debug', error.stack);
    process.exit(1);
  }
  ```

## Integration with Other Modules

- **Import Organization**:
  - ✅ DO: Group imports by module/functionality
  - ✅ DO: Import only what's needed, not entire modules
  - ❌ DON'T: Create circular dependencies

  ```javascript
  // ✅ DO: Organize imports by module
  import { program } from 'commander';
  import path from 'path';
  import chalk from 'chalk';
  import https from 'https';
  
  import { createTmCore } from '@tm/core';
  import { theme } from '../ui/theme.js';
  ```

## Subtask Management Commands

- **Add Subtask Command Structure**:
  ```javascript
  // ✅ DO: Follow this structure for adding subtasks
  programInstance
    .command('add-subtask')
    .description('Add a new subtask to a parent task or convert an existing task to a subtask')
    .option('-f, --file <path>', 'Path to the tasks file', 'tasks/tasks.json')
    .option('--parent <id>', 'ID of the parent task (required)')
    .option('-i, --task-id <id>', 'Existing task ID to convert to subtask')
    .option('-t, --title <title>', 'Title for the new subtask, required if not converting')
    .option('-d, --description <description>', 'Description for the new subtask, optional')
    .option('--details <details>', 'Implementation details for the new subtask, optional')
    .option('--dependencies <ids>', 'Comma-separated list of subtask IDs this subtask depends on')
    .option('--status <status>', 'Initial status for the subtask', 'pending')
    .option('--generate', 'Regenerate task files after adding subtask')
    .action(async (options) => {
      // Validate required parameters
      if (!options.parent) {
        printError('add-subtask needs --parent', "Example: taskgraph add-subtask --parent=5 --title='Implement login UI'");
        process.exit(1);
      }
      
      // Implementation with detailed error handling
    });
  ```

## Version Checking and Updates

`runCLI` in [`program.ts`](../../apps/cli/src/program.ts) checks for an update before the command runs. By default it only notifies; `taskgraph upgrade` or `TASKGRAPH_AUTO_UPDATE=install` (or `~/.taskgraph/auto-update.json`) installs. The check is skipped when stdin isn't a terminal, in CI, in tests, for `--json`, `completion` and `merge-driver`, and when `loop` or a parallel worker set `TASKGRAPH_LOOP_CHILD` / `TASKGRAPH_PARALLEL_WORKER` (those children also get `TASKGRAPH_SKIP_AUTO_UPDATE=1`). `taskgraph upgrade` passes `explicit`, so it refuses only in those loop children. An install takes the lock in `~/.taskgraph/update.lock`. The pieces live in `apps/cli/src/utils/auto-update/`.

Refer to the commands in `apps/cli/src/commands/` for implementation examples and `ui.md` for output.
