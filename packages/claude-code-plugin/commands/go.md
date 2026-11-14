---
description: "TaskGraph: plan a PRD into tasks and have Claude Code build them. Use to build a whole PRD in one step."
argument-hint: "<prd-file> [sandbox]"
---

Run `taskgraph go`: it sets up TaskGraph if this folder isn't a project yet, plans the PRD into tasks, then runs `taskgraph loop`, where Claude Code finishes one ready task per session, marking it done and committing it. Run again, it adds tasks only for PRD sections that are new and picks up where it left off.

Usage: `/taskgraph:go <prd-file> [sandbox]`

Arguments: $ARGUMENTS (PRD file path, then optionally `sandbox`)

1. Take the PRD path from the arguments; with none, ask which file. Check that the file exists (Read or Glob) before anything else. If it doesn't, say so and stop: don't pick another file and don't write one. The user writes the PRD first, for example in `.taskgraph/docs/prd.md`.
2. Build the command with the path in single quotes, writing any `'` in it as `'\''`:

   ```bash
   taskgraph go '<prd-file>'
   ```

   `sandbox` → `--sandbox`, each run in Docker.
3. Without `sandbox`, each run has permission prompts off: it can read, edit and run anything in this project without asking. Tell the user that, with the command you'll run, and go on only once they agree. Then add `--trust`; `loop` can't ask for itself from here.
4. Planning takes a minute or two and a run takes minutes per task, so run the command in the background and tell the user it started. The user can run the same command in their own terminal instead, to watch each run.
5. When it finishes, show what it printed: the tasks it planned, then the summary of each task it worked and its status. If a step failed, show its error and stop; the later steps didn't run. Then suggest `/taskgraph:list` to see where the plan stands.
