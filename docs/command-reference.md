# Task Master Command Reference

Here's a comprehensive reference of all available commands:

## Parse PRD

```bash
# Parse a PRD file and generate tasks
taskgraph parse-prd <prd-file.txt>

# Limit the number of tasks generated (default is 10)
taskgraph parse-prd <prd-file.txt> --num-tasks=5

# Allow task master to determine the number of tasks based on complexity
taskgraph parse-prd <prd-file.txt> --num-tasks=0
```

## List Tasks

```bash
# List all tasks
taskgraph list

# List tasks with a specific status
taskgraph list --status=<status>

# List tasks with subtasks
taskgraph list --with-subtasks

# List tasks with a specific status and include subtasks
taskgraph list --status=<status> --with-subtasks
```

## Show Next Task

```bash
# Show the next task to work on based on dependencies and status
taskgraph next
```

## Show Specific Task

```bash
# Show details of a specific task
taskgraph show <id>
# or
taskgraph show --id=<id>

# View multiple tasks with comma-separated IDs
taskgraph show 1,3,5
taskgraph show 44,55

# View a specific subtask (e.g., subtask 2 of task 1)
taskgraph show 1.2

# Mix parent tasks and subtasks
taskgraph show 44,44.1,55,55.2
```

**Multiple Task Display:**

- **Single ID**: Shows detailed task view with full implementation details
- **Multiple IDs**: Shows compact summary table with interactive action menu
- **Action Menu**: Provides copy-paste ready commands for batch operations:
  - Mark all as in-progress/done
  - Show next available task
  - Expand all tasks (generate subtasks)
  - View dependency relationships
  - Generate task files

## Update Tasks

```bash
# Update tasks from a specific ID and provide context
taskgraph update --from=<id> --prompt="<prompt>"

# Update tasks using research role
taskgraph update --from=<id> --prompt="<prompt>" --research
```

## Update a Specific Task

```bash
# Update a single task by ID with new information
taskgraph update-task --id=<id> --prompt="<prompt>"

# Use research-backed updates
taskgraph update-task --id=<id> --prompt="<prompt>" --research
```

## Update a Subtask

```bash
# Append additional information to a specific subtask
taskgraph update-subtask --id=<parentId.subtaskId> --prompt="<prompt>"

# Example: Add details about API rate limiting to subtask 2 of task 5
taskgraph update-subtask --id=5.2 --prompt="Add rate limiting of 100 requests per minute"

# Use research-backed updates
taskgraph update-subtask --id=<parentId.subtaskId> --prompt="<prompt>" --research
```

Unlike the `update-task` command which replaces task information, the `update-subtask` command _appends_ new information to the existing subtask details, marking it with a timestamp. This is useful for iteratively enhancing subtasks while preserving the original content.

## Set Task Status

```bash
# Set status of a single task
taskgraph set-status --id=<id> --status=<status>

# Set status for multiple tasks
taskgraph set-status --id=1,2,3 --status=<status>

# Set status for subtasks
taskgraph set-status --id=1.1,1.2 --status=<status>
```

When marking a task as "done", all of its subtasks will automatically be marked as "done" as well.

## Expand Tasks

```bash
# Expand a specific task with subtasks
taskgraph expand --id=<id> --num=<number>

# Expand a task with a dynamic number of subtasks (ignoring complexity report)
taskgraph expand --id=<id> --num=0

# Expand with additional context
taskgraph expand --id=<id> --prompt="<context>"

# Expand all pending tasks
taskgraph expand --all

# Force regeneration of subtasks for tasks that already have them
taskgraph expand --all --force

# Research-backed subtask generation for a specific task
taskgraph expand --id=<id> --research

# Research-backed generation for all tasks
taskgraph expand --all --research
```

## Clear Subtasks

```bash
# Clear subtasks from a specific task
taskgraph clear-subtasks --id=<id>

# Clear subtasks from multiple tasks
taskgraph clear-subtasks --id=1,2,3

# Clear subtasks from all tasks
taskgraph clear-subtasks --all
```

