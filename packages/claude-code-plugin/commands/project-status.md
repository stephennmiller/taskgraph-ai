---
description: "TaskGraph: show where the plan stands: done, in progress, blocked, next. Use when asked for status."
---

Show where the plan stands.

1. Run `taskgraph prime`. Its first line says how many tasks are done (`1 of 5 tasks done`); `In progress` names the task being worked on and `Ready next` the tasks that can start now.
2. Run `taskgraph graph` for what holds the plan up.
3. Show the first line and the `In progress` and `Ready next` sections of `prime` unchanged in a code block, then the `Bottlenecks`, `Critical path` and `N waves · N tasks can run now` lines from `graph`.
4. Then, in one or two sentences, say how far along the plan is, what is in progress, and the top bottleneck to finish first. Report only what the output shows.
