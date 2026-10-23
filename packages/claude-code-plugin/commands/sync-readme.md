---
description: "TaskGraph: write the task list into README.md."
argument-hint: "[status] [with-subtasks]"
---

Write the current task list into the project's README.md.

Arguments: $ARGUMENTS

1. Run:

   ```bash
   taskgraph sync-readme
   ```

   Add `--with-subtasks` if the arguments ask for subtasks, and `--status=<status>` for a status (pending, in-progress, done, review, deferred, cancelled, blocked).
2. Show the output unchanged. The list goes between the `<!-- TASKGRAPH_EXPORT_START -->` and `<!-- TASKGRAPH_EXPORT_END -->` markers, replacing the previous export, or at the end of README.md the first time. The rest of the file stays as it was.
3. Then run `git diff --stat README.md` and tell the user the README changed, ready to commit.