## Analyze Task Complexity

```bash
# Analyze complexity of all tasks
taskgraph analyze-complexity

# Save report to a custom location
taskgraph analyze-complexity --output=my-report.json

# Use a specific LLM model
taskgraph analyze-complexity --model=claude-3-opus-20240229

# Set a custom complexity threshold (1-10)
taskgraph analyze-complexity --threshold=6

# Use an alternative tasks file
taskgraph analyze-complexity --file=custom-tasks.json

# Use Perplexity AI for research-backed complexity analysis
taskgraph analyze-complexity --research
```

## View Complexity Report

```bash
# Display the task complexity analysis report
taskgraph complexity-report

# View a report at a custom location
taskgraph complexity-report --file=my-report.json
```

## Managing Task Dependencies

```bash
# Add a dependency to a task
taskgraph add-dependency --id=<id> --depends-on=<id>

# Remove a dependency from a task
taskgraph remove-dependency --id=<id> --depends-on=<id>

# Validate dependencies without fixing them
taskgraph validate-dependencies

# Find and fix invalid dependencies automatically
taskgraph fix-dependencies
```

## Move Tasks

```bash
# Move a task or subtask to a new position
taskgraph move --from=<id> --to=<id>

# Examples:
# Move task to become a subtask
taskgraph move --from=5 --to=7

# Move subtask to become a standalone task
taskgraph move --from=5.2 --to=7

# Move subtask to a different parent
taskgraph move --from=5.2 --to=7.3

# Reorder subtasks within the same parent
taskgraph move --from=5.2 --to=5.4

# Move a task to a new ID position (creates placeholder if doesn't exist)
taskgraph move --from=5 --to=25

# Move multiple tasks at once (must have the same number of IDs)
taskgraph move --from=10,11,12 --to=16,17,18
```

## Add a New Task

```bash
# Add a new task using AI (main role)
taskgraph add-task --prompt="Description of the new task"

# Add a new task using AI (research role)
taskgraph add-task --prompt="Description of the new task" --research

# Add a task with dependencies
taskgraph add-task --prompt="Description" --dependencies=1,2,3

# Add a task with priority
taskgraph add-task --prompt="Description" --priority=high
```

## Tag Management

Task Master supports tagged task lists for multi-context task management. Each tag represents a separate, isolated context for tasks.

```bash
# List all available tags with task counts and status
taskgraph tags

# List tags with detailed metadata
taskgraph tags --show-metadata

# Create a new empty tag
taskgraph add-tag <tag-name>

# Create a new tag with a description
taskgraph add-tag <tag-name> --description="Feature development tasks"

# Create a tag based on current git branch name
taskgraph add-tag --from-branch

# Create a new tag by copying tasks from the current tag
taskgraph add-tag <new-tag> --copy-from-current

# Create a new tag by copying from a specific tag
taskgraph add-tag <new-tag> --copy-from=<source-tag>

# Switch to a different tag context
taskgraph use-tag <tag-name>

# Rename an existing tag
taskgraph rename-tag <old-name> <new-name>

# Copy an entire tag to create a new one
taskgraph copy-tag <source-tag> <target-tag>

# Copy a tag with a description
taskgraph copy-tag <source-tag> <target-tag> --description="Copied for testing"

# Delete a tag and all its tasks (with confirmation)
taskgraph delete-tag <tag-name>

# Delete a tag without confirmation prompt
taskgraph delete-tag <tag-name> --yes
```

**Tag Context:**
- All task operations (list, show, add, update, etc.) work within the currently active tag
- Use `--tag=<name>` flag with most commands to operate on a specific tag context
- Tags provide complete isolation - tasks in different tags don't interfere with each other

## Initialize a Project

```bash
# Initialize a new project with Task Master structure
taskgraph init

# Set up the Claude Code integration (CLAUDE.md import, .mcp.json, slash commands)
taskgraph init --rules claude
```

