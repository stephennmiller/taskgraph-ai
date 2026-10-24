---
description: Guidelines for integrating new features into the TaskGraph CLI
paths:
  - "scripts/modules/*.js"
---
# TaskGraph Feature Integration Guidelines

## Feature Placement Decision Process

- **Identify Feature Type** (See `architecture.md` for module details):
  - **Data Manipulation**: Features that create, read, update, or delete tasks belong in [`@tm/core`](../../packages/tm-core/src/modules/tasks/). Follow guidelines in `tasks.md`.
  - **Dependency Management**: Features that handle task relationships belong in [`@tm/core` `modules/dependencies/`](../../packages/tm-core/src/modules/dependencies/). Follow guidelines in `dependencies.md`.
  - **User Interface**: Output is formatted by pure functions in `apps/cli/src/ui/formatters/` and printed by the command. Follow `ui.md`. 
  - **AI Integration**: Features that use AI models belong in [`ai-services.js`](../../scripts/modules/ai-services.js).
  - **Cross-Cutting**: Features that don't fit one category may need components in multiple modules

- **Command-Line Interface** (See `commands.md`):
  - Add new user-facing commands as classes in `apps/cli/src/commands/` and register them in [`command-registry.ts`](../../apps/cli/src/command-registry.ts)
  - Use consistent patterns for option naming and help text
  - Follow the Commander.js model for subcommand structure

## Implementation Pattern

The standard pattern for adding a feature follows this workflow:

1. **Core Logic**: Implement the business logic in the appropriate module (e.g., [`@tm/core`](../../packages/tm-core/src/modules/tasks/)).
2. **Context Gathering (If Applicable)**: 
   - For AI-powered commands that benefit from project context, use the standardized context gathering patterns from `context-gathering.md`.
   - Import `ContextGatherer` and `FuzzyTaskSearch` utilities for reusable context extraction.
   - Support multiple context types: tasks, files, custom text, project tree.
   - Print one muted line saying what context was used; the AI usage line reports the tokens.
3. **AI Integration (If Applicable)**: 
   - Import necessary service functions (e.g., `generateTextService`, `streamTextService`) from [`ai-services-unified.js`](../../scripts/modules/ai-services-unified.js).
   - Prepare parameters (`role`, `session`, `systemPrompt`, `prompt`).
   - Call the service function.
   - Handle the response (direct text or stream object).
   - **Important**: Prefer `generateTextService` for calls sending large context (like stringified JSON) where incremental display is not needed. See `ai-services.md` for detailed usage patterns and cautions.
4. **Output**: Add a formatter in `apps/cli/src/ui/formatters/<name>-formatters.ts` with a `.spec.ts` next to it, export it from `apps/cli/src/ui/index.ts`, and follow `ui.md`.
5. **Command Integration**: Add the CLI command in `apps/cli/src/commands/` and register it in [`command-registry.ts`](../../apps/cli/src/command-registry.ts), following `commands.md`.
6. **Testing**: Write tests for all components of the feature (following `tests.md`)
7. **Configuration**: Update configuration settings or add new ones in [`config-manager.js`](../../scripts/modules/config-manager.js) and ensure getters/setters are appropriate. Update documentation in `utilities.md` and `taskgraph.md`. Update the `.taskgraph/config.json` structure if needed.
8. **Documentation**: Update help text and documentation in `dev-workflow.md` and `taskgraph.md`.

## Critical Checklist for New Features

- **Comprehensive Function Exports**:
  - ✅ **DO**: Export **all core functions, helper functions (like `generateSubtaskPrompt`), and utility methods** needed by your new function or command from their respective modules.
  - ✅ **DO**: **Explicitly review the module's `export { ... }` block** at the bottom of the file to ensure every required dependency (even seemingly minor helpers like `findTaskById`, `taskExists`, specific prompt generators, AI call handlers, etc.) is included.
  - ❌ **DON'T**: Assume internal functions are already exported - **always verify**. A missing export will cause runtime errors (e.g., `ReferenceError: generateSubtaskPrompt is not defined`).
  - **Example**: If implementing a feature that checks task existence, ensure the helper function is in exports:
  ```javascript
  // At the bottom of your module file:
  export {
    // ... existing exports ...
    yourNewFunction,
    taskExists,  // Helper function used by yourNewFunction
    findTaskById, // Helper function used by yourNewFunction
    generateSubtaskPrompt, // Helper needed by expand/add features
    getSubtasksFromAI,     // Helper needed by expand/add features
  };
  ```

