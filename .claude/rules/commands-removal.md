---
description: Guidelines for CLI commands that delete or remove data
paths:
  - "apps/cli/src/commands/removal.command.ts"
---

# Removal and Delete Commands

The rest of the CLI command standards are in `commands.md`.

When implementing commands that delete or remove data (like `remove-task` or `remove-subtask`), follow these specific guidelines:

- **Confirmation Prompts**:
  - ✅ **DO**: Include a confirmation prompt by default for destructive operations
  - ✅ **DO**: Provide a `--yes` or `-y` flag to skip confirmation, useful for scripting or automation
  - ✅ **DO**: Show what will be deleted in the confirmation message
  - ✅ **DO**: Without a terminal, require `--yes` instead of prompting (a prompt there hangs scripts and agents)
  - ❌ **DON'T**: Perform destructive operations without user confirmation unless explicitly overridden

  ```javascript
  // ✅ DO: Include confirmation for destructive operations
  programInstance
    .command('remove-task')
    .description('Remove a task or subtask permanently')
    .option('-i, --id <id>', 'ID of the task to remove')
    .option('-y, --yes', 'Skip confirmation prompt', false)
    .action(async (options) => {
      // Validation code...
      
      if (!options.yes) {
        if (!process.stdin.isTTY) {
          printError(
            `Removing task ${taskId} needs confirmation`,
            'Pass --yes to remove it without asking'
          );
          process.exit(1);
        }
        const { proceed } = await inquirer.prompt([{
          type: 'confirm',
          name: 'proceed',
          message: `Remove task ${taskId} (${task.title})? This can't be undone.`,
          default: false
        }]);

        if (!proceed) {
          console.log(theme.muted('Cancelled; nothing was removed'));
          return;
        }
      }
      
      // Proceed with removal...
    });
  ```

- **File Path Handling**:
  - ✅ **DO**: Use `path.join()` to construct file paths
  - ✅ **DO**: Follow established naming conventions for tasks, like `task_001.txt`
  - ✅ **DO**: Check if files exist before attempting to delete them
  - ✅ **DO**: Handle file deletion errors gracefully
  - ❌ **DON'T**: Construct paths with string concatenation

  ```javascript
  // ✅ DO: Properly construct file paths
  const taskFilePath = path.join(
    path.dirname(tasksPath),
    `task_${taskId.toString().padStart(3, '0')}.txt`
  );
  
  // ✅ DO: Check existence before deletion; report it in the final summary,
  // not as its own line, and warn only if it fails
  if (fs.existsSync(taskFilePath)) {
    try {
      fs.unlinkSync(taskFilePath);
    } catch (error) {
      log('warn', `Couldn't delete ${path.relative(projectRoot, taskFilePath)}: ${error.message}`);
    }
  }
  ```

- **Clean Up References**:
  - ✅ **DO**: Clean up references to the deleted item in other parts of the data
  - ✅ **DO**: Handle both direct and indirect references
  - ✅ **DO**: Say what related data changed, in the result line
  - ❌ **DON'T**: Leave dangling references

  ```javascript
  // ✅ DO: Clean up references when deleting items
  let referencesRemoved = 0;
  
  // Update dependencies in other tasks
  data.tasks.forEach(task => {
    if (task.dependencies && task.dependencies.includes(taskId)) {
      task.dependencies = task.dependencies.filter(depId => depId !== taskId);
      referencesRemoved++;
    }
  });
  
  // One result line covers the removal and its side effects:
  //   ✓ Removed task 5 · 2 tasks no longer depend on it
  return { removed: taskId, referencesRemoved };
  ```

- **Task File Regeneration**:
  - ✅ **DO**: Regenerate task files after destructive operations
  - ✅ **DO**: Pass all required parameters to generation functions
  - ✅ **DO**: Provide an option to skip regeneration if needed
  - ❌ **DON'T**: Assume default parameters will work

  ```javascript
  // ✅ DO: Properly regenerate files after deletion. It's housekeeping, so
  // it prints nothing unless it fails
  if (!options.skipGenerate) {
    try {
      // Note both parameters are explicitly provided
      await generateTaskFiles(tasksPath, path.dirname(tasksPath));
    } catch (error) {
      log('warn', `Couldn't regenerate task files: ${error.message}`);
    }
  }
  ```

- **Alternative Suggestions**:
  - ✅ **DO**: Suggest non-destructive alternatives when appropriate
  - ✅ **DO**: Explain the difference between deletion and status changes
  - ✅ **DO**: Include examples of alternative commands

  ```javascript
  // ✅ DO: Suggest the alternative in one muted line, before the prompt
  console.log(
    theme.muted(`To keep its history instead: taskgraph set-status --id=${taskId} --status=cancelled`)
  );
  ```