- `claude` is the only supported rule profile; any other value is rejected with an error.
- Without `--rules`, `init` asks whether to set up the Claude Code integration (`--yes` skips the prompt and installs nothing).

## Configure AI Models

```bash
# View current AI model configuration and API key status
taskgraph models

# Set the primary model for generation/updates (provider inferred if known)
taskgraph models --set-main=claude-3-opus-20240229

# Set the research model
taskgraph models --set-research=sonar-pro

# Set the fallback model
taskgraph models --set-fallback=claude-3-haiku-20240307

# Set a custom Ollama model for the main role
taskgraph models --set-main=my-local-llama --ollama

# Set a custom OpenRouter model for the research role
taskgraph models --set-research=google/gemini-pro --openrouter

# Set Codex CLI model for the main role (uses ChatGPT subscription via OAuth)
taskgraph models --set-main=gpt-5-codex --codex-cli

# Set Codex CLI model for the fallback role
taskgraph models --set-fallback=gpt-5 --codex-cli

# Run interactive setup to configure models, including custom ones
taskgraph models --setup
```

Configuration is stored in `.taskmaster/config.json` in your project root (legacy `.taskmasterconfig` files are automatically migrated). API keys are still managed via `.env` or MCP configuration. Use `taskgraph models` without flags to see available built-in models. Use `--setup` for a guided experience.

State is stored in `.taskmaster/state.json` in your project root. It maintains important information like the current tag. Do not manually edit this file.

## Research Fresh Information

```bash
# Perform AI-powered research with fresh, up-to-date information
taskgraph research "What are the latest best practices for JWT authentication in Node.js?"

# Research with specific task context
taskgraph research "How to implement OAuth 2.0?" --id=15,16

# Research with file context for code-aware suggestions
taskgraph research "How can I optimize this API implementation?" --files=src/api.js,src/auth.js

# Research with custom context and project tree
taskgraph research "Best practices for error handling" --context="We're using Express.js" --tree

# Research with different detail levels
taskgraph research "React Query v5 migration guide" --detail=high

# Disable interactive follow-up questions (useful for scripting, is the default for MCP)
# Use a custom tasks file location
taskgraph research "How to implement this feature?" --file=custom-tasks.json

# Research within a specific tag context
taskgraph research "Database optimization strategies" --tag=feature-branch

# Save research conversation to .taskmaster/docs/research/ directory (for later reference)
taskgraph research "Database optimization techniques" --save-file

# Save key findings directly to a task or subtask (recommended for actionable insights)
taskgraph research "How to implement OAuth?" --save-to=15
taskgraph research "API optimization strategies" --save-to=15.2

# Combine context gathering with automatic saving of findings
taskgraph research "Best practices for this implementation" --id=15,16 --files=src/auth.js --save-to=15.3
```

**The research command is a powerful exploration tool that provides:**

- **Fresh information beyond AI knowledge cutoffs**
- **Project-aware context** from your tasks and files
- **Automatic task discovery** using fuzzy search
- **Multiple detail levels** (low, medium, high)
- **Token counting and cost tracking**
- **Interactive follow-up questions** for deep exploration
- **Flexible save options** (commit findings to tasks or preserve conversations)
- **Iterative discovery** through continuous questioning and refinement

**Use research frequently to:**

- Get current best practices before implementing features
- Research new technologies and libraries
- Find solutions to complex problems
- Validate your implementation approaches
- Stay updated with latest security recommendations

**Interactive Features (CLI):**

- **Follow-up questions** that maintain conversation context and allow deep exploration
- **Save menu** during or after research with flexible options:
  - **Save to task/subtask**: Commit key findings and actionable insights (recommended)
  - **Save to file**: Preserve entire conversation for later reference if needed
  - **Continue exploring**: Ask more follow-up questions to dig deeper
- **Automatic file naming** with timestamps and query-based slugs when saving conversations