- **Parameter Completeness and Matching**:
  - ✅ **DO**: Pass all required parameters to functions you call within your implementation
  - ✅ **DO**: Check function signatures before implementing calls to them
  - ❌ **DON'T**: Assume default parameter values will handle missing arguments
  - ❌ **DON'T**: Assume object parameters will work without verifying their required internal structure or methods.
  - **Example**: When calling file generation, pass all required parameters:
  ```javascript
  // ✅ DO: Pass all required parameters
  await generateTaskFiles(tasksPath, path.dirname(tasksPath));
  
  // ❌ DON'T: Omit required parameters
  await generateTaskFiles(tasksPath); // Error - missing outputDir parameter
  ```

- **Consistent File Path Handling**:
  - ✅ DO: Use consistent file naming conventions: `task_${id.toString().padStart(3, '0')}.txt`
  - ✅ DO: Use `path.join()` for composing file paths
  - ✅ DO: Use appropriate file extensions (.txt for tasks, .json for data)
  - ❌ DON'T: Hardcode path separators or inconsistent file extensions
  - **Example**: Creating file paths for tasks:
  ```javascript
  // ✅ DO: Use consistent file naming and path.join
  const taskFileName = path.join(
    path.dirname(tasksPath), 
    `task_${taskId.toString().padStart(3, '0')}.txt`
  );
  
  // ❌ DON'T: Use inconsistent naming or string concatenation 
  const taskFileName = path.dirname(tasksPath) + '/' + taskId + '.md';
  ```

- **Error Handling and Reporting**:
  - ✅ DO: Use structured error objects with code and message properties
  - ✅ DO: Include clear error messages identifying the specific problem
  - ✅ DO: Handle both function-specific errors and potential file system errors
  - ✅ DO: Log errors at appropriate severity levels
  - **Example**: Structured error handling in core functions:
  ```javascript
  try {
    // Implementation...
  } catch (error) {
    log('error', `Error removing task: ${error.message}`);
    throw {
      code: 'REMOVE_TASK_ERROR',
      message: error.message,
      details: error.stack
    };
  }
  ```

- **MCP output**:
  - ✅ **DO**: Keep code the MCP server runs off stdout, which carries the protocol. Tools log through the context's `log`, and tm-core through the logger `withToolContext` gives it (see `architecture.md`, "Keeping MCP output off stdout").
  - ❌ **DON'T**: `console.log` from tm-core or tool code.

- **Debugging Strategy**:
  - ✅ **DO**: If an MCP tool fails with vague errors (e.g., JSON parsing issues like `Unexpected token ... is not valid JSON`), **try running the equivalent CLI command directly in the terminal** (e.g., `taskgraph expand --all`). CLI output often provides much more specific error messages (like missing function definitions or stack traces from the core logic) that pinpoint the root cause.
  - ❌ **DON'T**: Rely solely on MCP logs if the error is unclear; use the CLI as a complementary debugging tool for core logic issues.

- **Telemetry Integration**: Ensure AI calls correctly handle and propagate `telemetryData` as described in `telemetry.md`.

```javascript
// 1. CORE LOGIC: Add function to appropriate module (example in task-manager.js)
/**
 * Archives completed tasks to archive.json
 * @param {string} tasksPath - Path to the tasks.json file
 * @param {string} archivePath - Path to the archive.json file
 * @returns {number} Number of tasks archived
 */
async function archiveTasks(tasksPath, archivePath = 'tasks/archive.json') {
  // Implementation...
  return archivedCount;
}

// Export from the module
export {
  // ... existing exports ...
  archiveTasks,
};
```

```javascript
// 2. AI Integration: Add import and use necessary service functions
import { generateTextService } from './ai-services-unified.js';

// Example usage:
async function handleAIInteraction() {
  const role = 'user';
  const session = 'exampleSession';
  const systemPrompt = 'You are a helpful assistant.';
  const prompt = 'What is the capital of France?';

  const result = await generateTextService(role, session, systemPrompt, prompt);
  console.log(result);
}

// Export from the module
export {
  // ... existing exports ...
  handleAIInteraction,
};
```

```typescript
// 3. OUTPUT: apps/cli/src/ui/formatters/archive-formatters.ts
/**
 * @fileoverview What `archive` moved, e.g.
 *
 *   ✓ Archived 4 done tasks to .taskgraph/tasks/archive.json
 */
import chalk from 'chalk';

export function formatArchived(count: number, archivePath: string): string {
	if (count === 0) return 'No done tasks to archive';
	const noun = count === 1 ? 'task' : 'tasks';
	return `${chalk.green('✓')} Archived ${count} done ${noun} to ${archivePath}`;
}

// ...and export it from apps/cli/src/ui/index.ts
```

