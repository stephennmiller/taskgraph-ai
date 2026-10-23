---
description: "TaskGraph: every TaskGraph slash command, grouped by purpose."
---

Show every TaskGraph slash command, grouped by purpose. Show this list as it is:

```
Start
  /taskgraph:install-taskgraph [--quick]   Install the taskgraph CLI
  /taskgraph:init-project [--quick]        Set up TaskGraph in this project
  /taskgraph:view-models                   Show the AI models in use
  /taskgraph:setup-models                  Choose the AI models

Plan
  /taskgraph:parse-prd <file>              Turn a PRD into tasks, gaps first
  /taskgraph:parse-prd-with-research       Same, with web research
  /taskgraph:analyze-complexity            Score tasks, say which to split
  /taskgraph:complexity-report             Show the complexity report
  /taskgraph:expand-task <id>              Break one task into subtasks
  /taskgraph:expand-all-tasks              Break down every task without any

See
  /taskgraph:next-task                     The next task to work on
  /taskgraph:show-task <id>                One task in full
  /taskgraph:list-tasks [status]           All tasks, or one status
  /taskgraph:project-status                Progress, work in hand, bottlenecks
  /taskgraph:graph [id]                    Tasks as a dependency tree
  /taskgraph:why <id>                      Why a task is blocked

Work
  /taskgraph:to-in-progress <id>           Start a task
  /taskgraph:to-done <id>                  Check the criteria and close a task
  /taskgraph:set-status <id> <status>      Set any other status

Edit
  /taskgraph:add-task <text>               Add a task
  /taskgraph:update-task <id> <changes>    Rewrite one task
  /taskgraph:update-tasks-from-id <id>     Rewrite every task from an ID onward
  /taskgraph:remove-task <id>              Delete a task
  /taskgraph:add-subtask <id> <title>      Add a subtask
  /taskgraph:convert-task-to-subtask       Move a task under another
  /taskgraph:remove-subtask <id>           Delete a subtask, or make it a task
  /taskgraph:clear-subtasks <id>           Delete all of a task's subtasks
  /taskgraph:sync-readme                   Write the task list into README.md

Dependencies
  /taskgraph:add-dependency <id> <id>      Make a task wait on another
  /taskgraph:remove-dependency <id> <id>   Remove a dependency
  /taskgraph:validate-dependencies         Check for broken or circular links
  /taskgraph:fix-dependencies              Repair them

To have Claude Code work the tasks one after another, run taskgraph loop in a
terminal (--prompt tdd for test-first, --parallel <n> for independent tasks).
```

Then, in one sentence, suggest `/taskgraph:next-task` to find what to work on.
