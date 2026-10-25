---
name: taskgraph
description: Track and plan work with TaskGraph in a project that has a .taskgraph/ folder. Use when the user asks what to work on next, what's in progress or left to do, why a task is blocked, to plan, size or break down work, to add, change or close a task, about task dependencies, tags or TaskGraph's models, or names a task ID like 3 or 3.2.
---

# TaskGraph

This project tracks its work in TaskGraph. Check that `.taskgraph/` exists in the project root; if it doesn't, this skill doesn't apply.

Start with `taskgraph prime`. It prints the task in progress with its done-when criteria, the next ready tasks, and the workflow rules. Follow those rules; they are the single source for how to work a task.

For what the user asked:

- What next: `taskgraph next`, then `taskgraph show <id>` for its details.
- What's left: `taskgraph list --status=pending` (or `--status=in-progress`, `--tag=<tag>`).
- Plan from a spec: `taskgraph parse-prd <file>`, then `taskgraph expand --id=<id>` for a task too big to do in one go.
- New work: `taskgraph add-task --prompt='<what>'`.
- Start a task: `taskgraph set-status --id=<id> --status=in-progress`.
- Log progress: `taskgraph note <id> '<what you did or decided>'`.
- Finish: check its criteria, then `taskgraph set-status --id=<id> --status=done`.
- Why blocked, or the whole graph: `taskgraph why <id>`, `taskgraph graph`.
- Change a task: `taskgraph update-task --id=<id> --prompt='<change>'`.
- Size the work: `taskgraph analyze-complexity`, then `taskgraph expand --all`.
- Dependencies look wrong: `taskgraph validate-dependencies`, then `taskgraph fix-dependencies`.
- Separate task lists: `taskgraph tags`, `taskgraph tags add <name>`, `taskgraph tags use <name>`.
- Models: `taskgraph models --set-main <opus|sonnet|haiku>` (also `--set-research`, `--set-fallback`).
- Anything else: `taskgraph --help` lists every command.

Put free text (a prompt, a note) in single quotes and write any `'` in it as `'\''`. In double quotes the shell runs backticks and `$(...)` in the text.

Change tasks through these commands, not by editing `.taskgraph/tasks/tasks.json`. `taskgraph <command> --help` lists a command's flags.