```javascript
// 4. COMMAND INTEGRATION: a command in apps/cli/src/commands/, registered in command-registry.ts
import { archiveTasks } from './task-manager.js';
import { ui } from '@tm/cli';

// In registerCommands function
programInstance
  .command('archive')
  .description('Archive completed tasks to separate file')
  .option('-f, --file <file>', 'Path to the tasks file', 'tasks/tasks.json')
  .option('-o, --output <file>', 'Archive output file', 'tasks/archive.json')
  .action(async (options) => {
    const tasksPath = options.file;
    const archivePath = options.output;
    
    // No "Archiving…" line: print the result once it's done
    const archivedCount = await archiveTasks(tasksPath, archivePath);
    console.log(ui.formatArchived(archivedCount, archivePath));
  });
```

## Cross-Module Features

For features requiring components in multiple modules:

- ✅ **DO**: Create a clear unidirectional flow of dependencies
  ```javascript
  // In task-manager.js
  function analyzeTasksDifficulty(tasks) {
    // Implementation...
    return difficultyScores;
  }
  
  // In ui.js - depends on task-manager.js
  import { analyzeTasksDifficulty } from './task-manager.js';
  
  function displayDifficultyReport(tasks) {
    const scores = analyzeTasksDifficulty(tasks);
    // Render the scores...
  }
  ```

- ❌ **DON'T**: Create circular dependencies between modules
  ```javascript
  // In task-manager.js - depends on ui.js
  import { displayDifficultyReport } from './ui.js';
  
  function analyzeTasks() {
    // Implementation...
    displayDifficultyReport(tasks); // WRONG! Don't call UI functions from task-manager
  }
  
  // In ui.js - depends on task-manager.js
  import { analyzeTasks } from './task-manager.js';
  ```

## Command-Line Interface Standards

- **Naming Conventions**:
  - Use kebab-case for command names (`analyze-complexity`, not `analyzeComplexity`)
  - Use kebab-case for option names (`--output-format`, not `--outputFormat`) 
  - Use the same option names across commands when they represent the same concept

- **Command Structure**:
  ```javascript
  programInstance
    .command('command-name')
    .description('Clear, concise description of what the command does')
    .option('-s, --short-option <value>', 'Option description', 'default value')
    .option('--long-option <value>', 'Option description')
    .action(async (options) => {
      // Command implementation
    });
  ```

## Utility Function Guidelines

When adding utilities to [`utils.js`](../../scripts/modules/utils.js):

- Only add functions that could be used by multiple modules
- Keep utilities single-purpose and purely functional
- Document parameters and return values

```javascript
/**
 * Formats a duration in milliseconds to a human-readable string
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Formatted duration string (e.g., "2h 30m 15s")
 */
function formatDuration(ms) {
  // Implementation...
  return formatted;
}
```

## Writing Testable Code

When implementing new features, follow these guidelines to ensure your code is testable:

- **Dependency Injection**
  - Design functions to accept dependencies as parameters
  - Avoid hard-coded dependencies that are difficult to mock
  ```javascript
  // ✅ DO: Accept dependencies as parameters
  function processTask(task, fileSystem, logger) {
    fileSystem.writeFile('task.json', JSON.stringify(task));
    logger.info('Task processed');
  }
  
  // ❌ DON'T: Use hard-coded dependencies
  function processTask(task) {
    fs.writeFile('task.json', JSON.stringify(task));
    console.log('Task processed');
  }
  ```

- **Separate Logic from Side Effects**
  - Keep pure logic separate from I/O operations or UI rendering
  - This allows testing the logic without mocking complex dependencies
  ```javascript
  // ✅ DO: Separate logic from side effects
  function calculateTaskPriority(task, dependencies) {
    // Pure logic that returns a value
    return computedPriority;
  }
  
  function displayTaskPriority(task, dependencies) {
    const priority = calculateTaskPriority(task, dependencies);
    console.log(`Task priority: ${priority}`);
  }
  ```

- **Callback Functions and Testing**
  - When using callbacks (like in Commander.js commands), define them separately
  - This allows testing the callback logic independently
  ```javascript
  // ✅ DO: Define callbacks separately for testing
  function getVersionString() {
    // Logic to determine version
    return version;
  }
  
  // In setupCLI
  programInstance.version(getVersionString);
  
  // In tests
  test('getVersionString returns correct version', () => {
    expect(getVersionString()).toBe('1.5.0');
  });
  ```

