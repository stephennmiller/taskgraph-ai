---
description: "TaskGraph: list the TaskGraph slash commands, grouped like the CLI's --help."
argument-hint: "[command]"
---

Show the TaskGraph slash commands. Each is named after the `taskgraph` CLI command it runs, except `to-done`, which checks a task's criteria and then closes it. Everything else is a CLI command; the list ends with the ones people reach for.

Arguments: $ARGUMENTS

If the arguments name a command in the list below, read its line and run `taskgraph <command> --help` for its CLI flags (for `to-done`, `taskgraph set-status --help`), and show that output unchanged. Otherwise show this list as it is:

```
Daily workflow
  /taskgraph:next                          The next task to work on
  /taskgraph:show <id>                     One task in full
  /taskgraph:list [status]                 All tasks, or one status
  /taskgraph:set-status <id> <status>      Start a task, or set any status
  /taskgraph:to-done <id>                  Check the criteria and close a task
  /taskgraph:note <id> <text>              Log a progress note, as written
  /taskgraph:graph [id]                    Tasks as a dependency tree
  /taskgraph:why <id>                      Why a task is blocked
  /taskgraph:loop [n]                      Have Claude Code work the tasks

Planning
  /taskgraph:init [--quick]                Install the CLI, set up this project
  /taskgraph:parse-prd <file> [research]   Turn a PRD into tasks, gaps first
  /taskgraph:add-task <text>               Add a task
  /taskgraph:update-task <id> <changes>    Rewrite one task
  /taskgraph:analyze-complexity            Score tasks, say which to split
  /taskgraph:expand <id>|all               Break tasks into subtasks

In the CLI
  taskgraph models                         Show or choose the AI models
  taskgraph update                         Rewrite every task from an ID onward
  taskgraph add-dependency                 Make a task wait on another
  taskgraph remove-dependency              Remove a dependency
  taskgraph validate-dependencies          Check for broken or circular links
  taskgraph add-subtask / remove-subtask   Add, move or delete subtasks
  taskgraph remove-task                    Delete a task
  taskgraph complexity-report              Show the complexity report
  taskgraph --help                         Everything else
```

Then, in one sentence, suggest `/taskgraph:next` to find what to work on. In a project with no tasks yet, start with `/taskgraph:init` and `/taskgraph:parse-prd`.
