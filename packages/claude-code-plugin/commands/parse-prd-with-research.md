---
description: "TaskGraph: turn a PRD into tasks, researching the tech first. Use for a PRD with unfamiliar tech."
argument-hint: "<PRD file path>"
---

Generate tasks from a PRD, with web research on the tech it names (the research model runs Claude Code with web search and fetch).

Arguments: $ARGUMENTS (PRD file path)

This is `/taskgraph:parse-prd <file> research` without the questions about gaps in the PRD. To be asked those first, use that command instead.

1. Put the file path in single quotes, with any `'` written as `'\''`. If the project already has tasks in the current tag, ask the user whether to add to them (`--append`) or replace them (`--force`), and add that flag.

   ```bash
   taskgraph parse-prd '<prd-file>' --research
   ```

2. Show the task lines it printed. Each task has 2-5 acceptance criteria, all unchecked, that say what "done" means.
3. Then suggest `taskgraph next`, and `/taskgraph:analyze-complexity` to find the tasks worth breaking down.
