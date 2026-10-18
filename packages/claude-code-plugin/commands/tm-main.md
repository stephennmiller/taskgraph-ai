# TaskGraph Command Reference

Comprehensive command structure for TaskGraph integration with Claude Code.

## Command Organization

Commands are organized hierarchically to match TaskGraph's CLI structure while providing enhanced Claude Code integration.

## Project Setup & Configuration

### `/taskgraph:init`
- `init-project` - Initialize new project (handles PRD files intelligently)
- `init-project-quick` - Quick setup with auto-confirmation (-y flag)

### `/taskgraph:models`
- `view-models` - View current AI model configuration
- `setup-models` - Interactive model configuration
- `set-main` - Set primary generation model
- `set-research` - Set research model
- `set-fallback` - Set fallback model

## Task Generation

### `/taskgraph:parse-prd`
- `parse-prd` - Generate tasks from PRD document
- `parse-prd-with-research` - Enhanced parsing with research mode

### `/taskgraph:generate`
- `generate-tasks` - Create individual task files from tasks.json

## Task Management

### `/taskgraph:list`
- `list-tasks` - Smart listing with natural language filters
- `list-tasks-with-subtasks` - Include subtasks in hierarchical view
- `list-tasks-by-status` - Filter by specific status

### `/taskgraph:set-status`
- `to-pending` - Reset task to pending
- `to-in-progress` - Start working on task
- `to-done` - Mark task complete
- `to-review` - Submit for review
- `to-deferred` - Defer task
- `to-cancelled` - Cancel task

### `/taskgraph:sync-readme`
- `sync-readme` - Export tasks to README.md with formatting

### `/taskgraph:update`
- `update-task` - Update tasks with natural language
- `update-tasks-from-id` - Update multiple tasks from a starting point
- `update-single-task` - Update specific task

### `/taskgraph:add-task`
- `add-task` - Add new task with AI assistance

### `/taskgraph:remove-task`
- `remove-task` - Remove task with confirmation

## Subtask Management

### `/taskgraph:add-subtask`
- `add-subtask` - Add new subtask to parent
- `convert-task-to-subtask` - Convert existing task to subtask

### `/taskgraph:remove-subtask`
- `remove-subtask` - Remove subtask (with optional conversion)

### `/taskgraph:clear-subtasks`
- `clear-subtasks` - Clear subtasks from specific task
- `clear-all-subtasks` - Clear all subtasks globally

## Task Analysis & Breakdown

### `/taskgraph:analyze-complexity`
- `analyze-complexity` - Analyze and generate expansion recommendations

### `/taskgraph:complexity-report`
- `complexity-report` - Display complexity analysis report

### `/taskgraph:expand`
- `expand-task` - Break down specific task
- `expand-all-tasks` - Expand all eligible tasks
- `with-research` - Enhanced expansion

## Task Navigation

### `/taskgraph:next`
- `next-task` - Intelligent next task recommendation

### `/taskgraph:show`
- `show-task` - Display detailed task information

### `/taskgraph:status`
- `project-status` - Comprehensive project dashboard

## Dependency Management

### `/taskgraph:add-dependency`
- `add-dependency` - Add task dependency

### `/taskgraph:remove-dependency`
- `remove-dependency` - Remove task dependency

### `/taskgraph:validate-dependencies`
- `validate-dependencies` - Check for dependency issues

### `/taskgraph:fix-dependencies`
- `fix-dependencies` - Automatically fix dependency problems

## Workflows & Automation

### `/taskgraph:workflows`
- `smart-workflow` - Context-aware intelligent workflow execution
- `command-pipeline` - Chain multiple commands together
- `auto-implement-tasks` - Advanced auto-implementation with code generation

## Utilities

### `/taskgraph:utils`
- `analyze-project` - Deep project analysis and insights

### `/taskgraph:setup`
- `install-taskgraph` - Comprehensive installation guide
- `quick-install-taskgraph` - One-line global installation

## Usage Patterns

### Natural Language
Most commands accept natural language arguments:
```
/taskgraph:add-task create user authentication system
/taskgraph:update mark all API tasks as high priority
/taskgraph:list show blocked tasks
```

### ID-Based Commands
Commands requiring IDs intelligently parse from $ARGUMENTS:
```
/taskgraph:show 45
/taskgraph:expand 23
/taskgraph:set-status/to-done 67
```

### Smart Defaults
Commands provide intelligent defaults and suggestions based on context.