---
description: "TaskGraph: list the TaskGraph slash commands, grouped like the CLI's --help."
argument-hint: "[command]"
---

Show the TaskGraph slash commands. Each is named after the `taskgraph` CLI command it runs, except `to-done` and `project-status`, which do more than one CLI command.

Arguments: $ARGUMENTS

If the arguments name a command in the list below, read its line and run `taskgraph <command> --help` for its CLI flags (for `to-done` and `project-status`, `taskgraph set-status --help` and `taskgraph prime --help`), and show that output unchanged. Otherwise show this list as it is:

```
Daily workflow
  /taskgraph:next                          The next task to work on
  /taskgraph:show <id>                     One task in full
  /taskgraph:list [status]                 All tasks, or one status
  /taskgraph:project-status                Progress, work in hand, bottlenecks
  /taskgraph:set-status <id> <status>      Start a task, or set any status
  /taskgraph:to-done <id>                  Check the criteria and close a task
  /taskgraph:add-task <text>               Add a task
  /taskgraph:loop [n]                      Have Claude Code work the tasks

Setup
  /taskgraph:init [--quick]                Install the CLI, set up this project
  /taskgraph:models [setup]                Show or choose the AI models

Create & update
  /taskgraph:parse-prd <file> [research]   Turn a PRD into tasks, gaps first
  /taskgraph:update <id> <changes>         Rewrite every task from an ID onward
  /taskgraph:update-task <id> <changes>    Rewrite one task
  /taskgraph:note <id> <text>              Log a progress note, as written
  /taskgraph:add-subtask <id> <title>      Add a subtask, or move a task under
  /taskgraph:remove-task <id>              Delete a task
  /taskgraph:remove-subtask <id>           Delete a subtask, or make it a task
  /taskgraph:clear-subtasks <id>           Delete all of a task's subtasks
  /taskgraph:sync-readme                   Write the task list into README.md

Analyze & expand
  /taskgraph:analyze-complexity            Score tasks, say which to split
  /taskgraph:complexity-report             Show the complexity report
  /taskgraph:expand <id>|all               Break tasks into subtasks

Organize
  /taskgraph:graph [id]                    Tasks as a dependency tree
  /taskgraph:why <id>                      Why a task is blocked
  /taskgraph:add-dependency <id> <id>      Make a task wait on another
  /taskgraph:remove-dependency <id> <id>   Remove a dependency
  /taskgraph:validate-dependencies         Check for broken or circular links
  /taskgraph:fix-dependencies              Repair what it can
```

Then, in one sentence, suggest `/taskgraph:next` to find what to work on. In a project with no tasks yet, start with `/taskgraph:init` and `/taskgraph:parse-prd`.
