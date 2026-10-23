---
description: "TaskGraph: show where the plan stands: done, in progress, blocked, next. Use when asked for status."
---

Show where the plan stands.

1. Run `taskgraph list --status=in-progress`. The summary at the top counts done, in-progress and pending tasks and subtasks, how many are ready or waiting on dependencies, and names the next task; the table lists the tasks in progress.
2. Run `taskgraph graph` for what holds the plan up.
3. Show the `list` output unchanged in a code block, then the `Bottlenecks`, `Critical path` and `N waves · N tasks can run now` lines from `graph`.
4. Then, in one or two sentences, say how far along the plan is, what is in progress, and the top bottleneck to finish first. Report only what the output shows.