- **UI Output Testing**
  - For UI components, focus on testing conditional logic rather than exact output
  - Use string pattern matching (like `expect(result).toContain('text')`)
  - Strip ANSI codes before comparing, and check line widths at 80 columns
  ```typescript
  // ✅ DO: Test the plain text a user sees
  import { stripVTControlCharacters as plain } from 'node:util';

  it('says how many subtasks were cleared', () => {
    const output = plain(formatClearedSubtasks(result, 80));
    expect(output.split('\n')[0]).toBe('✓ Cleared 4 subtasks from 2 tasks');
    for (const line of output.split('\n')) expect(line.length).toBeLessThanOrEqual(80);
  });
  ```

## Testing Requirements

Every new feature **must** include comprehensive tests following the guidelines in `tests.md`. Testing should include:

1. **Unit Tests**: Test individual functions and components in isolation
   ```javascript
   // Example unit test for a new utility function
   describe('newFeatureUtil', () => {
     test('should perform expected operation with valid input', () => {
       expect(newFeatureUtil('valid input')).toBe('expected result');
     });
     
     test('should handle edge cases appropriately', () => {
       expect(newFeatureUtil('')).toBeNull();
     });
   });
   ```

2. **Integration Tests**: Verify the feature works correctly with other components
   ```javascript
   // Example integration test for a new command
   describe('newCommand integration', () => {
     test('should call the correct service functions with parsed arguments', () => {
       const mockService = vi.fn().mockResolvedValue('success');
       // Set up test with mocked dependencies
       // Call the command handler
       // Verify service was called with expected arguments
     });
   });
   ```

3. **Edge Cases**: Test boundary conditions and error handling
   - Invalid inputs
   - Missing dependencies
   - File system errors
   - API failures

4. **Test Coverage**: Aim for at least 80% coverage for all new code

5. **Vitest Mocking Best Practices**
   - Declare `vi.mock()` calls for the modules under test's dependencies (Vitest hoists them), as described in `tests.md`
   - Use vi.spyOn() to create spy functions for testing
   - Clear mocks between tests to prevent interference
   - See the Vitest Module Mocking Best Practices section in `tests.md` for details

When submitting a new feature, always run the full test suite to ensure nothing was broken:

```bash
npm test
```

## Documentation Requirements

For each new feature:

1. Add help text to the command definition
2. Update `dev-workflow.md` with command reference
3. Consider updating `architecture.md` if the feature significantly changes module responsibilities.

Follow the existing command reference format:
```markdown
- **Command Reference: your-command**
  - CLI Syntax: `taskgraph your-command [options]`
  - Description: Brief explanation of what the command does
  - Parameters:
    - `--option1=<value>`: Description of option1 (default: 'default')
    - `--option2=<value>`: Description of option2 (required)
  - Example: `taskgraph your-command --option1=value --option2=value2`
  - Notes: Additional details, limitations, or special considerations
```

For more information on module structure, see [`MODULE_PLAN.md`](../../scripts/modules/MODULE_PLAN.md).

## Adding MCP Server Support for Commands

An MCP tool is a thin layer over a tm-core method, as a CLI command is. See `mcp.md` for the full pattern.

**MCP Integration Workflow**:

1.  **Core Logic**: Add or extend the method in [`@tm/core`](../../packages/tm-core/src/modules/tasks/) (for example on `TasksDomain`) with its tests.
2.  **Create the tool** in `apps/mcp/src/tools/<area>/<name>.tool.ts`, exporting `registerYourCommandTool(server: FastMCP)` from the area's `index.ts`:
    - Define parameters with zod, `projectRoot` included; keep names clients already send.
    - Wrap `execute` in `withToolContext` (`apps/mcp/src/shared/utils.ts`), which normalizes `args.projectRoot` and passes `tmCore`.
    - Call tm-core inside `replyWith` (`apps/mcp/src/shared/tool-reply.ts`), which replies with the data or the error:
      ```typescript
      execute: withToolContext(
          async (args: z.infer<typeof YourSchema>, context: ToolContext) =>
              replyWith(args, context, 'Error running your_command', async () => {
                  const result = await context.tmCore.tasks.yourMethod(args.id, {
                      tag: args.tag
                  });
                  return { tag: result.tag, data: result };
              })
      )
      ```
