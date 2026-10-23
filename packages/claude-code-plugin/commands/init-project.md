---
description: "TaskGraph: set up TaskGraph in this project. Use when asked to start tracking work with TaskGraph."
argument-hint: "[--quick] [<prd-file>]"
---

Initialize a new TaskGraph project.

Usage: `/taskgraph:init-project [--quick] [<prd-file>]`

Arguments: $ARGUMENTS

Parse arguments to determine initialization preferences.

## Initialization Process

1. **Parse Arguments**
   - PRD file path (if provided)
   - Project name
   - Auto-confirm flag (-y)

2. **Project Setup**
   ```bash
   taskgraph init       # interactive
   taskgraph init -y    # with --quick, quick or -y: accept all defaults
   ```

3. **Smart Initialization**
   - Detect existing project files
   - Suggest project name from directory
   - Check for git repository
   - Verify AI provider configuration

## Configuration Options

Based on arguments:
- `--quick` / `quick` / `-y` → Skip confirmations and accept all defaults (`taskgraph init -y`)
- `<file.md>` → Use as PRD after init
- `--name=<name>` → Set project name
- `--description=<desc>` → Set description

## Post-Initialization

After successful init:
1. Show project structure created
2. Verify AI models configured
3. Suggest next steps:
   - Parse PRD if available
   - Configure AI providers
   - Set up git hooks
   - Create first tasks

## Integration

If PRD file provided:
```
/taskgraph:init-project my-prd.md
→ Automatically runs parse-prd after init
```

## Quick mode

`--quick` runs `taskgraph init -y` without prompts:
- Creates the `.taskgraph/` directory structure and an empty `tasks.json`
- Uses the directory name as project name and the default configuration

Then configure models with `/taskgraph:setup-models`, parse a PRD with `/taskgraph:parse-prd <file>`, or create a first task with `/taskgraph:add-task`.
