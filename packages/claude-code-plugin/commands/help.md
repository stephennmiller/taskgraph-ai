---
description: "TaskGraph: list the TaskGraph slash commands, grouped like the CLI's --help."
argument-hint: "[command]"
---

Show the TaskGraph slash commands. Each is named after the `taskgraph` CLI command it runs, except `to-done`, which checks a task's criteria and then closes it. Everything else is a CLI command; the list ends with the ones people reach for.

Arguments: $ARGUMENTS

If the arguments name a command in the list below, read its line and run `taskgraph <command> --help` for its CLI flags (for `to-done`, `taskgraph set-status --help`), and show that output unchanged. Otherwise show this list as it is:

```
Daily workflow
  /taskgraph:next                              The next task to work on
  /taskgraph:show <task-id>                    One task in full
  /taskgraph:list [status]                     All tasks, or one status
  /taskgraph:set-status <task-id> <status>     Start a task, or set any status
  /taskgraph:to-done [task-id]                 Check the criteria and close a task
  /taskgraph:note [task-id] [note]             Log a progress note, as written
  /taskgraph:graph [task-id]                   Tasks as a dependency tree
  /taskgraph:why <task-id>                     Why a task is blocked
  /taskgraph:loop [runs]                       Have Claude Code work the tasks

Planning
  /taskgraph:go <prd-file>                     Plan a PRD and build every task
  /taskgraph:init [--quick]                    Install the CLI, set up this project
  /taskgraph:parse-prd <prd-file> [research]   Turn a PRD into tasks, gaps first
  /taskgraph:add-task <description>            Add a task
  /taskgraph:update <task-id> <changes>        Rewrite one task
  /taskgraph:analyze-complexity                Score tasks, say which to split
  /taskgraph:expand <task-id>|all              Break tasks into subtasks

In the CLI
  taskgraph models                             Show or choose the AI models
  taskgraph update --from                      Rewrite every task from an ID onward
  taskgraph depend <id> <ids> [--remove]       Make a task wait on others, or not
  taskgraph fix-dependencies [--check]         Check or fix broken or circular links
  taskgraph add-subtask                        Add or move a subtask
  taskgraph remove-task                        Delete a task or subtask
  taskgraph analyze-complexity --report        Show the complexity report
  taskgraph --help                             Everything else
```

Then, in one sentence, suggest `/taskgraph:next` to find what to work on. In a project with no tasks yet, start with `/taskgraph:go <prd-file>` to plan a PRD and build it, or `/taskgraph:init` and `/taskgraph:parse-prd` to plan first.
