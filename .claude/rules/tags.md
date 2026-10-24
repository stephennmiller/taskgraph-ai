---
description: Shared utility function conventions scripts/modules/*
paths:
  - "scripts/modules/*"
---
# Tagged Task Lists Command Patterns

This document outlines the standardized patterns that **ALL** TaskGraph commands must follow to properly support the tagged task lists system.

## Core Principles

- **Every command** that reads or writes tasks.json must be tag-aware
- **Consistent tag resolution** across all commands using `getCurrentTag(projectRoot)`
- **Proper context passing** to core functions with `{ projectRoot, tag }`
- **Standardized CLI options** with `--tag <tag>` flag

## Required Imports

All command files must import `getCurrentTag`:

```javascript
// ✅ DO: Import getCurrentTag in each command file
import { 
  log, 
  readJSON, 
  writeJSON, 
  findProjectRoot, 
  getCurrentTag 
} from './utils.js';

// ✅ DO: Import getCurrentTag in task-manager files
import { 
  readJSON, 
  writeJSON, 
  getCurrentTag 
} from '../utils.js';
```

## CLI Command Pattern

Every CLI command that operates on tasks must follow this exact pattern:

```javascript
// ✅ DO: Standard tag-aware CLI command pattern
programInstance
  .command('command-name')
  .description('Command description')
  .option('-f, --file <file>', 'Path to the tasks file', TASKGRAPH_TASKS_FILE)
  .option('--tag <tag>', 'Specify tag context for task operations') // REQUIRED
  .action(async (options) => {
    // 1. Find project root
    const projectRoot = findProjectRoot();
    if (!projectRoot) {
      printError('Not in a TaskGraph project', 'Run `taskgraph init` first');
      process.exit(1);
    }

    // 2. Resolve tag using standard pattern
    const tag = options.tag || getCurrentTag(projectRoot) || 'master';

    // 3. Call core function with proper context
    await coreFunction(
      tasksPath,
      // ... other parameters ...
      { projectRoot, tag } // REQUIRED context object
    );
  });
```

## Core Function Pattern

All core functions in `scripts/modules/task-manager/` must follow this pattern:

```javascript
// ✅ DO: Standard tag-aware core function pattern
async function coreFunction(
  tasksPath,
  // ... other parameters ...
  context = {} // REQUIRED context parameter
) {
  const { projectRoot, tag } = context;
  
  // Use tag-aware readJSON/writeJSON
  const data = readJSON(tasksPath, projectRoot, tag);
  
  // ... function logic ...
  
  writeJSON(tasksPath, data, projectRoot, tag);
}
```

## Tag Resolution Priority

The tag resolution follows this exact priority order:

1. **Explicit `--tag` flag**: `options.tag`
2. **Current active tag**: `getCurrentTag(projectRoot)`  
3. **Default fallback**: `'master'`

```javascript
// ✅ DO: Standard tag resolution pattern
const tag = options.tag || getCurrentTag(projectRoot) || 'master';
```

## Commands Requiring Updates

### High Priority (Core Task Operations)
- [x] `add-task` - ✅ Fixed
- [x] `list` - ✅ Fixed  
- [x] `update-task` - ✅ Fixed
- [x] `update-subtask` - ✅ Fixed
- [x] `set-status` - ✅ Already correct
- [x] `remove-task` - ✅ Already correct
- [x] `remove-subtask` - ✅ Fixed
- [x] `add-subtask` - ✅ Already correct
- [x] `clear-subtasks` - ✅ Fixed
- [x] `move-task` - ✅ Already correct

### Medium Priority (Analysis & Expansion)
- [x] `expand` - ✅ Fixed
- [ ] `next` - ✅ Fixed
- [ ] `show` (get-task) - Needs checking
- [ ] `analyze-complexity` - Needs checking
- [ ] `generate` - ✅ Fixed

### Lower Priority (Utilities)
- [ ] `research` - Needs checking
- [ ] `complexity-report` - Needs checking
- [ ] `validate-dependencies` - ✅ Fixed
- [ ] `fix-dependencies` - ✅ Fixed
- [ ] `add-dependency` - ✅ Fixed
- [ ] `remove-dependency` - ✅ Fixed

## MCP Integration Pattern

MCP tools take an optional `tag`, pass it to tm-core, and name it in the reply (`apps/mcp/src/tools/`, see `mcp.md`):

```typescript
replyWith(args, context, 'Error running core_action', async () => {
  const result = await context.tmCore.tasks.coreAction(args.id, { tag: args.tag });
  return { tag: result.tag, data: result };
})
```

## File Generation Tag-Aware Naming

The `generate` command must use tag-aware file naming:

```javascript
// ✅ DO: Tag-aware file naming
const taskFileName = targetTag === 'master' 
  ? `task_${task.id.toString().padStart(3, '0')}.txt`
  : `task_${task.id.toString().padStart(3, '0')}_${targetTag}.txt`;
```

**Examples:**
- Master tag: `task_001.txt`, `task_002.txt`
- Other tags: `task_001_feature.txt`, `task_002_feature.txt`

## Common Anti-Patterns

```javascript
// ❌ DON'T: Missing getCurrentTag import
import { readJSON, writeJSON } from '../utils.js'; // Missing getCurrentTag

// ❌ DON'T: Hard-coded tag resolution
const tag = options.tag || 'master'; // Missing getCurrentTag

// ❌ DON'T: Missing --tag option
.option('-f, --file <file>', 'Path to tasks file') // Missing --tag option

// ❌ DON'T: Missing context parameter
await coreFunction(tasksPath, param1, param2); // Missing { projectRoot, tag }

// ❌ DON'T: Incorrect readJSON/writeJSON calls
const data = readJSON(tasksPath); // Missing projectRoot and tag
writeJSON(tasksPath, data); // Missing projectRoot and tag
```

## Validation Checklist

For each command, verify:

- [ ] Imports `getCurrentTag` from utils.js
- [ ] Has `--tag <tag>` CLI option
- [ ] Uses standard tag resolution: `options.tag || getCurrentTag(projectRoot) || 'master'`
- [ ] Finds `projectRoot` with error handling
- [ ] Passes `{ projectRoot, tag }` context to core functions
- [ ] Core functions accept and use context parameter
- [ ] Uses `readJSON(tasksPath, projectRoot, tag)` and `writeJSON(tasksPath, data, projectRoot, tag)`

## Testing Tag Resolution

Test each command with:

```bash
# Test with explicit tag
node dist/taskgraph.js command-name --tag test-tag

# Test with active tag (should use current active tag)
node dist/taskgraph.js use-tag test-tag
node dist/taskgraph.js command-name

# Test with master tag (default)
node dist/taskgraph.js use-tag master  
node dist/taskgraph.js command-name
```

## Migration Strategy

1. **Audit Phase**: Systematically check each command against the checklist
2. **Fix Phase**: Apply the standard patterns to non-compliant commands
3. **Test Phase**: Verify tag resolution works correctly
4. **Document Phase**: Update command documentation with tag support

This ensures consistent, predictable behavior across all TaskGraph commands and prevents tag deletion bugs.
