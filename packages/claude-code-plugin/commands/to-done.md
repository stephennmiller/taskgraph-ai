---
description: "Check a task's acceptance criteria against your changes, write a close summary, and mark it done."
argument-hint: "[task ID]"
---

Close a task: verify what you can, record what changed, then mark it done.

Arguments: $ARGUMENTS (task ID, e.g. `3` or a subtask like `3.2`). With no ID, use the task `taskgraph list --status=in-progress --with-subtasks` shows; if there are several, ask which one. Put the ID into the commands below only when it is digits and dots (`3`, `3.2`); otherwise ask the user for the task ID.

## 1. Read the checklist

```bash
taskgraph show <id>
```

`show` numbers the checklist: the task's acceptance criteria first, then the project's Definition of Done (top-level tasks only). Those numbers are what `--check` takes. `taskgraph show <id> --json` has the details and test strategy; its `acceptanceCriteria` holds the criteria with their `checked` state, but not the Definition of Done.

## 2. Check the work against each item

Find the changes for this task: uncommitted work (`git status --short`, `git diff HEAD`) and the commits on this branch (`git log --oneline <base>..HEAD`, `git diff <base>...HEAD`, where `<base>` is usually `main`).

Run the `task-checker` agent (`taskgraph:task-checker`) with:

- the task ID
- every unchecked checklist item, with its number and text, exactly as `show` printed it
- how to see the diff (the commands above, with the base filled in)
- a request for a verdict on each numbered item: `met`, `not met` or `unclear`, each with evidence (a file and line, or a command and its result)

Read the report yourself. An item counts as met only when its evidence is concrete and you can see it holds. Treat `unclear` as not met. With no checklist items, the checker still reviews the diff against the task's details and test strategy.

## 3. Tick what was confirmed

Check off the confirmed items in one call, by the numbers `show` listed:

```bash
taskgraph set-status --id=<id> --check <n>,<n>
```

Then tell the user, one line per item, which items are still open and why (the checker's reason and evidence). Don't tick an item just to get past the gate.

If any item is still unchecked, or the checker found a failing test or build, stop here. Ask the user whether to keep working on it or to mark the task done anyway. Pass `--force` to `set-status` only when the user says so.

## 4. Write the close summary

Write three lines, in plain words, from the diff:

- `Changed:` what the task now does, in one sentence
- `Files:` the main files touched
- `Follow-ups:` anything left for later, or `none`

Save it on the task before marking it done. `taskgraph note` works for a task or a subtask and saves the text as written, with a timestamp and no AI call:

```bash
taskgraph note <id> 'Close summary
Changed: ...
Files: ...
Follow-ups: ...'
```

Keep the summary in single quotes, and write any `'` inside it as `'\''`. In double quotes the shell would run backticks and `$(...)` in the text, and summaries quote file names and code from the diff.

If the call fails, show the summary to the user and go on.

## 5. Mark it done

```bash
taskgraph set-status --id=<id> --status=done
```

`set-status` refuses while any checklist item is unchecked and lists them. Report that to the user; don't retry with `--force` unless they say so.

## 6. What's next

```bash
taskgraph next
```

End with what the task closed, any follow-ups from the summary, and the next task `next` suggests.