3.  **Register Tool**: Add `your_command: registerYourCommandTool` to `toolRegistry` in `apps/mcp/src/tools/tool-registry.ts`, and the name to `coreTools` or `standardTools` if it belongs in that tier. `TASKGRAPH_TOOLS=all` loads every tool in `toolRegistry`, and a comma-separated list can name any of them. A tier change also changes the counts in `apps/mcp/src/tools/tool-registry.spec.ts`, the README tier table and `llms-install.md`.
4.  **No `.mcp.json` change**: `.mcp.json` only starts the server; it has no list of tools.

## Progress Reporting

MCP tools run inline: `execute` awaits tm-core and returns the finished result. For long-running work, such as PRD parsing, take `reportProgress` from the `withToolContext` context and call it only when it is defined; don't let a failed report fail work that is already saved (see `apps/mcp/src/tools/tasks/parse-prd.tool.ts`).

## Project Initialization

When implementing project initialization commands:

1. **Support Programmatic Initialization**:
   - ✅ **DO**: Design initialization to work with both CLI and MCP
   - ✅ **DO**: Support non-interactive modes with sensible defaults
   - ✅ **DO**: Handle project metadata like name, description, version
   - ✅ **DO**: Create necessary files and directories

2. **In MCP Tool Implementation**: see `apps/mcp/src/tools/setup/initialize-project.tool.ts`, which calls tm-core's `initializeProject` inside `withNormalizedProjectRoot` and replies through `replyWith`.

## Feature Planning

- **Core Logic First**:
  - ✅ DO: Implement core logic in `scripts/modules/` before CLI or MCP interfaces
  - ✅ DO: Consider tagged task lists system compatibility from the start
  - ✅ DO: Design functions to work with both legacy and tagged data formats
  - ✅ DO: Use tag resolution functions (`getTasksForTag`, `setTasksForTag`) for task data access
  - ❌ DON'T: Directly manipulate tagged data structure in new features

  ```javascript
  // ✅ DO: Design tagged-aware core functions
  async function newFeatureCore(tasksPath, featureParams, options = {}) {
    const tasksData = readJSON(tasksPath);
    const currentTag = getCurrentTag() || 'master';
    const tasks = getTasksForTag(tasksData, currentTag);
    
    // Perform feature logic on tasks array
    const result = performFeatureLogic(tasks, featureParams);
    
    // Save back using tag resolution
    setTasksForTag(tasksData, currentTag, tasks);
    writeJSON(tasksPath, tasksData);
    
    return result;
  }
  ```

- **Backward Compatibility**:
  - ✅ DO: Ensure new features work with existing projects seamlessly
  - ✅ DO: Test with both legacy and tagged task data formats
  - ✅ DO: Support silent migration during feature usage
  - ❌ DON'T: Break existing workflows when adding tagged system features

## CLI Command Implementation

- **Command Structure**:
  - ✅ DO: Follow the established pattern in `apps/cli/src/commands/`
  - ✅ DO: Use Commander.js for argument parsing
  - ✅ DO: Include comprehensive help text and examples
  - ✅ DO: Support tagged task context awareness

  ```javascript
  // ✅ DO: Implement CLI commands with tagged system awareness
  program
    .command('new-feature')
    .description('Description of the new feature with tagged task lists support')
    .option('-t, --tag <tag>', 'Specify tag context (defaults to current tag)')
    .option('-p, --param <value>', 'Feature-specific parameter')
    .option('--force', 'Force operation without confirmation')
    .action(async (options) => {
      try {
        const projectRoot = findProjectRoot();
        if (!projectRoot) {
          printError('Not in a TaskGraph project', 'Run `taskgraph init` first');
          process.exit(1);
        }
        
        // Use specified tag or current tag
        const targetTag = options.tag || getCurrentTag() || 'master';
        
        const result = await newFeatureCore(
          path.join(projectRoot, '.taskgraph', 'tasks', 'tasks.json'),
          { param: options.param },
          { 
            force: options.force,
            targetTag: targetTag,
            outputFormat: 'text'
          }
        );
        
        console.log(ui.formatNewFeature(result)); // a ✓ line, per ui.md
      } catch (error) {
        printError(error.message);
        process.exit(1);
      }
    });
  ```

- **Error Handling**:
  - ✅ DO: Provide clear error messages for common failures
  - ✅ DO: Handle tagged system migration errors gracefully
  - ✅ DO: Include suggestion for resolution when possible
  - ✅ DO: Exit with appropriate codes for scripting

## MCP Tool Implementation

