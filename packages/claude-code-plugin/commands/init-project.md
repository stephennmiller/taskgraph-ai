---
description: "TaskGraph: set up TaskGraph in this project. Use when asked to start tracking work with TaskGraph."
argument-hint: "[--quick] [<prd-file>]"
---

Set up TaskGraph in this project.

Usage: `/taskgraph:init-project [--quick] [<prd-file>]`

Arguments: $ARGUMENTS

`taskgraph init` without `-y` asks questions in the terminal, which can't be answered from here, so always pass `-y` and turn the user's answers into flags.

1. With `--quick`, `quick` or `-y`, ask nothing and run:

   ```bash
   taskgraph init -y
   ```

   Without it, first ask the user whether to commit the task files to Git, then run `taskgraph init -y --git-tasks` or `taskgraph init -y --no-git-tasks`.
2. Show the output unchanged in a code block.
3. If the arguments name a PRD file, go on with `/taskgraph:parse-prd <prd-file>`. Otherwise point out the next step `init` printed: write a PRD in `.taskgraph/docs/prd.md`, or add a first task with `/taskgraph:add-task`.
