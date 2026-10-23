---
description: "TaskGraph: check task dependencies for missing or circular links."
---

Check the plan's dependencies for problems, without changing anything.

1. Run `taskgraph validate-dependencies`.
2. Show the output unchanged in a code block.
3. Then, in one or two sentences, say what to fix: dependencies on tasks that don't exist and dependency loops (`/taskgraph:fix-dependencies` repairs them), and any PRD sections no task covers, which are warnings only.
