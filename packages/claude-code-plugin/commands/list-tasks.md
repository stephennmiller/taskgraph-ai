---
description: "List tasks with intelligent argument parsing."
argument-hint: "[status] [--subtasks]"
---

List tasks with intelligent argument parsing. One command covers plain listing, status filters and the subtask tree.

Usage: `/taskgraph:list-tasks [status] [--subtasks]`

Parse arguments to determine filters and display options:
- Status: pending, in-progress, done, review, deferred, cancelled, blocked (a task whose status is `blocked`)
- Priority: high, medium, low (or priority:high)
- Special: subtasks (or `--subtasks`), tree, dependencies, "waiting" (tasks with unmet dependencies)
- IDs: Direct numbers (e.g., "1,3,5" or "1-5")
- Complex: "pending high" = pending AND high priority

Arguments: $ARGUMENTS

Let me parse your request intelligently:

1. **Detect Filter Intent**
   - If arguments contain status keywords → filter by status
   - If arguments contain priority → filter by priority
   - If arguments contain "subtasks" → include subtasks
   - If arguments contain "tree" → hierarchical view
   - If arguments contain numbers → show specific tasks
   - If arguments contain "blocked" → status filter: `taskgraph list --status=blocked`
   - If arguments contain "waiting" or "unmet dependencies" → tasks whose dependencies are not done (a different question from the `blocked` status)

2. **Smart Combinations**
   Examples of what I understand:
   - "pending high" → pending tasks with high priority
   - "done today" → tasks completed today
   - "blocked" → tasks with status `blocked`
   - "waiting" → tasks with unmet dependencies
   - "1-5" → tasks 1 through 5
   - "subtasks tree" → hierarchical view with subtasks

3. **Execute Appropriate Query**
   Based on parsed intent, run the most specific taskgraph command:
   ```bash
   taskgraph list                      # everything
   taskgraph list --status=<status>    # a status keyword was given
   taskgraph list --with-subtasks      # "subtasks" or "--subtasks" was given
   taskgraph list --status=<status> --with-subtasks
   ```

4. **Enhanced Display**
   - Group by relevant criteria
   - Show most important information first
   - Use visual indicators for quick scanning
   - Include relevant metrics

5. **Intelligent Suggestions**
   Based on what you're viewing, suggest next actions:
   - Many pending? → Suggest priority order
   - Many blocked? → Show dependency resolution
   - Looking at specific tasks? → Show related tasks