- ✅ DO: Write the tool in `apps/mcp/src/tools/` as `mcp.md` describes: zod parameters, `withToolContext`, one tm-core call, a reply through `replyWith` or `handleApiResult`.
- ✅ DO: Take an optional `tag` and pass it to tm-core and to the reply, so the reply names the tag the tool worked in.
- ✅ DO: Follow the naming in `mcp.md` (`<name>.tool.ts`, `register<Name>Tool`, snake_case tool names).
- ❌ DON'T: Put parsing, validation of task data or file I/O in the tool; it belongs in tm-core.

## Testing Strategy

- **Unit Tests**:
  - ✅ DO: Test core logic independently with both data formats
  - ✅ DO: Mock file system operations appropriately
  - ✅ DO: Test tag resolution behavior
  - ✅ DO: Verify migration compatibility

  ```javascript
  // ✅ DO: Test new features with tagged system awareness
  describe('newFeature', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });
    
    it('should work with legacy task format', async () => {
      const legacyData = { tasks: [/* test data */] };
      fs.readFileSync.mockReturnValue(JSON.stringify(legacyData));
      
      const result = await newFeatureCore('/test/tasks.json', { param: 'test' });
      
      expect(result).toBeDefined();
      // Test legacy format handling
    });
    
    it('should work with tagged task format', async () => {
      const taggedData = { 
        master: { tasks: [/* test data */] },
        feature: { tasks: [/* test data */] }
      };
      fs.readFileSync.mockReturnValue(JSON.stringify(taggedData));
      
      const result = await newFeatureCore('/test/tasks.json', { param: 'test' });
      
      expect(result).toBeDefined();
      // Test tagged format handling
    });
    
    it('should handle tag migration during feature usage', async () => {
      const legacyData = { tasks: [/* test data */] };
      fs.readFileSync.mockReturnValue(JSON.stringify(legacyData));
      
      await newFeatureCore('/test/tasks.json', { param: 'test' });
      
      // Verify migration occurred
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        '/test/tasks.json',
        expect.stringContaining('"master"')
      );
    });
  });
  ```

- **Integration Tests**:
  - ✅ DO: Test CLI and MCP interfaces with real task data
  - ✅ DO: Verify end-to-end workflows across tag contexts
  - ✅ DO: Test error scenarios and recovery

## Documentation Updates

- **Rule Updates**:
  - ✅ DO: Update relevant `.claude/rules/*.md` files
  - ✅ DO: Include tagged system considerations in architecture docs
  - ✅ DO: Add examples showing multi-context usage
  - ✅ DO: Update workflow documentation as needed

- **User Documentation**:
  - ✅ DO: Add feature documentation to `/docs` folder
  - ✅ DO: Include tagged system usage examples
  - ✅ DO: Update command reference documentation
  - ✅ DO: Provide migration notes if relevant

## Migration Considerations

- **Silent Migration Support**:
  - ✅ DO: Ensure new features trigger migration when needed
  - ✅ DO: Handle migration errors gracefully in feature code
  - ✅ DO: Test feature behavior with pre-migration projects
  - ❌ DON'T: Assume projects are already migrated

- **Tag Context Handling**:
  - ✅ DO: Default to current tag when not specified
  - ✅ DO: Support explicit tag selection in advanced features
  - ✅ DO: Validate tag existence before operations
  - ✅ DO: Provide clear messaging about tag context

## Performance Considerations

- **Efficient Tag Operations**:
  - ✅ DO: Minimize file I/O operations per feature execution
  - ✅ DO: Cache tag resolution results when appropriate
  - ✅ DO: Use streaming for large task datasets
  - ❌ DON'T: Load all tags when only one is needed

- **Memory Management**:
  - ✅ DO: Process large task lists efficiently
  - ✅ DO: Clean up temporary data structures
  - ✅ DO: Avoid keeping all tag data in memory simultaneously

## Deployment and Versioning

- **Changesets**:
  - ✅ DO: Create appropriate changesets for new features
  - ✅ DO: Use semantic versioning (minor for new features)
  - ✅ DO: Include tagged system information in release notes
  - ✅ DO: Document breaking changes if any

- **Feature Flags**:
  - ✅ DO: Consider feature flags for experimental functionality
  - ✅ DO: Ensure tagged system features work with flags
  - ✅ DO: Provide clear documentation about flag usage

By following these guidelines, new features will integrate smoothly with the TaskGraph ecosystem while supporting the enhanced tagged task lists system for multi-context development workflows.
