---
description: "TaskGraph: fix invalid or circular task dependencies that validate found."
---

Repair invalid dependencies: links to tasks that don't exist, tasks that depend on themselves, duplicates and loops.

1. Run `taskgraph fix-dependencies`.
2. Show the output unchanged in a code block.
3. Then run `taskgraph validate-dependencies` and say in one sentence whether anything is left that needs a manual change (`/taskgraph:remove-dependency`).
