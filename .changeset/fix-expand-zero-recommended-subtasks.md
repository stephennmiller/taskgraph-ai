---
"task-master-ai": patch
---

Fix `expand` and `expand --all` ignoring a `recommendedSubtasks` of `0` in the complexity report. Tasks the analysis marks as not needing expansion are now skipped without an AI call (and counted as skipped in the `expand --all` summary) instead of being expanded into the default number of subtasks.
