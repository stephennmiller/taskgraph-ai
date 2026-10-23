---
description: "TaskGraph: pick the next task to work on. Use when the user asks what to do next or what's ready."
---

Show the next task to work on.

1. Run `taskgraph next`.
2. Show the output unchanged in a code block.
3. Then, in one or two sentences, say why it's the one (its priority, and that its dependencies are done) and offer to start it with `/taskgraph:to-in-progress <id>`. If `next` finds no task, say so and suggest `/taskgraph:graph` to see what is waiting on what.
